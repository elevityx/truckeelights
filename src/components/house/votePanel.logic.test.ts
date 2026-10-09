import { describe, expect, it } from 'vitest';
import { canTap, initialVoteState, nextToSend, voteErrorMessage, voteReducer, type VoteAction, type VoteState } from './votePanel.logic';

const run = (s: VoteState, ...as: VoteAction[]) => as.reduce(voteReducer, s);
const tap = (photoId: string | null = null): VoteAction => ({ type: 'tap', photoId });
const fail = (code: 'rate_limited' | 'network' | 'votes_closed', detail?: string): VoteAction => ({ type: 'fail', code, detail, message: 'x' });

describe('voteReducer (AC21)', () => {
  it('applies a tap optimistically and keeps the server answer on success', () => {
    let s = run(initialVoteState(52), tap());
    expect([s.total, s.left, s.queue]).toEqual([53, 4, [null]]);
    s = run(s, { type: 'send' }, { type: 'ok', total: 60, left: 4 });
    expect([s.total, s.left, s.queue.length, s.inFlight]).toEqual([60, 4, 0, false]);
    expect(s.note?.text).toBe('Voted. 4 of 5 left today.');
  });

  it('rolls the tap back on an error', () => {
    const s = run(initialVoteState(10), tap(), { type: 'send' }, fail('network'));
    expect([s.total, s.left, s.queue.length, s.inFlight]).toEqual([10, 5, 0, false]);
    expect(s.note).toMatchObject({ error: true });
  });

  it('rolls back the queued taps behind a failure too', () => {
    const s = run(initialVoteState(10), tap(), tap(), tap(), { type: 'send' }, fail('network'));
    expect([s.total, s.left, s.queue.length]).toEqual([10, 5, 0]);
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
    expect(voteErrorMessage('rate_limited', 'region_breaker', 'f')).toBe('Lots of votes right now. Try again in a few minutes.');
    expect(voteErrorMessage('not_found', undefined, 'f')).toBe("This house isn't on the map anymore.");
    expect(voteErrorMessage('network', undefined, 'f')).toBe('f');
  });
});
