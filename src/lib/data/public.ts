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
    };
  } catch (e) {
    throw e instanceof DataError ? e : toDataError(e);
  }
}

export async function listMapHouses(regionId: string): Promise<PinView[]> {
  try {
    // Explicit columns, never '*': column grants reject it. RLS applies season/status/active filters.
    const { data, error } = await getSupabase()
      .from('houses')
      .select('id,address,lat,lng')
      .eq('region_id', regionId)
      .limit(2000);
    if (error) throw error;
    return (data ?? []).map((h: { id: string; address: string; lat: number; lng: number }) => ({
      id: h.id,
      address: h.address,
      lat: Number(h.lat),
      lng: Number(h.lng),
      photoCount: 0,
      votes: 0,
      badges: [],
    }));
  } catch (e) {
    throw e instanceof DataError ? e : toDataError(e);
  }
}
