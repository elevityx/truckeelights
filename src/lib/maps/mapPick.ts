// Pure helpers for "tap the map to add a house". No Google or DOM types, so they unit-test in node.
import type { PinView, Region } from '@/lib/data/types';
import { firstSegment } from '@/lib/text/address';
import type { GeocodeCandidate, PickedPlace } from './types';

export type { GeocodeCandidate };

export type MapPickResult =
  | { ok: true; place: PickedPlace }
  | { ok: false; reason: 'outside' | 'not_street' };

const STREET = ['street_address', 'premise'];

export function inRegion(region: Region, p: { lat: number; lng: number }): boolean {
  return p.lat >= region.minLat && p.lat <= region.maxLat && p.lng >= region.minLng && p.lng <= region.maxLng;
}

/**
 * Pick the first street-level reverse-geocode result inside the region's box.
 * The pin stays where the user tapped (that is the house they meant); the address comes from Google.
 */
export function pickStreetResult(
  results: readonly GeocodeCandidate[],
  region: Region,
  tapped: { lat: number; lng: number },
): MapPickResult {
  if (!inRegion(region, tapped)) return { ok: false, reason: 'outside' };
  const street = results.filter((r) => r.types.some((t) => STREET.includes(t)));
  if (street.length === 0) return { ok: false, reason: 'not_street' };
  const inside = street.find((r) => inRegion(region, r));
  if (!inside) return { ok: false, reason: 'outside' };
  return {
    ok: true,
    place: { placeId: inside.placeId, address: inside.address, lat: tapped.lat, lng: tapped.lng, types: inside.types },
  };
}

export function mapPickMessage(reason: 'outside' | 'not_street' | 'failed', regionName: string): string {
  switch (reason) {
    case 'outside':
      return `That spot is outside ${regionName}. Tap a house in ${regionName}.`;
    case 'not_street':
      return 'No street address there. Tap right on a house.';
    case 'failed':
      return "Couldn't look up that spot. Try again, or use Add a house.";
  }
}

/** Great-circle distance in meters. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const norm = (s: string) => firstSegment(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * A house already on this season's map that matches the pick: the same street line, or the nearest pin within
 * `meters`. UX only; the database dedupes by place id and normalized address on submit.
 */
export function findNearbyDuplicate(pins: readonly PinView[], place: PickedPlace, meters = 30): PinView | null {
  const key = norm(place.address);
  const same = pins.find((p) => key !== '' && norm(p.address) === key);
  if (same) return same;
  let best: PinView | null = null;
  let bestD = meters;
  for (const p of pins) {
    const d = distanceM(p, place);
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}
