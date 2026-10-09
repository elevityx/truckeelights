// Owner: events/db. Public event reads and the visitor submit (Spec_Events A12). The database enforces
// RLS, validation, quotas and dedupe; nothing here is a security boundary.
import { getSupabase } from '@/lib/supabase/client';
import { toDataError } from './errors';
import { DataError, type EventInput, type PublicEvent, type Region } from './types';

/** Explicit public columns (never '*': column grants reject it). */
export const PUBLIC_EVENT_COLUMNS = 'id,title,description,venue,address,lat,lng,starts_at,ends_at,url,adults_only';

export interface RawPublicEvent {
  id: string;
  title: string;
  description: string;
  venue: string | null;
  address: string;
  lat: number | string;
  lng: number | string;
  starts_at: string;
  ends_at: string | null;
  url: string | null;
  adults_only: boolean;
}

export function toPublicEvent(r: RawPublicEvent): PublicEvent {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    venue: r.venue ?? null,
    address: r.address,
    lat: Number(r.lat),
    lng: Number(r.lng),
    startsAt: new Date(r.starts_at).toISOString(),
    endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
    url: r.url ?? null,
    adultsOnly: r.adults_only === true,
  };
}

/** RPC arguments shared by submit_event and admin_update_event / admin_create_event. */
export function eventArgs(i: EventInput) {
  return {
    p_title: i.title,
    p_description: i.description,
    p_venue: i.venue,
    p_address: i.address,
    p_place_id: i.placeId,
    p_lat: i.lat,
    p_lng: i.lng,
    p_starts_at: i.startsAt,
    p_ends_at: i.endsAt,
    p_url: i.url,
    p_adults_only: i.adultsOnly,
  };
}

export function parseSubmitEvent(data: unknown): { result: 'created' | 'exists'; eventId: string | null } {
  const row = (Array.isArray(data) ? data[0] : data) as { result?: unknown; event_id?: unknown } | null | undefined;
  const eventId = typeof row?.event_id === 'string' ? row.event_id : null;
  if (row?.result === 'created' && eventId) return { result: 'created', eventId };
  if (row?.result === 'exists') return { result: 'exists', eventId };
  throw new DataError('unknown');
}

/**
 * A3: the event area = region bbox + 0.05 deg on every side, east edge + 0.10 deg. Mirrors SQL
 * private.event_bounds (pgTAP 10 pins the numbers). Use it for client checks and the map restriction.
 */
export function eventBounds(r: Pick<Region, 'minLat' | 'maxLat' | 'minLng' | 'maxLng'>) {
  return { minLat: r.minLat - 0.05, maxLat: r.maxLat + 0.05, minLng: r.minLng - 0.05, maxLng: r.maxLng + 0.1 };
}

type Box = { minLat: number; maxLat: number; minLng: number; maxLng: number };
/** Inclusive, like SQL BETWEEN; NaN and Infinity fail. */
const inBox = (b: Box, lat: number, lng: number) => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;

/** Inside the local box (eventBounds): where visitors may submit. Outside it, an event is "Worth the drive". */
export function inEventBounds(r: Pick<Region, 'minLat' | 'maxLat' | 'minLng' | 'maxLng'>, lat: number, lng: number): boolean {
  return inBox(eventBounds(r), lat, lng);
}

/**
 * Amendment 3: the admin box = the local box joined with the Reno-area box (region bbox: south - 0.06, north + 0.15,
 * west - 0.05, east + 0.38 deg; for Truckee lat 39.09-39.60, lng -120.47 to -119.60). Mirrors SQL
 * private.event_bounds_admin (pgTAP 13 pins the numbers). Admin create/update and the map camera restriction use it.
 */
export function eventBoundsAdmin(r: Pick<Region, 'minLat' | 'maxLat' | 'minLng' | 'maxLng'>) {
  return { minLat: r.minLat - 0.06, maxLat: r.maxLat + 0.15, minLng: r.minLng - 0.05, maxLng: r.maxLng + 0.38 };
}

export function inEventBoundsAdmin(r: Pick<Region, 'minLat' | 'maxLat' | 'minLng' | 'maxLng'>, lat: number, lng: number): boolean {
  return inBox(eventBoundsAdmin(r), lat, lng);
}

/** Approved, active-season, not-ended events of the region (RLS applies the filters), ordered by start. */
export async function listEvents(regionId: string): Promise<PublicEvent[]> {
  try {
    const { data, error } = await getSupabase()
      .from('events')
      .select(PUBLIC_EVENT_COLUMNS)
      .eq('region_id', regionId)
      .order('starts_at', { ascending: true })
      .limit(500);
    if (error) throw error;
    return ((data ?? []) as unknown as RawPublicEvent[]).map(toPublicEvent);
  } catch (e) {
    throw toDataError(e);
  }
}

export async function submitEvent(
  regionSlug: string,
  input: EventInput,
): Promise<{ result: 'created' | 'exists'; eventId: string | null }> {
  try {
    const { data, error } = await getSupabase().rpc('submit_event', { p_region_slug: regionSlug, ...eventArgs(input) });
    if (error) throw error;
    return parseSubmitEvent(data);
  } catch (e) {
    throw toDataError(e);
  }
}
