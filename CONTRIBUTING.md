# Contributing to Truckee Lights

Thanks for helping. This is a small, public, open-source project, and outside contributors (and their AI agents) are welcome.

## Prerequisites

- Node, at the version in [`.nvmrc`](.nvmrc)
- Docker
- Supabase CLI 2.109 or newer

## Local quickstart

```sh
nvm use && npm ci && npm run db:start && supabase db reset && cp .env.example .env.local
```

`npm run db:start` wraps `supabase start` with local-only auth defaults, so use it instead of calling `supabase start` directly. Paste the publishable key from `supabase status` into `.env.local`, then run `npm run dev`.

No Maps key? The List view still works.

You develop against the **local** Supabase stack only. Never point your checkout at a hosted project, and never ask for or use someone else's secrets. CI on fork pull requests runs without secrets by design.

## Tests and checks

| Command | What it covers |
| :--- | :--- |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm test` | Unit tests (Vitest) |
| `npm run build` | Static export to `out/` |
| `npm run db:test` | pgTAP database tests (needs the local stack) |
| `npm run test:concurrency` | Concurrency tests against the local stack |

Run lint, typecheck, unit tests, and build before you open a pull request. Run the database tests whenever you touch `supabase/`.

## Rules

- **Migrations only.** Schema changes go through new files in `supabase/migrations/`. Never edit a migration that has been merged.
- **Every new function needs an explicit `grant execute`** on its exact signature, and an update to the ACL allowlist test in `supabase/tests`.
- **RLS, auth, and Storage changes need pgTAP proof** that the policy holds, and get extra review.
- **No secrets.** Only public values (the Supabase URL, the publishable key, a referrer-restricted Maps key) may appear in client code. Never commit service keys, database passwords, or real `.env*` files.
- **Nothing private** in code, commits, or pull request descriptions: no keys, project identifiers, or internal plans.
- **Small pull requests to `main`.** Every change goes through a pull request, one focused change each. Commit messages are imperative and describe one change.
- **Keep docs current.** If you change the stack, commands, data model, or CI, update [`AGENTS.md`](AGENTS.md) and the relevant file in [`docs/`](docs/) in the same pull request.
- Merging and deploying are maintainer-only.

## Working with AI agents

Agents read [`AGENTS.md`](AGENTS.md) (`CLAUDE.md` points to it). It holds the invariants that must not be broken. If you use an agent, you are responsible for what it submits.

## Design docs

- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Decision log](docs/DECISIONS.md)

## Reporting security issues

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the project's [MIT License](LICENSE).
