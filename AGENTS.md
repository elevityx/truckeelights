# AGENTS.md: Truckee Lights

Rules for any AI agent (Claude Code, Codex, Cursor, Antigravity) working in this repo. `CLAUDE.md` points here. **Keep this file current**: any change to the stack, commands, data model, or deploy path updates this file in the same commit.

## What this is
truckeelights.com is a community map of decorated houses in Truckee, CA. It has two seasonal modes, **Christmas** (lights) and **Halloween**. Visitors add houses and photos. An admin back office picks the active season/theme and moderates photos.

## Status (2026-10-07): mid-migration
- **Current `main`** (legacy, Dec 2024): Next.js 15 Pages Router static export, Firebase (Firestore + Storage), and Google Maps, Christmas only.
- **In progress on `feat/seasonal-revival`**: move to Supabase, add the seasonal model and back office, upgrade dependencies, and redesign. Until that lands, treat the Firebase code as legacy and add no new Firebase usage.

## Stack
- Next.js static export (`output: 'export'`). There is no server runtime, so all data access is client-side through Supabase, and security comes **only** from Postgres RLS and constraints.
- Supabase: Postgres, Auth (an admin login, plus anonymous or bot-checked public writes), and Storage (photos).
- Google Maps JS API (key is referrer-restricted).
- Tailwind CSS.
- Hosting: Cloudflare Pages. DNS for truckeelights.com is on Cloudflare.

## Commands
```bash
nvm use            # Node version from .nvmrc
npm install
npm run dev        # local dev
npm run build      # static export to out/
```
Test, lint, and Supabase commands are added here as the revival lands.

## Invariants (do not break)
1. **The database enforces security, not the UI.** Every table has RLS enabled. The public role may only *create* rows, and only after validation. There is no public update or delete. Admin rights are checked inside RLS, never just in the client.
2. **Seasons**: every pin belongs to exactly one `(season, year)`. The public map shows only the active season, which is a single row in site settings that only admins can change. Pins from past seasons are hidden, never deleted.
3. **Photos stay hidden until an admin approves them.** The public UI never lists storage directly. It reads approved photo rows only.
4. **Deduplication happens in the database**, through a unique constraint, never only through a client-side check.
5. **Secrets**: only public values (the Supabase URL, the anon/publishable key, the referrer-restricted Maps key) may appear in client code or `NEXT_PUBLIC_*`. Never commit a service-role key, a database password, or `.env*` files.
6. **No HTML strings built from data.** Render through React or `textContent`, never `innerHTML`.
7. Schema changes go through versioned migrations under `supabase/migrations/`. Don't make ad-hoc changes in the dashboard.

## Workflow
This is a public, open-source repo, and outside contributors (and their agents) are welcome.
- **Every change goes through a pull request to `main`.** Never push to `main` directly. Keep PRs small and focused on one change, and fill in the PR template.
- **Agents must never deploy, run migrations against the hosted Supabase project, or touch production data.** Merging and deploying are maintainer-only, and happen through CI after review. Contributors develop against a local Supabase stack, never the hosted project.
- Don't ask for or use secrets. CI on fork PRs runs without secrets by design.
- Changes to RLS policies, auth, or storage rules need a test that proves the policy holds, and get extra review.
- Design docs for contributors live in `docs/` (architecture, data model, decision log). Update them when you change a design.
- Commit messages are imperative and describe one change each.
- License: MIT (see `LICENSE`). By contributing, you agree your contributions are MIT-licensed.
