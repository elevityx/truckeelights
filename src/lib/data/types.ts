export type Season = 'halloween' | 'christmas';
export type HouseStatus = 'visible' | 'hidden' | 'released';
export interface Region {
  id: string;
  slug: string;
  name: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  centerLat: number;
  centerLng: number;
  defaultZoom: number;
  timezone: string;
  countryCode: string;
}
export interface RegionContext {
  region: Region;
  season: Season;
  year: number;
  submissionsOpen: boolean;
  wordmark: string;
}
export interface Badge {
  kind: string;
  label: string;
  href?: string; // must start with https: (checked at render)
}
export interface PinView {
  id: string;
  address: string;
  lat: number;
  lng: number;
  photoCount: number; // R1: 0
  badges: Badge[]; // R1: []
}
export interface SubmitInput {
  regionSlug: string;
  placeId: string;
  address: string;
  lat: number;
  lng: number;
}
export type SubmitResult =
  | { result: 'created' | 'exists_visible'; houseId: string }
  | { result: 'blocked' };
export interface AdminHouse {
  id: string;
  address: string;
  season: Season;
  year: number;
  status: HouseStatus;
  hiddenReason: string | null;
  createdAt: string;
  legacySource: string | null;
}
export type DataErrorCode =
  | 'not_signed_in'
  | 'region_not_found'
  | 'submissions_closed'
  | 'invalid_place_id'
  | 'invalid_address'
  | 'invalid_coordinates'
  | 'out_of_bounds'
  | 'rate_limited'
  | 'forbidden'
  | 'not_found'
  | 'house_released'
  | 'must_be_hidden'
  | 'invalid_input'
  | 'captcha_failed'
  | 'auth_failed'
  | 'network'
  | 'unknown';
export class DataError extends Error {
  constructor(
    public code: DataErrorCode,
    public detail?: string,
  ) {
    super(code);
  }
}
