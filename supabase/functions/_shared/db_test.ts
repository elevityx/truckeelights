// Contract test: db.ts calls the svc_* routines of 20261016000200_subscribe_accounts.sql with exactly their
// parameter names, and maps their return shapes. If the migration's signatures change, update both.
import { assertEquals, assertRejects } from '@std/assert';
import { accountDb, digestDb, unsubscribeDb } from './db.ts';

type SupabaseClient = Parameters<typeof digestDb>[0];

type Reply = { data: unknown; error: { code?: string; message: string } | null };
function fakeClient(replies: Record<string, Reply>) {
  const calls: [string, Record<string, unknown>][] = [];
  const sb = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push([fn, args]);
      return Promise.resolve(replies[fn] ?? { data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

const RUN = '99999999-0000-4000-8000-000000000001';
const U = '00000000-0000-4000-8000-000000000001';
const P = '11111111-2222-4333-8444-555555555555';

Deno.test('digest: svc_digest_start / batch / mark / finish signatures and shapes', async () => {
  const { sb, calls } = fakeClient({
    svc_digest_start: { data: RUN, error: null },
    svc_digest_batch: { data: [{ run_id: RUN, user_id: U, idempotency_key: `digest:${P}:2026-12-04T02:07:00.000000Z`, window_to: '2026-12-05T02:07:00Z' }], error: null },
    svc_digest_mark: { data: true, error: null },
    svc_digest_finish: { data: [{ sent: 1, failed: 0, cap_hit: true }], error: null },
  });
  const db = digestDb(sb);
  assertEquals(await db.start('daily', '2026-12-04'), RUN);
  assertEquals((await db.batch(RUN, 100))[0].idempotency_key, `digest:${P}:2026-12-04T02:07:00.000000Z`);
  assertEquals(await db.mark(RUN, U, false, 'http_500'), true);
  assertEquals(await db.finish(RUN), { sent: 1, failed: 0, cap_hit: true });
  assertEquals(calls, [
    ['svc_digest_start', { p_kind: 'daily', p_run_date: '2026-12-04' }],
    ['svc_digest_batch', { p_run_id: RUN, p_limit: 100 }],
    ['svc_digest_mark', { p_run_id: RUN, p_user_id: U, p_ok: false, p_error_code: 'http_500' }],
    ['svc_digest_finish', { p_run_id: RUN }],
  ]);
});

Deno.test('digest: a null start or an rpc error throws without the provider message', async () => {
  const { sb } = fakeClient({ svc_digest_start: { data: null, error: null }, svc_digest_batch: { data: null, error: { message: 'row data here' } } });
  const db = digestDb(sb);
  await assertRejects(() => db.start('weekly', '2026-12-03'));
  const e = await assertRejects(() => db.batch(RUN, 5));
  assertEquals((e as Error).message, 'rpc svc_digest_batch failed');
});

Deno.test('unsubscribe: lookup / stop / set_prefs take (public_id, version) and map results', async () => {
  const { sb, calls } = fakeClient({
    svc_unsubscribe_lookup: { data: [{ status: 'active', houses: true, events: false, cadence: 'daily', region_name: 'Truckee' }], error: null },
    svc_unsubscribe_stop: { data: 'stopped', error: null },
    svc_unsubscribe_set_prefs: { data: 'updated', error: null },
  });
  const db = unsubscribeDb(sb);
  assertEquals((await db.lookup(P, 3))?.region_name, 'Truckee');
  assertEquals(await db.stop(P, 3), 'stopped');
  assertEquals(await db.setPrefs(P, 3, true, true, 'weekly'), 'updated');
  assertEquals(calls, [
    ['svc_unsubscribe_lookup', { p_public_id: P, p_version: 3 }],
    ['svc_unsubscribe_stop', { p_public_id: P, p_version: 3 }],
    ['svc_unsubscribe_set_prefs', { p_public_id: P, p_version: 3, p_houses: true, p_events: true, p_cadence: 'weekly' }],
  ]);
  const none = unsubscribeDb(fakeClient({ svc_unsubscribe_lookup: { data: [], error: null }, svc_unsubscribe_stop: { data: 'invalid', error: null }, svc_unsubscribe_set_prefs: { data: 'invalid', error: null } }).sb);
  assertEquals(await none.lookup(P, 1), null);
  assertEquals(await none.stop(P, 1), 'invalid');
  assertEquals(await none.setPrefs(P, 1, true, false, 'daily'), 'invalid');
  const again = unsubscribeDb(fakeClient({ svc_unsubscribe_stop: { data: 'already_stopped', error: null } }).sb);
  assertEquals(await again.stop(P, 1), 'already_stopped');
});

Deno.test('account: svc_delete_account_check maps ok / gone / forbidden (fail closed); svc_delete_account cleans up', async () => {
  const ok = fakeClient({ svc_delete_account_check: { data: 'ok', error: null }, svc_delete_account: { data: 0, error: null } });
  assertEquals(await accountDb(ok.sb).checkDelete(U), 'ok');
  await accountDb(ok.sb).cleanupDeleted(U);
  assertEquals(ok.calls, [['svc_delete_account_check', { p_user_id: U }], ['svc_delete_account', { p_user_id: U }]]);
  assertEquals(await accountDb(fakeClient({ svc_delete_account_check: { data: 'gone', error: null } }).sb).checkDelete(U), 'gone');
  assertEquals(await accountDb(fakeClient({ svc_delete_account_check: { data: 'forbidden', error: null } }).sb).checkDelete(U), 'forbidden');
  assertEquals(await accountDb(fakeClient({ svc_delete_account_check: { data: 'weird', error: null } }).sb).checkDelete(U), 'forbidden');
  const broken = fakeClient({ svc_delete_account: { data: null, error: { code: 'XX000', message: 'x' } } });
  await assertRejects(() => accountDb(broken.sb).cleanupDeleted(U));
});
