import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { DigestDb, DigestRecipient, RunTotals } from '../_shared/db.ts';
import { runDigest, type RunConfig } from '../_shared/digestRun.ts';
import { sendEmail } from '../_shared/resend.ts';
import { verifyToken } from '../_shared/token.ts';
import { handle, type DigestEnv } from './index.ts';

const RUN = '99999999-0000-4000-8000-000000000001';
const RUN2 = '99999999-0000-4000-8000-000000000002';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-12-05T02:07:00Z'); // 18:07 PST, a Friday

const cfg = (over: Partial<RunConfig> = {}): RunConfig => ({
  siteUrl: 'https://example.test', functionsUrl: 'https://fn.example.test/functions/v1', from: 'Test <t@example.test>',
  hmacSecret: 'hmac-test', resendKey: 're_test', paceMs: 0, now: () => NOW, ...over,
});

// A row exactly as svc_digest_batch returns it (minus the run-specific idempotency key, which the fake fills in).
const recipient = (n: number, withContent = true): Omit<DigestRecipient, 'idempotency_key'> => ({
  user_id: uid(n), email: `person${n}@example.test`, public_id: uid(1000 + n), token_version: 2,
  region_slug: 'truckee', region_name: 'Truckee', timezone: 'America/Los_Angeles', cadence: 'daily',
  houses: withContent ? [{ id: uid(5000 + n), address: `${n} Pine St` }] : [], house_total: withContent ? 1 : 0,
  events: [], event_total: 0,
});

type Status = 'sending' | 'sent' | 'failed';
interface Fake extends DigestDb {
  runId: string;
  cap: number;
  /** Sends counted against today's cap (sent + sending), like the SQL's v_room. */
  ledger: Map<string, { status: Status; attempts: number }>;
  advanced: Set<string>; // users whose last_sent_through moved
  marks: string[];
  capHit: boolean;
}

/**
 * Mirrors the SQL contract of svc_digest_* (20261016000200): batch returns only users with no sent/failed row in this
 * run and no in-flight claim, claims them as `sending`, and stops at the cap (setting cap_hit); mark changes only a
 * `sending` row and advances last_sent_through only on ok.
 */
function fakeDb(rows: Omit<DigestRecipient, 'idempotency_key'>[], opts: { cap?: number; runId?: string; sentToday?: number } = {}): Fake {
  const f: Fake = {
    runId: opts.runId ?? RUN, cap: opts.cap ?? 50, ledger: new Map(), advanced: new Set(), marks: [], capHit: false,
    start: () => Promise.resolve(f.runId),
    batch(run, limit) {
      const usedToday = (opts.sentToday ?? 0) + [...f.ledger.values()].filter((l) => l.status !== 'failed').length;
      const room = Math.max(0, Math.min(limit, 100, f.cap - usedToday));
      const out: DigestRecipient[] = [];
      for (const r of rows) {
        if (r.house_total + r.event_total === 0 || f.advanced.has(r.user_id)) continue;
        if (f.ledger.has(`${run}:${r.user_id}`)) continue; // sent, failed, or in flight
        if (out.length >= room) { f.capHit = true; break; }
        f.ledger.set(`${run}:${r.user_id}`, { status: 'sending', attempts: 1 });
        out.push({ ...r, idempotency_key: `${run}:${r.user_id}` });
      }
      return Promise.resolve(out);
    },
    mark(run, user, ok, err) {
      const l = f.ledger.get(`${run}:${user}`);
      if (!l || l.status !== 'sending') return Promise.resolve(false);
      l.status = ok ? 'sent' : 'failed';
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
const okSend = () => Promise.resolve({ ok: true as const, id: 'rid' });

Deno.test('sends one email per recipient with the row idempotency key (run:user) and one-click headers', async () => {
  const db = fakeDb([recipient(1), recipient(2)]);
  const calls: { key: string; to: string; headers: Record<string, string> | undefined }[] = [];
  const s = await runDigest('daily', '2026-12-04', cfg(), {
    db, send: (key, email) => { calls.push({ key, to: email.to, headers: email.headers }); return okSend(); },
  });
  assertEquals([s.sent, s.failed, s.skipped, s.capHit], [2, 0, 0, false]);
  assertEquals(calls.map((c) => c.key), [`${RUN}:${uid(1)}`, `${RUN}:${uid(2)}`]);
  assertStringIncludes(calls[0].headers!['List-Unsubscribe'], 'https://fn.example.test/functions/v1/unsubscribe?t=');
  assertStringIncludes(calls[0].headers!['List-Unsubscribe'], 'mailto:unsubscribe@mail.truckeelights.com');
  assertEquals(calls[0].headers!['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  // the link token is a valid unsub token for this subscription version
  const t = decodeURIComponent(calls[0].headers!['List-Unsubscribe'].match(/t=([^>]+)>/)![1]);
  const v = await verifyToken('hmac-test', t, 0);
  assert(v.ok && v.purpose === 'unsub' && v.version === 2 && v.publicId === uid(1001));
  // sent advances last_sent_through for exactly those people
  assertEquals([...db.advanced].sort(), [uid(1), uid(2)]);
});

Deno.test('idempotent rerun: a second run of the same day sends nothing', async () => {
  const db = fakeDb([recipient(1), recipient(2)]);
  let sends = 0;
  const send = () => { sends++; return okSend(); };
  await runDigest('daily', '2026-12-04', cfg(), { db, send });
  assertEquals(sends, 2);
  const s = await runDigest('daily', '2026-12-04', cfg(), { db, send });
  assertEquals([sends, s.sent], [2, 0]);
});

Deno.test('a crash between Resend and the mark is retried with the same idempotency key', async () => {
  const db = fakeDb([recipient(1)]);
  const keys: string[] = [];
  // First attempt: Resend accepts, then the mark never lands (simulated by the mark throwing).
  const realMark = db.mark;
  db.mark = () => Promise.reject(new Error('crash'));
  let threw = false;
  try { await runDigest('daily', '2026-12-04', cfg(), { db, send: (k) => { keys.push(k); return okSend(); } }); } catch { threw = true; }
  assert(threw);
  // The SQL hands a stale `sending` row back (after 10 min) with the same key.
  db.ledger.delete(`${RUN}:${uid(1)}`);
  db.mark = realMark;
  await runDigest('daily', '2026-12-04', cfg(), { db, send: (k) => { keys.push(k); return okSend(); } });
  assertEquals(keys, [`${RUN}:${uid(1)}`, `${RUN}:${uid(1)}`]);
});

Deno.test('daily cap comes from the database and is reported', async () => {
  const db = fakeDb([1, 2, 3, 4, 5].map((n) => recipient(n)), { cap: 3 });
  let sends = 0;
  const s = await runDigest('daily', '2026-12-04', cfg(), { db, send: () => { sends++; return okSend(); } });
  assertEquals([sends, s.sent, s.capHit], [3, 3, true]);
  // sends already made today count against the cap
  const db2 = fakeDb([recipient(1)], { cap: 3, sentToday: 3 });
  const s2 = await runDigest('daily', '2026-12-04', cfg(), { db: db2, send: () => Promise.reject(new Error('must not send')) });
  assertEquals([s2.sent, s2.capHit], [0, true]);
});

Deno.test('malformed content is released as failed (empty_render) without a send', async () => {
  const bad = { ...recipient(1), houses: [{ id: 'not-a-uuid', address: 'x' }] };
  const db = fakeDb([bad]);
  const s = await runDigest('daily', '2026-12-04', cfg(), { db, send: () => Promise.reject(new Error('must not send')) });
  assertEquals([s.sent, s.skipped], [0, 1]);
  assertEquals(db.marks, [`${uid(1)}:failed:empty_render`]);
  // and nobody with nothing new is ever claimed
  const db2 = fakeDb([recipient(2, false)]);
  const s2 = await runDigest('daily', '2026-12-04', cfg(), { db: db2, send: () => Promise.reject(new Error('must not send')) });
  assertEquals([s2.sent, s2.skipped, db2.ledger.size], [0, 0, 0]);
});

Deno.test('a Resend failure is recorded as failed with a code, does not advance, and is retried next run', async () => {
  const rows = [recipient(1), recipient(2)];
  const db = fakeDb(rows);
  let n = 0;
  const s = await runDigest('daily', '2026-12-04', cfg(), { db, send: () => Promise.resolve(++n === 1 ? { ok: false as const, code: 'http_500' } : { ok: true as const, id: 'ok' }) });
  assertEquals([s.sent, s.failed], [1, 1]);
  assert(db.marks.includes(`${uid(1)}:failed:http_500`));
  assert(!db.advanced.has(uid(1)));
  assert(!db.marks.some((m) => m.includes('person'))); // no addresses in the ledger
  // not retried within the same run
  const again = await runDigest('daily', '2026-12-04', cfg(), { db, send: () => Promise.reject(new Error('must not send')) });
  assertEquals(again.sent + again.failed, 0);
  // the next run (new run id, same window start) picks up only the failed person
  db.runId = RUN2;
  const keys: string[] = [];
  const next = await runDigest('daily', '2026-12-05', cfg(), { db, send: (k) => { keys.push(k); return okSend(); } });
  assertEquals([next.sent, keys], [1, [`${RUN2}:${uid(1)}`]]);
});

Deno.test('sendEmail: header, body, 429 retries once with the same key, errors become codes', async () => {
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
  const r = await sendEmail('re_k', 'run:user', email, { fetch: fake, sleep: (ms) => { slept = ms; return Promise.resolve(); } });
  assertEquals(r, { ok: true, id: 'abc' });
  assertEquals(slept, 1000);
  assertEquals(seen.map((s) => s.key), ['run:user', 'run:user']);
  assertEquals(seen[0].auth, 'Bearer re_k');
  const bad = await sendEmail('k', 'a:b', email, { fetch: (() => Promise.resolve(new Response('{"message":"secret detail"}', { status: 422 }))) as unknown as typeof fetch });
  assertEquals(bad, { ok: false, code: 'http_422' });
  const net = await sendEmail('k', 'a:b', email, { fetch: (() => Promise.reject(new Error('boom'))) as unknown as typeof fetch });
  assertEquals(net, { ok: false, code: 'network' });
});

Deno.test('handler: bearer required (constant-time), POST only, not-due skips, explicit kind runs', async () => {
  const env: DigestEnv = { cronSecret: 'cron-secret-xyz', config: cfg() };
  const db = fakeDb([recipient(1)]);
  const deps = { db, send: okSend };
  const req = (method: string, auth?: string, body?: unknown) =>
    new Request('https://fn.test/send-digest', { method, headers: auth ? { authorization: auth } : {}, body: body ? JSON.stringify(body) : undefined });
  assertEquals((await handle(req('GET', 'Bearer cron-secret-xyz'), env, deps)).status, 405);
  assertEquals((await handle(req('POST'), env, deps)).status, 401);
  assertEquals((await handle(req('POST', 'Bearer wrong'), env, deps)).status, 401);
  assertEquals((await handle(req('POST', 'Bearer cron-secret-xyz'), null, deps)).status, 500);
  const ok = await handle(req('POST', 'Bearer cron-secret-xyz', {}), env, deps);
  assertEquals(ok.status, 200);
  assertEquals((await ok.json()).runs[0].sent, 1);
  const off = { ...env, config: cfg({ now: () => new Date('2026-12-05T01:07:00Z') }) }; // 17:07 Pacific
  assertEquals((await (await handle(req('POST', 'Bearer cron-secret-xyz', {}), off, deps)).json()).skipped, 'not_due');
  const forced = await handle(req('POST', 'Bearer cron-secret-xyz', { kind: 'weekly' }), off, { db: fakeDb([]) });
  assertEquals((await forced.json()).runs[0].kind, 'weekly');
});
