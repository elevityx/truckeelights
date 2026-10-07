import { publicEnv } from '@/config/public-env';
import type { Season } from '@/lib/data/types';

export const THEMES: Record<
  Season,
  {
    mapId: () => string;
    glyph: 'pumpkin' | 'tree';
    altGlyph: 'ghost' | 'wreath';
    glow: string;
    altGlow: string;
    listTitle: (n: number) => string;
    empty: string;
    addedTitle: string;
  }
> = {
  halloween: {
    mapId: () => publicEnv.mapIdHalloween,
    glyph: 'pumpkin',
    altGlyph: 'ghost',
    glow: '#FF7A1A',
    altGlow: '#8AE234',
    listTitle: (n) => `${n} haunted houses`,
    empty: 'No haunted houses yet.',
    addedTitle: "It's alive!",
  },
  christmas: {
    mapId: () => publicEnv.mapIdChristmas,
    glyph: 'tree',
    altGlyph: 'wreath',
    glow: '#F2C14E',
    altGlow: '#F2C14E',
    listTitle: (n) => `${n} houses aglow`,
    empty: 'No lit-up houses yet.',
    addedTitle: 'Added!',
  },
};
