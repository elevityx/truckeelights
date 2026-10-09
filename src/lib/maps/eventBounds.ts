import type { Region } from '@/lib/data/types';

// TS mirror of SQL private.event_bounds: the region box plus 0.05° on every side, and 0.10° on the east
// edge so the north shore (Tahoe City, Kings Beach, Crystal Bay, Incline, Sand Harbor) fits and Reno does not.
// The map's camera restriction uses the same box. The database is the authority; this is UX only.
export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export function eventBounds(r: Pick<Region, 'minLat' | 'maxLat' | 'minLng' | 'maxLng'>): Bounds {
  return { north: r.maxLat + 0.05, south: r.minLat - 0.05, east: r.maxLng + 0.1, west: r.minLng - 0.05 };
}

/** Inclusive, like SQL BETWEEN; NaN is never inside. */
export function inBounds(b: Bounds, p: { lat: number; lng: number }): boolean {
  return p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;
}
