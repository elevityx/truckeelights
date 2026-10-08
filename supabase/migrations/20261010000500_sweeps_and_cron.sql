-- Release 2: expiry sweep, nightly orphan reconciliation, the guarded rehearsal purge, idempotent runner setup,
-- and the pg_cron schedules. None of these functions is granted to an API role.

-- Expire stale reservations (tombstone, never delete) and queue their upload deletes. Prune the ledger after 48 h.
create function private.sweep_photos() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_path text; v_house uuid; v_n integer := 0;
begin
  for r in select id from public.photos where status = 'reserved' and reserved_until < now() order by id loop
    if not pg_try_advisory_xact_lock(private.photo_lock_key(r.id)) then continue; end if;   -- busy: next pass
    update public.photos set status = 'expired'
     where id = r.id and status = 'reserved' and reserved_until < now()
    returning upload_path, house_id into v_path, v_house;
    if found then
      perform private.enqueue_storage_job('delete_upload', 'photo-uploads', v_path, null, r.id,
                                          (select h.region_id from public.houses h where h.id = v_house));
      v_n := v_n + 1;
    end if;
  end loop;
  delete from private.quota_events where created_at < now() - interval '48 hours';
  return v_n;
end $$;

-- Nightly: queue deletes for objects older than 1 day that nothing references and no open job covers.
create function private.reconcile_storage() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_a integer; v_b integer;
begin
  insert into private.storage_jobs (kind, bucket, object_name, region_id)
  select 'delete_public', 'photos', o.name, h.region_id
    from storage.objects o
    left join public.houses h on h.id = private.path_house_id(o.name)
   where o.bucket_id = 'photos' and o.created_at < now() - interval '1 day'
     and not exists (select 1 from public.photos p where p.public_path = o.name)
     and not exists (select 1 from private.storage_jobs j
                      where j.done_at is null and j.bucket = 'photos'
                        and (j.object_name = o.name or j.new_object_name = o.name));
  get diagnostics v_a = row_count;
  insert into private.storage_jobs (kind, bucket, object_name, region_id)
  select 'delete_upload', 'photo-uploads', o.name, h.region_id
    from storage.objects o
    left join public.houses h on h.id = private.path_house_id(o.name)
   where o.bucket_id = 'photo-uploads' and o.created_at < now() - interval '1 day'
     and not exists (select 1 from public.photos p where p.upload_path = o.name and p.status in ('reserved', 'pending'))
     and not exists (select 1 from private.storage_jobs j
                      where j.done_at is null and j.bucket = 'photo-uploads' and j.object_name = o.name);
  get diagnostics v_b = row_count;
  return v_a + v_b;
end $$;

-- Maintainer only. Touches ONLY the non-default, closed region with slug 'rehearsal'.
-- false: revoke/expire every rehearsal photo and queue deletes (old names, uploads, every queued rotate destination).
-- true:  delete rehearsal photos and houses, only once no job is open and no object remains under their folders.
-- Any change to another region's house or photo count rolls the whole call back.
create function private.purge_rehearsal(p_delete_rows boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid; v_set public.site_settings%rowtype; v_houses uuid[]; v_photos uuid[];
  v_oh0 bigint; v_op0 bigint; v_oh1 bigint; v_op1 bigint;
  r record; p public.photos%rowtype; v_new text; v_jobs integer := 0; v_touched integer := 0;
  v_del_p integer := 0; v_del_h integer := 0;
begin
  if p_delete_rows is null then raise exception 'invalid_input' using errcode = '22023', detail = 'p_delete_rows'; end if;
  select id into v_rid from public.regions where slug = 'rehearsal';
  if not found then raise exception 'invalid_input' using errcode = '22023', detail = 'no_rehearsal_region'; end if;
  if exists (select 1 from public.app_settings where default_region_id = v_rid) then
    raise exception 'invalid_input' using errcode = '22023', detail = 'rehearsal_is_default'; end if;
  select * into v_set from public.site_settings where region_id = v_rid for update;
  if not found or v_set.submissions_open or v_set.photos_open then
    raise exception 'invalid_input' using errcode = '22023', detail = 'rehearsal_open'; end if;

  select count(*) into v_oh0 from public.houses where region_id <> v_rid;
  select count(*) into v_op0 from public.photos ph join public.houses h on h.id = ph.house_id where h.region_id <> v_rid;

  select coalesce(array_agg(id order by id), '{}') into v_houses from public.houses where region_id = v_rid;

  if not p_delete_rows then
    for r in select id from public.photos where house_id = any(v_houses) order by id loop
      perform private.lock_photo(r.id);
      select * into p from public.photos where id = r.id for update;
      -- supersede queued AND moved-but-unfinished rotations; delete every destination they could have produced
      for v_new in
        update private.storage_jobs set done_at = now(), last_error = 'superseded'
         where photo_id = p.id and kind = 'rotate_public' and done_at is null
        returning new_object_name
      loop
        perform private.enqueue_storage_job('delete_public', 'photos', v_new, null, p.id, v_rid); v_jobs := v_jobs + 1;
      end loop;
      if p.public_path is not null then
        perform private.enqueue_storage_job('delete_public', 'photos', p.public_path, null, p.id, v_rid); v_jobs := v_jobs + 1;
      end if;
      if not exists (select 1 from private.storage_jobs j where j.done_at is null and j.bucket = 'photo-uploads'
                                                         and j.object_name = p.upload_path) then
        perform private.enqueue_storage_job('delete_upload', 'photo-uploads', p.upload_path, null, p.id, v_rid); v_jobs := v_jobs + 1;
      end if;
      if p.status = 'approved' then
        update public.photos set status = 'revoked', public_path = null, moderated_at = now() where id = p.id;
      elsif p.status in ('reserved', 'pending') then
        update public.photos set status = 'expired' where id = p.id;
      end if;
      v_touched := v_touched + 1;
      perform private.run_storage_jobs(10, p.id);
    end loop;
  else
    select coalesce(array_agg(id order by id), '{}') into v_photos from public.photos where house_id = any(v_houses);
    for r in select id from public.photos where house_id = any(v_houses) order by id loop
      perform private.lock_photo(r.id);
      perform 1 from public.photos where id = r.id for update;
    end loop;
    if exists (select 1 from private.storage_jobs j
                where j.done_at is null
                  and (j.photo_id = any(v_photos) or private.path_house_id(j.object_name) = any(v_houses))) then
      raise exception 'invalid_input' using errcode = '22023', detail = 'jobs_open'; end if;
    if exists (select 1 from storage.objects o
                where o.bucket_id in ('photo-uploads', 'photos')
                  and split_part(o.name, '/', 1) = any(select h::text from unnest(v_houses) h)) then
      raise exception 'invalid_input' using errcode = '22023', detail = 'objects_remain'; end if;
    delete from public.photos where house_id = any(v_houses);
    get diagnostics v_del_p = row_count;
    delete from public.houses where region_id = v_rid;
    get diagnostics v_del_h = row_count;
  end if;

  select count(*) into v_oh1 from public.houses where region_id <> v_rid;
  select count(*) into v_op1 from public.photos ph join public.houses h on h.id = ph.house_id where h.region_id <> v_rid;
  if v_oh1 <> v_oh0 or v_op1 <> v_op0 then
    raise exception 'invalid_input' using errcode = '22023', detail = 'other_region_changed'; end if;

  return jsonb_build_object('photos_touched', v_touched, 'jobs_enqueued', v_jobs,
                            'photos_deleted', v_del_p, 'houses_deleted', v_del_h);
end $$;

-- Idempotent Vault writer for the two runner secrets (update if present, else create).
create function private.set_runner_secret(p_name text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_name is null or p_name not in ('storage_api_url', 'storage_api_key') or p_value is null or p_value = '' then
    raise exception 'invalid_input' using errcode = '22023', detail = 'runner_secret'; end if;
  select id into v_id from vault.secrets where name = p_name;
  if found then perform vault.update_secret(v_id, p_value);
  else perform vault.create_secret(p_value, p_name); end if;
end $$;

-- Idempotent runner schedule switch (re-scheduling the same job name replaces it).
create function private.set_storage_runner(p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_enabled is null then raise exception 'invalid_input' using errcode = '22023', detail = 'p_enabled'; end if;
  if p_enabled then
    perform cron.schedule('tl-storage-jobs', '30 seconds', 'select private.run_storage_jobs(50, null)');
  else
    perform cron.unschedule(jobid) from cron.job where jobname = 'tl-storage-jobs';
  end if;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.photo_upload_allowed(text)   to authenticated;
grant execute on function private.storage_admin_ok(text, text) to authenticated;

select private.set_storage_runner(true);
select cron.schedule('tl-sweep-photos',      '* * * * *',  $$select private.sweep_photos()$$);
select cron.schedule('tl-reconcile-storage', '17 3 * * *', $$select private.reconcile_storage()$$);
