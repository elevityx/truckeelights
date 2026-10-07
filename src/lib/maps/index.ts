import { mapsConfigured } from '@/config/public-env';
import type { Season } from '@/lib/data/types';
import { createGoogleAdapter } from './google';
import { createStubAdapter } from './stub';
import type { MapAdapter } from './types';

export function getMapAdapter(season: Season): MapAdapter {
  return mapsConfigured(season) ? createGoogleAdapter() : createStubAdapter();
}
