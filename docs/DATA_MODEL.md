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
| `event_status` | `pending`, `approved`, `rejected`, `hidden` |

## Tables

### `public.regions`
One row per city: `slug`, `name`, bounding box (`min/max_lat`, `min/max_lng`), reserved `boundary` (unused), map center and default zoom, `timezone`, `country_code`, `is_active`. A trigger enforces that map centers and house coordinates stay inside the box.

### `public.app_settings`
A single row naming the default region (`default_region_id`, not null). A trigger forbids making an inactive region the default.

### `public.region_brands`
Display wordmark per `(region, season)`.

### `public.site_settings`
One row per region: `active_season`, `active_year`, `submissions_open` (default false), `photos_open` (default **false**, fail-closed), `votes_open` (default true; the per-region voting kill switch), `events_open` (default **false**; gates event submissions only, not reads), `updated_at`, `updated_by`.

### `public.houses`
`region_id`, `season`, `year`, `place_id`, `address`, `normalized_address`, `lat`, `lng`, `coord_source`, `status`, moderation fields (`hidden_reason`, `moderated_by/at`, `released_at`), `created_by`, and optional legacy import keys. Unique keys per `(region, season, year)` on `place_id` and on `normalized_address` de-duplicate in the database. A user-confirmed coordinate requires a `place_id`.

### `public.admins`
`user_id`, optional `region_id` (null means all regions), `note`. RLS on, no policy, no grant: only security-definer functions read it.

### `public.photos`
`house_id`, `upload_path` (`{house}/{id}.jpg` in the uploads bucket), `public_path` (random name in the public bucket, set only when approved), `status`, `reserved_until`, rotation and moderation timestamps, `created_by`. Constraints: `public_path` is present exactly when status is `approved`, and both paths match a strict UUID pattern.

### `public.house_vote_totals`
One row per house that has been voted on (`house_id`, `region_id`, `votes`); a missing row means 0. Publicly readable exactly when the house is visible. It is the only vote data the public reads.

### `private.vote_events` and `private.vote_salts`
The vote ledger (house, region, season, year, device uid, optional photo, region-local `vote_day`, nullable 16-byte `net_hash`, soft-void fields) and the daily per-region salts behind the hash. Both are private with forced RLS and no grants. Retention nulls the hash and deletes the salt once the day ends. `app_settings.vote_network_cap` (no API grant, default false) turns the per-network cap on.

### `public.events`
Community-submitted seasonal events: `region_id`, `season`, `year`, `title`, `description` (newlines kept), optional `venue`, `address` (a place name or street address), optional `place_id`, `lat`, `lng`, `starts_at`, optional `ends_at`, optional `url`, `adults_only`, `status` (`event_status`), `source` (`community` or `seed`), admin-only `source_url`, `reject_reason`, `created_by`, moderation fields, and two trigger-derived columns: `normalized_title` (lowercase, `[a-z0-9 ]` only) and `start_day` (the start date in the region's timezone). A partial unique index on `(region, season, year, normalized_title, starts_at)` where the status is not `rejected` de-duplicates on the exact start instant; a rejection frees the slot. Same-day matches are an admin warning, not a block. Coordinates of a visitor submission must be inside the region's local event area: the bounding box widened by 0.05° on every side and 0.10° on the east edge (`private.event_bounds`). Admin create and update use a wider admin area, `private.event_bounds_admin` (bbox −0.06° south, +0.15° north, −0.05° west, +0.38° east; for Truckee it reaches Reno and Carson City), which is also the trigger backstop for every write. The client labels an event outside the local area "Worth the drive"; there is no column for it. URLs must be plain `https://` links to a DNS host (no userinfo, port, IP literal, localhost, or link shortener). FORCE RLS; rejected rows are deleted 30 days after moderation.

### `private.quota_events`
An append-only ledger used for rate limits. Kinds: `house`, `photo_reserve`, `photo_confirm`, `event`. Rows are pruned after 48 hours.

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

- **Public reads** use column grants plus policies. Examples: anonymous callers can read a region only if it is active; houses only if `status = 'visible'` and the house belongs to the region's active `(season, year)`; events only if approved, in the active pair of an active region, and not ended (the end, or 3 hours after the start, plus a 1-hour grace), and never `source_url`, `status`, or moderation columns; photos are **not** readable by API roles at all (RLS on, no grants, no policies); see "Photos & storage jobs".
- **Private tables** have RLS enabled **and forced**, no policies, and no grants, so direct access fails with a permission error. Security-definer functions owned by the database owner keep working.
- **`private` schema USAGE** is granted to API roles only so Storage policies, which run as the caller, can call the helpers above. Every other function in `private` has no `EXECUTE` for API roles.
- **EXECUTE** is deny-by-default. Each function gets an explicit grant on its exact signature, and an ACL test asserts the full allowlist.

## RPC contracts

Callable by anonymous and signed-in users:

| Function | Purpose |
| :--- | :--- |
| `get_region_context(slug)` | Region, brand, active season, the submissions and photos switches, and `events: {open}` (a missing key means a database without events) |

Callable by signed-in users (anonymous sessions included):

| Function | Purpose |
| :--- | :--- |
| `submit_house(region_slug, place_id, address, lat, lng)` | Validate, de-duplicate, rate-limit, insert. Returns a result such as created, existing, or blocked |
| `reserve_photo(house_id)` | Returns `photo_id` and `upload_path`; fails when photos are closed or limits are hit |
| `confirm_photo_upload(photo_id)` | Returns `pending` or `over_cap` |
| `submit_event(region_slug, title, description, venue, address, place_id, lat, lng, starts_at, ends_at, url, adults_only)` | Validate, de-duplicate, rate-limit, cap the pending queue, insert as `pending`. Returns `created` (with id) or `exists` (id only when the existing event is approved) |

Callable by signed-in users and checked inside for an AAL2 admin of the region:

| Function | Purpose |
| :--- | :--- |
| `admin_whoami(region_id)` | Whether the caller is an admin |
| `admin_set_season(region_id, season, year, submissions_open)` | Switch the active pair (rotates photos of the old pair) |
| `admin_set_photos_open(region_id, open)` | Photos switch |
| `admin_list_houses(region_id, status, query)` | Moderation list |
| `admin_set_house_status(house_id, status, reason)` | Hide or unhide (hiding rotates photo objects) |
| `admin_release_house(house_id)` | Free a house's dedupe keys (revokes its photos) |
| `admin_event_queue(region_id, status)` / `admin_event_counts(region_id)` | Event moderation list (all columns, same-day warning) and the pending badge count |
| `admin_moderate_event(event_id, status, reason)` | pending to approved or rejected, approved to hidden, hidden or rejected to approved |
| `admin_update_event(event_id, …fields)` / `admin_create_event(region_id, …fields, source_url)` | Edit (status unchanged) or seed an approved event; same validation, past starts allowed, and the wider admin area (Reno area) instead of the local one |
| `admin_set_events_open(region_id, open)` | Event submissions switch |
| `admin_photo_queue(region_id, status)` | Photos awaiting or past review |
| `admin_approve_photo(photo_id, public_path)` | Single-statement approve |
| `admin_reject_photo(photo_id)` / `admin_revoke_photo(photo_id)` | Reject or revoke |
| `admin_storage_jobs(region_id)` / `admin_complete_storage_job(job_id)` | Fallback listing and server-verified completion |

Error codes are returned as the exception message: for example `not_signed_in`, `rate_limited`, `invalid_input`, `photo_expired`, `upload_missing`, `not_pending`, `not_approved`, `invalid_image`, `photos_closed`, `queue_full`, `exists`. Event validation fails with `invalid_input` and the field name as the detail.

## Quotas

Limits are counted from the append-only ledger under advisory locks (keys are prefixed by kind and dimension, and taken in a fixed order: user, region, house).

| Action | Per user | Per house | Per region |
| :--- | :--- | :--- | :--- |
| Add a house | 5 per hour | | 60 per 10 minutes |
| Reserve a photo | 10 per hour, and 3 live reservations at once | | 200 per hour |
| Confirm a photo | | at most 20 pending | 100 per hour |
| Submit an event | 3 per hour and 6 per 24 hours | | 30 per 10 minutes; at most 40 pending events (`queue_full`) |

Reservations expire after 15 minutes. A confirm over a cap commits the photo as `expired` and queues deletion of the upload.

## Photos & storage jobs

- **No direct reads.** `public.photos` has RLS enabled and no grants or policies for API roles. Visitors never query it. Admins read it through the admin RPCs.
- **Public reads.** `public.photo_sign_paths(house_id)` returns the newest approved photos (at most 20) of a public house and is executable by `service_role` only. The `photo-urls` Edge Function calls it and signs those paths for one hour. The function takes only a house id; the bucket and lifetime are fixed in code.
- **Lifecycle.** `reserved` (upload slot, expires) then `pending` after `confirm_photo_upload`, then `approved` (with a `public_path`), `rejected`, `revoked`, or `expired`.
- **Storage jobs.** Every change that removes or moves a stored object enqueues a `private.storage_jobs` row in the same transaction. A database runner sends it to Storage right after commit and a scheduled task retries it. A job is done only when `storage.objects` shows the new state. If the runner is down, admins list and complete jobs through `admin_storage_jobs` and `admin_complete_storage_job`, which verify server-side.
- **Sweeps.** Scheduled tasks expire stale reservations, prune old ledger rows, and reconcile unreferenced objects.
