# Architecture

Truckee Lights is a community map of decorated houses. Visitors add houses and photos, and an admin back office picks the active season and moderates content. This document describes how the pieces fit. For tables and functions see [DATA_MODEL.md](DATA_MODEL.md), and for the reasoning behind choices see [DECISIONS.md](DECISIONS.md).

## Shape of the system

- **A static, client-only site.** Next.js (App Router) is built with `output: 'export'`. Every page is a client component and loads data in effects, because the build prerenders with empty environment variables. There is **no server runtime** of our own.
- **Supabase is the only backend**: Postgres, Auth, and Storage. The browser talks to it directly with the public (publishable) key.
- **Hosting** is a static host that serves `main` as production and builds branches as previews.

```
browser (static site)
   |  publishable key, anonymous or admin session
   v
Supabase: Auth ---- Postgres (RLS, RPCs) ---- Storage (private buckets)
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
signed URL (short TTL) <-------- allowed only for an approved row of a public house
```

Key properties:

- **Reservation first.** `reserve_photo` creates a short-lived reservation. Storage policies let only the reserving user upload, only to that exact path, and never overwrite.
- **Caps under locks.** Reserve and confirm take advisory locks (user, then region, then house) and enforce per-user, per-house, and per-region limits, so parallel requests cannot exceed them.
- **Approve publishes a fresh copy.** The admin's browser re-encodes the image and uploads it under a random name the uploader never learns. Approval is one statement that sets the row to approved and queues deletion of the original upload.
- **Reads are authorized by the row.** A Storage policy allows signing an object in `photos` only if an approved row for a public house references it.

### Revocation model

A signed URL's lifetime is chosen by the client, so it is a cache hint and not a control. Revocation therefore acts on the **object**:

| Event | Effect on storage |
| :--- | :--- |
| revoke, release house | delete the public object |
| hide house, season switch | rotate: move the object to a new random name |
| reject, expiry | delete the upload |

Each change enqueues a row in a private `storage_jobs` queue **in the same transaction**. A database runner sends the job to Storage immediately after commit, and a scheduled task retries every 30 seconds. A job is marked done only after `storage.objects` confirms the new state.

**Runner-down fallback.** If the scheduler, the HTTP extension, or the runner's secret is broken, an admin can still finish the work: AAL2 admin RPCs list and complete jobs, region-scoped admin Storage policies let the admin's browser delete and move objects, and completion is verified server-side against `storage.objects`. Nightly reconciliation removes unreferenced objects, such as a half-finished approval.

## CI

GitHub Actions runs on pull requests and pushes with **no secrets** and no `pull_request_target`. Actions are pinned by commit SHA.

- Job `web`: lint, typecheck, unit tests, build, `npm audit` (high severity, production dependencies), and a privacy grep that fails the build if private material appears in the repo.
- Job `db`: starts the local Supabase stack, resets the database, then runs the pgTAP suite and the concurrency tests.

Migrations are applied to the hosted project by the maintainers after merge.
