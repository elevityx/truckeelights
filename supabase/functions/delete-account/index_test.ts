import { assertEquals } from '@std/assert';
import { decodeClaims, handle, isFresh, type DeleteDeps } from './index.ts';

const NOW = new Date('2026-12-05T02:07:00Z');
const nowS = Math.floor(NOW.getTime() / 1000);
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
const fresh = { is_anonymous: false, amr: [{ method: 'otp', timestamp: nowS - 60 }] };

function deps(over: Partial<DeleteDeps> = {}, check: 'ok' | 'forbidden' | 'gone' = 'ok') {
  // order records every step, so the tests can assert "auth delete first, then cleanup".
  const calls = { checked: [] as string[], authDeleted: [] as string[], cleaned: [] as string[], order: [] as string[] };
  const d: DeleteDeps = {
    site: 'https://example.test', now: () => NOW,
    verify: () => Promise.resolve({ id: 'user-1' }),
    db: {
      checkDelete: (id) => { calls.checked.push(id); calls.order.push('check'); return Promise.resolve(check); },
      cleanupDeleted: (id) => { calls.cleaned.push(id); calls.order.push('cleanup'); return Promise.resolve(); },
    },
    deleteAuthUser: (id) => { calls.authDeleted.push(id); calls.order.push('auth'); return Promise.resolve(true); },
    ...over,
  };
  return { d, calls };
}
const req = (token?: string, body?: string) =>
  new Request('https://fn.test/delete-account', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body });

Deno.test('freshness: otp or magiclink within 10 minutes only', () => {
  assertEquals(isFresh({ amr: [{ method: 'otp', timestamp: nowS - 599 }] }, nowS), true);
  assertEquals(isFresh({ amr: [{ method: 'magiclink', timestamp: nowS - 10 }] }, nowS), true);
  assertEquals(isFresh({ amr: [{ method: 'otp', timestamp: nowS - 601 }] }, nowS), false);
  assertEquals(isFresh({ amr: [{ method: 'password', timestamp: nowS }] }, nowS), false);
  assertEquals(isFresh({ amr: [{ method: 'otp', timestamp: nowS + 3600 }] }, nowS), false);
  assertEquals(isFresh({}, nowS), false);
});

Deno.test('decodeClaims reads a payload and tolerates garbage', () => {
  assertEquals(decodeClaims(jwt({ is_anonymous: false }))?.is_anonymous, false);
  assertEquals(decodeClaims('nope'), null);
});

Deno.test('happy path: check, then the auth user FIRST, then the cleanup, for the verified uid only', async () => {
  const { d, calls } = deps();
  const r = await handle(req(jwt(fresh), JSON.stringify({ user_id: 'someone-else' })), d); // body id is ignored
  assertEquals(r.status, 200);
  assertEquals(calls.order, ['check', 'auth', 'cleanup']);
  assertEquals([calls.checked, calls.authDeleted, calls.cleaned], [['user-1'], ['user-1'], ['user-1']]);
});

Deno.test('no token, bad token, anonymous session: 401 and nothing deleted', async () => {
  const { d, calls } = deps();
  assertEquals((await handle(req(), d)).status, 401);
  const bad = deps({ verify: () => Promise.resolve(null) });
  assertEquals((await handle(req(jwt(fresh)), bad.d)).status, 401);
  assertEquals((await handle(req(jwt({ ...fresh, is_anonymous: true })), d)).status, 401);
  assertEquals((await handle(req(jwt({ amr: fresh.amr })), d)).status, 401); // missing flag counts as not signed in
  assertEquals(calls.order.length + bad.calls.order.length, 0);
});

Deno.test('stale sign-in asks for a fresh code (reauth_required)', async () => {
  const { d, calls } = deps();
  const r = await handle(req(jwt({ is_anonymous: false, amr: [{ method: 'otp', timestamp: nowS - 3600 }] })), d);
  assertEquals([r.status, (await r.json()).error], [403, 'reauth_required']);
  assertEquals(calls.order.length, 0);
});

Deno.test('admins are refused before anything changes: no auth delete, no cleanup', async () => {
  const { d, calls } = deps({}, 'forbidden');
  const r = await handle(req(jwt(fresh)), d);
  assertEquals(r.status, 403);
  assertEquals(calls.order, ['check']);
});

Deno.test('auth delete fails: 502 and NOTHING changed (no cleanup ran)', async () => {
  const failing = deps({ deleteAuthUser: () => Promise.resolve(false) });
  assertEquals((await handle(req(jwt(fresh)), failing.d)).status, 502);
  assertEquals(failing.calls.cleaned.length, 0);
  const throwing = deps({ deleteAuthUser: () => Promise.reject(new Error('timeout')) });
  assertEquals((await handle(req(jwt(fresh)), throwing.d)).status, 502);
  assertEquals(throwing.calls.cleaned.length, 0);
});

Deno.test('a retry after the auth user is already gone just runs the idempotent cleanup', async () => {
  const { d, calls } = deps({}, 'gone');
  assertEquals((await handle(req(jwt(fresh)), d)).status, 200);
  assertEquals(calls.order, ['check', 'cleanup']);
});

Deno.test('a failing check is 502 (nothing changed); a failing cleanup after the auth delete still reports deleted', async () => {
  const { d: d1, calls: c1 } = deps({ db: { checkDelete: () => Promise.reject(new Error('x')), cleanupDeleted: () => Promise.resolve() } });
  assertEquals((await handle(req(jwt(fresh)), d1)).status, 502);
  assertEquals(c1.authDeleted.length, 0);
  const { d: d2, calls: c2 } = deps({ db: { checkDelete: () => Promise.resolve('ok'), cleanupDeleted: () => Promise.reject(new Error('x')) } });
  assertEquals((await handle(req(jwt(fresh)), d2)).status, 200);
  assertEquals(c2.authDeleted, ['user-1']);
  assertEquals((await handle(new Request('https://fn.test/x'), deps().d)).status, 405);
});
