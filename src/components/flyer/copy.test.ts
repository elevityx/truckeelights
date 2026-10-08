import { describe, expect, it } from 'vitest';
import { FLYER_COPY, flyerSeasonFromQuery } from './copy';

describe('flyerSeasonFromQuery', () => {
  it('accepts only known seasons', () => {
    expect(flyerSeasonFromQuery('?season=christmas')).toBe('christmas');
    expect(flyerSeasonFromQuery('?season=halloween')).toBe('halloween');
    expect(flyerSeasonFromQuery('?season=easter')).toBeNull();
    expect(flyerSeasonFromQuery('')).toBeNull();
  });
  it('has the seasonal headlines', () => {
    expect(FLYER_COPY.halloween.headline).toBe('Add your spooky house to the map!');
    expect(FLYER_COPY.christmas.headline).toMatch(/lit-up house/);
  });
});
