# Truckee Lights

A community map of the best holiday light displays in Truckee, CA. Halloween (Truckee Frights) and Christmas seasons, a map and a list view, and a way for neighbors to add a house. Next.js static site on Cloudflare Pages, Supabase for data.

## Quickstart

Prerequisites: Node (see `.nvmrc`), Docker, and the Supabase CLI.

```sh
nvm use && npm ci && npm run db:start && supabase db reset && cp .env.example .env.local
```

`npm run db:start` wraps `supabase start` with local-only auth defaults, so use it instead of calling `supabase start` directly. Paste the publishable key from `supabase status` into `.env.local`, then `npm run dev`.

No Maps key? The List view still works.

## Tests

- `npm test` (unit)
- `npm run db:test` (pgTAP, needs the local stack)
- `npm run test:concurrency` (needs the local stack)

## License

MIT
