-- Subscribe v1: the digest schedule (20261016000300_digest_cron.sql). The pg_cron job calls private.run_digest(),
-- which posts to the send-digest Edge Function only when both Vault secrets exist and the URL is EXACTLY
-- https://<project host>/functions/v1/send-digest, the host coming from the separately trusted `storage_api_url` Vault
-- secret; otherwise it is a no-op (safe to apply before the function and its secrets exist, C9).
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- Start from no digest secrets (a fresh local stack has none) and a known project URL (rolled back at the end).
delete from vault.secrets where name in ('digest_function_url', 'digest_cron_secret');
select private.set_runner_secret('storage_api_url', 'https://abcdefghijklmnop.supabase.test');

select is((select schedule from cron.job where jobname = 'tl-send-digest'), '7-57/10 1-3 * * *',
  'cron job tl-send-digest fires every 10 minutes 01:07-03:57 UTC (18:07-19:57 Pacific in PDT and PST)');
select is((select command from cron.job where jobname = 'tl-send-digest'), 'select private.run_digest()', 'cron job calls private.run_digest()');

select is(private.digest_project_host(), 'abcdefghijklmnop.supabase.test', 'project host comes from storage_api_url');
select ok(private.digest_url_ok('https://abcdefghijklmnop.supabase.test/functions/v1/send-digest'), 'the exact function URL is accepted');

-- Hostile or malformed digest URLs: every one is refused by digest_url_ok (and so by set_digest_secret and run_digest).
create temp table hostile (u text);
insert into hostile values
  ('https://attacker.example/functions/v1/send-digest'),                                   -- other host, same path
  ('http://abcdefghijklmnop.supabase.test/functions/v1/send-digest'),                      -- not https
  ('https://abcdefghijklmnop.supabase.test:8443/functions/v1/send-digest'),                -- port
  ('https://user@abcdefghijklmnop.supabase.test/functions/v1/send-digest'),                -- userinfo
  ('https://abcdefghijklmnop.supabase.test@attacker.example/functions/v1/send-digest'),    -- userinfo trick
  ('https://abcdefghijklmnop.supabase.test.attacker.example/functions/v1/send-digest'),    -- host suffix
  ('https://evil-abcdefghijklmnop.supabase.test/functions/v1/send-digest'),                -- host prefix
  ('https://ABCDEFGHIJKLMNOP.supabase.test/functions/v1/send-digest'),                     -- not the exact host string
  ('https://abcdefghijklmnop.supabase.test/functions/v1/send-digest/'),                    -- path suffix
  ('https://abcdefghijklmnop.supabase.test/functions/v1/send-digest?x=1'),                 -- query
  ('https://abcdefghijklmnop.supabase.test/functions/v1/send-digest#f'),                   -- fragment
  ('https://abcdefghijklmnop.supabase.test/x/functions/v1/send-digest'),                   -- path prefix
  ('https://abcdefghijklmnop.supabase.test/functions/v1/photo-urls'),                      -- other function
  (' https://abcdefghijklmnop.supabase.test/functions/v1/send-digest'),                    -- leading space
  ('https://abcdefghijklmnop.supabase.test/functions/v1/send-digest%2F..%2Fphoto-urls');   -- encoded path
select is((select count(*)::int from hostile where private.digest_url_ok(u)), 0, 'digest_url_ok rejects all 15 hostile URLs');

select throws_ok($$select private.set_digest_secret('digest_function_url', 'https://attacker.example/functions/v1/send-digest')$$,
  '22023', 'invalid_input', 'set_digest_secret refuses another host with the same path');
select throws_ok($$select private.set_digest_secret('digest_function_url', 'http://abcdefghijklmnop.supabase.test/functions/v1/send-digest')$$,
  '22023', 'invalid_input', 'set_digest_secret refuses http');
select throws_ok($$select private.set_digest_secret('digest_function_url', 'https://abcdefghijklmnop.supabase.test:8443/functions/v1/send-digest')$$,
  '22023', 'invalid_input', 'set_digest_secret refuses a port');
select throws_ok($$select private.set_digest_secret('digest_function_url', 'https://user@abcdefghijklmnop.supabase.test/functions/v1/send-digest')$$,
  '22023', 'invalid_input', 'set_digest_secret refuses userinfo');
select throws_ok($$select private.set_digest_secret('digest_function_url', 'https://abcdefghijklmnop.supabase.test@attacker.example/functions/v1/send-digest')$$,
  '22023', 'invalid_input', 'set_digest_secret refuses a userinfo trick');
select throws_ok($$select private.set_digest_secret('digest_function_url', 'https://abcdefghijklmnop.supabase.test.attacker.example/functions/v1/send-digest')$$,
  '22023', 'invalid_input', 'set_digest_secret refuses a host suffix');
select throws_ok($$select private.set_digest_secret('digest_function_url', 'https://evil-abcdefghijklmnop.supabase.test/functions/v1/send-digest')$$,
  '22023', 'invalid_input', 'set_digest_secret refuses a host prefix');
select throws_ok($$select private.set_digest_secret('digest_function_url', 'https://abcdefghijklmnop.supabase.test/functions/v1/send-digest/')$$,
  '22023', 'invalid_input', 'set_digest_secret refuses a path suffix');
select throws_ok($$select private.set_digest_secret('digest_function_url', 'https://abcdefghijklmnop.supabase.test/functions/v1/send-digest?x=1')$$,
  '22023', 'invalid_input', 'set_digest_secret refuses a query');
select throws_ok($$select private.set_digest_secret('digest_function_url', 'https://abcdefghijklmnop.supabase.test/x/functions/v1/send-digest')$$,
  '22023', 'invalid_input', 'set_digest_secret refuses a path prefix');
select throws_ok($$select private.set_digest_secret('digest_function_url', 'https://abcdefghijklmnop.supabase.test/functions/v1/photo-urls')$$,
  '22023', 'invalid_input', 'set_digest_secret refuses another function');
select throws_ok($$select private.set_digest_secret('other_name', 'x')$$, '22023', 'invalid_input', 'set_digest_secret refuses other names');

select set_config('t.q0', (select count(*)::text from net.http_request_queue), true);
select is(private.run_digest(), null, 'no Vault secrets -> run_digest is a no-op');
select private.set_digest_secret('digest_cron_secret', 'local-test-bearer');
select is(private.run_digest(), null, 'only the bearer set -> still a no-op');

-- URLs planted directly in Vault (bypassing set_digest_secret) are ignored by run_digest.
select vault.create_secret('https://attacker.example/functions/v1/send-digest', 'digest_function_url');
select is(private.run_digest(), null, 'a planted URL on another host -> no-op');
select vault.update_secret((select id from vault.secrets where name = 'digest_function_url'),
  'https://abcdefghijklmnop.supabase.test@attacker.example/functions/v1/send-digest');
select is(private.run_digest(), null, 'a planted userinfo-trick URL -> no-op');
select vault.update_secret((select id from vault.secrets where name = 'digest_function_url'),
  'https://abcdefghijklmnop.supabase.test:444/functions/v1/send-digest');
select is(private.run_digest(), null, 'a planted URL with a port -> no-op');
select vault.update_secret((select id from vault.secrets where name = 'digest_function_url'),
  'https://abcdefghijklmnop.supabase.test/functions/v1/send-digest-x');
select is(private.run_digest(), null, 'a planted URL with a path suffix -> no-op');
select is((select count(*)::text from net.http_request_queue), current_setting('t.q0'), 'no request was queued by any no-op');
delete from vault.secrets where name = 'digest_function_url';

-- The real URL works.
select private.set_digest_secret('digest_function_url', 'https://abcdefghijklmnop.supabase.test/functions/v1/send-digest');
select ok(private.run_digest() is not null, 'both secrets set, exact URL -> run_digest queues a request');
select is((select url || '|' || (headers ->> 'Authorization') || '|' || method from net.http_request_queue order by id desc limit 1),
  'https://abcdefghijklmnop.supabase.test/functions/v1/send-digest|Bearer local-test-bearer|POST',
  'the request goes to send-digest with the Vault bearer');

-- The project host itself must be a plain https origin; otherwise there is no host and nothing is ever posted.
select private.set_runner_secret('storage_api_url', 'http://supabase_kong_truckeelights:8000');
select is(private.digest_project_host(), null, 'an http/port storage_api_url gives no project host');
select ok(not private.digest_url_ok('https://abcdefghijklmnop.supabase.test/functions/v1/send-digest'), '... so even the formerly exact URL is refused');
select is(private.run_digest(), null, '... and run_digest is a no-op');
select private.set_runner_secret('storage_api_url', 'https://user@abcdefghijklmnop.supabase.test');
select is(private.digest_project_host(), null, 'a storage_api_url with userinfo gives no project host');
select private.set_runner_secret('storage_api_url', 'https://abcdefghijklmnop.supabase.test:8443');
select is(private.digest_project_host(), null, 'a storage_api_url with a port gives no project host');
select private.set_runner_secret('storage_api_url', 'https://abcdefghijklmnop.supabase.test/');
select is(private.digest_project_host(), 'abcdefghijklmnop.supabase.test', 'a trailing slash on storage_api_url is fine');
delete from vault.secrets where name = 'storage_api_url';
select is(private.digest_project_host(), null, 'no storage_api_url -> no project host');
select is(private.run_digest(), null, '... and run_digest is a no-op');

-- No API role can call any of these.
select ok(not has_function_privilege('authenticated', 'private.run_digest()', 'EXECUTE')
          and not has_function_privilege('anon', 'private.set_digest_secret(text, text)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'private.digest_url_ok(text)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'private.digest_project_host()', 'EXECUTE'),
  'run_digest / set_digest_secret / digest_url_ok / digest_project_host have no API EXECUTE');

select * from finish();
rollback;
