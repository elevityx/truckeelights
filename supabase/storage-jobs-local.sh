#!/bin/sh
# LOCAL ONLY. Point the storage-jobs runner at the local Storage API and schedule it.
# Run after every `supabase db reset` (Vault lives in the database); `npm run db:reset` does it for you.
# Idempotent: set_runner_secret updates-or-creates, set_storage_runner re-schedules by name.
# No secret ever appears in a process argv: the SQL goes through a 0600 file in a private temp dir,
# and node gets only file paths as arguments.
set -eu
umask 077
D="$(mktemp -d)"; trap 'rm -rf "$D"' EXIT
supabase status -o json > "$D/status.json" 2>/dev/null
node -e '
  const fs = require("fs"); const raw = fs.readFileSync(process.argv[1], "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(j.API_URL || "")) { console.error("refusing: not a local stack"); process.exit(1); }
  const key = j.SECRET_KEY || j.SERVICE_ROLE_KEY;
  if (!key) { console.error("no local secret key in supabase status"); process.exit(1); }
  const url = process.env.TL_STORAGE_INTERNAL_URL || "http://supabase_kong_truckeelights:8000";
  const q = (v) => { if (v.includes("$tl$")) { console.error("unexpected value"); process.exit(1); } return "$tl$" + v + "$tl$"; };
  // One command (db query runs a single prepared statement): a DO block.
  fs.writeFileSync(process.argv[2],
    "do $do$ begin\n" +
    `  perform private.set_runner_secret(${q("storage_api_url")}, ${q(url)});\n` +
    `  perform private.set_runner_secret(${q("storage_api_key")}, ${q(key)});\n` +
    "  perform private.set_storage_runner(true);\nend $do$;\n", { mode: 0o600 });
' "$D/status.json" "$D/q.sql"
supabase db query --local -f "$D/q.sql" >/dev/null
echo "storage-jobs runner configured for the local stack"
