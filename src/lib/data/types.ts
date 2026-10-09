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
  votesOpen: boolean;
  events?: { open: boolean }; // undefined = DB without events
  subscribe?: { open: boolean }; // undefined = DB without subscriptions; the Subscribe UI stays hidden
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
  votes: number;
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
  | 'votes_closed'
  | 'queue_full'
  | 'exists'
  | 'already_owned'
  | 'claim_pending'
  | 'token_invalid'
  | 'token_expired'
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
export interface VoteStatus {
  totalVotes: number;
  leftToday: number;
}
export interface AdminVoteRow {
  houseId: string;
  address: string;
  totalVotes: number;
  votesToday: number;
  votes24h: number;
  voters24h: number;
  topVoter: string | null;
  topVoter24h: number | null;
  networksToday: number;
  topNetworkToday: number;
  voided: number;
}
export class DataError extends Error {
  constructor(
    public code: DataErrorCode,
    public detail?: string,
  ) {
    super(code);
  }
}
export type EventStatus = 'pending' | 'approved' | 'rejected' | 'hidden';
export interface PublicEvent { id: string; title: string; description: string; venue: string | null;
  address: string; lat: number; lng: number; startsAt: string; endsAt: string | null; // ISO UTC
  url: string | null; adultsOnly: boolean; }
export interface AdminEvent extends PublicEvent { status: EventStatus; source: 'community' | 'seed';
  sourceUrl: string | null; rejectReason: string | null; createdAt: string; sameDayWarning: boolean;
  /** The pair the row was submitted under; pending rows of older pairs stay in the queue (Amendment 2). */
  season: Season; year: number; }
export interface EventInput { title: string; description: string; venue: string | null; address: string;
  placeId: string | null; lat: number; lng: number; startsAt: string; endsAt: string | null;
  url: string | null; adultsOnly: boolean; }

// Subscribe + Accounts v1 (owner: sub/db). Raw RPC shapes are mapped in account.ts / adminAccounts.ts.
export type SubscriptionCadence = 'daily' | 'weekly';
export type SubscriptionStatus = 'active' | 'stopped';
export interface SubscriptionPrefs {
  houses: boolean;
  events: boolean; // at least one of houses / events
  cadence: SubscriptionCadence;
}
export interface Subscription extends SubscriptionPrefs {
  regionSlug: string;
  status: SubscriptionStatus;
  confirmedAt: string | null;
}
export type ClaimKind = 'claim' | 'removal';
export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';
export interface OwnedHouse {
  id: string;
  address: string;
  status: HouseStatus; // 'visible' | 'hidden' (released houses lose their owner)
  /** Hidden by the owner (can unhide). Hidden by an admin -> false, and the owner cannot unhide. */
  hiddenByOwner: boolean;
  votes: number;
  approvedPhotos: number;
  removalPending: boolean;
}
export interface MyClaim {
  id: string;
  kind: ClaimKind;
  houseId: string;
  address: string;
  status: 'pending';
  createdAt: string;
}
export interface MyAccount {
  email: string;
  subscription: Subscription | null;
  houses: OwnedHouse[];
  claims: MyClaim[]; // pending claims and removal requests only
}
export interface AdminClaim {
  id: string;
  kind: ClaimKind;
  houseId: string;
  address: string;
  houseStatus: HouseStatus;
  claimantMasked: string; // e.g. "s•••@gmail.com", masked server-side
  currentOwnerMasked: string | null;
  note: string | null;
  status: ClaimStatus;
  reason: string | null;
  createdAt: string;
  resolvedAt: string | null;
}
export interface SubscriberCounts {
  active: number;
  stopped: number;
  daily: number; // active only, here and below
  weekly: number;
  houses: number;
  events: number;
}
export interface DigestToday {
  sent: number; // digest emails sent today (UTC day)
  failed: number;
  cap: number; // digest send cap per day
  providerDailyLimit: number; // 100 on the free plan; the banner warns at 80%
  capHit: boolean;
}
