import { getSupabase } from '@/lib/supabase/client';
import { toDataError } from './errors';
import { DataError, type SubmitInput, type SubmitResult } from './types';

// Owner: WP-C

export async function hasSession(): Promise<boolean> {
  try {
    const { data, error } = await getSupabase().auth.getSession();
    if (error) return false;
    return data.session !== null;
  } catch {
    return false;
  }
}

/** No-op if a session exists; otherwise anonymous sign-in with the Turnstile token. */
export async function ensureAnonymousSession(captchaToken: string): Promise<void> {
  try {
    const sb = getSupabase();
    const { data: cur } = await sb.auth.getSession();
    if (cur.session) return;
    const { error } = await sb.auth.signInAnonymously({ options: { captchaToken } });
    if (error) throw error;
  } catch (e) {
    throw toDataError(e);
  }
}

export async function submitHouse(i: SubmitInput): Promise<SubmitResult> {
  try {
    const { data, error } = await getSupabase().rpc('submit_house', {
      p_region_slug: i.regionSlug,
      p_place_id: i.placeId,
      p_address: i.address,
      p_lat: i.lat,
      p_lng: i.lng,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    const result: unknown = row?.result;
    if (result === 'blocked') return { result: 'blocked' };
    if ((result === 'created' || result === 'exists_visible') && typeof row.house_id === 'string') {
      return { result, houseId: row.house_id };
    }
    throw new DataError('unknown');
  } catch (e) {
    throw toDataError(e);
  }
}
