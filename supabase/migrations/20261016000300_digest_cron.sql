-- Subscribe v1: the digest schedule. pg_cron calls private.run_digest(), which posts to the `send-digest` Edge Function
-- through pg_net with a bearer secret read from Vault. Nothing here holds a secret or a URL.
-- If either Vault secret is missing, run_digest() does nothing, so this migration is safe to apply before the Edge Function,
-- the Resend key and the secrets exist (deploy order, C9). Names: `digest_function_url` (exactly
-- `<project URL>/functions/v1/send-digest`; anything else is refused by set_digest_secret and ignored by run_digest)
-- and `digest_cron_secret` (the same value as the function's DIGEST_CRON_SECRET).
--
-- The function only sends at the 18:xx Pacific slot, and pg_cron runs in UTC, so the job fires at 01:07 and 02:07 UTC;
-- whichever lands at 18:07 Pacific (PDT or PST) does the work and the other returns "not_due". Thursday adds the weekly run.

create function private.run_digest() returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'digest_function_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'digest_cron_secret';
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then return null; end if;   -- not configured: no-op
  if v_url !~ '^https?://[^/?#@]+/functions/v1/send-digest$' then return null; end if; -- only ever the digest function
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
end $$;

-- Idempotent Vault writer for the two digest secrets (update if present, else create).
create function private.set_digest_secret(p_name text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_name is null or p_name not in ('digest_function_url', 'digest_cron_secret') or p_value is null or p_value = '' then
    raise exception 'invalid_input' using errcode = '22023', detail = 'digest_secret'; end if;
  if p_name = 'digest_function_url' and p_value !~ '^https?://[^/?#@]+/functions/v1/send-digest$' then
    raise exception 'invalid_input' using errcode = '22023', detail = 'digest_function_url'; end if;
  select id into v_id from vault.secrets where name = p_name;
  if found then perform vault.update_secret(v_id, p_value);
  else perform vault.create_secret(p_value, p_name); end if;
end $$;

revoke execute on function private.run_digest() from public, anon, authenticated;
revoke execute on function private.set_digest_secret(text, text) from public, anon, authenticated;

select cron.schedule('tl-send-digest', '7 1,2 * * *', $$select private.run_digest()$$);
