# Architecture

Truckee Lights is a community map of decorated houses. Visitors add houses and photos, and an admin back office picks the active season and moderates content. This document describes how the pieces fit. For tables and functions see [DATA_MODEL.md](DATA_MODEL.md), and for the reasoning behind choices see [DECISIONS.md](DECISIONS.md).

## Shape of the system

- **A static, client-only site.** Next.js (App Router) is built with `output: 'export'`. Every page is a client component and loads data in effects, because the build prerenders with empty environment variables. There is **no server runtime** of our own.
- **Supabase is the only backend**: Postgres, Auth, Storage, and four small Edge Functions: `photo-urls` signs read URLs for approved photos, and Subscribe v1 adds `send-digest`, `unsubscribe` and `delete-account` (see below). The browser talks to Supabase directly with the public (publishable) key.
- **Hosting** is a static host that serves `main` as production and builds branches as previews.

```
browser (static site)
   |  publishable key, anonymous / account / admin session
   v
Supabase: Auth ---- Postgres (RLS, RPCs) ---- Storage (private buckets)
             Edge Functions: photo-urls (signs approved reads)
                             send-digest  <- pg_cron + pg_net, Vault bearer      -> Resend
                             unsubscribe  <- HMAC link tokens from emails
                             delete-account <- the signed-in account's own JWT
```

## The trust boundary: the database enforces, the UI never does

Because there is no server of ours, nothing in the browser can be trusted. Security comes from Postgres, plus the self-authenticating checks in the Edge Functions that hold the service-role key (next section):

- Tables have **no write grants**. Public writes go only through a small set of `security definer` RPCs that validate input, derive the season and region on the server, and enforce rate limits.
- Public reads use **column grants plus row-level security (RLS)**, so anonymous callers see only what a policy allows.
- Internal helpers live in a `private` schema that is not exposed through the Data API, with deny-by-default `EXECUTE`. An ACL test pins the exact set of callable functions.
- Admin actions require a non-anonymous session at **AAL2** whose JWT `amr` has both a `password` and a `totp` entry (an email-code + TOTP session does not count) and a row in the `admins` table, checked inside each RPC.

UI checks (button states, hidden controls) are conveniences only.

### Service-role Edge Functions (Subscribe v1)

Three functions run with the service-role key (function env only, never in the repo or the browser) and `verify_jwt = false`, so each authenticates its caller itself. They reach the database only through `public.svc_*` routines, which are executable by `service_role` alone (ACL test).

| Function | Who may call it, and how it checks | What it may do |
| :--- | :--- | :--- |
| `send-digest` | pg_cron via pg_net, with a bearer from Vault compared in constant time to `DIGEST_CRON_SECRET`. `private.run_digest` posts only to exactly `https://<project host>/functions/v1/send-digest`, where the host comes from the separately trusted `storage_api_url` Vault secret | Claim, send and mark digest rows (`svc_digest_*`). Bounded: about 40 s and 100 sends per call; cron fires every 10 minutes from 18:07 to 19:57 Pacific and later ticks resume |
| `unsubscribe` | Anyone holding an emailed link: an HMAC token `public_id.version.purpose.exp.sig` (`UNSUBSCRIBE_HMAC_SECRET`). A GET only redirects; a POST acts | Stop one subscription (idempotent: a retry answers "already stopped"), or read/change its topics with a 30-day `prefs` token |
| `delete-account` | The signed-in account itself: the JWT is verified with Auth, the user id comes only from it, the session must be non-anonymous with an email-code sign-in under 10 minutes old. A repeat whose user is already gone (Auth verifies the token and answers `user_not_found`, and the database agrees) needs no fresh sign-in | Refuse admins (read-only check first), delete the Auth user (the database FKs remove the subscription, claims, digest records and links and unown houses in the same step), then run an idempotent cleanup. If the Auth delete errors or its response is lost, it re-checks whether the user still exists: gone means cleanup and 200, otherwise 503 `retry` (never "nothing changed"). Repeating is always safe; the browser retries twice |

The digest's provider idempotency key is stored per content window (`digest:<public_id>:<window start>/<window end>`) and reused for every retry, including a later evening's resume of an ambiguous send. The rendered email is stored on the send row (`svc_digest_store_payload`) before the provider call, and a resume sends that stored email verbatim, so the provider always sees the identical request for a key whatever changed in the meantime; a row that crashed before the store is rendered fresh (the provider never saw its key). A definitely refused send is never reused: the next run's row has a new key. The daily cap counts each row once, on the UTC day it was claimed, and a resume needs no cap room. The provider dedupes a key for 24 hours, so an ambiguous send resumed more than a day later can arrive twice; that residual risk is accepted.

### Retention (Subscribe v1)

`private.sweep_subscribe` runs daily: house-link email hashes are deleted after a day (they are usable for one hour), a stored digest email is cleared when its row is marked sent or failed (the sweep never clears a still-`sending` row's email: a `sending` row idle for 2 days is first closed as failed with the code `abandoned`, and then its email is cleared), digest run and send records after 60 days, and resolved claims and removal requests after 180 days. Account deletion removes the account's rows at once through the Auth delete.

## Front-end layout

- `src/lib/data` is the **only** code that calls Supabase.
- `src/lib/maps` is a map adapter. The Google Maps implementation sits behind it, with a keyless stub so the list view works without a key.
- `src/lib/theme` holds the season themes. A small boot script sets the theme from local storage, or from a date rule, before first paint to avoid a flash, and the app corrects it once the region's settings load.
- `src/lib/text` has pure address helpers.
- `src/components/admin` is the admin back office at `/admin/`.
- `src/lib/route` + `src/components/route` are **Build my route**, client-only: stops live in this device's `localStorage`, ordering is straight-line nearest neighbor + 2-opt on the device, and "Start route" hands off to a Google Maps directions URL (split into legs of 3 waypoints on phones, 9 on desktop). No API call, no server state; the visitor's location is read once on request and only goes into the Google Maps link.

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

## House votes

Voting is one write RPC, `vote_house(house_id, photo_id?)`, for signed-in (anonymous-session) users, plus `my_vote_status` for the caller's remaining votes. It enforces everything in the database, in a fixed lock order (see AGENTS.md): per-device limits (5 votes per house and 60 per day, region-local day), an optional per-network limit (25 per house per day) keyed by a daily salted hash of the Cloudflare client network prefix, and exact flood breakers per house and per region over 10 minutes. The network cap fails open and is enabled by a global admin only after `scripts/probe-network-header.mjs` shows the header is authoritative on the deployed site. Admins see per-house stats, can void votes (last hour, top voter, or reset), and flip the per-region `votes_open` switch from the Votes tab. The UI maps the server's `rate_limited` detail (`house_daily`, `uid_daily`, `network_daily`, `house_breaker`, `region_breaker`) to friendly copy; it never decides limits itself. Local preview without the database: `NEXT_PUBLIC_VOTES_MOCK=1` with `npm run dev` (development only).

## CI

GitHub Actions runs on pull requests and pushes with **no secrets** and no `pull_request_target`. Actions are pinned by commit SHA.

- Job `web`: lint, typecheck, unit tests, build, `npm audit` (high severity, production dependencies), and a privacy grep that fails the build if private material appears in the repo.
- Job `db`: starts the local Supabase stack, resets the database, then runs the pgTAP suite, the concurrency tests, and the storage tests (`npm run test:storage`, which serves the Edge Function locally).

Migrations are applied to the hosted project by the maintainers after merge.
