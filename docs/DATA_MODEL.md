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

Exactly six storage policies exist (none for anonymous callers, none for UPDATE). They call two helpers in `private`: whether a user may upload to a reserved path, and whether the caller is an admin of the object's region. Public reads are not a storage policy: the `photo-urls` Edge Function signs approved photos (see "Photos & storage jobs").

## Grants and RLS

- **Public reads** use column grants plus policies. Examples: anonymous callers can read a region only if it is active; houses only if `status = 'visible'` and the house belongs to the region's active `(season, year)`; photos are **not** readable by API roles at all (RLS on, no grants, no policies); see "Photos & storage jobs".
- **Private tables** have RLS enabled **and forced**, no policies, and no grants, so direct access fails with a permission error. Security-definer functions owned by the database owner keep working.
- **`private` schema USAGE** is granted to API roles only so Storage policies, which run as the caller, can call the helpers above. Every other function in `private` has no `EXECUTE` for API roles.
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

## Photos & storage jobs

- **No direct reads.** `public.photos` has RLS enabled and no grants or policies for API roles. Visitors never query it. Admins read it through the admin RPCs.
- **Public reads.** `public.photo_sign_paths(house_id)` returns the newest approved photos (at most 20) of a public house and is executable by `service_role` only. The `photo-urls` Edge Function calls it and signs those paths for one hour. The function takes only a house id; the bucket and lifetime are fixed in code.
- **Lifecycle.** `reserved` (upload slot, expires) then `pending` after `confirm_photo_upload`, then `approved` (with a `public_path`), `rejected`, `revoked`, or `expired`.
- **Storage jobs.** Every change that removes or moves a stored object enqueues a `private.storage_jobs` row in the same transaction. A database runner sends it to Storage right after commit and a scheduled task retries it. A job is done only when `storage.objects` shows the new state. If the runner is down, admins list and complete jobs through `admin_storage_jobs` and `admin_complete_storage_job`, which verify server-side.
- **Sweeps.** Scheduled tasks expire stale reservations, prune old ledger rows, and reconcile unreferenced objects.
