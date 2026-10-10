import type { Season } from '@/lib/data/types';
import { siteBase } from '@/lib/share/urls';
import { haversine, type Point } from './geo';

// Route stops: saved on this device only (localStorage), shared as ids in a link. Never sent to our servers.

export type StopKind = 'house';
export interface Stop {
  kind: StopKind;
  id: string;
}

export const MAX_STOPS = 25;
export const ROUTE_PARAM = 'route';

export const routeKey = (season: Season, year: number) => `tl:route:${season}-${year}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isStop = (x: unknown): x is Stop =>
  !!x &&
  typeof x === 'object' &&
  (x as Stop).kind === 'house' &&
  typeof (x as Stop).id === 'string' &&
  UUID.test((x as Stop).id);

export const sameStop = (a: Stop, b: Stop) => a.kind === b.kind && a.id === b.id;

/** Valid shapes only, no duplicates, at most MAX_STOPS, first one wins. */
export function cleanStops(xs: readonly unknown[]): Stop[] {
  const out: Stop[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    if (!isStop(x)) continue;
    const k = `${x.kind}:${x.id.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: x.kind, id: x.id.toLowerCase() });
    if (out.length >= MAX_STOPS) break;
  }
  return out;
}

/** Storage can be missing or throw (private mode, blocked site data), even on access. */
export type StorageGetter = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined;

export function loadStops(key: string, storage: StorageGetter): Stop[] {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? cleanStops(v) : [];
  } catch {
    return [];
  }
}

export function saveStops(key: string, stops: readonly Stop[], storage: StorageGetter): void {
  try {
    const s = storage();
    if (!s) return;
    if (stops.length === 0) s.removeItem(key);
    else s.setItem(key, JSON.stringify(cleanStops(stops)));
  } catch {
    /* not remembered; the route still works for this visit */
  }
}

/**
 * Drop stops that are no longer public (hidden, released). A `null` set means houses could not be loaded, so the
 * stops are kept: only a successful load is authoritative.
 */
export function pruneStops(
  stops: readonly Stop[],
  live: { houses: ReadonlySet<string> | null },
): { stops: Stop[]; dropped: number } {
  const kept = stops.filter((s) => {
    return live.houses === null || live.houses.has(s.id);
  });
  return { stops: kept, dropped: stops.length - kept.length };
}

/** A new visible order, plus any saved stops that are not shown right now (their source is unavailable). Never over the cap. */
export function withHidden(current: readonly Stop[], visibleOrder: readonly Stop[]): Stop[] {
  return cleanStops([...visibleOrder, ...current.filter((c) => !visibleOrder.some((v) => sameStop(v, c)))]);
}

/** Append stops to the latest route; duplicates and anything past MAX_STOPS are dropped. */
export const appendStops = (current: readonly Stop[], add: readonly Stop[]): Stop[] => cleanStops([...current, ...add]);

export const droppedToast = (n: number) => (n === 1 ? '1 stop is no longer on the map' : `${n} stops are no longer on the map`);

/** Add a stop, or remove it when it's already there. 'full' when the route is at MAX_STOPS. */
export function toggleStop(stops: readonly Stop[], s: Stop): { stops: Stop[]; result: 'added' | 'removed' | 'full' } {
  if (stops.some((x) => sameStop(x, s))) return { stops: stops.filter((x) => !sameStop(x, s)), result: 'removed' };
  if (stops.length >= MAX_STOPS) return { stops: [...stops], result: 'full' };
  return { stops: [...stops, s], result: 'added' };
}

/** Swap stop i with its neighbor (dir -1 = up, +1 = down). Out of range: unchanged. */
export function moveStop<T>(stops: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= stops.length || j < 0 || j >= stops.length) return [...stops];
  const out = [...stops];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

// ---- Share link: https://truckeelights.com/?route=house:<id>,house:<id>,… ----

export function routeShareUrl(base: string | undefined, stops: readonly Stop[]): string {
  // ':' and ',' are legal in a query; keep them readable. Ids are UUIDs, so nothing else needs escaping.
  return `${siteBase(base)}/?${ROUTE_PARAM}=${cleanStops(stops)
    .map((s) => `${s.kind}:${s.id}`)
    .join(',')}`;
}

/** Parse `?route=` (already URL-decoded). Junk entries (including any `event:` ones) are skipped; null when there is no param at all. */
export function parseRouteParam(value: string | null | undefined): Stop[] | null {
  if (value == null) return null;
  return cleanStops(
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const c = part.indexOf(':');
        return c < 0 ? null : { kind: part.slice(0, c), id: part.slice(c + 1) };
      }),
  );
}

/**
 * What to do with a shared route: 'load' it when there's no saved route, 'same' when it matches the saved one
 * (just open the panel), 'ask' before replacing a different saved route, 'none' when nothing in it is on the map.
 */
export function shareDecision(current: readonly Stop[], incoming: readonly Stop[]): 'load' | 'same' | 'ask' | 'none' {
  if (incoming.length === 0) return 'none';
  if (current.length === 0) return 'load';
  if (current.length === incoming.length && current.every((s, i) => sameStop(s, incoming[i]))) return 'same';
  return 'ask';
}

// ---- Nearby houses ----

export const NEARBY_MAX = 8;
export const NEARBY_RADIUS_M = 1000;

/** Up to `max` closest houses within `radius` meters of `center`, skipping ones in `skip`. Ties go by id. */
export function nearbyHouses<T extends Point & { id: string }>(
  houses: readonly T[],
  center: Point,
  skip: ReadonlySet<string>,
  max = NEARBY_MAX,
  radius = NEARBY_RADIUS_M,
): T[] {
  return houses
    .filter((h) => !skip.has(h.id))
    .map((h) => ({ h, d: haversine(center, h) }))
    .filter((x) => x.d <= radius)
    .sort((a, b) => a.d - b.d || (a.h.id < b.h.id ? -1 : a.h.id > b.h.id ? 1 : 0))
    .slice(0, Math.max(0, max))
    .map((x) => x.h);
}
