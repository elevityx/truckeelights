import { assertEquals } from '@std/assert';
import type { Prefs, UnsubscribeDb } from '../_shared/db.ts';
import { PREFS_TTL_SECONDS, signToken } from '../_shared/token.ts';
import { handle, type UnsubDeps } from './index.ts';

const SECRET = 'hmac-test';
const PID = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-12-05T02:07:00Z');
const nowS = Math.floor(NOW.getTime() / 1000);

function fake(version = 1) {
  const state: Prefs & { mutations: number } = { status: 'active', houses: true, events: false, cadence: 'daily', token_version: version, mutations: 0 };
  const db: UnsubscribeDb = {
    lookup: (id) => Promise.resolve(id === PID ? { ...state } : null),
    stop: (id, v) => { if (id !== PID || v !== state.token_version) return Promise.resolve('invalid'); state.mutations++; state.status = 'stopped'; return Promise.resolve('stopped'); },
    setPrefs: (id, v, h, e, c) => { if (id !== PID || v !== state.token_version) return Promise.resolve('invalid'); state.mutations++; Object.assign(state, { houses: h, events: e, cadence: c }); return Promise.resolve('ok'); },
  };
  const deps: UnsubDeps = { db, secret: SECRET, site: 'https://example.test', now: () => NOW };
  return { state, deps };
}
const unsub = (v = 1) => signToken(SECRET, { publicId: PID, version: v, purpose: 'unsub', exp: 0 });
const prefs = (v = 1, exp = nowS + PREFS_TTL_SECONDS) => signToken(SECRET, { publicId: PID, version: v, purpose: 'prefs', exp });
const post = (t: string, body?: unknown, viaQuery = true) =>
  new Request(`https://fn.test/unsubscribe${viaQuery ? `?t=${encodeURIComponent(t)}` : ''}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(viaQuery ? (body ?? {}) : { t, ...(body as object) }),
  });

Deno.test('GET never mutates: 303 to the static page, valid token or not', async () => {
  const { state, deps } = fake();
  const t = await unsub();
  for (const url of [`https://fn.test/unsubscribe?t=${t}`, 'https://fn.test/unsubscribe?t=garbage', 'https://fn.test/unsubscribe']) {
    const r = await handle(new Request(url), deps);
    assertEquals(r.status, 303);
    assertEquals(r.headers.get('location')!.startsWith('https://example.test/unsubscribe/'), true);
  }
  assertEquals(state.mutations, 0);
  assertEquals(state.status, 'active');
});

Deno.test('one-click POST (form body, token in query) stops', async () => {
  const { state, deps } = fake();
  const t = await unsub();
  const r = await handle(new Request(`https://fn.test/unsubscribe?t=${encodeURIComponent(t)}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click',
  }), deps);
  assertEquals(r.status, 200);
  assertEquals(state.status, 'stopped');
});

Deno.test('stale version (bumped), tampered and malformed tokens are rejected and change nothing', async () => {
  const { state, deps } = fake(2);
  assertEquals((await handle(post(await unsub(1)), deps)).status, 410); // version bumped since
  const t = await unsub(2);
  assertEquals((await handle(post(t.slice(0, -3) + 'AAA'), deps)).status, 400);
  assertEquals((await handle(post('nope'), deps)).status, 400);
  assertEquals((await handle(new Request('https://fn.test/unsubscribe', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }), deps)).status, 400);
  assertEquals(state.mutations, 0);
});

Deno.test('prefs: get and set need a prefs token; expired is 410; invalid input is 400', async () => {
  const { state, deps } = fake();
  const p = await prefs();
  const got = await handle(post(p, { action: 'get' }), deps);
  assertEquals(await got.json(), { status: 'active', houses: true, events: false, cadence: 'daily' });
  assertEquals((await handle(post(await unsub(), { action: 'get' }), deps)).status, 403);
  assertEquals((await handle(post(await unsub(), { action: 'set', houses: true, events: true, cadence: 'weekly' }), deps)).status, 403);
  assertEquals((await handle(post(await prefs(1, nowS - 1), { action: 'get' }), deps)).status, 410);
  assertEquals((await handle(post(p, { action: 'set', houses: false, events: false, cadence: 'daily' }), deps)).status, 400);
  assertEquals((await handle(post(p, { action: 'set', houses: true, events: true, cadence: 'hourly' }), deps)).status, 400);
  assertEquals(state.mutations, 0);
  assertEquals((await handle(post(p, { action: 'set', houses: true, events: true, cadence: 'weekly' }, false), deps)).status, 200);
  assertEquals([state.houses, state.events, state.cadence], [true, true, 'weekly']);
  // a prefs link can also stop
  assertEquals((await handle(post(p, { action: 'stop' }), deps)).status, 200);
});

Deno.test('OPTIONS, other methods, and a missing secret', async () => {
  const { deps } = fake();
  assertEquals((await handle(new Request('https://fn.test/unsubscribe', { method: 'OPTIONS' }), deps)).status, 204);
  assertEquals((await handle(new Request('https://fn.test/unsubscribe', { method: 'DELETE' }), deps)).status, 405);
  assertEquals((await handle(post('x'), { ...deps, secret: undefined })).status, 500);
});
