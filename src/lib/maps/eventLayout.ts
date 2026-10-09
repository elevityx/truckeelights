// Pure camera and pin-layout math for event pins (F1). No Google types: tested with vitest.
import { inEventBounds } from '@/lib/data/events';
import type { Region } from '@/lib/data/types';
import type { LatLng } from './types';

const TILE = 256;

/** Web Mercator world pixel at `zoom` (the same projection Google Maps uses). */
export function project(p: LatLng, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const s = Math.min(Math.max(Math.sin((p.lat * Math.PI) / 180), -0.9999), 0.9999);
  return { x: scale * ((p.lng + 180) / 360), y: scale * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) };
}

export function unproject(pt: { x: number; y: number }, zoom: number): LatLng {
  const scale = TILE * 2 ** zoom;
  const lng = (pt.x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * pt.y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lng };
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export interface Viewport {
  width: number;
  height: number;
}
type Box = { minLat: number; maxLat: number; minLng: number; maxLng: number };

function boxOf(points: LatLng[]): Box {
  return {
    minLat: Math.min(...points.map((p) => p.lat)),
    maxLat: Math.max(...points.map((p) => p.lat)),
    minLng: Math.min(...points.map((p) => p.lng)),
    maxLng: Math.max(...points.map((p) => p.lng)),
  };
}

/** Largest whole zoom at which `box` fits the padded viewport (Infinity for a single point). */
export function fitZoom(box: Box, vp: Viewport, pad: Padding): number {
  const w = Math.max(1, vp.width - pad.left - pad.right);
  const h = Math.max(1, vp.height - pad.top - pad.bottom);
  const a = project({ lat: box.maxLat, lng: box.minLng }, 0);
  const b = project({ lat: box.minLat, lng: box.maxLng }, 0);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const zx = dx > 0 ? Math.log2(w / dx) : Infinity;
  const zy = dy > 0 ? Math.log2(h / dy) : Infinity;
  return Math.floor(Math.min(zx, zy));
}

/**
 * The points the Events camera fits: local events only ("Worth the drive" pins stay reachable by panning). With no
 * local events, all events plus the region center, so the town stays on screen.
 */
export function fitTargets(events: LatLng[], region: Region): LatLng[] {
  const local = events.filter((e) => inEventBounds(region, e.lat, e.lng));
  if (local.length) return local.map(({ lat, lng }) => ({ lat, lng }));
  if (!events.length) return [];
  return [...events.map(({ lat, lng }) => ({ lat, lng })), { lat: region.centerLat, lng: region.centerLng }];
}

/**
 * Camera that fits `points` inside the padded viewport. Zoom is clamped to [minZoom, region.defaultZoom], where
 * minZoom is one level out from the zoom that fits the region's own box (the town still shows). The center is
 * shifted so the points sit in the middle of the padded area, not of the whole map. Null when there is nothing to fit.
 */
export function fitEventsCamera(points: LatLng[], region: Region, vp: Viewport, pad: Padding): { center: LatLng; zoom: number } | null {
  if (!points.length || vp.width <= 0 || vp.height <= 0) return null;
  const box = boxOf(points);
  const minZoom = Math.min(region.defaultZoom, fitZoom(region, vp, pad) - 1);
  const zoom = Math.max(minZoom, Math.min(region.defaultZoom, fitZoom(box, vp, pad)));
  const a = project({ lat: box.maxLat, lng: box.minLng }, zoom);
  const b = project({ lat: box.minLat, lng: box.maxLng }, zoom);
  const mid = { x: (a.x + b.x) / 2 + (pad.right - pad.left) / 2, y: (a.y + b.y) / 2 + (pad.bottom - pad.top) / 2 };
  return { center: unproject(mid, zoom), zoom };
}

export interface SpreadPoint extends LatLng {
  id: string;
  startsAt: string;
}
export interface SpreadOptions {
  /** Same venue: closer than this many meters. */
  venueM?: number;
  /** Rendered pins overlap: closer than this many pixels at the zoom. */
  overlapPx?: number;
  /** Minimum ring radius in pixels (the ring grows with the group so neighbors' discs don't overlap). */
  radiusPx?: number;
}

/** Great-circle distance in meters. */
export function metersBetween(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Pixel offsets that fan out overlapping event pins. Points within `venueM` meters, or whose pins overlap at `zoom`,
 * form a group (transitively). Each group of 2+ is laid on a ring around its centroid, first pin at 9 o'clock and
 * clockwise in start-time order (a pair sits side by side, so neither covers the other's date badge) (id breaks ties), so the layout is deterministic. Pins alone get no entry.
 */
export function spreadOffsets(points: SpreadPoint[], zoom: number, o: SpreadOptions = {}): Map<string, { dx: number; dy: number }> {
  const venueM = o.venueM ?? 30;
  const overlapPx = o.overlapPx ?? 44;
  const radius = o.radiusPx ?? 18;
  const sorted = [...points].sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const px = sorted.map((p) => project(p, zoom));
  // Union-find over pairs; event counts are small (tens), so O(n^2) is fine.
  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const near = Math.hypot(px[i].x - px[j].x, px[i].y - px[j].y) < overlapPx || metersBetween(sorted[i], sorted[j]) < venueM;
      if (near) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, number[]>();
  sorted.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  const out = new Map<string, { dx: number; dy: number }>();
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    const n = idx.length;
    const cx = idx.reduce((s, i) => s + px[i].x, 0) / n;
    const cy = idx.reduce((s, i) => s + px[i].y, 0) / n;
    const r = Math.max(radius, 24 / Math.sin(Math.PI / n)); // neighbors >= 48 px apart: a 40 px disc never covers the next one
    idx.forEach((i, k) => {
      const ang = Math.PI + (2 * Math.PI * k) / n; // screen y points down, so a growing angle runs clockwise
      const dx = cx + r * Math.cos(ang) - px[i].x;
      const dy = cy + r * Math.sin(ang) - px[i].y;
      out.set(sorted[i].id, { dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 });
    });
  }
  return out;
}

/**
 * Build my route: a camera that fits `points` inside the padded viewport, zoom clamped to [minZoom, maxZoom], with the
 * same padded-center shift as the events fit. Null when there is nothing to fit.
 */
export function fitPointsCamera(points: LatLng[], vp: Viewport, pad: Padding, maxZoom = 17, minZoom = 10): { center: LatLng; zoom: number } | null {
  if (!points.length || vp.width <= 0 || vp.height <= 0) return null;
  const box = boxOf(points);
  const zoom = Math.max(minZoom, Math.min(maxZoom, fitZoom(box, vp, pad)));
  const a = project({ lat: box.maxLat, lng: box.minLng }, zoom);
  const b = project({ lat: box.minLat, lng: box.maxLng }, zoom);
  const mid = { x: (a.x + b.x) / 2 + (pad.right - pad.left) / 2, y: (a.y + b.y) / 2 + (pad.bottom - pad.top) / 2 };
  return { center: unproject(mid, zoom), zoom };
}
