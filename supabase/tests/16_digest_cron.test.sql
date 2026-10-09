-- Subscribe v1: the digest schedule (20261016000300_digest_cron.sql). The pg_cron job calls private.run_digest(),
-- which posts to the send-digest Edge Function only when both Vault secrets exist and the URL is exactly that
-- function; otherwise it is a no-op (safe to apply before the function and its secrets exist, C9).
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- Start from no digest secrets (a fresh local stack has none).
delete from vault.secrets where name in ('digest_function_url', 'digest_cron_secret');

select is((select schedule from cron.job where jobname = 'tl-send-digest'), '7 1,2 * * *', 'cron job tl-send-digest fires at 01:07 and 02:07 UTC');
select is((select command from cron.job where jobname = 'tl-send-digest'), 'select private.run_digest()', 'cron job calls private.run_digest()');

select set_config('t.q0', (select count(*)::text from net.http_request_queue), true);
select is(private.run_digest(), null, 'no Vault secrets -> run_digest is a no-op');
select is((select count(*)::text from net.http_request_queue), current_setting('t.q0'), 'no-op queues no HTTP request');

select private.set_digest_secret('digest_cron_secret', 'local-test-bearer');
select is(private.run_digest(), null, 'only the bearer set -> still a no-op');

select throws_ok($$select private.set_digest_secret('digest_function_url', 'https://fn.example.test/functions/v1/photo-urls')$$,
  '22023', 'invalid_input', 'set_digest_secret refuses a URL that is not the send-digest function');
select throws_ok($$select private.set_digest_secret('other_name', 'x')$$, '22023', 'invalid_input', 'set_digest_secret refuses other names');

-- A URL planted directly in Vault that is not send-digest is ignored too.
select vault.create_secret('https://evil.example.test/collect', 'digest_function_url');
select is(private.run_digest(), null, 'a Vault URL that is not send-digest -> no-op');
delete from vault.secrets where name = 'digest_function_url';

select private.set_digest_secret('digest_function_url', 'http://127.0.0.1:54321/functions/v1/send-digest');
select ok(private.run_digest() is not null, 'both secrets set -> run_digest queues a request');
select is((select url || '|' || (headers ->> 'Authorization') || '|' || method from net.http_request_queue order by id desc limit 1),
  'http://127.0.0.1:54321/functions/v1/send-digest|Bearer local-test-bearer|POST',
  'the request goes to send-digest with the Vault bearer');

select * from finish();
rollback;
