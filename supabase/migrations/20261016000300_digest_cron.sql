-- Subscribe v1: the digest schedule. pg_cron calls private.run_digest(), which posts to the `send-digest` Edge Function
-- through pg_net with a bearer secret read from Vault. Nothing here holds a secret or a URL.
-- If either Vault secret is missing, run_digest() does nothing, so this migration is safe to apply before the Edge Function,
-- the Resend key and the secrets exist (deploy order, C9). Names: `digest_function_url` and `digest_cron_secret` (the
-- same value as the function's DIGEST_CRON_SECRET).
--
-- The URL is accepted only when it is EXACTLY https://<project host>/functions/v1/send-digest, where <project host> comes
-- from a different, already-trusted setting: the host of the Vault secret `storage_api_url` (the project URL the
-- storage-jobs runner already sends the service key to, e.g. https://<ref>.supabase.co). Exact string equality rules out
-- other hosts, userinfo (`user@host`), ports, extra path segments, prefixes/suffixes, query strings and fragments. With
-- no valid `storage_api_url` there is no project host and the digest is never posted anywhere.
--
-- Schedule (bounded worker): every 10 minutes from 18:07 to 19:57 Pacific. pg_cron runs in UTC, so the job covers both
-- offsets: 01:07-02:57 UTC is 18:07-19:57 PDT, and 02:07-03:57 UTC is 18:07-19:57 PST. The function's Pacific-slot
-- guard (18:xx or 19:xx) turns the other fires into no-ops ("not_due"). Each fire sends for at most ~40 s and a fixed
-- batch, then returns; unfinished rows resume on the next tick with their stored idempotency keys.

-- The project host from storage_api_url: lowercase DNS labels only (no scheme other than https, no port, no userinfo,
-- no path beyond an optional trailing slash). Null when it is missing or not of that shape.
create function private.digest_project_host() returns text
language sql stable set search_path = '' as $$
  select substring(s.decrypted_secret from '^https://([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)/?$')
    from vault.decrypted_secrets s where s.name = 'storage_api_url'
$$;

-- True only for exactly https://<project host>/functions/v1/send-digest.
create function private.digest_url_ok(p_url text) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(p_url = 'https://' || private.digest_project_host() || '/functions/v1/send-digest', false)
$$;

create function private.run_digest() returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'digest_function_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'digest_cron_secret';
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then return null; end if;   -- not configured: no-op
  if not private.digest_url_ok(v_url) then return null; end if;                        -- only ever this project's function
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000);   -- the function stops sending at ~40 s and returns
end $$;

-- Idempotent Vault writer for the two digest secrets (update if present, else create).
create function private.set_digest_secret(p_name text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_name is null or p_name not in ('digest_function_url', 'digest_cron_secret') or p_value is null or p_value = '' then
    raise exception 'invalid_input' using errcode = '22023', detail = 'digest_secret'; end if;
  if p_name = 'digest_function_url' and not private.digest_url_ok(p_value) then
    raise exception 'invalid_input' using errcode = '22023', detail = 'digest_function_url'; end if;
  select id into v_id from vault.secrets where name = p_name;
  if found then perform vault.update_secret(v_id, p_value);
  else perform vault.create_secret(p_value, p_name); end if;
end $$;

revoke execute on function private.digest_project_host() from public, anon, authenticated;
revoke execute on function private.digest_url_ok(text) from public, anon, authenticated;
revoke execute on function private.run_digest() from public, anon, authenticated;
revoke execute on function private.set_digest_secret(text, text) from public, anon, authenticated;

select cron.schedule('tl-send-digest', '7-57/10 1-3 * * *', $$select private.run_digest()$$);
