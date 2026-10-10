// Subscribe v1 (C3): every auth email links to /auth/confirm/ with token_hash and shows the code. Never ConfirmationURL.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../supabase/templates/', import.meta.url));
const TYPES = { 'magic_link.html': 'email', 'confirmation.html': 'email', 'email_change.html': 'email_change', 'recovery.html': 'recovery' };

test('exactly the four auth templates exist', () => {
  assert.deepEqual(readdirSync(dir).sort(), Object.keys(TYPES).sort());
});

for (const [file, type] of Object.entries(TYPES)) {
  test(`${file} links to /auth/confirm/ with token_hash and type=${type}, shows the code`, () => {
    const html = readFileSync(dir + file, 'utf8');
    assert.ok(html.includes(`{{ .SiteURL }}/auth/confirm/?token_hash={{ .TokenHash }}&amp;type=${type}"`), 'confirm link');
    assert.ok(html.includes('{{ .Token }}'), 'shows the code');
    assert.ok(!html.includes('ConfirmationURL'), 'never ConfirmationURL');
    assert.ok(!/<script|javascript:|https?:\/\/(?!www\.w3\.org)/i.test(html), 'no scripts and no hard-coded hosts');
  });
}

test('config.toml wires the four templates and the three function entries', () => {
  const toml = readFileSync(fileURLToPath(new URL('../supabase/config.toml', import.meta.url)), 'utf8');
  for (const f of Object.keys(TYPES)) assert.ok(toml.includes(`./supabase/templates/${f}`), f);
  for (const fn of ['send-digest', 'unsubscribe', 'delete-account']) assert.ok(toml.includes(`[functions.${fn}]`), fn);
});

test('the digest cron migration holds no secret and is a no-op without Vault secrets', () => {
  const sql = readFileSync(fileURLToPath(new URL('../supabase/migrations/20261016000300_digest_cron.sql', import.meta.url)), 'utf8');
  assert.ok(/decrypted_secret[\s\S]*digest_function_url/.test(sql));
  assert.ok(/is null|coalesce\(v_url, ''\) = ''/.test(sql) && /return null/.test(sql));
  // The scheme appears (the URL must be exactly 'https://' || <project host> || path), but never a host: the host comes
  // from the storage_api_url Vault secret at run time.
  assert.ok(!/https?:\/\/[A-Za-z0-9]/.test(sql.replace(/--.*$/gm, '')), 'no URL host in code');
  assert.ok(/storage_api_url/.test(sql) && /digest_url_ok/.test(sql), 'the URL is checked against the project host');
});
