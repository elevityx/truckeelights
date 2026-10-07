import { describe, expect, it } from 'vitest';
import { firstSegment, groupByStreet, number, restSegment, splitBold, street } from './address';

describe('address helpers', () => {
  it('splits segments', () => {
    expect(firstSegment('10013 Jibboom St, Truckee, CA 96161')).toBe('10013 Jibboom St');
    expect(restSegment('10013 Jibboom St, Truckee, CA 96161')).toBe('Truckee, CA 96161');
    expect(restSegment('10013 Jibboom St')).toBe('');
  });
  it('extracts street and number', () => {
    expect(street('10013 Jibboom St, Truckee')).toBe('Jibboom St');
    expect(street('12A Alder Dr')).toBe('Alder Dr');
    expect(number('10013 Jibboom St')).toBe(10013);
    expect(number('Jibboom')).toBe(0);
  });
  it('groups A-Z with ascending numbers', () => {
    const g = groupByStreet([
      { address: '20 Zed St, T' },
      { address: '9 Alder Dr, T' },
      { address: '100 Alder Dr, T' },
    ]);
    expect(g.map((x) => x.street)).toEqual(['Alder Dr', 'Zed St']);
    expect(g[0].items.map((i) => i.address)).toEqual(['9 Alder Dr, T', '100 Alder Dr, T']);
  });
  it('splits bold markers', () => {
    expect(splitBold('a **b** c')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' c', bold: false },
    ]);
  });
});
