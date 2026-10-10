// Owner: sub/db. Subscribe + Accounts v1 client wrappers (Spec_Subscribe_Accounts, Amendments 1-2).
// The database enforces who may call what (non-anonymous, owner, anonymous-only); nothing here is a
// security boundary. Sign-in itself (signInWithOtp / verifyOtp / signOut) lives in the UI layer.
import { getSupabase } from '@/lib/supabase/client';
import { toDataError } from './errors';
import {
  DataError,
  type ClaimKind,
  type HouseStatus,
  type MyAccount,
  type MyClaim,
  type OwnedHouse,
  type Subscription,
  type SubscriptionPrefs,
} from './types';

export interface RawSubscription {
  region_slug: string;
  houses: boolean;
  events: boolean;
  cadence: string;
  status: string;
  confirmed_at: string | null;
}
interface RawOwnedHouse {
  id: string;
  address: string;
  status: string;
  hidden_by_owner: boolean;
  votes: number | string;
  approved_photos: number | string;
  removal_pending: boolean;
}
interface RawMyClaim {
  id: string;
  kind: string;
  house_id: string;
  address: string;
  created_at: string;
}
interface RawAccount {
  email: string | null;
  subscription: RawSubscription | null;
  houses: RawOwnedHouse[] | null;
  claims: RawMyClaim[] | null;
}

const count = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const houseStatus = (v: string): HouseStatus => (v === 'hidden' || v === 'released' ? v : 'visible');
const claimKind = (v: string): ClaimKind => (v === 'removal' ? 'removal' : 'claim');

export function toSubscription(r: RawSubscription | null | undefined): Subscription | null {
  if (!r || typeof r !== 'object') return null;
  return {
    regionSlug: r.region_slug,
    houses: r.houses === true,
    events: r.events === true,
    cadence: r.cadence === 'weekly' ? 'weekly' : 'daily',
    status: r.status === 'stopped' ? 'stopped' : 'active',
    confirmedAt: r.confirmed_at ?? null,
  };
}

export function toMyAccount(data: unknown): MyAccount {
  const r = data as RawAccount | null;
  if (!r || typeof r !== 'object') throw new DataError('unknown');
  const houses: OwnedHouse[] = (r.houses ?? []).map((h) => ({
    id: h.id,
    address: h.address,
    status: houseStatus(h.status),
    hiddenByOwner: h.hidden_by_owner === true,
    votes: count(h.votes),
    approvedPhotos: count(h.approved_photos),
    removalPending: h.removal_pending === true,
  }));
  const claims: MyClaim[] = (r.claims ?? []).map((c) => ({
    id: c.id,
    kind: claimKind(c.kind),
    houseId: c.house_id,
    address: c.address,
    status: 'pending',
    createdAt: c.created_at,
  }));
  return { email: r.email ?? '', subscription: toSubscription(r.subscription), houses, claims };
}

async function call<T>(fn: string, args: Record<string, unknown> | undefined, map: (data: unknown) => T): Promise<T> {
  try {
    const { data, error } = await getSupabase().rpc(fn, args);
    if (error) throw error;
    return map(data);
  } catch (e) {
    throw toDataError(e);
  }
}

const toCount = (data: unknown) => count(Array.isArray(data) ? data[0] : data);
const toId = (data: unknown) => {
  const v = Array.isArray(data) ? data[0] : data;
  if (typeof v !== 'string') throw new DataError('unknown');
  return v;
};

/**
 * Save (or change) this account's subscription; non-anonymous sessions only. Idempotent: calling it again with
 * new choices updates the row and reactivates a stopped one. Quota 10/day ('rate_limited').
 * invalid_input details: 'topics' (neither houses nor events), 'cadence'.
 */
export function setSubscription(regionSlug: string, prefs: SubscriptionPrefs): Promise<Subscription> {
  return call(
    'set_subscription',
    { p_region_slug: regionSlug, p_houses: prefs.houses, p_events: prefs.events, p_cadence: prefs.cadence },
    (d) => {
      const s = toSubscription((Array.isArray(d) ? d[0] : d) as RawSubscription);
      if (!s) throw new DataError('unknown');
      return s;
    },
  );
}

/** Stop emails for the signed-in account (keeps the row; invalidates every emailed link). */
export function stopSubscription(): Promise<void> {
  return call('stop_subscription', undefined, () => undefined);
}

/** The signed-in account: email, subscription, owned houses, pending claims/removal requests. */
export function getMyAccount(): Promise<MyAccount> {
  return call('my_account', undefined, toMyAccount);
}

/** Take ownership of unowned houses this same account added while signed in. Returns how many. */
export function claimMySubmissions(): Promise<number> {
  return call('claim_my_submissions', undefined, toCount);
}

/**
 * Before sending the OTP, from an ANONYMOUS session only ('forbidden' otherwise): remember that this device's
 * houses may be linked to whoever verifies `email` within 1 hour. Never reveals whether the email has an account.
 */
export function beginHouseLink(email: string): Promise<void> {
  return call('begin_house_link', { p_email: email }, () => undefined);
}

/** After verification: link the houses of every pending device link for this account's confirmed email. */
export function completeHouseLink(): Promise<number> {
  return call('complete_house_link', undefined, toCount);
}

/** Ask an admin to make this account the manager of a visible, active-season house. Returns the claim id. */
export function requestHouseClaim(houseId: string, note: string | null): Promise<string> {
  return call('request_house_claim', { p_house_id: houseId, p_note: note }, toId);
}

/** Owner only: ask an admin to remove the house from the map. Returns the request id. */
export function requestHouseRemoval(houseId: string, note: string | null): Promise<string> {
  return call('request_house_removal', { p_house_id: houseId, p_note: note }, toId);
}

/** Withdraw one of this account's pending claims or removal requests. */
export function withdrawHouseClaim(claimId: string): Promise<void> {
  return call('withdraw_house_claim', { p_claim_id: claimId }, () => undefined);
}

/**
 * Owner only. visible=false hides a visible house (owner-hidden); visible=true unhides only an owner-hidden one.
 * Admin-hidden houses -> 'forbidden'. 3 changes per house per day ('rate_limited').
 */
export function setHouseVisibility(houseId: string, visible: boolean): Promise<void> {
  return call('owner_set_house_visibility', { p_house_id: houseId, p_visible: visible }, () => undefined);
}
