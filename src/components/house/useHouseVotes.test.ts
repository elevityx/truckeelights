import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '@/lib/data/types';

const api = {
  voteHouse: vi.fn(),
  getMyVoteStatus: vi.fn(),
  hasSession: vi.fn(),
  ensureAnonymousSession: vi.fn(),
};
vi.mock('./votesApi', () => ({ votesApi: async () => api, devVotesFixture: async () => null }));

import { _store, setPinTotalListener } from './useHouseVotes';

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  _store.reset();
  Object.values(api).forEach((f) => f.mockReset());
  api.hasSession.mockResolvedValue(true);
});

describe('pin totals without a mounted panel', () => {
  it('propagates the optimistic tap and the rollback after the failure settles', async () => {
    const seen: [string, number][] = [];
    setPinTotalListener((id, t) => seen.push([id, t]));
    _store.get('h1', 10);
    let rej!: (e: unknown) => void;
    api.voteHouse.mockReturnValue(new Promise((_, r) => (rej = r)));
    await _store.tap('h1', null, 'panel'); // no panel exists; only the store
    expect(seen).toEqual([['h1', 11]]);
    rej(new DataError('votes_closed'));
    await flush();
    expect(seen.at(-1)).toEqual(['h1', 10]);
    expect(_store.get('h1', 10)).toMatchObject({ total: 10, closed: true });
  });

  it('propagates the settled server total on ok', async () => {
    const seen: [string, number][] = [];
    setPinTotalListener((id, t) => seen.push([id, t]));
    _store.get('h1', 10);
    api.voteHouse.mockResolvedValue({ totalVotes: 14, leftToday: 4 });
    await _store.tap('h1', null, 'panel');
    await flush();
    expect(seen.at(-1)).toEqual(['h1', 14]);
  });

  it('keeps pumping after a transient failure, rolls back only the head', async () => {
    _store.get('h1', 10);
    api.voteHouse.mockRejectedValueOnce(new TypeError('x')).mockResolvedValue({ totalVotes: 11, leftToday: 3 });
    await _store.tap('h1', 'p1', 'photo');
    await _store.tap('h1', 'p2', 'photo');
    await flush();
    expect(api.voteHouse).toHaveBeenCalledTimes(2);
    expect(_store.get('h1', 10)).toMatchObject({ total: 11, left: 3, queue: [] });
  });
});

describe('house switch during first-vote auth', () => {
  it('cancelling the check lets the next house show its own check and vote', async () => {
    api.hasSession.mockResolvedValue(false);
    _store.get('A', 1);
    _store.get('B', 2);
    await _store.tap('A', null, 'panel');
    expect(_store.getCheck()?.houseId).toBe('A');
    await _store.tap('B', null, 'panel'); // stranded before the fix: silently ignored
    expect(_store.getCheck()?.houseId).toBe('A');
    _store.cancelCheck(); // what the panel does when its house changes or it unmounts
    expect(_store.getCheck()).toBeNull();
    await _store.tap('B', null, 'panel');
    expect(_store.getCheck()?.houseId).toBe('B');
    expect(_store.get('A', 1).queue).toEqual([]); // A's pending tap was dropped
  });

  it('a token that arrives after the cancel does not cast the old house vote', async () => {
    api.hasSession.mockResolvedValue(false);
    let done!: () => void;
    api.ensureAnonymousSession.mockReturnValue(new Promise<void>((r) => (done = r)));
    _store.get('A', 1);
    await _store.tap('A', null, 'panel');
    const pending = _store.onToken('tok');
    _store.cancelCheck();
    done();
    await pending;
    await flush();
    expect(api.voteHouse).not.toHaveBeenCalled();
    expect(_store.get('A', 1).queue).toEqual([]);
  });
});
