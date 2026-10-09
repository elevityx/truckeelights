# Decision log

Technical decisions, what was considered, and why. Entries keep their original numbers so references stay stable; a few entries that don't affect contributors are not listed, which is why the numbering has gaps.

| # | Topic | Decision | Alternatives and why not |
| :-- | :--- | :--- | :--- |
| D1 | Front end | Next.js App Router with TypeScript, static export, all client components, `trailingSlash: true`. | Pages Router: would need a rewrite anyway. Server features: there is no server runtime on a static host. |
| D2 | Deep links | `/?house=<uuid>`. | `/house/[id]`: ids are created at runtime, so those pages can't be pre-rendered. |
| D3 | Map coordinates | Store the `place_id` plus a **user-confirmed** pin and address. Legacy rows were re-geocoded once with a public-domain geocoder at import. | Re-resolving `place_id` on every load: one lookup per pin per visit. A public-domain geocoder for live adds: no autocomplete and no browser-friendly access. |
| D4 | Writes | `security definer` RPCs only, with zero table write grants. | Direct INSERT with RLS: no server-derived season, no friendly duplicate result, awkward rate limits. |
| D5 | Bot defense | Lazy anonymous sign-in gated by a bot challenge, plus advisory-lock quotas counted from an append-only ledger. | Challenge only: it protects sessions, not inserts. Counting live rows: expiry or deletion would refund quota. A counter-per-window table: same guarantee, harder to inspect and test. |
| D6 | Admin model | An `admins` table, with checks requiring a non-anonymous session at AAL2 (password plus TOTP). | A role claim in the token: can go stale and is invisible in migrations. Password-only admin: phishing would give full control. |
| D7 | Theme source | Derived from the active season. | A separate `theme` column: two sources of truth. |
| D8 | House moderation | Post-moderation for houses, pre-moderation for photos. | Pre-moderating houses: an empty map and a heavy moderation load. |
| D9 | Photo pipeline | Two private buckets. Reserve, upload, confirm. The admin re-encodes and uploads under a fresh random name. Approve is one statement. Public reads use signed URLs authorized by the approved row. | A public bucket with copy-before-approve: publishes before the row says approved, at a URL the uploader knows, and can't be revoked. A public bucket with an approve-time random name: CDN caches would keep revoked images. A single private bucket without re-encoding: uploader-controlled bytes would be served. |
| D10 | Image variants | One JPEG of at most 1600 px, sized with CSS and lazy-loaded. | Server-side image transforms: an extra moving part for little gain. |
| D11 | House detail UI | A React sheet or side panel. | Map InfoWindows: injection and listener-cleanup problems. |
| D12 | Theme flash | A head script reads local storage (per region), else a date rule, and the app corrects it after settings load. | Build-time season: needs a build trigger and makes builds depend on the hosted database. |
| D13 | Environments | Contributors and CI use the **local stack** for every write test. Hosted submissions stay closed until deliberately opened. | Opening writes from preview builds against the live database: unbounded junk. |
| D14 | Public config | Public values are set in the host's environment settings. `.env.example` holds local-stack values only. | Committing hosted values: identifiers don't belong in a public repo. |
| D16 | Migration deploy | Migrations are applied to the hosted project by the maintainers after merge, and **expand before use** so old and new code both work during rollout. The seed file is never applied to hosted. | Running changes by hand with no trail in review. |
| D17 | Maps | Google Maps with Advanced Markers and a map ID per theme, behind a `MapAdapter`. | An open-source renderer: no good US address autocomplete. |
| D18 | Display fonts | Creepster (Halloween), Fraunces (Christmas), Atkinson Hyperlegible Next for body text. | Other horror and holiday display faces: harder to read at small sizes. |
| D20 | Settings scope | Season settings are per region. | Global settings: every city would switch on the same day. |
| D21 | Region geometry | Bounding-box columns, trigger-enforced, with a reserved GeoJSON column. | PostGIS: no benefit at this scale yet. |
| D22 | Region of a house | An explicit `region_id` from the route, checked against the region bounds. | Deriving it from coordinates: ambiguous where regions overlap. |
| D23 | Default region | `app_settings.default_region_id` is not null, with a trigger forbidding an inactive default. | A partial unique `is_default` flag: allows zero defaults. |
| D24 | Function exposure | Internal helpers live in a non-exposed `private` schema, with deny-by-default EXECUTE, exact-signature grants, and an ACL inventory test. | All functions in `public` with per-function revokes: one forgotten revoke exposes an RLS-bypassing function. |
| D25 | Hidden-row duplicates | A duplicate of a hidden house returns a `blocked` result without leaking the row, and an admin can release the house to free its keys. | A partial unique index on visible rows: unhiding could create two visible pins. Returning the hidden id: tells the visitor "already on the map" when nothing shows. |
| D26 | Revocation | Delete or rotate the stored object, driven by a database queue that is sent right after commit and retried on a schedule, with an admin fallback that works if the runner is down. | Relying on signed-URL expiry: the client chooses the lifetime. Deleting from the admin's browser only after the RPC: a closed tab leaves the object live. An RPC that returns signed URLs: not possible from SQL without a server, and it wouldn't stop direct signing. |
| D29 | Public photo reads | A small Edge Function (`photo-urls`) signs URLs only for approved photos of public houses, using a service-role-only database function to decide which paths qualify. | A storage read policy alone: storage RLS cannot express "approved only" together with signing, and it would leave the signing path open to any caller who can sign. An RPC that returns signed URLs: not possible from SQL without a server. |
