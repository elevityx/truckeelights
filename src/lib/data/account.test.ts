import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase/client', () => ({ getSupabase: () => ({ rpc }) }));

import {
  beginHouseLink,
  claimMySubmissions,
  completeHouseLink,
  getMyAccount,
  requestHouseClaim,
  requestHouseRemoval,
  setHouseVisibility,
  setSubscription,
  stopSubscription,
  toMyAccount,
  withdrawHouseClaim,
} from './account';
import {
  adminClaimQueue,
  adminClearOwner,
  adminDigestToday,
  adminResolveClaim,
  adminSetSubscribeOpen,
  adminSubscriberCounts,
} from './adminAccounts';

beforeEach(() => rpc.mockReset());

const SUB = { region_slug: 'truckee', houses: true, events: false, cadence: 'weekly', status: 'active', confirmed_at: '2026-10-16T00:00:00Z' };

describe('account wrappers call the exact RPC names and argument names', () => {
  it.each([
    [() => setSubscription('truckee', { houses: true, events: false, cadence: 'weekly' }), 'set_subscription',
      { p_region_slug: 'truckee', p_houses: true, p_events: false, p_cadence: 'weekly' }, SUB],
    [() => stopSubscription(), 'stop_subscription', undefined, null],
    [() => claimMySubmissions(), 'claim_my_submissions', undefined, 2],
    [() => beginHouseLink('a@example.test'), 'begin_house_link', { p_email: 'a@example.test' }, null],
    [() => completeHouseLink(), 'complete_house_link', undefined, 3],
    [() => requestHouseClaim('h1', 'mine'), 'request_house_claim', { p_house_id: 'h1', p_note: 'mine' }, 'c1'],
    [() => requestHouseRemoval('h1', null), 'request_house_removal', { p_house_id: 'h1', p_note: null }, 'c2'],
    [() => withdrawHouseClaim('c1'), 'withdraw_house_claim', { p_claim_id: 'c1' }, null],
    [() => setHouseVisibility('h1', false), 'owner_set_house_visibility', { p_house_id: 'h1', p_visible: false }, null],
    [() => adminResolveClaim('c1', false, 'no'), 'admin_resolve_claim', { p_claim_id: 'c1', p_approve: false, p_reason: 'no' }, null],
    [() => adminClearOwner('h1'), 'admin_clear_owner', { p_house_id: 'h1' }, null],
    [() => adminSetSubscribeOpen('r1', true), 'admin_set_subscribe_open', { p_region_id: 'r1', p_open: true }, null],
  ] as const)('%#', async (fn, name, args, data) => {
    rpc.mockResolvedValue({ data, error: null });
    await fn();
    expect(rpc).toHaveBeenCalledWith(name, args);
  });
});

describe('mappers', () => {
  it('maps set_subscription', async () => {
    rpc.mockResolvedValue({ data: SUB, error: null });
    expect(await setSubscription('truckee', { houses: true, events: false, cadence: 'weekly' })).toEqual({
      regionSlug: 'truckee', houses: true, events: false, cadence: 'weekly', status: 'active', confirmedAt: '2026-10-16T00:00:00Z',
    });
  });
  it('maps my_account, with counts clamped and unknown values defaulted', () => {
    const a = toMyAccount({
      email: 'a@example.test',
      subscription: null,
      houses: [{ id: 'h1', address: '1 A St', status: 'hidden', hidden_by_owner: true, votes: '7', approved_photos: -1, removal_pending: false }],
      claims: [{ id: 'c1', kind: 'removal', house_id: 'h1', address: '1 A St', created_at: '2026-10-16T00:00:00Z' }],
    });
    expect(a).toEqual({
      email: 'a@example.test',
      subscription: null,
      houses: [{ id: 'h1', address: '1 A St', status: 'hidden', hiddenByOwner: true, votes: 7, approvedPhotos: 0, removalPending: false }],
      claims: [{ id: 'c1', kind: 'removal', houseId: 'h1', address: '1 A St', status: 'pending', createdAt: '2026-10-16T00:00:00Z' }],
    });
  });
  it('getMyAccount rejects a null payload as unknown', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getMyAccount()).rejects.toMatchObject({ code: 'unknown' });
  });
  it('maps admin_claim_queue rows', async () => {
    rpc.mockResolvedValue({
      data: [{ id: 'c1', kind: 'claim', house_id: 'h1', address: '1 A St', house_status: 'visible', claimant_masked: 'a•••@example.test',
        current_owner_masked: null, note: null, status: 'pending', reason: null, created_at: 't', resolved_at: null }],
      error: null,
    });
    const rows = await adminClaimQueue('r1', 'pending');
    expect(rpc).toHaveBeenCalledWith('admin_claim_queue', { p_region_id: 'r1', p_status: 'pending' });
    expect(rows[0]).toMatchObject({ kind: 'claim', claimantMasked: 'a•••@example.test', currentOwnerMasked: null, status: 'pending' });
  });
  it('maps admin_subscriber_counts and admin_digest_today (first row)', async () => {
    rpc.mockResolvedValueOnce({ data: [{ active: 3, stopped: 1, daily: 2, weekly: 1, houses: 3, events: 1 }], error: null });
    expect(await adminSubscriberCounts('r1')).toEqual({ active: 3, stopped: 1, daily: 2, weekly: 1, houses: 3, events: 1 });
    rpc.mockResolvedValueOnce({ data: [{ sent: 40, failed: 1, cap: 500, cap_hit: false }], error: null });
    expect(await adminDigestToday()).toEqual({ sent: 40, failed: 1, cap: 500, capHit: false });
    expect(rpc).toHaveBeenLastCalledWith('admin_digest_today', undefined);
  });
});

describe('errors', () => {
  it.each(['not_signed_in', 'forbidden', 'invalid_input', 'rate_limited', 'already_owned', 'claim_pending', 'not_found', 'not_pending'])(
    'keeps the server code %s',
    async (code) => {
      rpc.mockResolvedValue({ data: null, error: { message: code, details: 'x' } });
      await expect(requestHouseClaim('h1', null)).rejects.toMatchObject({ code });
    },
  );
});
