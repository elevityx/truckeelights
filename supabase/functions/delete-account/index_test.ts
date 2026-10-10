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

/** A stateful Auth + database: deleteAuthUser really removes the user, and the database check sees it. */
function liveDeps(deleteBehaviour: 'commit_then_throw' | 'refuse' | 'throw_no_commit', checkFailsAfterDelete = false) {
  const state = { exists: true, cleaned: 0, deletes: 0 };
  let checks = 0;
  const d: DeleteDeps = {
    site: 'https://example.test', now: () => NOW,
    // Auth's getUser: a valid token for a deleted user is user_not_found, mapped to { gone: true }.
    verify: () => Promise.resolve(state.exists ? { id: 'user-1' } : { id: 'user-1', gone: true }),
    db: {
      checkDelete: () => {
        checks++;
        if (checkFailsAfterDelete && checks > 1) return Promise.reject(new Error('db down'));
        return Promise.resolve(state.exists ? 'ok' : 'gone');
      },
      cleanupDeleted: () => { state.cleaned++; return Promise.resolve(); },
    },
    deleteAuthUser: () => {
      state.deletes++;
      if (deleteBehaviour === 'commit_then_throw') { state.exists = false; return Promise.reject(new Error('response lost')); }
      if (deleteBehaviour === 'refuse') return Promise.resolve(false);
      return Promise.reject(new Error('timeout'));
    },
  };
  return { d, state };
}

Deno.test('auth delete COMMITTED but its response was lost: the re-check sees the user gone, cleans up, 200', async () => {
  const { d, state } = liveDeps('commit_then_throw');
  const r = await handle(req(jwt(fresh)), d);
  assertEquals([r.status, await r.json()], [200, { deleted: true }]);
  assertEquals([state.exists, state.cleaned], [false, 1]);
});

Deno.test('auth delete refused or timed out while the user still exists: 503 retry, nothing cleaned; the retry works', async () => {
  for (const b of ['refuse', 'throw_no_commit'] as const) {
    const { d, state } = liveDeps(b);
    const r = await handle(req(jwt(fresh)), d);
    assertEquals([r.status, (await r.json()).error], [503, 'retry']);
    assertEquals([state.exists, state.cleaned], [true, 0]);
    d.deleteAuthUser = () => { state.exists = false; return Promise.resolve(true); };
    assertEquals((await handle(req(jwt(fresh)), d)).status, 200);
    assertEquals(state.cleaned, 1);
  }
});

Deno.test('ambiguous delete AND the re-check fails: 503 retry (never "nothing changed"); the retry with the same token is 200', async () => {
  const { d, state } = liveDeps('commit_then_throw', true);
  const r = await handle(req(jwt(fresh)), d);
  assertEquals([r.status, (await r.json()).error], [503, 'retry']);
  assertEquals(state.cleaned, 0);
  // The retry: Auth answers user_not_found for the (valid) token, the database says gone -> cleanup, 200.
  const { d: d2 } = liveDeps('commit_then_throw');
  d2.verify = () => Promise.resolve({ id: 'user-1', gone: true });
  d2.db.checkDelete = () => Promise.resolve('gone');
  let cleaned = 0;
  d2.db.cleanupDeleted = () => { cleaned++; return Promise.resolve(); };
  d2.deleteAuthUser = () => Promise.reject(new Error('must not delete again'));
  assertEquals((await handle(req(jwt(fresh)), d2)).status, 200);
  assertEquals(cleaned, 1);
});

Deno.test('a retry after the auth user is already gone just runs the idempotent cleanup, even past the 10-minute window', async () => {
  const { d, calls } = deps({ verify: () => Promise.resolve({ id: 'user-1', gone: true }) }, 'gone');
  assertEquals((await handle(req(jwt(fresh)), d)).status, 200);
  assertEquals(calls.order, ['check', 'cleanup']);
  const stale = { is_anonymous: false, amr: [{ method: 'otp', timestamp: nowS - 3600 }] };
  const late = deps({ verify: () => Promise.resolve({ id: 'user-1', gone: true }) }, 'gone');
  assertEquals((await handle(req(jwt(stale)), late.d)).status, 200);
  // Auth says gone but the database still has the user: fail closed, nothing runs.
  const odd = deps({ verify: () => Promise.resolve({ id: 'user-1', gone: true }) }, 'ok');
  assertEquals((await handle(req(jwt(fresh)), odd.d)).status, 401);
  assertEquals(odd.calls.order, ['check']);
});

Deno.test('a failing check is 503 retry (nothing changed); a failing cleanup after the auth delete still reports deleted', async () => {
  const { d: d1, calls: c1 } = deps({ db: { checkDelete: () => Promise.reject(new Error('x')), cleanupDeleted: () => Promise.resolve() } });
  assertEquals((await handle(req(jwt(fresh)), d1)).status, 503);
  assertEquals(c1.authDeleted.length, 0);
  const { d: d2, calls: c2 } = deps({ db: { checkDelete: () => Promise.resolve('ok'), cleanupDeleted: () => Promise.reject(new Error('x')) } });
  assertEquals((await handle(req(jwt(fresh)), d2)).status, 200);
  assertEquals(c2.authDeleted, ['user-1']);
  assertEquals((await handle(new Request('https://fn.test/x'), deps().d)).status, 405);
});
