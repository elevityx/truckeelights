import { describe, expect, it } from 'vitest';
import { FLYER_COPY, flyerInkFromQuery, flyerSeasonFromQuery, resolveFlyerInk, richToText } from './copy';

describe('flyerSeasonFromQuery', () => {
  it('accepts only known seasons', () => {
    expect(flyerSeasonFromQuery('?season=christmas')).toBe('christmas');
    expect(flyerSeasonFromQuery('?season=halloween')).toBe('halloween');
    expect(flyerSeasonFromQuery('?season=easter')).toBeNull();
    expect(flyerSeasonFromQuery('')).toBeNull();
  });
  it('has the seasonal headlines', () => {
    expect(FLYER_COPY.halloween.headline).toBe('Add your spooky house or event to the map!');
    expect(FLYER_COPY.christmas.headline).toBe('Add your lit-up house or holiday event to the map!');
  });
});

describe('flyer copy', () => {
  it('talks about houses and events in both seasons', () => {
    expect(FLYER_COPY.halloween.pitch).toMatch(/spooky-season events/);
    expect(FLYER_COPY.halloween.pitch).toMatch(/trunk-or-treats/);
    expect(FLYER_COPY.christmas.pitch).toMatch(/holiday events/);
    expect(FLYER_COPY.christmas.pitch).toMatch(/tree lightings/);
    expect(FLYER_COPY.halloween.footer).toMatch(/^Not decorating\? Scan to find the spookiest streets, vote for your favorite house/);
    expect(FLYER_COPY.christmas.footer).toMatch(/^Not decorating\? Scan to find the brightest streets, vote for your favorite house/);
  });
  it('has the three steps, with Add and the two choices in bold', () => {
    for (const s of ['halloween', 'christmas'] as const) {
      const steps = FLYER_COPY[s].steps;
      expect(steps.map(richToText)).toEqual([
        'Scan the code with your phone camera.',
        'Tap Add, then choose A house or An event.',
        'Houses go on the map right away. Events appear after a quick check. No app needed.',
      ]);
      expect(steps[1].filter((p) => typeof p !== 'string')).toEqual([{ strong: 'Add' }, { strong: 'A house' }, { strong: 'An event' }]);
    }
  });
  it('never carries HTML in the copy', () => {
    const all = JSON.stringify(FLYER_COPY);
    expect(all).not.toMatch(/<[a-z/]/i);
  });
});

describe('flyer ink', () => {
  it('accepts only known inks from the query', () => {
    expect(flyerInkFromQuery('?ink=color')).toBe('color');
    expect(flyerInkFromQuery('?ink=bw')).toBe('bw');
    expect(flyerInkFromQuery('?ink=sepia')).toBeNull();
    expect(flyerInkFromQuery('')).toBeNull();
  });
  it('prefers the URL, then storage, then color', () => {
    expect(resolveFlyerInk('?ink=bw', 'color')).toBe('bw');
    expect(resolveFlyerInk('', 'bw')).toBe('bw');
    expect(resolveFlyerInk('?ink=junk', 'junk')).toBe('color');
    expect(resolveFlyerInk('', null)).toBe('color');
  });
});
