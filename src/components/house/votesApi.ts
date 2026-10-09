// The vote calls the public UI makes. Production always uses the real data layer.
// `next dev` with NEXT_PUBLIC_VOTES_MOCK=1 swaps in votesDevMock.ts (an in-memory fake for screenshots before the
// votes database exists). The NODE_ENV check is inlined at build, so the mock is dead code in `next build`.
import { getMyVoteStatus, voteHouse, type PinView, type RegionContext, type VoteStatus } from '@/lib/data';
import { ensureAnonymousSession, hasSession } from '@/lib/data/submit';

export interface VotesApi {
  voteHouse(houseId: string, photoId: string | null): Promise<VoteStatus>;
  getMyVoteStatus(houseId: string): Promise<VoteStatus>;
  hasSession(): Promise<boolean>;
  ensureAnonymousSession(token: string): Promise<void>;
}

const real: VotesApi = { voteHouse, getMyVoteStatus, hasSession, ensureAnonymousSession };

const mocked = () => process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_VOTES_MOCK === '1';

export async function votesApi(): Promise<VotesApi> {
  if (mocked()) return (await import('./votesDevMock')).devVotesApi();
  return real;
}

/** DEV ONLY: a sample region and pins with vote counts (no database needed). Always null in production. */
export async function devVotesFixture(): Promise<{ ctx: RegionContext; pins: PinView[] } | null> {
  if (mocked()) return (await import('./votesDevMock')).fixture();
  return null;
}
