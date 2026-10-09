import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { DigestDb, DigestRecipient, RunTotals, StoredPayload } from '../_shared/db.ts';
import { BUDGET_MS, MAX_SENDS, runDigest, type RunConfig } from '../_shared/digestRun.ts';
import { dueKinds } from '../_shared/pacific.ts';
import { sendEmail, type OutgoingEmail, type SendResult } from '../_shared/resend.ts';
import { verifyToken } from '../_shared/token.ts';
import { handle, type DigestEnv } from './index.ts';

const RUN = '99999999-0000-4000-8000-000000000001';
const RUN2 = '99999999-0000-4000-8000-000000000002';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-12-05T02:07:00Z'); // 18:07 PST, a Friday
const WINDOW_FROM = '2026-12-04T02:07:00.000000Z';
const WINDOW_TO = '2026-12-05T02:07:00Z';

/** A mutable clock shared by the config and the fake database. */
function clock(start = NOW.getTime()) {
  const c = { t: start, now: () => new Date(c.t), advance: (ms: number) => { c.t += ms; } };
  return c;
}

const cfg = (over: Partial<RunConfig> = {}): RunConfig => ({
  siteUrl: 'https://example.test', functionsUrl: 'https://fn.example.test/functions/v1', from: 'Test <t@example.test>',
  hmacSecret: 'hmac-test', resendKey: 're_test', paceMs: 0, now: () => NOW, ...over,
});

type Row = Omit<DigestRecipient, 'idempotency_key' | 'run_id' | 'window_to' | 'payload'> & { window_from: string };
// A subscriber as svc_digest_batch sees it (the key, run and window are filled in by the fake, as the SQL does).
const recipient = (n: number, withContent = true): Row => ({
  user_id: uid(n), email: `person${n}@example.test`, public_id: uid(1000 + n), token_version: 2,
  region_slug: 'truckee', region_name: 'Truckee', timezone: 'America/Los_Angeles', cadence: 'daily',
  houses: withContent ? [{ id: uid(5000 + n), address: `${n} Pine St` }] : [], house_total: withContent ? 1 : 0,
  events: [], event_total: 0, window_from: WINDOW_FROM,
});
const keyOf = (n: number, to = WINDOW_TO) => `digest:${uid(1000 + n)}:${WINDOW_FROM}/${to}`;
/** The request body sendEmail would POST: what Resend compares for a reused key. */
const wire = (e: OutgoingEmail) => JSON.stringify(e);

type Status = 'sending' | 'sent' | 'failed';
interface Entry {
  run: string; user: string; status: Status; attempts: number; key: string; windowTo: string; touched: number;
  payload: StoredPayload | null;
}
interface Fake extends DigestDb {
  runId: string;
  windowTo: string;
  cap: number;
  ledger: Map<string, Entry>;
  advanced: Set<string>; // users whose last_sent_through moved
  marks: string[];
  capHit: boolean;
  stores: number;
}

/**
 * Mirrors the SQL contract of svc_digest_* (20261016000200):
 *  - batch resumes, first, any user's `sending` row (any run) idle for 5 minutes, with that row's run, key and window;
 *    and that row's stored payload (returned the way jsonb does: a fresh object, header keys in another order);
 *  - then claims people with content, no unresolved send and no row in this run, with key
 *    digest:<public_id>:<window start>/<window end>;
 *  - only NEW claims are limited by the cap (rows claimed today that are sent or sending), setting cap_hit; a resume
 *    needs no room;
 *  - storePayload stores once, accepts the same payload again, refuses a different one;
 *  - mark changes only a `sending` row, clears its payload, and advances last_sent_through only on ok.
 */
function fakeDb(rows: Row[], c: { now: () => Date }, opts: { cap?: number; sentToday?: number } = {}): Fake {
  const f: Fake = {
    runId: RUN, windowTo: WINDOW_TO, cap: opts.cap ?? 500, ledger: new Map(), advanced: new Set(), marks: [], capHit: false, stores: 0,
    start: () => Promise.resolve(f.runId),
    batch(run, limit) {
      const now = c.now().getTime();
      const usedToday = (opts.sentToday ?? 0) + [...f.ledger.values()].filter((l) => l.status !== 'failed').length;
      const room = Math.max(0, f.cap - usedToday);
      let fresh_n = 0;
      const out: DigestRecipient[] = [];
      const open = (u: string) => [...f.ledger.values()].find((l) => l.user === u && l.status === 'sending');
      const resumes: { row: Row; resume?: Entry }[] = [];
      const fresh: { row: Row; resume?: Entry }[] = [];
      for (const r of rows) {
        const o = open(r.user_id);
        if (o) { if (now - o.touched >= 5 * 60_000) resumes.push({ row: r, resume: o }); continue; }
        if (r.house_total + r.event_total === 0 || f.advanced.has(r.user_id)) continue;
        if (f.ledger.has(`${run}:${r.user_id}`)) continue; // sent or failed in this run
        fresh.push({ row: r });
      }
      for (const { row: r, resume } of [...resumes, ...fresh]) {
        if (out.length >= Math.min(limit, 100)) break;
        let e = resume;
        if (e) { e.attempts++; e.touched = now; } else {
          if (fresh_n >= room) { f.capHit = true; break; }
          fresh_n++;
          e = { run, user: r.user_id, status: 'sending', attempts: 1, key: `digest:${r.public_id}:${r.window_from}/${f.windowTo}`, windowTo: f.windowTo, touched: now, payload: null };
          f.ledger.set(`${run}:${r.user_id}`, e);
        }
        const { window_from: _w, ...rest } = r;
        out.push({ ...rest, run_id: e.run, idempotency_key: e.key, window_to: e.windowTo, payload: e.payload ? asJsonb(e.payload) : null });
      }
      return Promise.resolve(out);
    },
    storePayload(run, user, p) {
      const l = f.ledger.get(`${run}:${user}`);
      if (!l || l.status !== 'sending') return Promise.reject(new Error('not_found'));
      f.stores++;
      if (l.payload) {
        if (canon(l.payload) !== canon(p)) return Promise.reject(new Error('payload_conflict'));
        return Promise.resolve();
      }
      l.payload = JSON.parse(JSON.stringify(p));
      return Promise.resolve();
    },
    mark(run, user, ok, err) {
      const l = f.ledger.get(`${run}:${user}`);
      if (!l || l.status !== 'sending') return Promise.resolve(false);
      l.status = ok ? 'sent' : 'failed';
      l.payload = null;
      f.marks.push(`${user}:${ok ? 'sent' : 'failed'}:${err ?? ''}`);
      if (ok) f.advanced.add(user);
      return Promise.resolve(true);
    },
    finish(): Promise<RunTotals> {
      const v = [...f.ledger.values()];
      return Promise.resolve({ sent: v.filter((l) => l.status === 'sent').length, failed: v.filter((l) => l.status === 'failed').length, cap_hit: f.capHit });
    },
  };
  return f;
}
/** Key-order-insensitive comparison, as jsonb equality is. */
const canon = (p: StoredPayload) => JSON.stringify(p, Object.keys({ ...p, ...p.headers }).sort());
/** What PostgREST hands back for a jsonb column: a new object; jsonb does not keep key order (reverse it here). */
function asJsonb(p: StoredPayload): StoredPayload {
  const rev = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).reverse()) as T;
  return rev({ ...JSON.parse(JSON.stringify(p)), headers: rev(p.headers) });
}
const okSend = (): Promise<SendResult> => Promise.resolve({ ok: true as const, id: 'rid' });

Deno.test('sends one email per recipient with the stored per-window key and one-click headers', async () => {
  const db = fakeDb([recipient(1), recipient(2)], { now: () => NOW });
  const calls: { key: string; to: string; headers: Record<string, string> | undefined }[] = [];
  const s = await runDigest('daily', '2026-12-04', cfg(), {
    db, send: (key, email) => { calls.push({ key, to: email.to, headers: email.headers }); return okSend(); },
  });
  assertEquals([s.sent, s.failed, s.skipped, s.pending, s.capHit, s.more], [2, 0, 0, 0, false, false]);
  assertEquals(calls.map((c) => c.key), [keyOf(1), keyOf(2)]);
  assertStringIncludes(calls[0].headers!['List-Unsubscribe'], 'https://fn.example.test/functions/v1/unsubscribe?t=');
  assertStringIncludes(calls[0].headers!['List-Unsubscribe'], 'mailto:unsubscribe@mail.truckeelights.com');
  assertEquals(calls[0].headers!['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const t = decodeURIComponent(calls[0].headers!['List-Unsubscribe'].match(/t=([^>]+)>/)![1]);
  const v = await verifyToken('hmac-test', t, 0);
  assert(v.ok && v.purpose === 'unsub' && v.version === 2 && v.publicId === uid(1001));
  assertEquals([...db.advanced].sort(), [uid(1), uid(2)]);
});

Deno.test('idempotent rerun: a second run of the same day sends nothing', async () => {
  const db = fakeDb([recipient(1), recipient(2)], { now: () => NOW });
  let sends = 0;
  const send = () => { sends++; return okSend(); };
  await runDigest('daily', '2026-12-04', cfg(), { db, send });
  assertEquals(sends, 2);
  const s = await runDigest('daily', '2026-12-04', cfg(), { db, send });
  assertEquals([sends, s.sent], [2, 0]);
});

Deno.test('crash after Resend accepted (mark lost): the next tick resends the SAME key and the SAME payload', async () => {
  const c = clock();
  const rows = [recipient(1)];
  const db = fakeDb(rows, c);
  const sent: { key: string; email: OutgoingEmail }[] = [];
  const send = (k: string, e: OutgoingEmail) => { sent.push({ key: k, email: e }); return okSend(); };
  const realMark = db.mark;
  db.mark = () => Promise.reject(new Error('crash'));
  let threw = false;
  try { await runDigest('daily', '2026-12-04', cfg({ now: c.now }), { db, send }); } catch { threw = true; }
  assert(threw);
  db.mark = realMark;
  assertEquals(db.stores, 1); // stored before the provider call
  // Meanwhile the live data changes: a different house list and a bumped link version.
  rows[0].houses = [{ id: uid(5999), address: '99 Other St' }];
  rows[0].house_total = 1;
  rows[0].token_version = 3;
  // 4 minutes later the row is still "in flight": nothing is handed out again.
  c.advance(4 * 60_000);
  await runDigest('daily', '2026-12-04', cfg({ now: c.now }), { db, send });
  assertEquals(sent.length, 1);
  // The next cron tick (10 minutes after the first) resumes it.
  c.advance(6 * 60_000);
  const s = await runDigest('daily', '2026-12-04', cfg({ now: c.now }), { db, send });
  assertEquals(s.sent, 1);
  assertEquals(sent.map((x) => x.key), [keyOf(1), keyOf(1)]);
  // byte-identical although the content changed: the stored payload is sent, never a re-render
  assertEquals(wire(sent[1].email), wire(sent[0].email));
  assertEquals(db.stores, 1); // a resume never stores (or renders) again
  assertEquals(db.ledger.get(`${RUN}:${uid(1)}`)?.payload, null); // cleared once sent
});

Deno.test('crash BEFORE the payload was stored: the resume renders fresh (Resend never saw the key) and stores it', async () => {
  const c = clock();
  const db = fakeDb([recipient(1)], c);
  const realStore = db.storePayload;
  db.storePayload = () => Promise.reject(new Error('lost'));
  const sends: string[] = [];
  const s = await runDigest('daily', '2026-12-04', cfg({ now: c.now }), { db, send: (k) => { sends.push(k); return okSend(); } });
  assertEquals([s.sent, s.pending, sends.length], [0, 1, 0]); // never sent without a stored payload
  assertEquals(db.ledger.get(`${RUN}:${uid(1)}`)?.status, 'sending');
  db.storePayload = realStore;
  c.advance(10 * 60_000);
  const s2 = await runDigest('daily', '2026-12-04', cfg({ now: c.now }), { db, send: (k) => { sends.push(k); return okSend(); } });
  assertEquals([s2.sent, sends], [1, [keyOf(1)]]);
});

Deno.test('accepted send + failed mark, then the NEXT DAY run: the unresolved row is resumed with its own key and window', async () => {
  const c = clock();
  const rows = [recipient(1)];
  const db = fakeDb(rows, c);
  const sent: { key: string; email: OutgoingEmail }[] = [];
  const send = (k: string, e: OutgoingEmail) => { sent.push({ key: k, email: e }); return okSend(); };
  const realMark = db.mark;
  db.mark = () => Promise.reject(new Error('mark lost'));
  try { await runDigest('daily', '2026-12-04', cfg({ now: c.now }), { db, send }); } catch { /* crash */ }
  db.mark = realMark;
  rows[0].houses = []; rows[0].house_total = 0; rows[0].events = [{ id: uid(7000), title: 'New', starts_at: '2026-12-08T02:00:00Z' }]; rows[0].event_total = 1;
  // No tick that evening got to it. The next evening is a new run with a later window.
  c.advance(22 * 3600_000);
  db.runId = RUN2;
  db.windowTo = '2026-12-06T02:07:00Z';
  const s = await runDigest('daily', '2026-12-05', cfg({ now: c.now }), { db, send });
  assertEquals(s.sent, 1);
  assertEquals(sent.map((x) => x.key), [keyOf(1), keyOf(1)]); // never a new key while the old send is unresolved
  assertEquals(wire(sent[1].email), wire(sent[0].email)); // the stored payload, not the changed content
  assertEquals(db.ledger.get(`${RUN}:${uid(1)}`)?.status, 'sent'); // the original row is the one resolved
  assertEquals(db.ledger.has(`${RUN2}:${uid(1)}`), false);
});

Deno.test('ambiguous provider outcomes (network, 5xx) stay sending and are resumed with the same key', async () => {
  const c = clock();
  const db = fakeDb([recipient(1), recipient(2)], c);
  const keys: string[] = [];
  let n = 0;
  const flaky = (k: string): Promise<SendResult> => {
    keys.push(k);
    n++;
    if (n === 1) return Promise.resolve({ ok: false, code: 'network', ambiguous: true });
    if (n === 2) return Promise.resolve({ ok: false, code: 'http_503', ambiguous: true });
    return okSend();
  };
  const s = await runDigest('daily', '2026-12-04', cfg({ now: c.now }), { db, send: flaky });
  assertEquals([s.sent, s.failed, s.pending], [0, 0, 2]);
  assertEquals(db.marks, []); // nothing marked failed: Resend may have accepted them
  c.advance(10 * 60_000);
  const s2 = await runDigest('daily', '2026-12-04', cfg({ now: c.now }), { db, send: flaky });
  assertEquals(s2.sent, 2);
  assertEquals(keys, [keyOf(1), keyOf(2), keyOf(1), keyOf(2)]);
});

Deno.test('daily cap comes from the database and is reported', async () => {
  const db = fakeDb([1, 2, 3, 4, 5].map((n) => recipient(n)), { now: () => NOW }, { cap: 3 });
  let sends = 0;
  const s = await runDigest('daily', '2026-12-04', cfg(), { db, send: () => { sends++; return okSend(); } });
  assertEquals([sends, s.sent, s.capHit], [3, 3, true]);
  const db2 = fakeDb([recipient(1)], { now: () => NOW }, { cap: 3, sentToday: 3 });
  const s2 = await runDigest('daily', '2026-12-04', cfg(), { db: db2, send: () => Promise.reject(new Error('must not send')) });
  assertEquals([s2.sent, s2.capHit], [0, true]);
});

Deno.test('cap: stale sending rows are resumed even when they are what fills the cap (charged once, when claimed)', async () => {
  const c = clock();
  const db = fakeDb([1, 2, 3].map((n) => recipient(n)), c, { cap: 3 });
  const keys: string[] = [];
  let n = 0;
  const send = (k: string): Promise<SendResult> => {
    keys.push(k);
    return Promise.resolve(++n <= 3 ? { ok: false, code: 'network', ambiguous: true } : { ok: true, id: 'ok' });
  };
  const s = await runDigest('daily', '2026-12-04', cfg({ now: c.now }), { db, send });
  assertEquals([s.sent, s.pending, s.capHit], [0, 3, false]); // three claims, all ambiguous: the cap is now full
  c.advance(10 * 60_000);
  const s2 = await runDigest('daily', '2026-12-04', cfg({ now: c.now }), { db, send });
  assertEquals([s2.sent, s2.capHit], [3, false]); // all three resumed, no new room needed
  assertEquals(keys, [keyOf(1), keyOf(2), keyOf(3), keyOf(1), keyOf(2), keyOf(3)]);
});

Deno.test('malformed content is released as failed (empty_render) without a send', async () => {
  const bad = { ...recipient(1), houses: [{ id: 'not-a-uuid', address: 'x' }] };
  const db = fakeDb([bad], { now: () => NOW });
  const s = await runDigest('daily', '2026-12-04', cfg(), { db, send: () => Promise.reject(new Error('must not send')) });
  assertEquals([s.sent, s.skipped], [0, 1]);
  assertEquals(db.marks, [`${uid(1)}:failed:empty_render`]);
  const db2 = fakeDb([recipient(2, false)], { now: () => NOW });
  const s2 = await runDigest('daily', '2026-12-04', cfg(), { db: db2, send: () => Promise.reject(new Error('must not send')) });
  assertEquals([s2.sent, s2.skipped, db2.ledger.size], [0, 0, 0]);
});

Deno.test('a definite Resend failure (4xx) is failed with a code, does not advance, and the next run uses a new key', async () => {
  const db = fakeDb([recipient(1), recipient(2)], { now: () => NOW });
  let n = 0;
  const s = await runDigest('daily', '2026-12-04', cfg(), { db, send: () => Promise.resolve(++n === 1 ? { ok: false as const, code: 'http_422' } : { ok: true as const, id: 'ok' }) });
  assertEquals([s.sent, s.failed], [1, 1]);
  assert(db.marks.includes(`${uid(1)}:failed:http_422`));
  assert(!db.advanced.has(uid(1)));
  assert(!db.marks.some((m) => m.includes('person'))); // no addresses in the ledger
  const again = await runDigest('daily', '2026-12-04', cfg(), { db, send: () => Promise.reject(new Error('must not send')) });
  assertEquals(again.sent + again.failed, 0);
  db.runId = RUN2;
  const keys: string[] = [];
  db.windowTo = '2026-12-06T02:07:00Z';
  const next = await runDigest('daily', '2026-12-05', cfg(), { db, send: (k) => { keys.push(k); return okSend(); } });
  // a definitely refused key is never reused: the next run's row has a later window end, so a new key
  assertEquals([next.sent, keys], [1, [keyOf(1, '2026-12-06T02:07:00Z')]]);
});

Deno.test('bounded worker: stops at the time budget, leaves claimed rows for the next tick, which finishes them', async () => {
  const c = clock();
  const rows = [1, 2, 3, 4, 5, 6].map((n) => recipient(n));
  const db = fakeDb(rows, c);
  const keys: string[] = [];
  const slow = (k: string) => { keys.push(k); c.advance(15_000); return okSend(); }; // each send takes 15 s
  const s = await runDigest('daily', '2026-12-04', cfg({ now: c.now }), { db, send: slow });
  assertEquals([s.sent, s.more], [3, true]); // sends start at 0, 15 and 30 s; the 4th would start at 45 s
  assertEquals(BUDGET_MS, 40_000);
  c.advance(10 * 60_000); // next cron tick
  const s2 = await runDigest('daily', '2026-12-04', cfg({ now: c.now }), { db, send: slow });
  assertEquals([s2.sent, s2.more], [3, true]);
  c.advance(10 * 60_000);
  const s3 = await runDigest('daily', '2026-12-04', cfg({ now: c.now }), { db, send: slow });
  assertEquals([s3.sent, s3.more], [0, false]);
  assertEquals(keys, rows.map((_, i) => keyOf(i + 1))); // each person exactly once
});

Deno.test('bounded worker: at most MAX_SENDS per invocation', async () => {
  const rows = Array.from({ length: MAX_SENDS + 20 }, (_, i) => recipient(i + 1));
  const db = fakeDb(rows, { now: () => NOW });
  let sends = 0;
  const s = await runDigest('daily', '2026-12-04', cfg(), { db, send: () => { sends++; return okSend(); } });
  assertEquals([sends, s.more], [MAX_SENDS, true]);
});

Deno.test('sendEmail: header, body, 429 retries once with the same key, errors become codes; ambiguous ones are flagged', async () => {
  const seen: { key: string | null; auth: string | null }[] = [];
  let calls = 0;
  const fake = ((_u: string, init: RequestInit) => {
    const h = new Headers(init.headers);
    seen.push({ key: h.get('idempotency-key'), auth: h.get('authorization') });
    calls++;
    return Promise.resolve(calls === 1 ? new Response('slow down', { status: 429, headers: { 'retry-after': '1' } }) : Response.json({ id: 'abc' }));
  }) as unknown as typeof fetch;
  const email = { from: 'a@x.test', to: 'b@x.test', subject: 's', html: 'h', text: 't' };
  let slept = 0;
  const r = await sendEmail('re_k', 'digest:k', email, { fetch: fake, sleep: (ms) => { slept = ms; return Promise.resolve(); } });
  assertEquals(r, { ok: true, id: 'abc' });
  assertEquals(slept, 1000);
  assertEquals(seen.map((s) => s.key), ['digest:k', 'digest:k']);
  assertEquals(seen[0].auth, 'Bearer re_k');
  const bad = await sendEmail('k', 'a:b', email, { fetch: (() => Promise.resolve(new Response('{"message":"secret detail"}', { status: 422 }))) as unknown as typeof fetch });
  assertEquals(bad, { ok: false, code: 'http_422' });
  const down = await sendEmail('k', 'a:b', email, { fetch: (() => Promise.resolve(new Response('x', { status: 502 }))) as unknown as typeof fetch });
  assertEquals(down, { ok: false, code: 'http_502', ambiguous: true });
  const net = await sendEmail('k', 'a:b', email, { fetch: (() => Promise.reject(new Error('boom'))) as unknown as typeof fetch });
  assertEquals(net, { ok: false, code: 'network', ambiguous: true });
});

Deno.test('Pacific slot: 18:xx and 19:xx run (both DST offsets); the rest of the 01-03 UTC window is not due', () => {
  // PST (UTC-8): 02:07..03:57 UTC run; 01:07 UTC is 17:07 -> not due
  assertEquals(dueKinds(new Date('2026-12-05T01:07:00Z')).kinds, []);
  assertEquals(dueKinds(new Date('2026-12-05T02:07:00Z')).kinds, ['daily']);
  assertEquals(dueKinds(new Date('2026-12-05T03:57:00Z')).kinds, ['daily']);
  // PDT (UTC-7): 01:07..02:57 UTC run; 03:07 UTC is 20:07 -> not due
  assertEquals(dueKinds(new Date('2026-10-16T01:07:00Z')).kinds, ['daily', 'weekly']); // Thursday 18:07 PDT
  assertEquals(dueKinds(new Date('2026-10-16T02:57:00Z')).kinds, ['daily', 'weekly']);
  assertEquals(dueKinds(new Date('2026-10-16T03:07:00Z')).kinds, []);
  assertEquals(dueKinds(new Date('2026-10-16T02:57:00Z')).date, '2026-10-15');
});

Deno.test('handler: bearer required (constant-time), POST only, not-due skips, explicit kind runs, reports more', async () => {
  const env: DigestEnv = { cronSecret: 'cron-secret-xyz', config: cfg() };
  const db = fakeDb([recipient(1)], { now: () => NOW });
  const deps = { db, send: okSend };
  const req = (method: string, auth?: string, body?: unknown) =>
    new Request('https://fn.test/send-digest', { method, headers: auth ? { authorization: auth } : {}, body: body ? JSON.stringify(body) : undefined });
  assertEquals((await handle(req('GET', 'Bearer cron-secret-xyz'), env, deps)).status, 405);
  assertEquals((await handle(req('POST'), env, deps)).status, 401);
  assertEquals((await handle(req('POST', 'Bearer wrong'), env, deps)).status, 401);
  assertEquals((await handle(req('POST', 'Bearer cron-secret-xyz'), null, deps)).status, 500);
  const ok = await handle(req('POST', 'Bearer cron-secret-xyz', {}), env, deps);
  assertEquals(ok.status, 200);
  const body = await ok.json();
  assertEquals([body.runs[0].sent, body.more], [1, false]);
  const off = { ...env, config: cfg({ now: () => new Date('2026-12-05T01:07:00Z') }) }; // 17:07 Pacific
  assertEquals((await (await handle(req('POST', 'Bearer cron-secret-xyz', {}), off, deps)).json()).skipped, 'not_due');
  const late = { ...env, config: cfg({ now: () => new Date('2026-12-05T03:47:00Z') }) }; // 19:47 Pacific: still the slot
  assertEquals((await (await handle(req('POST', 'Bearer cron-secret-xyz', {}), late, { db: fakeDb([], { now: () => NOW }) })).json()).runs.length, 1);
  const forced = await handle(req('POST', 'Bearer cron-secret-xyz', { kind: 'weekly' }), off, { db: fakeDb([], { now: () => NOW }) });
  assertEquals((await forced.json()).runs[0].kind, 'weekly');
});
