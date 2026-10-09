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

describe('stale async results', () => {
  it('a stale bot-check completion does not consume a replacement check for the same house', async () => {
    api.hasSession.mockResolvedValue(false);
    let doneA!: () => void;
    api.ensureAnonymousSession.mockReturnValueOnce(new Promise<void>((r) => (doneA = r))).mockReturnValue(new Promise<void>(() => {}));
    _store.get('A', 1);
    await _store.tap('A', 'photoA', 'photo');
    const first = _store.onToken('tokA');
    _store.cancelCheck();
    await _store.tap('A', 'photoB', 'photo'); // a replacement check for the same house
    void _store.onToken('tokB'); // busy again, waiting on the bot check
    const replacement = _store.getCheck();
    expect(replacement).toMatchObject({ photoId: 'photoB', busy: true });
    doneA();
    await first;
    await flush();
    expect(_store.getCheck()).toBe(replacement); // untouched
    expect(api.voteHouse).not.toHaveBeenCalled(); // and photo A's canceled vote was not cast
  });

  it('a my_vote_status that started before a vote settled does not overwrite the committed total', async () => {
    _store.get('h1', 10);
    let status!: (v: unknown) => void;
    api.getMyVoteStatus.mockReturnValue(new Promise((r) => (status = r)));
    const seen: number[] = [];
    setPinTotalListener((_, t) => seen.push(t));
    // the open-sheet read starts first (via a vote's refresh path), then a vote settles before it answers
    const { _refresh } = await import('./useHouseVotes');
    const read = _refresh('h1');
    await flush();
    api.voteHouse.mockResolvedValue({ totalVotes: 11, leftToday: 4 });
    await _store.tap('h1', null, 'panel');
    await flush();
    status({ totalVotes: 10, leftToday: 5 }); // older than the vote
    await read;
    await flush();
    expect(_store.get('h1', 10)).toMatchObject({ total: 11, left: 4 });
    expect(seen.at(-1)).toBe(11);
  });

  it('after a lost response the status is re-read and the committed total comes back', async () => {
    _store.get('h1', 10);
    api.voteHouse.mockRejectedValue(new TypeError('network down')); // vote committed, response lost
    api.getMyVoteStatus.mockResolvedValue({ totalVotes: 11, leftToday: 4 });
    await _store.tap('h1', null, 'panel');
    await flush();
    expect(api.getMyVoteStatus).toHaveBeenCalledTimes(1);
    expect(_store.get('h1', 10)).toMatchObject({ total: 11, left: 4, queue: [] });
  });

  it('keeps the head-only rollback when the status read also fails', async () => {
    _store.get('h1', 10);
    api.voteHouse.mockRejectedValue(new TypeError('network down'));
    api.getMyVoteStatus.mockRejectedValue(new TypeError('still down'));
    await _store.tap('h1', null, 'panel');
    await flush();
    expect(_store.get('h1', 10)).toMatchObject({ total: 10, left: 5, queue: [] });
  });

  it('an ambiguous failure with a tap queued behind it still gets a status read after the queue drains', async () => {
    _store.get('h1', 10);
    let rejA!: (e: unknown) => void;
    api.voteHouse
      .mockReturnValueOnce(new Promise((_, r) => (rejA = r)))
      .mockRejectedValueOnce(new DataError('not_found', 'photo')); // B: definitive, not network/unknown
    api.getMyVoteStatus.mockResolvedValue({ totalVotes: 11, leftToday: 4 }); // A had committed
    await _store.tap('h1', 'pA', 'panel');
    await _store.tap('h1', 'pB', 'panel');
    rejA(new TypeError('network down'));
    await flush();
    expect(api.getMyVoteStatus).toHaveBeenCalledTimes(1);
    expect(_store.get('h1', 10)).toMatchObject({ total: 11, left: 4, queue: [] });
  });

  it('a recovered vote shows no failure note; a vote the re-read does not show keeps the failure', async () => {
    _store.get('h1', 10);
    api.voteHouse.mockRejectedValue(new TypeError('network down'));
    api.getMyVoteStatus.mockResolvedValue({ totalVotes: 11, leftToday: 4 });
    await _store.tap('h1', null, 'panel');
    await flush();
    const ok = _store.get('h1', 10);
    expect(ok.pendingFail).toBeNull();
    expect(ok.note?.error).toBe(false);

    _store.reset();
    api.hasSession.mockResolvedValue(true);
    _store.get('h2', 10);
    api.getMyVoteStatus.mockResolvedValue({ totalVotes: 10, leftToday: 5 }); // it did not count
    await _store.tap('h2', null, 'panel');
    await flush();
    expect(_store.get('h2', 10)).toMatchObject({ total: 10, left: 5, note: { error: true } });
  });

  describe('ambiguous votes with later successes in the queue', () => {
    const twoTaps = async (status: { totalVotes: number; leftToday: number }, second: unknown) => {
      _store.get('h1', 10);
      let rejA!: (e: unknown) => void;
      api.voteHouse.mockReturnValueOnce(new Promise((_, r) => (rejA = r))).mockResolvedValueOnce(second);
      api.getMyVoteStatus.mockResolvedValue(status);
      await _store.tap('h1', null, 'panel');
      await _store.tap('h1', null, 'panel');
      rejA(new TypeError('down'));
      await flush();
      return _store.get('h1', 10);
    };

    it('ambiguous then success, both committed: no failure note', async () => {
      const st = await twoTaps({ totalVotes: 12, leftToday: 3 }, { totalVotes: 12, leftToday: 3 });
      expect(st.note?.error).toBe(false);
      expect(st).toMatchObject({ total: 12, left: 3, pendingFail: null });
    });

    it('ambiguous not committed then success: failure note', async () => {
      const st = await twoTaps({ totalVotes: 11, leftToday: 4 }, { totalVotes: 11, leftToday: 4 });
      expect(st.note?.error).toBe(true);
      expect(st).toMatchObject({ total: 11, left: 4 });
    });

    it('two ambiguous taps, one committed: failure note, server totals kept', async () => {
      _store.get('h1', 10);
      let rejA!: (e: unknown) => void;
      let rejB!: (e: unknown) => void;
      api.voteHouse.mockReturnValueOnce(new Promise((_, r) => (rejA = r))).mockReturnValueOnce(new Promise((_, r) => (rejB = r)));
      api.getMyVoteStatus.mockResolvedValue({ totalVotes: 11, leftToday: 4 });
      await _store.tap('h1', null, 'panel');
      await _store.tap('h1', null, 'panel');
      rejA(new TypeError('down'));
      await flush();
      rejB(new TypeError('down'));
      await flush();
      expect(_store.get('h1', 10)).toMatchObject({ total: 11, left: 4, note: { error: true }, recon: null });
    });
  });

  it('a failed re-read still surfaces the failure text', async () => {
    _store.get('h1', 10);
    api.voteHouse.mockRejectedValue(new TypeError('network down'));
    api.getMyVoteStatus.mockRejectedValue(new TypeError('still down'));
    await _store.tap('h1', null, 'panel');
    await flush();
    expect(_store.get('h1', 10).note?.error).toBe(true);
  });

  it("another house settling does not discard this house's status read", async () => {
    _store.get('hA', 10);
    _store.get('hB', 20);
    let status!: (v: unknown) => void;
    api.getMyVoteStatus.mockReturnValue(new Promise((r) => (status = r)));
    const { _refresh } = await import('./useHouseVotes');
    const read = _refresh('hA');
    await flush();
    api.voteHouse.mockResolvedValue({ totalVotes: 21, leftToday: 4 });
    await _store.tap('hB', null, 'panel');
    await flush();
    status({ totalVotes: 12, leftToday: 5 });
    await read;
    await flush();
    expect(_store.get('hA', 10)).toMatchObject({ total: 12, left: 5 });
  });
});
