import { getSupabase } from '@/lib/supabase/client';
import { toDataError } from './errors';
import { DataError, type VoteStatus } from './types';

// Owner: V2. House votes: one write RPC and one read of the caller's own remaining votes.
// Errors keep the server `detail` (house_daily / uid_daily / network_daily / photo) for the vote UI.

function toStatus(data: unknown): VoteStatus {
  const row = (Array.isArray(data) ? data[0] : data) as { total_votes?: unknown; left_today?: unknown } | null;
  const total = Number(row?.total_votes);
  const left = Number(row?.left_today);
  if (!row || !Number.isFinite(total) || !Number.isFinite(left)) throw new DataError('unknown');
  return { totalVotes: Math.max(0, Math.floor(total)), leftToday: Math.max(0, Math.floor(left)) };
}

/** One vote for a house. `photoId` is set only by the lightbox heart (an approved photo of this house). */
export async function voteHouse(houseId: string, photoId: string | null): Promise<VoteStatus> {
  try {
    const { data, error } = await getSupabase().rpc('vote_house', { p_house_id: houseId, p_photo_id: photoId });
    if (error) throw error;
    return toStatus(data);
  } catch (e) {
    throw toDataError(e);
  }
}

/** The house total and this device's votes left today for it. Needs a session (`not_signed_in` otherwise). */
export async function getMyVoteStatus(houseId: string): Promise<VoteStatus> {
  try {
    const { data, error } = await getSupabase().rpc('my_vote_status', { p_house_id: houseId });
    if (error) throw error;
    return toStatus(data);
  } catch (e) {
    throw toDataError(e);
  }
}
