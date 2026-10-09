# Architecture

Truckee Lights is a community map of decorated houses. Visitors add houses and photos, and an admin back office picks the active season and moderates content. This document describes how the pieces fit. For tables and functions see [DATA_MODEL.md](DATA_MODEL.md), and for the reasoning behind choices see [DECISIONS.md](DECISIONS.md).

## Shape of the system

- **A static, client-only site.** Next.js (App Router) is built with `output: 'export'`. Every page is a client component and loads data in effects, because the build prerenders with empty environment variables. There is **no server runtime** of our own.
- **Supabase is the only backend**: Postgres, Auth, Storage, and one small Edge Function (`photo-urls`) that signs read URLs for approved photos. The browser talks to it directly with the public (publishable) key.
- **Hosting** is a static host that serves `main` as production and builds branches as previews.

```
browser (static site)
   |  publishable key, anonymous or admin session
   v
Supabase: Auth ---- Postgres (RLS, RPCs) ---- Storage (private buckets)
                                  Edge Function photo-urls (signs approved reads)
```

## The trust boundary: the database enforces, the UI never does

Because there is no server of ours, nothing in the browser can be trusted. Security comes only from Postgres:

- Tables have **no write grants**. Public writes go only through a small set of `security definer` RPCs that validate input, derive the season and region on the server, and enforce rate limits.
- Public reads use **column grants plus row-level security (RLS)**, so anonymous callers see only what a policy allows.
- Internal helpers live in a `private` schema that is not exposed through the Data API, with deny-by-default `EXECUTE`. An ACL test pins the exact set of callable functions.
- Admin actions require a non-anonymous session at **AAL2** (password plus TOTP) and a row in the `admins` table, checked inside each RPC.

UI checks (button states, hidden controls) are conveniences only.

## Front-end layout

- `src/lib/data` is the **only** code that calls Supabase.
- `src/lib/maps` is a map adapter. The Google Maps implementation sits behind it, with a keyless stub so the list view works without a key.
- `src/lib/theme` holds the season themes. A small boot script sets the theme from local storage, or from a date rule, before first paint to avoid a flash, and the app corrects it once the region's settings load.
- `src/lib/text` has pure address helpers.
- `src/components/admin` is the admin back office at `/admin/`.

## Region model

Everything is scoped to a **region** (a city and its bounding box). Each region has one settings row that names its active `(season, year)` pair, a submissions switch, and a photos switch. The public sees only houses in the active pair. Pins from earlier seasons are hidden rather than deleted. The theme is derived from the active season, so there is one source of truth.

## Adding a house

The visitor gets a lazy anonymous session, gated by a bot-challenge token. The client calls the `submit_house` RPC. The server checks the address shape and region bounds, de-duplicates through unique keys, counts the caller against rate limits (kept in an append-only ledger and serialized with advisory locks), and inserts. Houses are post-moderated: they appear immediately, and admins can hide them.

## Photo pipeline

Photos are pre-moderated and stay invisible until approved. Both Storage buckets are private.

```
visitor                          database / storage                      admin
-------                          ------------------                      -----
resize to <=1600 px JPEG
reserve_photo(house)  ---------> reserved row + upload path (expires)
upload to photo-uploads -------> object under the reserved path only
confirm_photo_upload  ---------> pending (or over_cap -> expired + delete job)
                                                                          see pending (signed preview)
                                                                          re-encode in the browser
                                 photos bucket <---- upload, random name -
                                 admin_approve_photo -> approved, one statement
public house sheet
photo-urls Edge Function ------> signs only paths of approved photos of public houses
```

Key properties:

- **Reservation first.** `reserve_photo` creates a short-lived reservation. Storage policies let only the reserving user upload, only to that exact path, and never overwrite.
- **Caps under locks.** Reserve and confirm take advisory locks (user, then region, then house) and enforce per-user, per-house, and per-region limits, so parallel requests cannot exceed them.
- **Approve publishes a fresh copy.** The admin's browser re-encodes the image and uploads it under a random name the uploader never learns. Approval is one statement that sets the row to approved and queues deletion of the original upload.
- **Reads are authorized by the row.** Storage policies alone cannot express "approved only", so the `photo-urls` Edge Function asks the database which paths are approved photos of public houses and signs only those (1-hour URLs). See D29 in [DECISIONS.md](DECISIONS.md).

### Revocation model

A signed URL's lifetime is chosen by the client, so it is a cache hint and not a control. Revocation therefore acts on the **object**:

| Event | Effect on storage |
| :--- | :--- |
| revoke, release house | delete the public object |
| hide house, season switch | rotate: move the object to a new random name |
| reject, expiry | delete the upload |

Each change enqueues a row in a private `storage_jobs` queue **in the same transaction**. A database runner sends the job to Storage immediately after commit, and a scheduled task retries every 30 seconds. A job is marked done only after `storage.objects` confirms the new state.

**Runner-down fallback.** If the scheduler, the HTTP extension, or the runner's secret is broken, an admin can still finish the work: AAL2 admin RPCs list and complete jobs, region-scoped admin Storage policies let the admin's browser delete and move objects, and completion is verified server-side against `storage.objects`. Nightly reconciliation removes unreferenced objects, such as a half-finished approval.

## Moderation & storage-job fallback

- The admin **Photos** tab lists pending photos (oldest first) with 10-minute signed thumbnails, and live photos with a Revoke button. The database enforces admin and AAL2 on every RPC; the UI is not a boundary.
- **Approve** downloads the pending upload, re-encodes it in the browser (`toJpeg`, 1600 px, quality 0.85, metadata dropped) to a new random name `<house>/<uuid>.jpg` in the `photos` bucket, then calls `admin_approve_photo`. If the RPC fails the new object is removed (best effort; the reconciler is the backstop). Any failure leaves the photo not public.
- **Reject** and **Revoke** call their RPCs. After every photo action, hide, release, and season switch the browser runs the open storage jobs itself (`runStorageJobsFallback`): delete kinds `remove`; `rotate_public` is `copy` then `remove` (admins have no UPDATE). "Not found" is fine. Completion is only ever decided by `admin_complete_storage_job`.
- `StorageJobsBanner` polls every 30 s. Any `delete_public`/`rotate_public` job older than 60 s (or any other job older than 2 min) shows a red banner with **Run now**.
- "Visitors can add photos" (`photos_open`, default closed) is separate from house submissions.

## Photo upload & display

- **House sheet strip.** `PhotoStrip` calls `listHousePhotos(houseId)`, which invokes the `photo-urls` Edge Function. The function signs 1-hour URLs only for paths that `photo_sign_paths` returns (approved photos of public houses). The public client never reads the `photos` table or Storage directly, and only `http(s)` URLs reach an `<img>`. The strip shows a skeleton while loading, "No photos yet." when empty, and "Photos couldn’t load." on any error. Up to six thumbnails show; the sixth opens the rest.
- **Lightbox.** A portal above the sheet (`role="dialog"`, `aria-modal`). Focus starts on Close and returns to the thumbnail that opened it; Tab stays inside; Esc closes only the viewer; ←/→ and a horizontal swipe step through photos. Alt text is "Photo N of <street address>".
- **Add photos.** The button appears only while the region's `photos_open` is on. `AddPhotosSheet` keeps at most 3 files per batch, previews them with object URLs (revoked on remove and on close), runs the bot check only when there's no session yet, then `addPhotos` handles each file in turn: `toJpeg` (≤1600 px JPEG, metadata dropped) → `reserve_photo` → upload to the reserved path in `photo-uploads` (no upsert) → `confirm_photo_upload`. A bad image fails just that file; `rate_limited`, `photos_closed`, or a lost session stop the batch. Results: "Photos appear after a quick review", an over-cap notice, or the mapped error message.
- **Local preview without the database.** `npm run dev` with `NEXT_PUBLIC_PHOTOS_MOCK=1` swaps in `src/components/photos/devMock.ts` (scenarios via `?photosMock=thanks|overcap|rate|closed|invalid|captcha|empty|loaderror`). The switch checks `NODE_ENV === 'development'`, so production builds never include it.

## CI

GitHub Actions runs on pull requests and pushes with **no secrets** and no `pull_request_target`. Actions are pinned by commit SHA.

- Job `web`: lint, typecheck, unit tests, build, `npm audit` (high severity, production dependencies), and a privacy grep that fails the build if private material appears in the repo.
- Job `db`: starts the local Supabase stack, resets the database, then runs the pgTAP suite, the concurrency tests, and the storage tests (`npm run test:storage`, which serves the Edge Function locally).

Migrations are applied to the hosted project by the maintainers after merge.
