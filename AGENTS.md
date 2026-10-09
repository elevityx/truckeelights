# AGENTS.md: Truckee Lights

Rules for any AI agent (Claude Code, Codex, Cursor, Antigravity) working in this repo. `CLAUDE.md` points here. **Keep this file current**: any change to the stack, commands, data model, or deploy path updates this file in the same commit.

## What this is
truckeelights.com is a community map of decorated houses in Truckee, CA. It has two seasonal modes, **Christmas** (lights) and **Halloween**. Visitors add houses, photos, and seasonal events. An admin back office picks the active season/theme and moderates photos and events.

## Status (2026-10)
The Supabase rewrite and Release 2 (photos) are live on `main`. There is no Firebase code. House Votes is integrated on `votes/integration` (PR #16) and goes live when it merges to `main`.

## Stack
- Next.js 16 App Router, static export (`output: 'export'`, `trailingSlash: true`). The map, flyer, and admin pages are client components and their data loads in effects only, because the build prerenders with empty env; the About page is a static server component that renders at build time. There is no server runtime except the `photo-urls` signer Edge Function, so security comes **only** from Postgres RLS, constraints, and Storage policies.
- TypeScript, Tailwind 4 (tokens per `[data-theme]` in `globals.css`).
- Supabase: Postgres + Auth (anonymous sessions gated by Turnstile; admin password + TOTP MFA) + Storage (two **private** buckets, `photo-uploads` and `photos`; no public read, no UPDATE policy). Revocation runs through `private.storage_jobs`, dispatched by pg_net, retried by pg_cron every 30 s, with the Storage API URL and key in Vault (`supabase/storage-jobs-local.sh` sets them locally). Public photo URLs (1 h) come only from the `photo-urls` Edge Function (`supabase/functions/photo-urls`), which signs only what `public.photo_sign_paths` (service_role only) returns: the newest approved photos of public houses.
- House Votes (Pumpkin Power, Ghost Power, Snowfall): `vote_house(house, photo?)` is the only write. A device (anonymous session) gets 5 votes per house per day and 60 per day; exact flood breakers cap a house at 200 and a region at 2000 votes per 10 minutes. `site_settings.votes_open` is the per-region kill switch. An optional per-network cap (25 per house per day) is off until `app_settings.vote_network_cap` is turned on by a global admin; it keys on a daily, per-region salted hash of the Cloudflare-supplied client network prefix (`cf-connecting-ip` only), fails open, and never stores or returns an address. `scripts/probe-network-header.mjs` checks against a deployed site that the header is authoritative (via the `network_probe` RPC) before the cap is enabled. Counters live in `public.house_vote_totals`; the ledger is private.
- Google Maps JS (`@googlemaps/js-api-loader` 2, Advanced Markers, `PlaceAutocompleteElement`, `Geocoder` for tap-the-map-to-add) behind `src/lib/maps`, with a keyless stub (tap-to-add is off without a key).
- Cloudflare Pages: `main` = production, branches = previews. DNS for truckeelights.com is on Cloudflare.

## Commands
Note: `next dev` may rewrite this file (Next.js agent-docs injection). Revert any such change before committing.
```bash
nvm use            # Node version from .nvmrc
npm ci
npm run dev        # add NEXT_PUBLIC_PHOTOS_MOCK=1 to preview photo flows, NEXT_PUBLIC_VOTES_MOCK=1 to preview voting, or NEXT_PUBLIC_EVENTS_MOCK=1 to preview events, without the database (dev only)
npm run build      # static export to out/
npm run lint
npm run typecheck
npm test
npm run db:start   # local Supabase stack (sets local-only auth env; don't run bare `supabase start`)
npm run db:reset   # supabase db reset, then supabase/storage-jobs-local.sh (local storage-runner setup)
npm run db:test
npm run test:concurrency
npm run test:storage   # tests/storage, serialized (--test-concurrency=1); needs the local stack
```
Local env: copy `.env.example` to `.env.local`. It holds the `NEXT_PUBLIC_*` values (Supabase URL and publishable key, Turnstile site key, optional Maps key and map ids, site URL), all public.
The local stack also reads `SUPABASE_AUTH_SITE_URL` and `SUPABASE_AUTH_CAPTCHA_SECRET` through `supabase/config.toml`. `supabase/start-local.sh` (via `npm run db:start`) defaults them to `http://localhost:3000` and Cloudflare's public always-pass test secret. Never put a real captcha secret in the repo.

## Layout
- `src/app` (pages: `/` map, `/about/` static About + FAQ, `/flyer/` and `/admin/` noindex), `src/components`
- `src/lib/seo` (JSON-LD builders). `public/sitemap.xml` and `public/robots.txt` are hand-written: add every new indexable page to the sitemap, and keep `/admin/` and `/flyer/` out of it.
- `src/lib/data` (the **only** Supabase caller; events: `events.ts` public read/submit + `eventBounds` (local box, visitor submissions) and `eventBoundsAdmin` (admin box incl. Reno, admin writes and the map camera), `adminEvents.ts` moderation)
- `src/lib/images` (`toJpeg`: browser-side resize and re-encode to JPEG, used by photo upload and admin approve)
- `src/components/photos` (visitor photo upload sheet, `api.ts` data wiring, `devMock.ts` dev-only mock) and `src/components/house` (house sheet, photo strip, lightbox)
- `src/components/events` (Events v1 public UI: the Houses · Events · Both layer switch (`?layer=`, `localStorage` key `tl:layer`), event list views, event sheet (`?event=<id>`), Add chooser and event form; `api.ts` data wiring, `eventsDevMock.ts` dev-only mock). Shown only when `get_region_context` returns `events`; without it the client makes no events calls.
- `src/lib/time` (`pacific.ts`: wall-clock conversion in the region's zone with `Intl`, never the device zone; DST gap rejected, fall-back hour takes daylight time; list grouping)
- `src/lib/maps` (adapter; event pins are a constant glyph plus `textContent` labels; the map's camera restriction comes from `eventBoundsAdmin` in `src/lib/data/events.ts`, the TS mirror of SQL `private.event_bounds_admin`, next to `eventBounds`, the mirror of `private.event_bounds`; the initial camera stays on the region), `src/lib/theme`, `src/lib/text` (pure address helpers), `src/config/public-env.ts`
- `src/components/admin` (admin back office at `/admin/`; the Events tab is `EventsTab.tsx` with pure helpers and tests in `eventsState.ts`, wired to `src/lib/data/adminEvents.ts`; the Claims tab (`ClaimsTab.tsx`, helpers in `claimsState.ts`: house claims and owner removal requests, masked emails only, approve/reject/clear owner) and the Overview tab (`OverviewTab.tsx`: subscriber counts, today's email use against the provider limit with an upgrade banner at 80%, and the `subscribe_open` switch) are wired to `src/lib/data/adminAccounts.ts` and are shown only when `get_region_context` returns `subscribe`)
- `src/lib/share` (pure share-URL builders + Web Share/copy helper; `qr.ts` turns a URL into SVG path data with `qrcode`, used only from server components so it runs at build time and ships no runtime code)
- `src/app/flyer` + `src/components/flyer` (printable QR flyer at `/flyer/`, noindex, linked from the admin console; color or black & white ink via `?ink=color|bw` and `localStorage` key `tl:flyer-ink`, color by default; the QR stays black on white)
- `public/og/{halloween,christmas}.png` (1200×630 social cards; site-wide OG/Twitter meta in `src/app/layout.tsx`). Source is `scripts/og/card.html`; regenerate with `node scripts/og/render.mjs` (needs local Chrome; not part of the build)
- `supabase/migrations` (schema; never edited after merge), `supabase/seed.sql` (fake local data only), `supabase/tests` (pgTAP)
- `scripts/probe-network-header.mjs` (network-header probe for the vote network cap; run against a deployed origin, not part of CI)
- `supabase/functions` (Edge Functions; `photo-urls` is the photo signer)
- `tests/db-concurrency` (Node test runner, needs the local stack)
- `tests/storage` (Storage and runner tests, Node test runner, needs the local stack)
- `docs/` (ARCHITECTURE, DATA_MODEL, DECISIONS)
- `.github/workflows/ci.yml`

## Invariants (do not break)
1. There are no table write grants. Public writes go only through the exposed RPCs, and internal functions live in the `private` schema, which isn't exposed. Every table in every schema has RLS enabled.
2. Each region has one `site_settings` row, and the public sees only its active `(season, year)`. Pins from past seasons are hidden, never deleted.
3. Photos stay hidden until an admin approves them. The public UI never lists storage directly.
4. Deduplication happens in the database, through unique keys per `(region, season, year)`, never only in the client. Events dedupe on `(region, season, year, normalized_title, starts_at)` for non-rejected rows.
5. **Secrets**: only public values (the Supabase URL, the publishable key, the referrer-restricted Maps key) may appear in client code or `NEXT_PUBLIC_*`. Never commit a service-role key, a database password, or real `.env*` files. A sanitized `.env.example` with local-stack values only is allowed. Hosted values live in the host's env settings, never in the repo.
6. **No HTML strings built from data.** Render through React or `textContent`, never `innerHTML`.
7. Schema changes go through versioned migrations under `supabase/migrations/`. Don't make ad-hoc changes in the dashboard.
8. A new function needs an explicit `grant execute` on its exact signature and an update to the ACL allowlist test (`supabase/tests/01_acl.test.sql`).
9. `private` schema USAGE is granted to `authenticated` **only** (never anon), so the Storage policies can call the two policy helpers `private.photo_upload_allowed` and `private.storage_admin_ok`. Every other `private` function has no EXECUTE for API roles, and private tables keep FORCE RLS with no grants, so direct access still fails with 42501 (pgTAP 01/06).
10. Private tables (`private.quota_events`, `private.blocked_terms`, `private.storage_jobs`, `private.vote_events`, `private.vote_salts`) have RLS enabled **and forced**, with no policies and no grants. The security-definer RPCs keep working because the owner role has BYPASSRLS. Do not switch to policies without updating the pgTAP tests.
11. A state change that ends public reads of a photo (revoke, release, hide, season switch, reject, expiry) enqueues its storage job **in the same transaction**. A job is done only when `storage.objects` confirms the new state, never on an HTTP status. Photo paths take locks in one order: per-photo advisory lock, then the `photos` row, then `storage_jobs` rows.
12. The `net` and `vault` schemas are never exposed through the Data API (`[api] schemas` stays `["public"]`). `public.photos` has no grants or policies for API roles; the public reads photos only through the signer.
13. Raw IP addresses are never stored, logged, or returned by the vote path; only a 16-byte salted hash is kept, and retention nulls it and destroys the salt after the region-local day ends, so past hashes are unlinkable. Vote paths take locks in one order: the region's `site_settings` row (FOR KEY SHARE), the voted house's `houses` row (FOR SHARE, so a concurrent hide/release/revoke waits for the vote or is seen as `not_found`), for a photo heart the photo's `photos` row (FOR SHARE), per-device advisory lock, salt row, per-network advisory lock, the house's `house_vote_totals` row, per-region advisory lock, then ledger rows. Never take them in another order.
14. Events: `public.events` has FORCE RLS, a column grant without `source_url` or moderation fields, and one SELECT policy (approved, active pair, active region, not ended). All writes go through `submit_event` and the `admin_*_event` RPCs. `site_settings.events_open` gates submissions only. A client that gets no `events` key from `get_region_context` must not call any events relation or RPC. Event URLs pass `private.valid_event_url` in every write path. `submit_event` takes locks in one order: the `event:uid` then `event:region` advisory locks, then the region's `site_settings` row `FOR SHARE` (so `admin_set_events_open` and `admin_set_season`, which update that row, cannot interleave), and only then does it read `events_open` and the active season/year, insert, and take quota. `admin_set_season` (site_settings FOR UPDATE, then houses/photos) and `vote_house` (site_settings FOR KEY SHARE, then vote locks) take no event lock, so the order has no cycle; never take an `event:*` advisory lock after touching `site_settings`. The 40-pending cap counts every pending row in the region (any season/year), and the admin queue/counts show them all. Client URL checks use the one shared `src/lib/data/eventUrl.ts` (mirror of `valid_event_url`). Event bounds come in two boxes: `submit_event` keeps the local box (`private.event_bounds`); `admin_create_event`/`admin_update_event` (via `private.clean_event` with `p_admin`) and the `events_before_write` trigger backstop use the admin box (`private.event_bounds_admin`, adds Reno and Carson City). Events outside the local box show a client-side "Worth the drive" chip.

**CI** (`.github/workflows/ci.yml`): runs on PRs and pushes with no secrets and no `pull_request_target`, actions pinned by SHA. Job `web` runs lint, typecheck, tests, build, `npm audit --omit=dev --audit-level=high`, and a privacy grep. Job `db` starts the local stack with `npm run db:start`, then runs `npm run db:reset` (reset plus the local runner setup), pgTAP, `npm run test:concurrency`, and `npm run test:storage` (serialized; never in parallel with the concurrency tests).

**Known limits**: the server checks the shape of an address (house number, real street word, inside the region's bounding box, deduplicated), but can't prove Google returned the place or that the house exists. Admins hide bad entries, and the per-region submissions switch is the kill switch. Events are the same: the server checks shape, bounds, and URL form, not that the event is real; every community event waits in the admin queue, and `events_open` is the kill switch. The admin re-encode on approve runs in the admin's browser: the server verifies the approved object exists in the right house folder, not that it was re-encoded. Revocation takes seconds while the admin page is open (it runs the jobs itself) and up to about 1 min on the cron retry otherwise, plus CDN propagation. Votes are per anonymous device, so someone who clears site data gets fresh votes; the per-network cap, the flood breakers, admin voiding, and the kill switch bound the damage but cannot make a vote a proof of a person. Anyone can ask the signer for 1-hour URLs of approved photos of public houses (they're public by design).

**PR rule**: any PR that changes stack, commands, env vars, layout, schema/RLS/grants, CI, or deploy updates this file in the same PR.

## Workflow
This is a public, open-source repo, and outside contributors (and their agents) are welcome.
- **Every change goes through a pull request to `main`.** Never push to `main` directly. Keep PRs small and focused on one change, and fill in the PR template.
- **Agents must never deploy, run migrations against the hosted Supabase project, or touch production data.** Merging and deploying are maintainer-only, and happen through CI after review. Contributors develop against a local Supabase stack, never the hosted project.
- Don't ask for or use secrets. CI on fork PRs runs without secrets by design.
- Changes to RLS policies, auth, or storage rules need a test that proves the policy holds, and get extra review.
- Design docs for contributors live in `docs/` (architecture, data model, decision log). Update them when you change a design.
- Commit messages are imperative and describe one change each.
- License: MIT (see `LICENSE`). By contributing, you agree your contributions are MIT-licensed.
