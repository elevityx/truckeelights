import type { Point } from './geo';

// Google Maps URL hand-off (https://developers.google.com/maps/documentation/urls/get-started). No API key, no cost.
// Google keeps up to 3 waypoints in mobile browsers and 9 elsewhere, and never reorders them, so we order and split.

export type TravelMode = 'walking' | 'driving';

/** Coarse pointer or a narrow window counts as a phone. */
export function waypointsPerLeg(device: { coarse: boolean; width: number }): number {
  return device.coarse || device.width < 768 ? 3 : 9;
}

export interface Leg<T> {
  /** Where the leg starts: the previous leg's last stop, or null for leg 1 (the trip origin). */
  from: T | null;
  /** The leg's stops in order; the last one is the destination, the rest are waypoints. */
  stops: T[];
}

/** Split an ordered route into legs of at most `perLeg` waypoints plus a destination; each leg starts where the last ended. */
export function splitLegs<T>(stops: readonly T[], perLeg: number): Leg<T>[] {
  const size = Math.max(1, Math.floor(perLeg)) + 1;
  const legs: Leg<T>[] = [];
  for (let i = 0; i < stops.length; i += size) {
    legs.push({ from: i === 0 ? null : stops[i - 1], stops: stops.slice(i, i + size) });
  }
  return legs;
}

const ll = (p: Point) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/**
 * `https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=a|b&travelmode=…`.
 * origin: a point, 'my-location' ("My Location"), or null to leave it out (Google then starts from the device).
 */
export function directionsUrl(origin: Point | 'my-location' | null, stops: readonly Point[], mode: TravelMode): string {
  const q = new URLSearchParams({ api: '1' });
  if (origin === 'my-location') q.set('origin', 'My Location');
  else if (origin) q.set('origin', ll(origin));
  if (stops.length > 0) q.set('destination', ll(stops[stops.length - 1]));
  if (stops.length > 1) q.set('waypoints', stops.slice(0, -1).map(ll).join('|'));
  q.set('travelmode', mode);
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

/** One Google Maps link per leg. Leg 1 starts at `origin` (or the device location when null). */
export function legUrls(stops: readonly Point[], perLeg: number, origin: Point | 'my-location' | null, mode: TravelMode): string[] {
  return splitLegs(stops, perLeg).map((leg) => directionsUrl(leg.from ?? origin, leg.stops, mode));
}
