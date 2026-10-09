import { describe, expect, it } from 'vitest';
import {
  displayVotes, isCapped, meterAriaText, meterCaption, meterFraction, powerKind, powerName, snowFeet, tier,
  tierName, unlockHint, votesLabel,
} from './meter';

describe('meterFraction', () => {
  it('hits the anchors', () => {
    expect(meterFraction(0)).toBe(0.25);
    expect(meterFraction(25)).toBe(0.5);
    expect(meterFraction(50)).toBe(0.75);
    expect(meterFraction(75)).toBe(0.875);
    expect(meterFraction(100)).toBe(1);
    expect(meterFraction(150)).toBe(1);
  });
  it('interpolates, floors and cleans', () => {
    expect(meterFraction(12)).toBeCloseTo(0.37, 10);
    expect(meterFraction(24.9)).toBeCloseTo(0.49, 10);
    expect(meterFraction(-3)).toBe(0.25);
    expect(meterFraction(NaN)).toBe(0.25);
    expect(meterFraction(Infinity)).toBe(0.25);
  });
});

describe('tier', () => {
  it('has the right boundaries', () => {
    expect(tier(24)).toBe('quarter');
    expect(tier(25)).toBe('half');
    expect(tier(49)).toBe('half');
    expect(tier(50)).toBe('three_quarter');
    expect(tier(99)).toBe('three_quarter');
    expect(tier(100)).toBe('full');
    expect(tier(149)).toBe('full');
    expect(tier(150)).toBe('over');
  });
});

describe('snowFeet and names', () => {
  it('floors feet per spec', () => {
    const cases: Array<[number, number]> = [[0, 1], [12, 1], [24, 2], [25, 3], [49, 5], [50, 6], [75, 7], [100, 9], [149, 11], [150, 12], [200, 14]];
    for (const [v, ft] of cases) expect(snowFeet(v)).toBe(ft);
  });
  it('names tiers', () => {
    expect(meterCaption('snow', 75)).toBe('7 ft · Powder day');
    expect(meterCaption('snow', 150)).toBe('12 ft · Christmas Miracle');
    expect(tierName('snow', 'quarter')).toBe('A dusting');
    expect(tierName('snow', 'half')).toBe('Need a snowblower');
    expect(tierName('snow', 'full')).toBe('I-80 is closed!');
    expect(tierName('snow', 'over')).toBe('Christmas Miracle');
    expect(tierName('pumpkin', 'over')).toBe('Overcharged');
    expect(tierName('ghost', 'three_quarter')).toBe('Three-quarter power');
    expect(meterCaption('pumpkin', 0)).toBe('Quarter power');
  });
  it('maps season and glyph to a power', () => {
    expect(powerKind('halloween', 'ghost')).toBe('ghost');
    expect(powerKind('halloween', 'pumpkin')).toBe('pumpkin');
    expect(powerKind('christmas', 'tree')).toBe('snow');
    expect(powerKind('christmas', 'wreath')).toBe('snow');
    expect(powerName('pumpkin')).toBe('Pumpkin Power');
    expect(powerName('ghost')).toBe('Ghost Power');
    expect(powerName('snow')).toBe('Snowfall');
  });
});

describe('photo cap', () => {
  it('caps at 50 without photos', () => {
    expect(displayVotes(150, 0)).toBe(50);
    expect(displayVotes(150, 1)).toBe(150);
    expect(displayVotes(30, 0)).toBe(30);
    expect(meterFraction(displayVotes(150, 0))).toBe(0.75);
    expect(isCapped(undefined as unknown as number)).toBe(true);
    expect(isCapped(NaN)).toBe(true);
    expect(isCapped(0)).toBe(true);
    expect(isCapped(2)).toBe(false);
  });
  it('hints', () => {
    expect(unlockHint('pumpkin', 0, true)).toBe('Add a photo to unlock full Pumpkin Power');
    expect(unlockHint('ghost', 0, true)).toBe('Add a photo to unlock full Ghost Power');
    expect(unlockHint('snow', 0, true)).toBe('Add a photo to unlock the full snowfall');
    expect(unlockHint('pumpkin', 0, false)).toBe('Full Pumpkin Power unlocks with a photo. Photo uploads open soon.');
    expect(unlockHint('pumpkin', 2, true)).toBeNull();
    expect(unlockHint('pumpkin', 2, false)).toBeNull();
  });
});

describe('aria and labels', () => {
  it('speaks the painted tier and the raw count', () => {
    expect(meterAriaText('pumpkin', 52, 1)).toBe('Pumpkin Power three-quarters, 52 votes');
    expect(meterAriaText('snow', 1, 1)).toBe('Snowfall 1 ft, A dusting, 1 vote');
    expect(meterAriaText('snow', 75, 1)).toBe('Snowfall 7 ft, Powder day, 75 votes');
    const capped = meterAriaText('pumpkin', 120, 0);
    expect(capped).toBe('Pumpkin Power three-quarters, capped until the house has a photo, 120 votes');
    expect(capped).not.toContain('full');
    expect(meterAriaText('ghost', 150, 1)).toBe('Ghost Power overcharged, 150 votes');
  });
  it('formats vote counts', () => {
    expect(votesLabel(1)).toBe('1 vote');
    expect(votesLabel(0)).toBe('0 votes');
    expect(votesLabel(52)).toBe('52 votes');
    expect(votesLabel(1204)).toBe('1,204 votes');
  });
});
