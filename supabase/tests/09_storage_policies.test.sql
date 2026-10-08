-- AC3 (Amendment 1 A.1): the complete Storage access model. Exactly 6 tl_* policies on storage.objects, all for
-- authenticated, none for anon, none UPDATE/ALL. Policy-helper truth tables as each role (through claims).
-- The signer input functions are not callable by API roles.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- ---------------------------------------------------------------- fixtures (as postgres)
delete from public.photos;
delete from public.admins;
insert into public.regions (slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng, default_zoom, timezone, is_active)
values ('testville', 'Testville', 10, 11, 10, 11, 10.5, 10.5, 12, 'America/Los_Angeles', true)
on conflict (slug) do update set is_active = true;
insert into public.site_settings (region_id, active_season, active_year, submissions_open)
  select id, 'halloween', 2026, true from public.regions where slug = 'testville'
on conflict (region_id) do update set active_season = 'halloween', active_year = 2026;
update public.site_settings s set active_season = 'halloween', active_year = 2026
  from public.regions r where r.id = s.region_id and r.slug = 'truckee';
insert into auth.users (id, aud, role, email)
select ('e9000000-0000-4000-a000-0000000000' || x)::uuid, 'authenticated', 'authenticated', 'u9' || x || '@example.test'
  from unnest(array['01', '02', 'a1', 'a2', 'a3', 'a4']) x;
insert into public.admins (user_id, region_id, note) values
  ('e9000000-0000-4000-a000-0000000000a1', null, 'test global'),
  ('e9000000-0000-4000-a000-0000000000a2', (select id from public.regions where slug = 'testville'), 'test testville'),
  ('e9000000-0000-4000-a000-0000000000a4', null, 'test anonymous-with-row');
insert into public.houses (id, region_id, season, year, address, normalized_address, lat, lng, coord_source, status)
select v.id::uuid, r.id, 'halloween', 2026, v.address, v.address || ' #9', v.lat, v.lng, 'admin', 'visible'
  from (values
    ('e9000000-0000-4000-a000-0000000000b1', 'truckee',   '1 Nine Rd', 39.30, -120.20),
    ('e9000000-0000-4000-a000-0000000000b2', 'testville', '2 Nine Rd', 10.50,   10.50)
  ) v(id, slug, address, lat, lng)
  join public.regions r on r.slug = v.slug;
insert into public.photos (id, house_id, upload_path, status, reserved_until, created_by) values
  ('e9000000-0000-4000-a000-000000000c01', 'e9000000-0000-4000-a000-0000000000b1', 'e9000000-0000-4000-a000-0000000000b1/e9000000-0000-4000-a000-000000000c01.jpg',
   'reserved', now() + interval '15 minutes', 'e9000000-0000-4000-a000-000000000001'),
  ('e9000000-0000-4000-a000-000000000c02', 'e9000000-0000-4000-a000-0000000000b1', 'e9000000-0000-4000-a000-0000000000b1/e9000000-0000-4000-a000-000000000c02.jpg',
   'reserved', now() - interval '1 minute', 'e9000000-0000-4000-a000-000000000001'),
  ('e9000000-0000-4000-a000-000000000c03', 'e9000000-0000-4000-a000-0000000000b1', 'e9000000-0000-4000-a000-0000000000b1/e9000000-0000-4000-a000-000000000c03.jpg',
   'pending', now() + interval '15 minutes', 'e9000000-0000-4000-a000-000000000001');

create schema test_helpers;
grant usage on schema test_helpers to anon, authenticated;
create function test_helpers.claims(p_uid text, p_anon boolean, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', p_anon, 'aal', p_aal)::text, true)::text
$$;
-- rows an UPDATE on both buckets can touch as the current role (invoker)
create function test_helpers.update_count() returns int language plpgsql as $$
declare n int;
begin
  update storage.objects set name = name where bucket_id in ('photo-uploads', 'photos');
  get diagnostics n = row_count; return n;
end $$;
grant execute on all functions in schema test_helpers to anon, authenticated;
select set_config('t.live',    'e9000000-0000-4000-a000-0000000000b1/e9000000-0000-4000-a000-000000000c01.jpg', true);
select set_config('t.expired', 'e9000000-0000-4000-a000-0000000000b1/e9000000-0000-4000-a000-000000000c02.jpg', true);
select set_config('t.pending', 'e9000000-0000-4000-a000-0000000000b1/e9000000-0000-4000-a000-000000000c03.jpg', true);
select set_config('t.truckee_obj', 'e9000000-0000-4000-a000-0000000000b1/e9000000-0000-4000-a000-00000000ffff.jpg', true);
select set_config('t.testville_obj', 'e9000000-0000-4000-a000-0000000000b2/e9000000-0000-4000-a000-00000000ffff.jpg', true);

-- ---------------------------------------------------------------- the policy set
select is(
  (select array_agg(format('%s:%s:%s', policyname, cmd, roles::text) order by policyname::text) from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname like 'tl\_%'),
  array['tl_photos_admin_delete:DELETE:{authenticated}', 'tl_photos_admin_insert:INSERT:{authenticated}',
        'tl_photos_admin_select:SELECT:{authenticated}', 'tl_uploads_admin_delete:DELETE:{authenticated}',
        'tl_uploads_admin_select:SELECT:{authenticated}', 'tl_uploads_insert:INSERT:{authenticated}'],
  'exactly the 6 tl_* policies: uploads INSERT/SELECT/DELETE + photos SELECT/INSERT/DELETE, all for authenticated');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
            and (roles && array['anon', 'public']::name[] or cmd in ('UPDATE', 'ALL'))), 0,
          'no storage.objects policy for anon/public and none for UPDATE or ALL (no list/download/sign; no upsert/overwrite)');
select is((select count(*)::int from storage.buckets where id in ('photo-uploads', 'photos') and not public), 2, 'both buckets are private');

-- ---------------------------------------------------------------- signer inputs are not callable by API roles
select ok(not has_function_privilege('anon', 'private.photo_object_readable(text, text)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'private.photo_object_readable(text, text)', 'EXECUTE'),
          'photo_object_readable: no EXECUTE for anon/authenticated');
select ok(not has_function_privilege('anon', 'public.photo_sign_paths(uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.photo_sign_paths(uuid)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.photo_sign_paths(uuid)', 'EXECUTE'),
          'photo_sign_paths: service_role only');
select ok(not has_function_privilege('anon', 'private.photo_upload_allowed(text)', 'EXECUTE')
          and not has_function_privilege('anon', 'private.storage_admin_ok(text, text)', 'EXECUTE'),
          'anon cannot execute the policy helpers');

-- ---------------------------------------------------------------- photo_upload_allowed truth table
select test_helpers.claims('e9000000-0000-4000-a000-000000000001', true, 'aal1');
set local role authenticated;
select is(private.photo_upload_allowed(current_setting('t.live')), true, 'upload_allowed: owner + live reservation -> true');
select is(private.photo_upload_allowed(current_setting('t.expired')), false, 'upload_allowed: expired reservation -> false');
select is(private.photo_upload_allowed(current_setting('t.pending')), false, 'upload_allowed: already pending -> false');
select is(private.photo_upload_allowed('e9000000-0000-4000-a000-0000000000b1/e9000000-0000-4000-a000-000000000c99.jpg'), false, 'upload_allowed: unreserved path -> false');
reset role;
select test_helpers.claims('e9000000-0000-4000-a000-000000000002', true, 'aal1');
set local role authenticated;
select is(private.photo_upload_allowed(current_setting('t.live')), false, 'upload_allowed: another uid -> false');
reset role;

-- ---------------------------------------------------------------- storage_admin_ok truth table
select test_helpers.claims('e9000000-0000-4000-a000-0000000000a1', false, 'aal2');
set local role authenticated;
select is(private.storage_admin_ok('photos', current_setting('t.truckee_obj')), true, 'admin_ok: global aal2 -> true (photos)');
select is(private.storage_admin_ok('photo-uploads', current_setting('t.live')), true, 'admin_ok: global aal2 -> true (photo-uploads)');
select is(private.storage_admin_ok('photos', 'not-a-uuid/x.jpg'), false, 'admin_ok: malformed path -> false');
select is(private.storage_admin_ok('photos', '------------------------------------/x.jpg'), false, 'admin_ok: dash-only folder -> false (no cast error)');
select is(private.storage_admin_ok('photos', current_setting('t.truckee_obj') || '/../x.jpg'), false, 'admin_ok: trailing segments -> false');
select is(private.storage_admin_ok('avatars', current_setting('t.truckee_obj')), false, 'admin_ok: other bucket -> false');
select is(private.storage_admin_ok('photos', 'e9000000-0000-4000-a000-0000000000ff/e9000000-0000-4000-a000-00000000ffff.jpg'), false, 'admin_ok: unknown house -> false');
reset role;
select test_helpers.claims('e9000000-0000-4000-a000-0000000000a1', false, 'aal1');
set local role authenticated;
select is(private.storage_admin_ok('photos', current_setting('t.truckee_obj')), false, 'admin_ok: aal1 -> false');
reset role;
select test_helpers.claims('e9000000-0000-4000-a000-0000000000a4', true, 'aal2');
set local role authenticated;
select is(private.storage_admin_ok('photos', current_setting('t.truckee_obj')), false, 'admin_ok: anonymous JWT with an admins row -> false');
reset role;
select test_helpers.claims('e9000000-0000-4000-a000-0000000000a3', false, 'aal2');
set local role authenticated;
select is(private.storage_admin_ok('photos', current_setting('t.truckee_obj')), false, 'admin_ok: aal2 without an admins row -> false');
reset role;
select test_helpers.claims('e9000000-0000-4000-a000-0000000000a2', false, 'aal2');
set local role authenticated;
select is(private.storage_admin_ok('photos', current_setting('t.truckee_obj')), false, 'admin_ok: testville admin on a Truckee house -> false');
select is(private.storage_admin_ok('photos', current_setting('t.testville_obj')), true, 'admin_ok: testville admin on a testville house -> true');
reset role;

-- ---------------------------------------------------------------- the policies, exercised on storage.objects
insert into storage.objects (bucket_id, name) values ('photos', current_setting('t.truckee_obj')), ('photo-uploads', current_setting('t.pending'));
select test_helpers.claims('e9000000-0000-4000-a000-000000000001', true, 'aal1');
set local role authenticated;
select lives_ok(format($$insert into storage.objects (bucket_id, name) values ('photo-uploads', %L)$$, current_setting('t.live')),
                'uploader: INSERT at its own live reservation path');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('photo-uploads', %L)$$, current_setting('t.expired')),
                 '42501', null, 'uploader: INSERT at its expired reservation path -> denied');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('photos', %L)$$, 'e9000000-0000-4000-a000-0000000000b1/e9000000-0000-4000-a000-00000000eeee.jpg'),
                 '42501', null, 'uploader: INSERT into photos -> denied');
select is((select count(*)::int from storage.objects where bucket_id in ('photo-uploads', 'photos')), 0, 'uploader: SELECT sees nothing (not even its own upload)');
select is(test_helpers.update_count(), 0,
          'uploader: UPDATE (upsert/overwrite) touches nothing');
reset role;
select test_helpers.claims('e9000000-0000-4000-a000-000000000002', true, 'aal1');
set local role authenticated;
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('photo-uploads', %L)$$, 'e9000000-0000-4000-a000-0000000000b1/e9000000-0000-4000-a000-000000000c01.jpg'),
                 '42501', null, 'another uid: INSERT at someone else''s reservation path -> denied');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is((select count(*)::int from storage.objects where bucket_id in ('photo-uploads', 'photos')), 0, 'anon: SELECT (list/download) sees nothing in either bucket');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('photo-uploads', %L)$$, 'e9000000-0000-4000-a000-0000000000b1/e9000000-0000-4000-a000-00000000dddd.jpg'),
                 '42501', null, 'anon: INSERT -> denied');
reset role;
select test_helpers.claims('e9000000-0000-4000-a000-0000000000a1', false, 'aal2');
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id in ('photo-uploads', 'photos') and name like 'e9000000-%'), 3, 'global admin: SELECT sees both buckets');
select is(test_helpers.update_count(), 0,
          'global admin: UPDATE touches nothing (no UPDATE policy: no overwrite)');
reset role;
select test_helpers.claims('e9000000-0000-4000-a000-0000000000a2', false, 'aal2');
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id in ('photo-uploads', 'photos') and name like 'e9000000-%'), 0, 'testville admin: sees no Truckee objects');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('photos', %L)$$, 'e9000000-0000-4000-a000-0000000000b1/e9000000-0000-4000-a000-00000000cccc.jpg'),
                 '42501', null, 'testville admin: INSERT (copy) into a Truckee house folder -> denied');
reset role;

select * from finish();
rollback;
