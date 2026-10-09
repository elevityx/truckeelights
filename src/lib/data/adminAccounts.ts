// Owner: sub/db. Admin side of Subscribe + Accounts v1: the Claims tab, Overview counts, the digest usage banner
// and the subscribe_open switch. The database enforces admin + aal2 (password + totp) on every RPC; no admin RPC
// returns an email address (only server-masked ones).
import { getSupabase } from '@/lib/supabase/client';
import { toDataError } from './errors';
import { DataError, type AdminClaim, type ClaimStatus, type DigestToday, type HouseStatus, type SubscriberCounts } from './types';

export interface RawAdminClaim {
  id: string;
  kind: string;
  house_id: string;
  address: string;
  house_status: string;
  claimant_masked: string;
  current_owner_masked: string | null;
  note: string | null;
  status: string;
  reason: string | null;
  created_at: string;
  resolved_at: string | null;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const first = (d: unknown) => (Array.isArray(d) ? d[0] : d) as Record<string, unknown> | null | undefined;

export function toAdminClaim(r: RawAdminClaim): AdminClaim {
  const st = r.status;
  return {
    id: r.id,
    kind: r.kind === 'removal' ? 'removal' : 'claim',
    houseId: r.house_id,
    address: r.address,
    houseStatus: (r.house_status === 'hidden' || r.house_status === 'released' ? r.house_status : 'visible') as HouseStatus,
    claimantMasked: r.claimant_masked ?? '',
    currentOwnerMasked: r.current_owner_masked ?? null,
    note: r.note ?? null,
    status: (st === 'approved' || st === 'rejected' || st === 'withdrawn' ? st : 'pending') as ClaimStatus,
    reason: r.reason ?? null,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at ?? null,
  };
}

async function rpc(fn: string, args?: Record<string, unknown>): Promise<unknown> {
  try {
    const { data, error } = await getSupabase().rpc(fn, args);
    if (error) throw error;
    return data;
  } catch (e) {
    throw toDataError(e);
  }
}

/** Claims and removal requests of the region in that status (pending: oldest first; others: newest first, max 200). */
export async function adminClaimQueue(regionId: string, status: ClaimStatus): Promise<AdminClaim[]> {
  const data = await rpc('admin_claim_queue', { p_region_id: regionId, p_status: status });
  return ((data ?? []) as RawAdminClaim[]).map(toAdminClaim);
}

/**
 * Approve or reject a pending row. Approving a claim makes the claimant the owner (replacing any current owner);
 * approving a removal releases the house (same path as adminReleaseHouse). Reject reason max 200 chars.
 * Not pending -> 'not_pending'.
 */
export async function adminResolveClaim(claimId: string, approve: boolean, reason?: string): Promise<void> {
  await rpc('admin_resolve_claim', { p_claim_id: claimId, p_approve: approve, p_reason: reason ?? null });
}

/** Remove the house's owner (the listing stays). */
export async function adminClearOwner(houseId: string): Promise<void> {
  await rpc('admin_clear_owner', { p_house_id: houseId });
}

export async function adminSubscriberCounts(regionId: string): Promise<SubscriberCounts> {
  const r = first(await rpc('admin_subscriber_counts', { p_region_id: regionId }));
  if (!r) throw new DataError('unknown');
  return {
    active: num(r.active),
    stopped: num(r.stopped),
    daily: num(r.daily),
    weekly: num(r.weekly),
    houses: num(r.houses),
    events: num(r.events),
  };
}

/** Today's digest sends (all regions; the email provider's limit is per account). Any admin (aal2) may read it. */
export async function adminDigestToday(): Promise<DigestToday> {
  const r = first(await rpc('admin_digest_today'));
  if (!r) throw new DataError('unknown');
  return {
    sent: num(r.sent),
    failed: num(r.failed),
    cap: num(r.cap),
    providerDailyLimit: num(r.provider_daily_limit),
    capHit: r.cap_hit === true,
  };
}

export async function adminSetSubscribeOpen(regionId: string, open: boolean): Promise<void> {
  await rpc('admin_set_subscribe_open', { p_region_id: regionId, p_open: open });
}
