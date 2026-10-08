// AC19: after the storage suite the runner must be back exactly as `storage-jobs-local.sh` left it.
// Fails CI if a file forgot to restore the cron job or the Vault values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql, sqlOne } from './_local.mjs';

test('cron job tl-storage-jobs is scheduled', async () => {
  assert.equal(Number(await sqlOne(`select count(*) from cron.job where jobname = 'tl-storage-jobs' and active`)), 1);
});

test('Vault runner secrets resolve to the local values (not the runner-down URL)', async () => {
  const m = Object.fromEntries((await sql(`select name, decrypted_secret from vault.decrypted_secrets
    where name in ('storage_api_url','storage_api_key')`)).map((r) => [r.name, r.decrypted_secret]));
  assert.ok(m.storage_api_url, 'storage_api_url missing');
  assert.ok(!/127\.0\.0\.1:9\b/.test(m.storage_api_url), `storage_api_url still points at the runner-down URL: ${m.storage_api_url}`);
  assert.ok(m.storage_api_key && m.storage_api_key.length > 10, 'storage_api_key missing');
});

test('tidy: photos stay closed on the shared local stack unless a developer opens them', async () => {
  // These suites open photos for Truckee/Testville; restore the fail-closed default. (db:reset also does.)
  await sql(`update public.site_settings set photos_open = false where region_id in (select id from public.regions where slug in ('truckee','testville'))`);
});
