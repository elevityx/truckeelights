import { mapsConfigured } from '@/config/public-env';
import type { Season } from '@/lib/data/types';
import { loadGeocoder } from './loader';
import type { GeocodeCandidate, LatLng } from './types';

/** Reverse-geocode a point with Google. [] when nothing is there (or no Maps key); rejects when the lookup fails. */
export async function reverseGeocode(p: LatLng, season: Season): Promise<GeocodeCandidate[]> {
  if (!mapsConfigured(season)) return [];
  const g = await loadGeocoder();
  try {
    const { results } = await g.geocode({ location: p });
    return results.map((r) => ({
      placeId: r.place_id,
      address: r.formatted_address,
      lat: r.geometry.location.lat(),
      lng: r.geometry.location.lng(),
      types: r.types ?? [],
    }));
  } catch (e) {
    if ((e as { code?: string }).code === 'ZERO_RESULTS') return [];
    throw e;
  }
}
