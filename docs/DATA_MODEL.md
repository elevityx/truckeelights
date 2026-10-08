# Data model

The schema lives in `supabase/migrations/` and is the source of truth. This document summarizes it at a public level. The photo objects below arrive with the photos release and are described here so the design is reviewable.

Conventions: every table in every schema has RLS enabled. There are no table write grants for API roles. The `private` schema is not exposed through the Data API.

## Enums

| Enum | Values |
| :--- | :--- |
| `season_kind` | `halloween`, `christmas` |
| `house_status` | `visible`, `hidden`, `released` |
| `coord_source` | `user_confirmed`, `census`, `admin` |
| `photo_status` | `reserved`, `expired`, `pending`, `approved`, `rejected`, `revoked` |

## Tables

### `public.regions`
One row per city: `slug`, `name`, bounding box (`min/max_lat`, `min/max_lng`), reserved `boundary` (unused), map center and default zoom, `timezone`, `country_code`, `is_active`. A trigger enforces that map centers and house coordinates stay inside the box.

### `public.app_settings`
A single row naming the default region (`default_region_id`, not null). A trigger forbids making an inactive region the default.

### `public.region_brands`
Display wordmark per `(region, season)`.

### `public.site_settings`
One row per region: `active_season`, `active_year`, `submissions_open` (default false), `photos_open` (default **false**, fail-closed), `updated_at`, `updated_by`.

### `public.houses`
`region_id`, `season`, `year`, `place_id`, `address`, `normalized_address`, `lat`, `lng`, `coord_source`, `status`, moderation fields (`hidden_reason`, `moderated_by/at`, `released_at`), `created_by`, and optional legacy import keys. Unique keys per `(region, season, year)` on `place_id` and on `normalized_address` de-duplicate in the database. A user-confirmed coordinate requires a `place_id`.

### `public.admins`
`user_id`, optional `region_id` (null means all regions), `note`. RLS on, no policy, no grant: only security-definer functions read it.

### `public.photos`
`house_id`, `upload_path` (`{house}/{id}.jpg` in the uploads bucket), `public_path` (random name in the public bucket, set only when approved), `status`, `reserved_until`, rotation and moderation timestamps, `created_by`. Constraints: `public_path` is present exactly when status is `approved`, and both paths match a strict UUID pattern.

### `private.quota_events`
An append-only ledger used for rate limits. Kinds: `house`, `photo_reserve`, `photo_confirm`. Rows are pruned after 48 hours.

### `private.blocked_terms`
Terms rejected in addresses.

### `private.storage_jobs`
The revocation queue (see [ARCHITECTURE.md](ARCHITECTURE.md)): `kind` (`delete_upload`, `delete_public`, `rotate_public`), `bucket`, `object_name`, optional `new_object_name`, retry bookkeeping, and `done_at`.

## Storage

| Bucket | Visibility | Limit | Types |
| :--- | :--- | :--- | :--- |
| `photo-uploads` | private | 5 MiB | `image/jpeg` |
| `photos` | private | 5 MiB | `image/jpeg` |

Storage policies call three helpers in `private`: whether a user may upload to a reserved path, whether an object in `photos` is readable (approved row of a public house), and whether the caller is an admin of the object's region.

## Grants and RLS

- **Public reads** use column grants plus policies. Examples: anonymous callers can read a region only if it is active; houses only if `status = 'visible'` and the house belongs to the region's active `(season, year)`; photos only the columns `id, house_id, public_path, status, created_at`, and only rows that are `approved` for a visible house in the active pair.
- **Private tables** have RLS enabled **and forced**, no policies, and no grants, so direct access fails with a permission error. Security-definer functions owned by the database owner keep working.
- **`private` schema USAGE** is granted to API roles only so Storage policies, which run as the caller, can call the three helpers above. Every other function in `private` has no `EXECUTE` for API roles.
- **EXECUTE** is deny-by-default. Each function gets an explicit grant on its exact signature, and an ACL test asserts the full allowlist.

## RPC contracts

Callable by anonymous and signed-in users:

| Function | Purpose |
| :--- | :--- |
| `get_region_context(slug)` | Region, brand, active season, and the submissions and photos switches |

Callable by signed-in users (anonymous sessions included):

| Function | Purpose |
| :--- | :--- |
| `submit_house(region_slug, place_id, address, lat, lng)` | Validate, de-duplicate, rate-limit, insert. Returns a result such as created, existing, or blocked |
| `reserve_photo(house_id)` | Returns `photo_id` and `upload_path`; fails when photos are closed or limits are hit |
| `confirm_photo_upload(photo_id)` | Returns `pending` or `over_cap` |

Callable by signed-in users and checked inside for an AAL2 admin of the region:

| Function | Purpose |
| :--- | :--- |
| `admin_whoami(region_id)` | Whether the caller is an admin |
| `admin_set_season(region_id, season, year, submissions_open)` | Switch the active pair (rotates photos of the old pair) |
| `admin_set_photos_open(region_id, open)` | Photos switch |
| `admin_list_houses(region_id, status, query)` | Moderation list |
| `admin_set_house_status(house_id, status, reason)` | Hide or unhide (hiding rotates photo objects) |
| `admin_release_house(house_id)` | Free a house's dedupe keys (revokes its photos) |
| `admin_photo_queue(region_id, status)` | Photos awaiting or past review |
| `admin_approve_photo(photo_id, public_path)` | Single-statement approve |
| `admin_reject_photo(photo_id)` / `admin_revoke_photo(photo_id)` | Reject or revoke |
| `admin_storage_jobs(region_id)` / `admin_complete_storage_job(job_id)` | Fallback listing and server-verified completion |

Error codes are returned as the exception message: for example `not_signed_in`, `rate_limited`, `invalid_input`, `photo_expired`, `upload_missing`, `not_pending`, `not_approved`, `invalid_image`, `photos_closed`.

## Quotas

Limits are counted from the append-only ledger under advisory locks (keys are prefixed by kind and dimension, and taken in a fixed order: user, region, house).

| Action | Per user | Per house | Per region |
| :--- | :--- | :--- | :--- |
| Add a house | 5 per hour | | 60 per 10 minutes |
| Reserve a photo | 10 per hour, and 3 live reservations at once | | 200 per hour |
| Confirm a photo | | at most 20 pending | 100 per hour |

Reservations expire after 15 minutes. A confirm over a cap commits the photo as `expired` and queues deletion of the upload.
