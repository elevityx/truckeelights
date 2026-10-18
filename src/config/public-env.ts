import type { Season } from '@/lib/data/types';

/** Where event display comes from: the native UI, the native UI plus a headless TruckeeVibes comparison, or the TruckeeVibes widget. */
export type EventsProvider = 'lights' | 'shadow' | 'vibes';
/** Exact 'shadow' / 'vibes' only; anything else (unset, empty, other case, padding) is the native UI. */
export function parseProvider(v: string | undefined): EventsProvider {
  return v === 'shadow' || v === 'vibes' ? v : 'lights';
}

// Each NEXT_PUBLIC_* must be written out literally so Next can inline it at build.
// Never throw here: `next build` prerenders client pages with empty env in CI.
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '',
  mapsKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
  mapIdHalloween: process.env.NEXT_PUBLIC_MAP_ID_HALLOWEEN ?? '',
  mapIdChristmas: process.env.NEXT_PUBLIC_MAP_ID_CHRISTMAS ?? '',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://truckeelights.com',
  eventsProvider: parseProvider(process.env.NEXT_PUBLIC_EVENTS_PROVIDER),
} as const;

export function supabaseConfigured(): boolean {
  return publicEnv.supabaseUrl !== '' && publicEnv.supabaseKey !== '';
}

export function mapsConfigured(season: Season): boolean {
  const id = season === 'halloween' ? publicEnv.mapIdHalloween : publicEnv.mapIdChristmas;
  return publicEnv.mapsKey !== '' && id !== '';
}
