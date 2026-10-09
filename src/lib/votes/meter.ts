import type { Season } from '@/lib/data/types';
import type { GlyphName } from '@/lib/maps/glyphs';

// Pure meter math and labels for house votes. No DOM, no I/O.
// Every display function takes displayVotes(...), never the raw count; the raw count is only shown as the number.

export const DAILY_LIMIT = 5;
export type PowerKind = 'pumpkin' | 'ghost' | 'snow';
export type Tier = 'quarter' | 'half' | 'three_quarter' | 'full' | 'over';

function clean(votes: number): number {
  return Number.isFinite(votes) ? Math.max(0, Math.floor(votes)) : 0;
}

/** Anchors: 0 -> 0.25, 25 -> 0.5, 50 -> 0.75, 100 -> 1. Piecewise linear, capped at 1. Negative/NaN -> 0.25. */
export function meterFraction(votes: number): number {
  const v = clean(votes);
  if (v < 25) return 0.25 + (0.25 * v) / 25;
  if (v < 50) return 0.5 + (0.25 * (v - 25)) / 25;
  if (v < 100) return 0.75 + (0.25 * (v - 50)) / 50;
  return 1;
}

export function tier(votes: number): Tier {
  const v = clean(votes);
  if (v < 25) return 'quarter';
  if (v < 50) return 'half';
  if (v < 100) return 'three_quarter';
  if (v < 150) return 'full';
  return 'over';
}

/** A house with no approved photos displays at most the 50-vote level (three quarters). */
export const PHOTO_CAP_VOTES = 50;

export function isCapped(approvedPhotos: number): boolean {
  return !(approvedPhotos >= 1);
}

export function displayVotes(votes: number, approvedPhotos: number): number {
  const v = clean(votes);
  return isCapped(approvedPhotos) ? Math.min(v, PHOTO_CAP_VOTES) : v;
}

/** Christmas snowfall in whole feet, floored so it stays inside its tier. */
export function snowFeet(displayVotesValue: number): number {
  const v = clean(displayVotesValue);
  let ft: number;
  if (v < 25) ft = 1 + (2 * v) / 25;
  else if (v < 50) ft = 3 + (3 * (v - 25)) / 25;
  else if (v < 100) ft = 6 + (3 * (v - 50)) / 50;
  else if (v < 150) ft = 9 + (3 * (v - 100)) / 50;
  else ft = 12 + (v - 150) / 25;
  return Math.floor(ft);
}

export function powerKind(season: Season, glyph: GlyphName): PowerKind {
  if (season === 'christmas') return 'snow';
  return glyph === 'ghost' ? 'ghost' : 'pumpkin';
}

export function powerName(kind: PowerKind): string {
  if (kind === 'pumpkin') return 'Pumpkin Power';
  if (kind === 'ghost') return 'Ghost Power';
  return 'Snowfall';
}

const HALLOWEEN_TIERS: Record<Tier, string> = {
  quarter: 'Quarter power',
  half: 'Half power',
  three_quarter: 'Three-quarter power',
  full: 'Full power',
  over: 'Overcharged',
};

const SNOW_TIERS: Record<Tier, string> = {
  quarter: 'A dusting',
  half: 'Need a snowblower',
  three_quarter: 'Powder day',
  full: 'I-80 is closed!',
  over: 'Christmas Miracle',
};

export function tierName(kind: PowerKind, t: Tier): string {
  return kind === 'snow' ? SNOW_TIERS[t] : HALLOWEEN_TIERS[t];
}

/** Visible caption: "Three-quarter power" or "7 ft · Powder day". Takes displayVotes. */
export function meterCaption(kind: PowerKind, displayVotesValue: number): string {
  const name = tierName(kind, tier(displayVotesValue));
  return kind === 'snow' ? `${snowFeet(displayVotesValue)} ft · ${name}` : name;
}

const SPOKEN_FRACTION: Record<Tier, string> = {
  quarter: 'one quarter',
  half: 'half',
  three_quarter: 'three-quarters',
  full: 'full',
  over: 'overcharged',
};

/** Screen-reader text. The spoken tier comes from displayVotes (what is painted); the spoken number is the raw count. */
export function meterAriaText(kind: PowerKind, votes: number, approvedPhotos: number): string {
  const raw = clean(votes);
  const shown = displayVotes(raw, approvedPhotos);
  const t = tier(shown);
  const capNote = isCapped(approvedPhotos) && raw >= PHOTO_CAP_VOTES ? ', capped until the house has a photo' : '';
  const head =
    kind === 'snow'
      ? `${powerName(kind)} ${snowFeet(shown)} ft, ${tierName(kind, t)}`
      : `${powerName(kind)} ${SPOKEN_FRACTION[t]}`;
  return `${head}${capNote}, ${votesLabel(raw)}`;
}

/** Hint for capped houses; null when the house has a photo. */
export function unlockHint(kind: PowerKind, approvedPhotos: number, photosOpen: boolean): string | null {
  if (!isCapped(approvedPhotos)) return null;
  if (photosOpen) {
    return kind === 'snow' ? 'Add a photo to unlock the full snowfall' : `Add a photo to unlock full ${powerName(kind)}`;
  }
  return kind === 'snow'
    ? 'The full snowfall unlocks with a photo. Photo uploads open soon.'
    : `Full ${powerName(kind)} unlocks with a photo. Photo uploads open soon.`;
}

/** "1 vote" / "52 votes" / "1,204 votes". */
export function votesLabel(votes: number): string {
  const v = clean(votes);
  return `${v.toLocaleString('en-US')} ${v === 1 ? 'vote' : 'votes'}`;
}
