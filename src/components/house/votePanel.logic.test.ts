import { describe, expect, it } from 'vitest';
import { canTap, initialVoteState, nextToSend, voteErrorMessage, voteReducer, type VoteAction, type VoteState } from './votePanel.logic';

const run = (s: VoteState, ...as: VoteAction[]) => as.reduce(voteReducer, s);
const tap = (photoId: string | null = null): VoteAction => ({ type: 'tap', photoId });
const fail = (code: 'rate_limited' | 'network' | 'votes_closed' | 'unknown' | 'not_found', detail?: string): VoteAction => ({ type: 'fail', code, detail, message: 'x' });

describe('voteReducer (AC21)', () => {
  it('applies a tap optimistically and keeps the server answer on success', () => {
    let s = run(initialVoteState(52), tap());
    expect([s.total, s.left, s.queue]).toEqual([53, 4, [null]]);
    s = run(s, { type: 'send' }, { type: 'ok', total: 60, left: 4 });
    expect([s.total, s.left, s.queue.length, s.inFlight]).toEqual([60, 4, 0, false]);
    expect(s.note?.text).toBe('Voted. 4 of 5 left today.');
  });

  it('rolls the tap back on an error', () => {
    const s = run(initialVoteState(10), tap(), { type: 'send' }, fail('not_found'));
    expect([s.total, s.left, s.queue.length, s.inFlight]).toEqual([10, 5, 0, false]);
    expect(s.note).toMatchObject({ error: true });
  });

  it('holds an ambiguous failure back until the re-read: counted shows success, not counted shows the failure', () => {
    const failed = run(initialVoteState(10), tap(), { type: 'send' }, fail('network'));
    expect([failed.note, failed.pendingFail]).toEqual([null, 'x']);
    const counted = voteReducer(failed, { type: 'sync', total: 11, left: 4, reconcile: true });
    expect(counted).toMatchObject({ total: 11, left: 4, pendingFail: null, note: { error: false } });
    const missed = voteReducer(failed, { type: 'sync', total: 10, left: 5, reconcile: true });
    expect(missed).toMatchObject({ pendingFail: null, note: { error: true, text: 'x' } });
    expect(voteReducer(failed, { type: 'giveUp' })).toMatchObject({ pendingFail: null, note: { error: true } });
  });

  it('a transient error rolls back only the in-flight head and keeps the rest queued', () => {
    for (const code of ['network', 'unknown', 'not_found'] as const) {
      const s = run(initialVoteState(10), tap('p1'), tap('p2'), tap('p3'), { type: 'send' }, fail(code));
      expect([s.total, s.left, s.queue, s.inFlight]).toEqual([12, 3, ['p2', 'p3'], false]);
      expect(nextToSend(s)).toBe('p2');
      expect(s.closed).toBe(false);
    }
  });

  it('terminal errors drop and roll back the whole queue', () => {
    const cases: [Parameters<typeof fail>[0], string | undefined][] = [
      ['votes_closed', undefined],
      ['rate_limited', 'house_daily'],
      ['rate_limited', 'uid_daily'],
      ['rate_limited', 'network_daily'],
      ['rate_limited', 'house_breaker'],
      ['rate_limited', 'region_breaker'],
    ];
    for (const [code, detail] of cases) {
      const s = run(initialVoteState(10), tap(), tap(), tap(), { type: 'send' }, fail(code, detail));
      expect([s.total, s.queue.length, s.inFlight]).toEqual([10, 0, false]);
      expect(nextToSend(s)).toBeUndefined();
    }
  });

  it('votes_closed sets closed (panel disables)', () => {
    const s = run(initialVoteState(10), tap(), tap(), { type: 'send' }, fail('votes_closed'));
    expect([s.closed, s.total, s.left, canTap(s)]).toEqual([true, 10, 5, false]);
  });

  it('a settled server answer is not clobbered by a stale pin total (seed)', () => {
    let s = run(initialVoteState(10), tap(), { type: 'send' }, fail('network'));
    expect(s.reconciled).toBe(true);
    s = run(s, { type: 'seed', total: 11 }); // stale pin that still shows the refused vote
    expect(s.total).toBe(10);
    expect(run(initialVoteState(10), { type: 'seed', total: 12 }).total).toBe(12); // untouched house: pin wins
  });

  it('house_daily forces left = 0', () => {
    const s = run(initialVoteState(3), tap(), { type: 'send' }, fail('rate_limited', 'house_daily'));
    expect([s.total, s.left]).toEqual([3, 0]);
    expect(canTap(s)).toBe(false);
  });

  it('network_daily also forces left = 0; uid_daily sets dailyExhausted; votes_closed closes', () => {
    expect(run(initialVoteState(0), tap(), { type: 'send' }, fail('rate_limited', 'network_daily')).left).toBe(0);
    const ex = run(initialVoteState(0), tap(), { type: 'send' }, fail('rate_limited', 'uid_daily'));
    expect([ex.dailyExhausted, ex.left, canTap(ex)]).toEqual([true, 5, false]);
    expect(canTap(run(initialVoteState(0), tap(), { type: 'send' }, fail('votes_closed')))).toBe(false);
  });

  it('ignores taps beyond left', () => {
    const s = run(initialVoteState(0), tap(), tap(), tap(), tap(), tap(), tap(), tap());
    expect([s.total, s.left, s.queue.length]).toEqual([5, 0, 5]);
  });

  it('processes the queue one at a time', () => {
    let s = run(initialVoteState(0), tap('p1'), tap(null));
    expect(nextToSend(s)).toBe('p1');
    s = run(s, { type: 'send' });
    expect(nextToSend(s)).toBeUndefined(); // one in flight: nothing else goes out
    expect(run(s, { type: 'send' })).toBe(s);
    s = run(s, { type: 'ok', total: 1, left: 4 });
    // The second tap is still counted on top of the server's answer.
    expect([s.total, s.left]).toEqual([2, 3]);
    expect(nextToSend(s)).toBeNull();
    s = run(s, { type: 'send' }, { type: 'ok', total: 2, left: 3 });
    expect([s.total, s.left, nextToSend(s)]).toEqual([2, 3, undefined]);
  });

  it('server sync never overwrites pending taps', () => {
    const pending = run(initialVoteState(5), tap());
    expect(run(pending, { type: 'sync', total: 99, left: 1 })).toBe(pending);
    expect(run(initialVoteState(5), { type: 'sync', total: 99, left: 1 })).toMatchObject({ total: 99, left: 1 });
    expect(run(initialVoteState(5), { type: 'seed', total: 7 }).total).toBe(7);
  });

  it('maps errors to the spec texts', () => {
    expect(voteErrorMessage('rate_limited', 'uid_daily', 'f')).toBe("You've used today's votes. Come back tomorrow.");
    expect(voteErrorMessage('rate_limited', 'network_daily', 'f')).toBe('This network has given this house 25 votes today. More at midnight.');
    expect(voteErrorMessage('rate_limited', 'region_breaker', 'f')).toBe('This house is getting a lot of love right now — try again in a few minutes.');
    expect(voteErrorMessage('not_found', undefined, 'f')).toBe("This house isn't on the map anymore.");
    expect(voteErrorMessage('network', undefined, 'f')).toBe('f');
  });
});
