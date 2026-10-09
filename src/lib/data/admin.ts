import { getSupabase } from '@/lib/supabase/client';
import { toDataError } from './errors';
import type { AdminHouse, AdminVoteRow, HouseStatus, Season } from './types';

// Owner: WP-D. Every function wraps its errors with toDataError. The database enforces
// admin + aal2 on every admin RPC; nothing here is a security boundary.

export async function adminSignIn(email: string, password: string, captchaToken: string): Promise<void> {
  try {
    const { error } = await getSupabase().auth.signInWithPassword({
      email,
      password,
      options: { captchaToken },
    });
    if (error) throw error;
  } catch (e) {
    throw toDataError(e);
  }
}

export async function adminAal(): Promise<{ current: 'aal1' | 'aal2' | null; next: 'aal1' | 'aal2' | null }> {
  try {
    const { data, error } = await getSupabase().auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    const lvl = (v: string | null | undefined): 'aal1' | 'aal2' | null => (v === 'aal1' || v === 'aal2' ? v : null);
    return { current: lvl(data?.currentLevel), next: lvl(data?.nextLevel) };
  } catch (e) {
    throw toDataError(e);
  }
}

/**
 * Addition to the frozen contract (UI convenience only): true when a non-anonymous session exists.
 * A visitor's anonymous session counts as "no session" for the back office.
 */
export async function adminHasUserSession(): Promise<boolean> {
  try {
    const { data, error } = await getSupabase().auth.getSession();
    if (error) throw error;
    const user = data.session?.user;
    return !!user && !user.is_anonymous;
  } catch (e) {
    throw toDataError(e);
  }
}

export async function adminVerifiedTotp(): Promise<{ id: string; friendlyName: string } | null> {
  try {
    const { data, error } = await getSupabase().auth.mfa.listFactors();
    if (error) throw error;
    const f = (data?.totp ?? []).find((x) => x.factor_type === 'totp' && x.status === 'verified');
    return f ? { id: f.id, friendlyName: f.friendly_name ?? '' } : null;
  } catch (e) {
    throw toDataError(e);
  }
}

export async function adminEnrollTotp(friendlyName: string): Promise<{ factorId: string; qrCode: string; secret: string }> {
  try {
    const { data, error } = await getSupabase().auth.mfa.enroll({ factorType: 'totp', friendlyName });
    if (error) throw error;
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  } catch (e) {
    throw toDataError(e);
  }
}

export async function adminVerifyTotp(factorId: string, code: string): Promise<void> {
  try {
    const { error } = await getSupabase().auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw error;
  } catch (e) {
    throw toDataError(e);
  }
}

export async function adminChangePassword(pw: string): Promise<void> {
  try {
    const { error } = await getSupabase().auth.updateUser({ password: pw });
    if (error) throw error;
  } catch (e) {
    throw toDataError(e);
  }
}

export async function adminSignOut(): Promise<void> {
  try {
    const { error } = await getSupabase().auth.signOut();
    if (error) throw error;
  } catch (e) {
    throw toDataError(e);
  }
}

export async function adminWhoami(regionId: string): Promise<boolean> {
  try {
    const { data, error } = await getSupabase().rpc('admin_whoami', { p_region_id: regionId });
    if (error) throw error;
    return data === true;
  } catch (e) {
    throw toDataError(e);
  }
}

export async function adminSetSeason(regionId: string, season: Season, year: number, open: boolean): Promise<void> {
  try {
    const { error } = await getSupabase().rpc('admin_set_season', {
      p_region_id: regionId,
      p_season: season,
      p_year: year,
      p_submissions_open: open,
    });
    if (error) throw error;
  } catch (e) {
    throw toDataError(e);
  }
}

interface RawAdminHouse {
  id: string;
  address: string;
  season: Season;
  year: number;
  status: HouseStatus;
  hidden_reason: string | null;
  created_at: string;
  legacy_source: string | null;
}

export async function adminListHouses(regionId: string, status: HouseStatus | null, query: string | null): Promise<AdminHouse[]> {
  try {
    const { data, error } = await getSupabase().rpc('admin_list_houses', {
      p_region_id: regionId,
      p_status: status,
      p_query: query,
    });
    if (error) throw error;
    return ((data ?? []) as RawAdminHouse[]).map((h) => ({
      id: h.id,
      address: h.address,
      season: h.season,
      year: h.year,
      status: h.status,
      hiddenReason: h.hidden_reason,
      createdAt: h.created_at,
      legacySource: h.legacy_source,
    }));
  } catch (e) {
    throw toDataError(e);
  }
}

export async function adminSetHouseStatus(houseId: string, status: 'visible' | 'hidden', reason: string | null): Promise<void> {
  try {
    const { error } = await getSupabase().rpc('admin_set_house_status', {
      p_house_id: houseId,
      p_status: status,
      p_reason: reason,
    });
    if (error) throw error;
  } catch (e) {
    throw toDataError(e);
  }
}

export async function adminReleaseHouse(houseId: string): Promise<void> {
  try {
    const { error } = await getSupabase().rpc('admin_release_house', { p_house_id: houseId });
    if (error) throw error;
  } catch (e) {
    throw toDataError(e);
  }
}

interface RawVoteRow {
  house_id: string;
  address: string;
  total_votes: number | string;
  votes_today: number | string;
  votes_24h: number | string;
  voters_24h: number | string;
  top_voter: string | null;
  top_voter_24h: number | string | null;
  voided: number | string;
}

/** Per-house vote stats. `top_voter_24h` is the top voter's count; it is kept as a string to match AdminVoteRow. */
export async function adminVoteStats(regionId: string): Promise<AdminVoteRow[]> {
  try {
    const { data, error } = await getSupabase().rpc('admin_vote_stats', { p_region_id: regionId });
    if (error) throw error;
    return ((data ?? []) as RawVoteRow[]).map((r) => ({
      houseId: r.house_id,
      address: r.address,
      totalVotes: Number(r.total_votes ?? 0),
      votesToday: Number(r.votes_today ?? 0),
      votes24h: Number(r.votes_24h ?? 0),
      voters24h: Number(r.voters_24h ?? 0),
      topVoter: r.top_voter ?? null,
      topVoter24h: r.top_voter_24h == null ? null : String(r.top_voter_24h),
      voided: Number(r.voided ?? 0),
    }));
  } catch (e) {
    throw toDataError(e);
  }
}

/** Voids votes on a house: since=null,uid=null is a full reset. Returns how many were voided. */
export async function adminVoidVotes(houseId: string, since: string | null, uid: string | null): Promise<number> {
  try {
    const { data, error } = await getSupabase().rpc('admin_void_votes', {
      p_house_id: houseId,
      p_since: since,
      p_uid: uid,
    });
    if (error) throw error;
    return Number(data ?? 0);
  } catch (e) {
    throw toDataError(e);
  }
}

export async function adminSetVotesOpen(regionId: string, open: boolean): Promise<void> {
  try {
    const { error } = await getSupabase().rpc('admin_set_votes_open', { p_region_id: regionId, p_open: open });
    if (error) throw error;
  } catch (e) {
    throw toDataError(e);
  }
}

/** Global admin only: a region-only admin gets `forbidden`. Never defaults; errors throw. */
export async function adminNetworkCapStatus(): Promise<boolean> {
  try {
    const { data, error } = await getSupabase().rpc('admin_network_cap_status');
    if (error) throw error;
    if (typeof data !== 'boolean') throw new Error('unexpected network cap status');
    return data;
  } catch (e) {
    throw toDataError(e);
  }
}
