import { getSupabase } from '@/lib/supabase/client';
import { DataError, type PinView, type RegionContext, type Season } from './types';
import { toDataError } from './errors';

interface RawRegion {
  id: string;
  slug: string;
  name: string;
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
  center_lat: number;
  center_lng: number;
  default_zoom: number;
  timezone: string;
  country_code: string;
}
interface RawContext {
  region: RawRegion;
  season: Season;
  year: number;
  submissions_open: boolean;
  wordmark: string;
  photos_open?: boolean;
  votes_open?: boolean;
  events?: unknown;
}

/** A1: the "events" capability object. Missing (DB without events) -> undefined; never guessed. */
export function eventsCapability(raw: unknown): { open: boolean } | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return { open: (raw as { open?: unknown }).open === true };
}

export async function getRegionContext(slug?: string): Promise<RegionContext> {
  try {
    const { data, error } = await getSupabase().rpc('get_region_context', { p_slug: slug ?? null });
    if (error) throw error;
    const c = data as RawContext | null;
    if (!c || !c.region) throw new DataError('region_not_found');
    const r = c.region;
    return {
      region: {
        id: r.id,
        slug: r.slug,
        name: r.name,
        minLat: r.min_lat,
        maxLat: r.max_lat,
        minLng: r.min_lng,
        maxLng: r.max_lng,
        centerLat: r.center_lat,
        centerLng: r.center_lng,
        defaultZoom: r.default_zoom,
        timezone: r.timezone,
        countryCode: r.country_code,
      },
      season: c.season,
      year: c.year,
      submissionsOpen: c.submissions_open,
      wordmark: c.wordmark,
      photosOpen: c.photos_open === true,
      votesOpen: c.votes_open === true,
      // A1: a missing key means a DB without events; the client then never touches events.
      events: eventsCapability(c.events),
    };
  } catch (e) {
    throw e instanceof DataError ? e : toDataError(e);
  }
}

interface RawHouse {
  id: string;
  address: string;
  lat: number;
  lng: number;
  /** One-to-one embed: an object, or null before the house's first vote. */
  house_vote_totals?: { votes?: unknown } | { votes?: unknown }[] | null;
}

const HOUSE_COLS = 'id,address,lat,lng';

function embeddedVotes(h: RawHouse): number {
  const t = Array.isArray(h.house_vote_totals) ? h.house_vote_totals[0] : h.house_vote_totals;
  const v = Number(t?.votes ?? 0);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** Approved-photo counts per house. Any failure means 0 (capped), which fails safe. */
async function photoCounts(regionId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const { data, error } = await getSupabase().rpc('get_house_photo_counts', { p_region_id: regionId });
    if (error || !Array.isArray(data)) return out;
    for (const r of data as { house_id?: unknown; approved?: unknown }[]) {
      const n = Number(r?.approved);
      if (typeof r?.house_id === 'string' && Number.isFinite(n) && n > 0) out.set(r.house_id, Math.floor(n));
    }
  } catch {
    /* capped */
  }
  return out;
}

export async function listMapHouses(regionId: string): Promise<PinView[]> {
  try {
    // Explicit columns, never '*': column grants reject it. RLS applies season/status/active filters.
    const sb = getSupabase();
    const query = (cols: string) => sb.from('houses').select(cols).eq('region_id', regionId).limit(2000);
    const [first, counts] = await Promise.all([query(`${HOUSE_COLS},house_vote_totals(votes)`), photoCounts(regionId)]);
    let { data, error } = first;
    // PGRST200: the votes table isn't deployed yet. Retry once without the embed so the front end can ship first.
    if (error && (error as { code?: string }).code === 'PGRST200') ({ data, error } = await query(HOUSE_COLS));
    if (error) throw error;
    return ((data ?? []) as unknown as RawHouse[]).map((h) => ({
      id: h.id,
      address: h.address,
      lat: Number(h.lat),
      lng: Number(h.lng),
      photoCount: counts.get(h.id) ?? 0,
      votes: embeddedVotes(h),
      badges: [],
    }));
  } catch (e) {
    throw e instanceof DataError ? e : toDataError(e);
  }
}
