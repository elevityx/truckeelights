import { describe, expect, it } from 'vitest';
import { displayVotes, rankHouses } from './meter';

const h = (address: string, votes: number, photoCount = 0) => ({ id: address, address, votes, photoCount });

describe('rankHouses (AC20)', () => {
  it('orders by votes desc, then address', () => {
    const { voted } = rankHouses([h('9 B St', 10), h('1 C St', 30), h('2 A St', 10)]);
    expect(voted.map((r) => r.pin.address)).toEqual(['1 C St', '2 A St', '9 B St']);
  });

  it('gives tied houses the same competition rank (1, 2, 2, 4)', () => {
    const { voted } = rankHouses([h('a', 50), h('b', 20), h('c', 20), h('d', 5)]);
    expect(voted.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it('puts 0-vote houses after the divider, unranked, in address order', () => {
    const { voted, waiting } = rankHouses([h('z', 0), h('m', 3), h('a', 0)]);
    expect(voted.map((r) => r.pin.address)).toEqual(['m']);
    expect(waiting.map((p) => p.address)).toEqual(['a', 'z']);
  });

  it('ranks on raw votes, so a capped house with 80 beats an uncapped one with 60', () => {
    const capped = h('capped', 80, 0);
    const open = h('open', 60, 2);
    const { voted } = rankHouses([open, capped]);
    expect(voted[0].pin).toBe(capped);
    expect(displayVotes(capped.votes, capped.photoCount)).toBe(50);
  });

  it('does not mutate the input', () => {
    const pins = [h('b', 1), h('a', 2)];
    rankHouses(pins);
    expect(pins.map((p) => p.address)).toEqual(['b', 'a']);
  });
});
