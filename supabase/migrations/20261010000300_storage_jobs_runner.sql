-- Release 2: the storage-jobs runner (pg_net dispatch, verified completion) under the global lock order:
--   pg_advisory_xact_lock(photo key) -> public.photos row -> private.storage_jobs rows.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- The per-photo advisory lock key. Every photo-touching path takes this before the photos row.
create function private.photo_lock_key(p_photo_id uuid) returns bigint
language sql immutable set search_path = '' as $$
  select hashtextextended('photo:' || p_photo_id::text, 0)
$$;

create function private.lock_photo(p_photo_id uuid) returns void
language sql security definer set search_path = '' as $$
  select pg_advisory_xact_lock(private.photo_lock_key(p_photo_id))
$$;

create function private.enqueue_storage_job(p_kind text, p_bucket text, p_object text, p_new text,
                                            p_photo_id uuid, p_region_id uuid) returns bigint
language sql security definer set search_path = '' as $$
  insert into private.storage_jobs (kind, bucket, object_name, new_object_name, photo_id, region_id)
  values (p_kind, p_bucket, p_object, p_new, p_photo_id, p_region_id) returning id
$$;

create function private.storage_object_exists(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from storage.objects o where o.bucket_id = p_bucket and o.name = p_name)
$$;

-- Retry delay. Revocation kinds never back off past the 30 s cron cadence; upload deletes may grow to 10 min.
create function private.storage_job_backoff(p_kind text, p_attempts integer) returns interval
language sql immutable set search_path = '' as $$
  select case when p_kind in ('delete_public', 'rotate_public') then interval '20 seconds'
              else make_interval(secs => least(15 * (greatest(p_attempts, 0) + 1), 600)) end
$$;

-- Done means: the old name is gone (and, for rotate, finish_storage_job decides the outcome). Never trust HTTP.
create function private.storage_job_satisfied(p_job_id bigint) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare j private.storage_jobs%rowtype;
begin
  select * into j from private.storage_jobs where id = p_job_id;
  if not found then return false; end if;
  return not private.storage_object_exists(j.bucket, j.object_name);
end $$;

-- Lock order: photo advisory lock (re-entrant if the caller holds it) -> photos row -> job row.
create function private.finish_storage_job(p_job_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_photo uuid; j private.storage_jobs%rowtype;
begin
  select photo_id into v_photo from private.storage_jobs where id = p_job_id;
  if not found then return; end if;
  if v_photo is not null then
    perform private.lock_photo(v_photo);
    perform 1 from public.photos where id = v_photo for update;
  end if;
  select * into j from private.storage_jobs where id = p_job_id for update;
  if not found or j.done_at is not null then return; end if;
  if j.kind = 'rotate_public' then
    if private.storage_object_exists('photos', j.new_object_name) then
      update public.photos set public_path = j.new_object_name, public_rotated_at = now()
       where id = j.photo_id and status = 'approved' and public_path = j.object_name;
    else   -- both names missing: the object is lost; fail closed
      update public.photos set status = 'revoked', public_path = null, moderated_at = now()
       where id = j.photo_id and status = 'approved' and public_path = j.object_name;
      update private.storage_jobs set last_error = 'object_missing' where id = j.id;
    end if;
  end if;
  update private.storage_jobs set done_at = now() where id = j.id;
end $$;

-- Candidates are picked without row locks. Per job: try the photo advisory lock (skip if busy), then lock the
-- job row with SKIP LOCKED, then finish (which updates photos). pg_net sends requests after commit.
create function private.run_storage_jobs(p_limit integer, p_photo_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_ids bigint[]; v_id bigint; j private.storage_jobs%rowtype; v_url text; v_key text; v_rid bigint;
  v_n integer := 0; v_status integer; v_err text; v_hdr jsonb;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'storage_api_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'storage_api_key';
  v_hdr := jsonb_build_object('apikey', v_key, 'Authorization', 'Bearer ' || v_key);
  select coalesce(array_agg(s.id order by s.id), '{}') into v_ids
    from (select id from private.storage_jobs
           where done_at is null
             -- due for a retry, or already satisfied (finish it now instead of waiting out the retry delay)
             and (next_attempt_at <= now() or not private.storage_object_exists(bucket, object_name))
             and (p_photo_id is null or photo_id = p_photo_id)
           order by id limit greatest(coalesce(p_limit, 0), 0)) s;
  foreach v_id in array v_ids loop
    select * into j from private.storage_jobs where id = v_id;
    if not found or j.done_at is not null then continue; end if;
    if j.photo_id is not null and not pg_try_advisory_xact_lock(private.photo_lock_key(j.photo_id)) then
      continue;                                              -- someone else is working on this photo
    end if;
    select * into j from private.storage_jobs where id = v_id and done_at is null for update skip locked;
    if not found then continue; end if;
    if j.last_request_id is not null then
      select r.status_code, r.error_msg into v_status, v_err from net._http_response r where r.id = j.last_request_id;
      if found and (v_status is null or v_status >= 300) then
        update private.storage_jobs set last_error = coalesce(v_err, 'http ' || v_status) where id = j.id;
      end if;
    end if;
    if private.storage_job_satisfied(j.id) then
      perform private.finish_storage_job(j.id); v_n := v_n + 1; continue;
    end if;
    if v_url is null or v_key is null then
      update private.storage_jobs set attempts = attempts + 1, last_error = 'runner_not_configured',
             next_attempt_at = now() + private.storage_job_backoff(j.kind, j.attempts) where id = j.id;
      continue;
    end if;
    if j.kind = 'rotate_public' then
      v_rid := net.http_post(url := v_url || '/storage/v1/object/move',
                 body := jsonb_build_object('bucketId', 'photos', 'sourceKey', j.object_name, 'destinationKey', j.new_object_name),
                 headers := v_hdr || jsonb_build_object('Content-Type', 'application/json'));
    else
      v_rid := net.http_delete(url := v_url || '/storage/v1/object/' || j.bucket || '/' || j.object_name, headers := v_hdr);
    end if;
    update private.storage_jobs
       set attempts = attempts + 1, last_request_id = v_rid,
           next_attempt_at = now() + private.storage_job_backoff(j.kind, j.attempts)
     where id = j.id;
  end loop;
  return v_n;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.photo_upload_allowed(text)   to authenticated;
grant execute on function private.storage_admin_ok(text, text) to authenticated;
