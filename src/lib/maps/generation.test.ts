import { describe, expect, it } from 'vitest';
import { createGeneration } from './generation';

describe('createGeneration', () => {
  it('only the latest token is current', () => {
    const g = createGeneration();
    const a = g.begin();
    const b = g.begin();
    expect(g.isCurrent(a)).toBe(false);
    expect(g.isCurrent(b)).toBe(true);
  });

  it('invalidate retires a pending reverse geocode so it cannot re-arm a rejected location', () => {
    const g = createGeneration();
    let place: string | null = null;
    const pin = g.begin(); // pin dropped, reverse geocode pending
    place = null; // onReject clears the location ...
    g.invalidate(); // ... and retires pending work
    if (g.isCurrent(pin)) place = 'old pin address'; // the late result
    expect(place).toBeNull();
  });

  it('a late place callback from an older selection is ignored', () => {
    const g = createGeneration();
    const town = g.begin(); // first selection, slow fetchFields
    const venue = g.begin(); // newer selection
    const applied: string[] = [];
    if (g.isCurrent(venue)) applied.push('venue');
    if (g.isCurrent(town)) applied.push('town');
    expect(applied).toEqual(['venue']);
  });

  it('a pin drop retires an in-flight autocomplete selection sharing the counter', () => {
    const g = createGeneration();
    const select = g.begin(); // venue chosen, fetchFields in flight
    const pin = g.begin(); // pin dropped meanwhile
    let place = 'pin';
    if (g.isCurrent(select)) place = 'venue'; // the late selection callback
    expect(place).toBe('pin');
    expect(g.isCurrent(pin)).toBe(true);
  });
});
