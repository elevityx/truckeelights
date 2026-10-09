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
  photosOpen: boolean;
  events?: { open: boolean }; // undefined = DB without events
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
  | 'photo_expired'
  | 'upload_missing'
  | 'not_pending'
  | 'not_approved'
  | 'invalid_image'
  | 'photos_closed'
  | 'auth_failed'
  | 'network'
  | 'unknown';
export type PhotoStatus = 'reserved' | 'expired' | 'pending' | 'approved' | 'rejected' | 'revoked';
export interface HousePhoto {
  id: string;
  url: string; // signed URL, 1 h
}
export type ConfirmResult = 'pending' | 'over_cap';
export interface AddPhotosProgress {
  index: number;
  total: number;
  stage: 'resizing' | 'uploading' | 'done' | 'failed';
  error?: DataErrorCode;
}
export interface AddPhotosResult {
  pending: number;
  overCap: number;
  failed: number;
}
export interface AdminPhoto {
  id: string;
  houseId: string;
  address: string;
  status: 'pending' | 'approved';
  uploadPath: string | null;
  publicPath: string | null;
  createdAt: string;
}
export interface StorageJob {
  id: number;
  kind: 'delete_upload' | 'delete_public' | 'rotate_public';
  bucket: 'photo-uploads' | 'photos';
  objectName: string;
  newObjectName: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}
export class DataError extends Error {
  constructor(
    public code: DataErrorCode,
    public detail?: string,
  ) {
    super(code);
  }
}

// Events v1 contract (A12)
export type EventStatus = 'pending' | 'approved' | 'rejected' | 'hidden';
export interface PublicEvent { id: string; title: string; description: string; venue: string | null;
  address: string; lat: number; lng: number; startsAt: string; endsAt: string | null; // ISO UTC
  url: string | null; adultsOnly: boolean; }
export interface AdminEvent extends PublicEvent { status: EventStatus; source: 'community' | 'seed';
  sourceUrl: string | null; rejectReason: string | null; createdAt: string; sameDayWarning: boolean; }
export interface EventInput { title: string; description: string; venue: string | null; address: string;
  placeId: string | null; lat: number; lng: number; startsAt: string; endsAt: string | null;
  url: string | null; adultsOnly: boolean; }
