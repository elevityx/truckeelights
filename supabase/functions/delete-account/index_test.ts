import { assertEquals } from '@std/assert';
import { decodeClaims, handle, isFresh, type DeleteDeps } from './index.ts';

const NOW = new Date('2026-12-05T02:07:00Z');
const nowS = Math.floor(NOW.getTime() / 1000);
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
const fresh = { is_anonymous: false, amr: [{ method: 'otp', timestamp: nowS - 60 }] };

function deps(over: Partial<DeleteDeps> = {}) {
  const calls = { deleted: [] as string[], authDeleted: [] as string[] };
  const d: DeleteDeps = {
    site: 'https://example.test', now: () => NOW,
    verify: () => Promise.resolve({ id: 'user-1' }),
    db: { deleteAccount: (id) => { calls.deleted.push(id); return Promise.resolve('ok'); } },
    deleteAuthUser: (id) => { calls.authDeleted.push(id); return Promise.resolve(true); },
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

Deno.test('happy path deletes data first, then the auth user, for the verified uid only', async () => {
  const { d, calls } = deps();
  const r = await handle(req(jwt(fresh), JSON.stringify({ user_id: 'someone-else' })), d); // body id is ignored
  assertEquals(r.status, 200);
  assertEquals(calls.deleted, ['user-1']);
  assertEquals(calls.authDeleted, ['user-1']);
});

Deno.test('no token, bad token, anonymous session: 401 and nothing deleted', async () => {
  const { d, calls } = deps();
  assertEquals((await handle(req(), d)).status, 401);
  const bad = deps({ verify: () => Promise.resolve(null) });
  assertEquals((await handle(req(jwt(fresh)), bad.d)).status, 401);
  assertEquals((await handle(req(jwt({ ...fresh, is_anonymous: true })), d)).status, 401);
  assertEquals((await handle(req(jwt({ amr: fresh.amr })), d)).status, 401); // missing flag counts as not signed in
  assertEquals(calls.deleted.length + calls.authDeleted.length, 0);
});

Deno.test('stale sign-in asks for a fresh code (reauth_required)', async () => {
  const { d, calls } = deps();
  const r = await handle(req(jwt({ is_anonymous: false, amr: [{ method: 'otp', timestamp: nowS - 3600 }] })), d);
  assertEquals([r.status, (await r.json()).error], [403, 'reauth_required']);
  assertEquals(calls.deleted.length, 0);
});

Deno.test('admins are refused and the auth user is kept', async () => {
  const { d, calls } = deps({ db: { deleteAccount: () => Promise.resolve('forbidden') } });
  const r = await handle(req(jwt(fresh)), d);
  assertEquals(r.status, 403);
  assertEquals(calls.authDeleted.length, 0);
});

Deno.test('failures surface as 502 and non-POST is 405', async () => {
  const failing = deps({ deleteAuthUser: () => Promise.resolve(false) });
  assertEquals((await handle(req(jwt(fresh)), failing.d)).status, 502);
  const throwing = deps({ db: { deleteAccount: () => Promise.reject(new Error('x')) } });
  assertEquals((await handle(req(jwt(fresh)), throwing.d)).status, 502);
  assertEquals((await handle(new Request('https://fn.test/x'), deps().d)).status, 405);
});
