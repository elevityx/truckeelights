-- Release 2: two PRIVATE buckets, the Storage policy helpers, the complete set of tl_* Storage policies,
-- and the service-role-only input for the photo-urls signer.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('photo-uploads', 'photo-uploads', false, 5242880, array['image/jpeg']),
  ('photos',        'photos',        false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

create function private.path_house_id(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.jpg$'
              then split_part(p_name, '/', 1)::uuid end
$$;

create function private.house_is_public(p_house_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.houses h
                   join public.site_settings s on s.region_id = h.region_id
                   join public.regions r on r.id = h.region_id
                  where h.id = p_house_id and h.status = 'visible' and r.is_active
                    and s.active_season = h.season and s.active_year = h.year)
$$;

create function private.photo_upload_allowed(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.photos p
                  where p.upload_path = p_name and p.status = 'reserved'
                    and p.created_by = auth.uid() and p.reserved_until > now())
$$;

create function private.photo_object_readable(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_bucket = 'photos' and exists (
    select 1 from public.photos p
     where p.public_path = p_name and p.status = 'approved' and private.house_is_public(p.house_id))
$$;

create function private.storage_admin_ok(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_bucket in ('photo-uploads', 'photos') and exists (
    select 1 from public.houses h
     where h.id = private.path_house_id(p_name) and private.is_admin(h.region_id))
$$;

revoke execute on all functions in schema private from public, anon, authenticated;   -- reassert deny-by-default
grant execute on function private.photo_upload_allowed(text)   to authenticated;
grant execute on function private.storage_admin_ok(text, text) to authenticated;
-- private.photo_object_readable has NO grants (used only inside definer code).

-- The COMPLETE set of tl_* policies on storage.objects: exactly 6, none for anon, no UPDATE, no ALL.
-- The public can't list, download, or sign anything; nobody can upsert or overwrite.
create policy tl_uploads_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photo-uploads' and private.photo_upload_allowed(name));     -- only own live reservation path
create policy tl_uploads_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'photo-uploads' and private.storage_admin_ok(bucket_id, name));
create policy tl_uploads_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photo-uploads' and private.storage_admin_ok(bucket_id, name));
create policy tl_photos_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and private.storage_admin_ok(bucket_id, name));
create policy tl_photos_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and private.storage_admin_ok(bucket_id, name));
create policy tl_photos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and private.storage_admin_ok(bucket_id, name));

-- Trusted signer input: the 20 NEWEST approved photos of a public house (by approval time), so a new approval
-- always shows. service_role ONLY.
create function public.photo_sign_paths(p_house_id uuid) returns table (id uuid, public_path text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.public_path from public.photos p
   where p.house_id = p_house_id and p.status = 'approved' and private.house_is_public(p.house_id)
   order by p.moderated_at desc nulls last, p.id desc limit 20
$$;
revoke execute on function public.photo_sign_paths(uuid) from public, anon, authenticated;
grant execute on function public.photo_sign_paths(uuid) to service_role;
