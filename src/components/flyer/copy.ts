import type { Season } from '@/lib/data/types';

/** A run of plain text, or a bold run (rendered as `<strong>`, never as an HTML string). */
export type RichPart = string | { strong: string };
export type RichText = RichPart[];

export interface FlyerCopy {
  seasonName: string;
  wordmark: string;
  headline: string;
  pitch: string;
  steps: RichText[];
  footer: string;
}

// Both seasons share the steps: the Add button opens a chooser (a house or an event), and only events wait for review.
const STEPS: RichText[] = [
  ['Scan the code with your phone camera.'],
  ['Tap ', { strong: 'Add' }, ', then choose ', { strong: 'A house' }, ' or ', { strong: 'An event' }, '.'],
  ['Houses go on the map right away. Events appear after a quick check. No app needed.'],
];

export const FLYER_COPY: Record<Season, FlyerCopy> = {
  halloween: {
    seasonName: 'Halloween',
    wordmark: 'Truckee Frights',
    headline: 'Add your spooky house or event to the map!',
    pitch:
      'A free community map of Truckee’s decorated houses and spooky-season events — haunted walks, trunk-or-treats, fall fests and more.',
    steps: STEPS,
    footer: 'Not decorating? Scan to find the spookiest streets, vote for your favorite house, and see what’s happening this season.',
  },
  christmas: {
    seasonName: 'Christmas',
    wordmark: 'Truckee Lights',
    headline: 'Add your lit-up house or holiday event to the map!',
    pitch:
      'A free community map of Truckee’s decorated houses and holiday events — tree lightings, holiday markets, light walks and more.',
    steps: STEPS,
    footer: 'Not decorating? Scan to find the brightest streets, vote for your favorite house, and see what’s happening this season.',
  },
};

/** Plain text of a rich run (for tests and labels). */
export function richToText(parts: RichText): string {
  return parts.map((p) => (typeof p === 'string' ? p : p.strong)).join('');
}

/** `?season=halloween|christmas` lets an admin print next season's flyer early. Anything else is ignored. */
export function flyerSeasonFromQuery(search: string): Season | null {
  const s = new URLSearchParams(search).get('season');
  return s === 'halloween' || s === 'christmas' ? s : null;
}

export type FlyerInk = 'color' | 'bw';
export const FLYER_INK_KEY = 'tl:flyer-ink';

function asInk(v: string | null | undefined): FlyerInk | null {
  return v === 'color' || v === 'bw' ? v : null;
}

/** `?ink=color|bw` picks the flyer ink. Anything else is ignored. */
export function flyerInkFromQuery(search: string): FlyerInk | null {
  return asInk(new URLSearchParams(search).get('ink'));
}

/** Ink to show: the URL wins, then the stored choice, then color (black & white is one tap away for cheap printing). */
export function resolveFlyerInk(search: string, stored: string | null | undefined): FlyerInk {
  return flyerInkFromQuery(search) ?? asInk(stored) ?? 'color';
}
