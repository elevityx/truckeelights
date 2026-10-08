-- Release 2: photo quota, reserve/confirm, admin moderation RPCs, and the R1 admin RPCs replaced so that
-- every state change that ends public reads of a photo enqueues its storage job in the same transaction.
-- Global lock order (all photo paths): quota locks (uid -> region -> house, confirm only) ->
--   pg_advisory_xact_lock(photo key) -> public.photos row -> private.storage_jobs rows. Multi-photo paths go in id order.

-- take_quota: same contract as R1, adds the house lock (uid -> region -> house) and photo_reserve.
create or replace function private.take_quota(p_kind text, p_region_id uuid, p_house_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_n integer;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_kind || ':uid:' || v_uid::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_kind || ':region:' || p_region_id::text, 0));
  if p_house_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_kind || ':house:' || p_house_id::text, 0));
  end if;
  if p_kind = 'house' then
    select count(*) into v_n from private.quota_events where kind = 'house' and uid = v_uid and created_at > now() - interval '1 hour';
    if v_n >= 5 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'uid_hourly'; end if;
    select count(*) into v_n from private.quota_events where kind = 'house' and region_id = p_region_id and created_at > now() - interval '10 minutes';
    if v_n >= 60 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'region_breaker'; end if;
  elsif p_kind = 'photo_reserve' then
    select count(*) into v_n from private.quota_events where kind = 'photo_reserve' and uid = v_uid and created_at > now() - interval '1 hour';
    if v_n >= 10 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'uid_hourly'; end if;
    -- "outstanding" is counted from LIVE rows under the uid lock, not from the ledger
    select count(*) into v_n from public.photos where created_by = v_uid and status = 'reserved' and reserved_until > now();
    if v_n >= 3 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'outstanding'; end if;
    select count(*) into v_n from private.quota_events where kind = 'photo_reserve' and region_id = p_region_id and created_at > now() - interval '1 hour';
    if v_n >= 200 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'region_breaker'; end if;
  else
    raise exception 'invalid_input' using errcode = '22023', detail = 'quota_kind';
  end if;
  insert into private.quota_events (kind, uid, region_id, house_id) values (p_kind, v_uid, p_region_id, p_house_id);
end $$;

-- ---------------------------------------------------------------- job helpers (caller holds the photo lock)
-- Revocation by delete: supersede any open rotate for the photo, then delete the old name and every queued destination.
create function private.enqueue_delete_public(p_photo_id uuid, p_path text, p_region_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_new text; v_n integer := 0;
begin
  perform private.lock_photo(p_photo_id);                     -- re-entrant; keeps the lock order for direct callers
  if p_path is not null then
    perform private.enqueue_storage_job('delete_public', 'photos', p_path, null, p_photo_id, p_region_id);
    v_n := v_n + 1;
  end if;
  for v_new in
    update private.storage_jobs set done_at = now(), last_error = 'superseded'
     where photo_id = p_photo_id and kind = 'rotate_public' and done_at is null
    returning new_object_name
  loop
    perform private.enqueue_storage_job('delete_public', 'photos', v_new, null, p_photo_id, p_region_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Revocation by rotation: move the object to a fresh random name in the same house folder. An open rotate for the
-- photo already moves the current name away (its destination was never public), so a second one is not queued.
create function private.enqueue_rotate(p_photo_id uuid, p_path text, p_house_id uuid, p_region_id uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.storage_jobs
              where photo_id = p_photo_id and kind = 'rotate_public' and done_at is null) then
    return null;
  end if;
  return private.enqueue_storage_job('rotate_public', 'photos', p_path,
           p_house_id::text || '/' || gen_random_uuid()::text || '.jpg', p_photo_id, p_region_id);
end $$;

-- Rotate every approved photo of the given houses (id order, lock order). Returns the number of photos locked.
create function private.rotate_house_photos(p_house_ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; p public.photos%rowtype; v_n integer := 0;
begin
  for r in select ph.id, h.region_id from public.photos ph join public.houses h on h.id = ph.house_id
            where ph.house_id = any(p_house_ids) and ph.status = 'approved' order by ph.id loop
    perform private.lock_photo(r.id);
    select * into p from public.photos where id = r.id for update;
    if found and p.status = 'approved' then
      perform private.enqueue_rotate(p.id, p.public_path, p.house_id, r.region_id);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- Photo row + its house's region, for admin RPCs. Not found -> not_found for global admins, else forbidden.
create function private.admin_photo_region(p_photo_id uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_region uuid;
begin
  select h.region_id into v_region from public.photos p join public.houses h on h.id = p.house_id where p.id = p_photo_id;
  if not found then
    if private.is_admin(null) then raise exception 'not_found' using errcode = 'P0002';
    else raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  if not private.is_admin(v_region) then raise exception 'forbidden' using errcode = '42501'; end if;
  return v_region;
end $$;

-- ---------------------------------------------------------------- visitor RPCs
create function public.reserve_photo(p_house_id uuid) returns table (photo_id uuid, upload_path text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_region uuid; v_set public.site_settings%rowtype; v_id uuid := gen_random_uuid(); v_path text;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  select h.region_id into v_region from public.houses h where h.id = p_house_id;
  if not found or not private.house_is_public(p_house_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into v_set from public.site_settings where region_id = v_region;
  if not coalesce(v_set.submissions_open, false) then raise exception 'submissions_closed' using errcode = 'P0001'; end if;
  if not coalesce(v_set.photos_open, false) then raise exception 'photos_closed' using errcode = 'P0001'; end if;
  perform private.take_quota('photo_reserve', v_region, p_house_id);
  v_path := p_house_id::text || '/' || v_id::text || '.jpg';
  insert into public.photos (id, house_id, upload_path, status, reserved_until, created_by)
  values (v_id, p_house_id, v_path, 'reserved', now() + interval '15 minutes', v_uid);
  return query select v_id, v_path;
end $$;

-- An over-cap confirm COMMITS expired + delete_upload and returns 'over_cap' (no raise).
create function public.confirm_photo_upload(p_photo_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); p public.photos%rowtype; v_region uuid;
        v_house_pending integer; v_region_confirms integer;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  select * into p from public.photos where id = p_photo_id and created_by = v_uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select region_id into v_region from public.houses where id = p.house_id;
  -- lock order: quota (uid -> region -> house) -> photo advisory -> photo row
  perform pg_advisory_xact_lock(hashtextextended('photo_confirm:uid:' || v_uid::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('photo_confirm:region:' || v_region::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('photo_confirm:house:' || p.house_id::text, 0));
  perform private.lock_photo(p.id);
  select * into p from public.photos where id = p_photo_id for update;
  if p.status <> 'reserved' or p.reserved_until <= now() then raise exception 'photo_expired' using errcode = 'P0001'; end if;
  if not private.storage_object_exists('photo-uploads', p.upload_path) then
    raise exception 'upload_missing' using errcode = 'P0001'; end if;
  select count(*) into v_house_pending from public.photos where house_id = p.house_id and status = 'pending';
  select count(*) into v_region_confirms from private.quota_events
   where kind = 'photo_confirm' and region_id = v_region and created_at > now() - interval '1 hour';
  if v_house_pending >= 20 or v_region_confirms >= 100 then
    update public.photos set status = 'expired' where id = p.id;
    perform private.enqueue_storage_job('delete_upload', 'photo-uploads', p.upload_path, null, p.id, v_region);
    perform private.run_storage_jobs(5, p.id);
    return 'over_cap';
  end if;
  insert into private.quota_events (kind, uid, region_id, house_id) values ('photo_confirm', v_uid, v_region, p.house_id);
  update public.photos set status = 'pending' where id = p.id;
  return 'pending';
end $$;

-- ---------------------------------------------------------------- admin photo RPCs (AAL2 admin of the row's region)
create function public.admin_photo_queue(p_region_id uuid, p_status text)
returns table (id uuid, house_id uuid, address text, status text, upload_path text, public_path text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.is_admin(p_region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('pending', 'approved') then
    raise exception 'invalid_input' using errcode = '22023'; end if;
  return query
    select p.id, p.house_id, h.address, p.status::text,
           case when p.status = 'pending' then p.upload_path end,
           case when p.status = 'approved' then p.public_path end,
           p.created_at
      from public.photos p
      join public.houses h on h.id = p.house_id
      join public.site_settings s on s.region_id = h.region_id
     where h.region_id = p_region_id and h.season = s.active_season and h.year = s.active_year
       and p.status = p_status::public.photo_status
     order by case when p_status = 'pending' then extract(epoch from p.created_at) else -extract(epoch from p.created_at) end, p.id
     limit 200;
end $$;

create function public.admin_approve_photo(p_photo_id uuid, p_public_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_region uuid; p public.photos%rowtype;
begin
  v_region := private.admin_photo_region(p_photo_id);
  perform private.lock_photo(p_photo_id);
  select * into p from public.photos where id = p_photo_id for update;
  if p.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;
  if p_public_path is null or private.path_house_id(p_public_path) is distinct from p.house_id then
    raise exception 'invalid_input' using errcode = '22023', detail = 'public_path'; end if;
  if not private.storage_object_exists('photos', p_public_path) then
    raise exception 'upload_missing' using errcode = 'P0001'; end if;
  update public.photos
     set status = 'approved', public_path = p_public_path, moderated_by = auth.uid(), moderated_at = now()
   where id = p.id;
  perform private.enqueue_storage_job('delete_upload', 'photo-uploads', p.upload_path, null, p.id, v_region);
  perform private.run_storage_jobs(5, p.id);
end $$;

create function public.admin_reject_photo(p_photo_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_region uuid; p public.photos%rowtype;
begin
  v_region := private.admin_photo_region(p_photo_id);
  perform private.lock_photo(p_photo_id);
  select * into p from public.photos where id = p_photo_id for update;
  if p.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;
  update public.photos set status = 'rejected', moderated_by = auth.uid(), moderated_at = now() where id = p.id;
  perform private.enqueue_storage_job('delete_upload', 'photo-uploads', p.upload_path, null, p.id, v_region);
  perform private.run_storage_jobs(5, p.id);
end $$;

create function public.admin_revoke_photo(p_photo_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_region uuid; p public.photos%rowtype;
begin
  v_region := private.admin_photo_region(p_photo_id);
  perform private.lock_photo(p_photo_id);
  select * into p from public.photos where id = p_photo_id for update;
  if p.status <> 'approved' then raise exception 'not_approved' using errcode = 'P0001'; end if;
  update public.photos set status = 'revoked', public_path = null, moderated_by = auth.uid(), moderated_at = now()
   where id = p.id;
  perform private.enqueue_delete_public(p.id, p.public_path, v_region);
  perform private.run_storage_jobs(5, p.id);
end $$;

create function public.admin_set_photos_open(p_region_id uuid, p_open boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin(p_region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_open is null then raise exception 'invalid_input' using errcode = '22023'; end if;
  update public.site_settings set photos_open = p_open, updated_at = now(), updated_by = auth.uid()
   where region_id = p_region_id;
  if not found then raise exception 'region_not_found' using errcode = 'P0002'; end if;
end $$;

create function public.admin_storage_jobs(p_region_id uuid)
returns table (id bigint, kind text, bucket text, object_name text, new_object_name text, attempts integer,
               last_error text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_global boolean;
begin
  if not private.is_admin(p_region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_global := private.is_admin(null);
  return query
    select j.id, j.kind, j.bucket, j.object_name, j.new_object_name, j.attempts, j.last_error, j.created_at
      from private.storage_jobs j
     where j.done_at is null and (j.region_id = p_region_id or (j.region_id is null and v_global))
     order by j.id
     limit 200;
end $$;

-- The ONLY way the fallback marks work done: the server checks storage.objects.
create function public.admin_complete_storage_job(p_job_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_region uuid; v_photo uuid; v_done timestamptz;
begin
  select region_id, photo_id into v_region, v_photo from private.storage_jobs where id = p_job_id;
  if not found then
    if private.is_admin(null) then raise exception 'not_found' using errcode = 'P0002';
    else raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  if not private.is_admin(v_region) then raise exception 'forbidden' using errcode = '42501'; end if;   -- null region = global only
  if v_photo is not null then
    perform private.lock_photo(v_photo);
    perform 1 from public.photos where id = v_photo for update;
  end if;
  select done_at into v_done from private.storage_jobs where id = p_job_id for update;
  if v_done is not null then return true; end if;
  if private.storage_job_satisfied(p_job_id) then
    perform private.finish_storage_job(p_job_id);
    return true;
  end if;
  return false;
end $$;

-- ---------------------------------------------------------------- replaced R1 RPCs (same signatures)
create or replace function public.get_region_context(p_slug text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'region', jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name,
       'min_lat', r.min_lat, 'max_lat', r.max_lat, 'min_lng', r.min_lng, 'max_lng', r.max_lng,
       'center_lat', r.center_lat, 'center_lng', r.center_lng, 'default_zoom', r.default_zoom,
       'timezone', r.timezone, 'country_code', r.country_code),
    'season', s.active_season, 'year', s.active_year, 'submissions_open', s.submissions_open,
    'photos_open', s.photos_open,
    'wordmark', coalesce(b.wordmark, r.name))
  from public.regions r
  join public.site_settings s on s.region_id = r.id
  left join public.region_brands b on b.region_id = r.id and b.season = s.active_season
  where r.is_active
    and r.slug = coalesce(p_slug, (select r2.slug from public.app_settings a
                                   join public.regions r2 on r2.id = a.default_region_id))
$$;

create or replace function public.admin_set_season(p_region_id uuid, p_season text, p_year integer, p_submissions_open boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.site_settings%rowtype; v_houses uuid[];
begin
  if not private.is_admin(p_region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_season is null or p_season not in ('halloween', 'christmas')
     or p_year is null or p_year not between 2024 and 2100 or p_submissions_open is null then
    raise exception 'invalid_input' using errcode = '22023'; end if;
  select * into v_old from public.site_settings where region_id = p_region_id for update;
  update public.site_settings
     set active_season = p_season::public.season_kind, active_year = p_year,
         submissions_open = p_submissions_open, updated_at = now(), updated_by = auth.uid()
   where region_id = p_region_id;
  if not found then raise exception 'region_not_found' using errcode = 'P0002'; end if;
  -- R2: the old pair's public photos stop being public; rotate them so leaked URLs die.
  if v_old.active_season::text <> p_season or v_old.active_year <> p_year then
    select coalesce(array_agg(h.id), '{}') into v_houses from public.houses h
     where h.region_id = p_region_id and h.season = v_old.active_season and h.year = v_old.active_year
       and h.status = 'visible';
    if private.rotate_house_photos(v_houses) > 0 then
      perform private.run_storage_jobs(50, null);
    end if;
  end if;
end $$;

create or replace function public.admin_set_house_status(p_house_id uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_region uuid; v_status public.house_status;
begin
  select region_id, status into v_region, v_status from public.houses where id = p_house_id for update;
  if not found then
    if private.is_admin(null) then raise exception 'not_found' using errcode = 'P0002';
    else raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  if not private.is_admin(v_region) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_status = 'released' then raise exception 'house_released' using errcode = '22023'; end if;
  if p_status is null or p_status not in ('visible', 'hidden')
     or (p_reason is not null and char_length(p_reason) > 200) then
    raise exception 'invalid_input' using errcode = '22023'; end if;
  update public.houses
     set status = p_status::public.house_status,
         hidden_reason = case when p_status = 'hidden' then nullif(btrim(p_reason), '') end,
         moderated_by = auth.uid(), moderated_at = now()
   where id = p_house_id;
  -- R2: hiding rotates every approved photo of the house.
  if v_status = 'visible' and p_status = 'hidden' then
    if private.rotate_house_photos(array[p_house_id]) > 0 then
      perform private.run_storage_jobs(50, null);
    end if;
  end if;
end $$;

create or replace function public.admin_release_house(p_house_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_region uuid; v_status public.house_status; r record; p public.photos%rowtype; v_n integer := 0;
begin
  select region_id, status into v_region, v_status from public.houses where id = p_house_id for update;
  if not found then
    if private.is_admin(null) then raise exception 'not_found' using errcode = 'P0002';
    else raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  if not private.is_admin(v_region) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_status <> 'hidden' then raise exception 'must_be_hidden' using errcode = '22023'; end if;
  update public.houses
     set status = 'released', released_at = now(), place_id = null,
         normalized_address = normalized_address || '#released:' || id::text,
         moderated_by = auth.uid(), moderated_at = now()
   where id = p_house_id;
  -- R2: approved -> revoked (delete), pending -> rejected and reserved -> expired (delete upload). Id order.
  for r in select id from public.photos where house_id = p_house_id and status in ('approved', 'pending', 'reserved') order by id loop
    perform private.lock_photo(r.id);
    select * into p from public.photos where id = r.id for update;
    if p.status = 'approved' then
      update public.photos set status = 'revoked', public_path = null, moderated_by = auth.uid(), moderated_at = now() where id = p.id;
      perform private.enqueue_delete_public(p.id, p.public_path, v_region);
    elsif p.status = 'pending' then
      update public.photos set status = 'rejected', moderated_by = auth.uid(), moderated_at = now() where id = p.id;
      perform private.enqueue_storage_job('delete_upload', 'photo-uploads', p.upload_path, null, p.id, v_region);
    elsif p.status = 'reserved' then
      update public.photos set status = 'expired' where id = p.id;
      perform private.enqueue_storage_job('delete_upload', 'photo-uploads', p.upload_path, null, p.id, v_region);
    else
      continue;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then perform private.run_storage_jobs(50, null); end if;
end $$;

-- ---------------------------------------------------------------- EXECUTE: deny all, then the exact §1.1 allowlist
revoke execute on all functions in schema public  from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function public.get_region_context(text) to anon, authenticated;
grant execute on function public.submit_house(text, text, text, double precision, double precision) to authenticated;
grant execute on function public.admin_whoami(uuid) to authenticated;
grant execute on function public.admin_set_season(uuid, text, integer, boolean) to authenticated;
grant execute on function public.admin_list_houses(uuid, text, text) to authenticated;
grant execute on function public.admin_set_house_status(uuid, text, text) to authenticated;
grant execute on function public.admin_release_house(uuid) to authenticated;
grant execute on function public.reserve_photo(uuid) to authenticated;
grant execute on function public.confirm_photo_upload(uuid) to authenticated;
grant execute on function public.admin_set_photos_open(uuid, boolean) to authenticated;
grant execute on function public.admin_photo_queue(uuid, text) to authenticated;
grant execute on function public.admin_approve_photo(uuid, text) to authenticated;
grant execute on function public.admin_reject_photo(uuid) to authenticated;
grant execute on function public.admin_revoke_photo(uuid) to authenticated;
grant execute on function public.admin_storage_jobs(uuid) to authenticated;
grant execute on function public.admin_complete_storage_job(bigint) to authenticated;
grant execute on function private.photo_upload_allowed(text)   to authenticated;
grant execute on function private.storage_admin_ok(text, text) to authenticated;
-- public.photo_sign_paths(uuid) stays service_role only (granted in 20261010000200).
