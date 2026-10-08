import type { Season } from '@/lib/data/types';

export interface FlyerCopy {
  seasonName: string;
  wordmark: string;
  headline: string;
  pitch: string;
  steps: string[];
  footer: string;
}

export const FLYER_COPY: Record<Season, FlyerCopy> = {
  halloween: {
    seasonName: 'Halloween',
    wordmark: 'Truckee Frights',
    headline: 'Add your spooky house to the map!',
    pitch: 'A free community map of decorated houses, so trick-or-treaters know where the good scares are.',
    steps: [
      'Scan the code with your phone camera.',
      'Tap “Add a house” and type your address.',
      'Check the pin. You’re on the map. No account, no app.',
    ],
    footer: 'Not decorating? Scan anyway to find the spookiest streets in town.',
  },
  christmas: {
    seasonName: 'Christmas',
    wordmark: 'Truckee Lights',
    headline: 'Add your lit-up house to the map!',
    pitch: 'A free community map of decorated houses, so neighbors and visitors can find the best lights.',
    steps: [
      'Scan the code with your phone camera.',
      'Tap “Add a house” and type your address.',
      'Check the pin. You’re on the map. No account, no app.',
    ],
    footer: 'Not decorating? Scan anyway to find the brightest streets in town.',
  },
};

/** `?season=halloween|christmas` lets an admin print next season's flyer early. Anything else is ignored. */
export function flyerSeasonFromQuery(search: string): Season | null {
  const s = new URLSearchParams(search).get('season');
  return s === 'halloween' || s === 'christmas' ? s : null;
}
