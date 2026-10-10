// Straight-line geometry for Build my route. Pure; no Maps API.

export interface Point {
  lat: number;
  lng: number;
}

const R = 6_371_000; // mean Earth radius, meters
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in meters (haversine). Fine for walks and short drives. */
export function haversine(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const FT_PER_M = 3.28084;
const M_PER_MI = 1609.344;

/** Short US-style distance: "300 ft" under a tenth of a mile, else "0.4 mi". */
export function formatDistance(m: number): string {
  if (m < 0.1 * M_PER_MI) return `${Math.max(50, Math.round((m * FT_PER_M) / 50) * 50)} ft`;
  const mi = m / M_PER_MI;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}
