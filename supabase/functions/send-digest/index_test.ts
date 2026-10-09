import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { BeginRun, DigestDb, DigestRecipient } from '../_shared/db.ts';
import { runDigest, type RunConfig } from '../_shared/digestRun.ts';
import { sendEmail } from '../_shared/resend.ts';
import { verifyToken } from '../_shared/token.ts';
import { handle, type DigestEnv } from './index.ts';

const RUN = '99999999-0000-4000-8000-000000000001';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-12-05T02:07:00Z'); // 18:07 PST, a Friday

const cfg = (over: Partial<RunConfig> = {}): RunConfig => ({
  siteUrl: 'https://example.test', functionsUrl: 'https://fn.example.test/functions/v1', from: 'Test <t@example.test>',
  hmacSecret: 'hmac-test', resendKey: 're_test', dailyCap: 60, paceMs: 0, now: () => NOW, ...over,
});

const recipient = (n: number, withContent = true): DigestRecipient => ({
  user_id: uid(n), email: `person${n}@example.test`, public_id: uid(1000 + n), token_version: 2, cadence: 'daily',
  houses: withContent ? [{ id: uid(5000 + n), address: `${n} Pine St`, town: 'Truckee' }] : [], events: [],
  houses_total: withContent ? 1 : 0, events_total: 0, window_through: '2026-12-05T02:00:00Z',
});

interface Fake extends DigestDb { log: string[]; sentIds: Set<string>; marks: string[] }
function fakeDb(pendingRows: DigestRecipient[], sentToday = 0): Fake {
  const f: Fake = {
    log: [], sentIds: new Set(), marks: [],
    beginRun: (): Promise<BeginRun> => Promise.resolve({ run_id: RUN, sent_today: sentToday }),
    pending(_run, limit) { return Promise.resolve(pendingRows.filter((r) => !f.sentIds.has(r.user_id) && !f.marks.some((m) => m.startsWith(`${r.user_id}:`))).slice(0, limit)); },
    claim(_run, user) { f.log.push(`claim ${user}`); return Promise.resolve(!f.sentIds.has(user)); },
    mark(_run, user, status, _pid, err) {
      f.marks.push(`${user}:${status}:${err ?? ''}`);
      if (status === 'sent') f.sentIds.add(user);
      return Promise.resolve();
    },
    finishRun() { f.log.push('finish'); return Promise.resolve(); },
  };
  return f;
}

Deno.test('sends one email per recipient with Idempotency-Key run:user and one-click headers', async () => {
  const db = fakeDb([recipient(1), recipient(2)]);
  const calls: { key: string; to: string; headers: Record<string, string> | undefined }[] = [];
  const s = await runDigest('daily', '2026-12-04', cfg(), {
    db, send: (key, email) => { calls.push({ key, to: email.to, headers: email.headers }); return Promise.resolve({ ok: true, id: 'rid' }); },
  });
  assertEquals([s.sent, s.failed, s.skipped, s.capHit], [2, 0, 0, false]);
  assertEquals(calls[0].key, `${RUN}:${uid(1)}`);
  assertStringIncludes(calls[0].headers!['List-Unsubscribe'], 'https://fn.example.test/functions/v1/unsubscribe?t=');
  assertStringIncludes(calls[0].headers!['List-Unsubscribe'], 'mailto:unsubscribe@mail.truckeelights.com');
  assertEquals(calls[0].headers!['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  // the link token is a valid unsub token for this subscription version
  const t = decodeURIComponent(calls[0].headers!['List-Unsubscribe'].match(/t=([^>]+)>/)![1]);
  const v = await verifyToken('hmac-test', t, 0);
  assert(v.ok && v.purpose === 'unsub' && v.version === 2 && v.publicId === uid(1001));
});

Deno.test('idempotent rerun: already-sent rows are not sent again', async () => {
  const rows = [recipient(1), recipient(2)];
  const db = fakeDb(rows);
  let sends = 0;
  const send = () => { sends++; return Promise.resolve({ ok: true as const, id: 'x' }); };
  await runDigest('daily', '2026-12-04', cfg(), { db, send });
  assertEquals(sends, 2);
  await runDigest('daily', '2026-12-04', cfg(), { db, send });
  assertEquals(sends, 2);
  // a claim that says "already sent" is also honored even if pending still lists the row
  const db2 = fakeDb(rows); db2.sentIds.add(uid(1));
  db2.pending = () => Promise.resolve(rows);
  sends = 0;
  const s = await runDigest('daily', '2026-12-04', cfg(), { db: db2, send });
  assertEquals([sends, s.skipped], [1, 1]);
});

Deno.test('daily cap is respected and reported', async () => {
  const db = fakeDb([1, 2, 3, 4, 5].map((n) => recipient(n)), 0);
  let sends = 0;
  const s = await runDigest('daily', '2026-12-04', cfg({ dailyCap: 3 }), { db, send: () => { sends++; return Promise.resolve({ ok: true, id: 'x' }); } });
  assertEquals([sends, s.sent, s.capHit], [3, 3, true]);
  // sends already made today count against the cap
  const db2 = fakeDb([recipient(1)], 3);
  const s2 = await runDigest('daily', '2026-12-04', cfg({ dailyCap: 3 }), { db: db2, send: () => Promise.reject(new Error('must not send')) });
  assertEquals([s2.sent, s2.capHit], [0, true]);
});

Deno.test('empty digest is skipped with no claim and no send', async () => {
  const db = fakeDb([recipient(1, false)]);
  const s = await runDigest('daily', '2026-12-04', cfg(), { db, send: () => Promise.reject(new Error('must not send')) });
  assertEquals([s.sent, s.skipped], [0, 1]);
  assertEquals(db.log.filter((l) => l.startsWith('claim')).length, 0);
});

Deno.test('a Resend failure is recorded as failed with a code and does not stop the run', async () => {
  const db = fakeDb([recipient(1), recipient(2)]);
  let n = 0;
  const s = await runDigest('daily', '2026-12-04', cfg(), { db, send: () => Promise.resolve(++n === 1 ? { ok: false as const, code: 'http_500' } : { ok: true as const, id: 'ok' }) });
  assertEquals([s.sent, s.failed], [1, 1]);
  assert(db.marks.includes(`${uid(1)}:failed:http_500`));
  assert(!db.marks.some((m) => m.includes('person'))); // no addresses in the ledger
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
  const deps = { db, send: () => Promise.resolve({ ok: true as const, id: 'x' }) };
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
