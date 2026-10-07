# AGENTS.md: Truckee Lights

Rules for any AI agent (Claude Code, Codex, Cursor, Antigravity) working in this repo. `CLAUDE.md` points here. **Keep this file current**: any change to the stack, commands, data model, or deploy path updates this file in the same commit.

## What this is
truckeelights.com is a community map of decorated houses in Truckee, CA. It has two seasonal modes, **Christmas** (lights) and **Halloween**. Visitors add houses and photos. An admin back office picks the active season/theme and moderates photos.

## Status (2026-10)
The Supabase rewrite is on `feat/seasonal-revival` and goes live on `main` at cutover. There is no Firebase code. Photos arrive in a later release.

## Stack
- Next.js 16 App Router, static export (`output: 'export'`, `trailingSlash: true`). Every page is a client component and data loads in effects only, because the build prerenders with empty env. There is no server runtime, so security comes **only** from Postgres RLS and constraints.
- TypeScript, Tailwind 4 (tokens per `[data-theme]` in `globals.css`).
- Supabase: Postgres + Auth (anonymous sessions gated by Turnstile; admin password + TOTP MFA).
- Google Maps JS (`@googlemaps/js-api-loader` 2, Advanced Markers, `PlaceAutocompleteElement`) behind `src/lib/maps`, with a keyless stub.
- Cloudflare Pages: `main` = production, branches = previews. DNS for truckeelights.com is on Cloudflare.

## Commands
```bash
nvm use            # Node version from .nvmrc
npm ci
npm run dev
npm run build      # static export to out/
npm run lint
npm run typecheck
npm test
supabase start
supabase db reset
npm run db:test
npm run test:concurrency
```
Local env: copy `.env.example` to `.env.local`.

## Layout
- `src/app` (pages), `src/components`
- `src/lib/data` (the **only** Supabase caller)
- `src/lib/maps` (adapter), `src/lib/theme`, `src/config/public-env.ts`
- `supabase/migrations` (schema; never edited after merge), `supabase/seed.sql` (fake local data only), `supabase/tests` (pgTAP)
- `tests/db-concurrency`

## Invariants (do not break)
1. There are no table write grants. Public writes go only through the exposed RPCs, and internal functions live in the `private` schema, which isn't exposed. Every table in every schema has RLS enabled.
2. Each region has one `site_settings` row, and the public sees only its active `(season, year)`. Pins from past seasons are hidden, never deleted.
3. Photos stay hidden until an admin approves them. The public UI never lists storage directly.
4. Deduplication happens in the database, through unique keys per `(region, season, year)`, never only in the client.
5. **Secrets**: only public values (the Supabase URL, the publishable key, the referrer-restricted Maps key) may appear in client code or `NEXT_PUBLIC_*`. Never commit a service-role key, a database password, or real `.env*` files. A sanitized `.env.example` with local-stack values only is allowed. Hosted values live in the host's env settings, never in the repo.
6. **No HTML strings built from data.** Render through React or `textContent`, never `innerHTML`.
7. Schema changes go through versioned migrations under `supabase/migrations/`. Don't make ad-hoc changes in the dashboard.
8. A new function needs an explicit `grant execute` on its exact signature and an update to the ACL allowlist test (`supabase/tests/01_acl.test.sql`).
9. `private` schema USAGE is **not** granted to API roles in R1. If a later release grants it for Storage policy helpers, the ACL test changes in the same PR.
10. Private-table protection: FORCE RLS is the intended variant. If the database work ships the restrictive-policy variant instead, note it here.

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
