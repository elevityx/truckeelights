import type { VoteStatus } from './types';

// Owner: V2. Stubs until the votes RPCs are wired. Errors will go through toDataError.

export async function voteHouse(_houseId: string, _photoId: string | null): Promise<VoteStatus> {
  void _houseId;
  void _photoId;
  throw new Error('not implemented');
}

export async function getMyVoteStatus(_houseId: string): Promise<VoteStatus> {
  void _houseId;
  throw new Error('not implemented');
}
