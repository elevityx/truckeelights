-- AC1, AC2 (Amendment 1): public.photos has NO grants and NO policies for anon/authenticated; storage_jobs is
-- RLS-forced with no grants; the only public read path is photo_sign_paths (service_role only), which returns
-- the 20 NEWEST approved photos of a public house and nothing else.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- Fixtures (as postgres). Do not rely on seed rows.
delete from public.photos;
delete from private.storage_jobs;
insert into public.regions (slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng, default_zoom, timezone, is_active)
values ('testville', 'Testville', 10, 11, 10, 11, 10.5, 10.5, 12, 'America/Los_Angeles', true)
on conflict (slug) do update set is_active = true;
insert into public.site_settings (region_id, active_season, active_year, submissions_open)
  select id, 'halloween', 2026, true from public.regions where slug = 'testville'
on conflict (region_id) do update set active_season = 'halloween', active_year = 2026;
update public.site_settings s set active_season = 'halloween', active_year = 2026
  from public.regions r where r.id = s.region_id and r.slug = 'truckee';
insert into auth.users (id, aud, role, email) values ('e6000000-0000-4000-a000-000000000001', 'authenticated', 'authenticated', 'v6@example.test');

insert into public.houses (id, region_id, season, year, address, normalized_address, lat, lng, coord_source, status)
select v.id::uuid, r.id, v.season::public.season_kind, v.year, v.address, v.address || ' #6', v.lat, v.lng, 'admin', v.status::public.house_status
  from (values
    ('e6000000-0000-4000-a000-0000000000a1', 'truckee',   'halloween', 2026, '1 Photo Rd',     39.30, -120.20, 'visible'),
    ('e6000000-0000-4000-a000-0000000000a2', 'truckee',   'halloween', 2026, '2 Hidden Rd',    39.30, -120.21, 'hidden'),
    ('e6000000-0000-4000-a000-0000000000a3', 'truckee',   'christmas', 2024, '3 Oldseason Rd', 39.31, -120.20, 'visible'),
    ('e6000000-0000-4000-a000-0000000000a4', 'testville', 'halloween', 2026, '4 Inactive Rd',  10.50,   10.50, 'visible'),
    ('e6000000-0000-4000-a000-0000000000a5', 'truckee',   'halloween', 2026, '5 Many Rd',      39.30, -120.22, 'visible')
  ) v(id, slug, season, year, address, lat, lng, status)
  join public.regions r on r.slug = v.slug;

create schema test_helpers;
create function test_helpers.mk_photo(p_id uuid, p_house uuid, p_status text, p_moderated timestamptz default now())
returns uuid language sql as $$
  insert into public.photos (id, house_id, upload_path, public_path, status, reserved_until, created_by, moderated_at)
  values (p_id, p_house, p_house::text || '/' || p_id::text || '.jpg',
          case when p_status = 'approved' then p_house::text || '/' || gen_random_uuid()::text || '.jpg' end,
          p_status::public.photo_status, now() + interval '15 minutes', 'e6000000-0000-4000-a000-000000000001',
          case when p_status in ('approved', 'rejected', 'revoked') then p_moderated end)
  returning id
$$;
select test_helpers.mk_photo('e6000000-0000-4000-a000-000000000b01', 'e6000000-0000-4000-a000-0000000000a1', 'reserved');
select test_helpers.mk_photo('e6000000-0000-4000-a000-000000000b02', 'e6000000-0000-4000-a000-0000000000a1', 'pending');
select test_helpers.mk_photo('e6000000-0000-4000-a000-000000000b03', 'e6000000-0000-4000-a000-0000000000a1', 'rejected');
select test_helpers.mk_photo('e6000000-0000-4000-a000-000000000b04', 'e6000000-0000-4000-a000-0000000000a1', 'revoked');
select test_helpers.mk_photo('e6000000-0000-4000-a000-000000000b05', 'e6000000-0000-4000-a000-0000000000a1', 'expired');
select test_helpers.mk_photo('e6000000-0000-4000-a000-000000000b06', 'e6000000-0000-4000-a000-0000000000a1', 'approved');   -- the only public one
select test_helpers.mk_photo('e6000000-0000-4000-a000-000000000b07', 'e6000000-0000-4000-a000-0000000000a2', 'approved');   -- hidden house
select test_helpers.mk_photo('e6000000-0000-4000-a000-000000000b08', 'e6000000-0000-4000-a000-0000000000a3', 'approved');   -- other season
select test_helpers.mk_photo('e6000000-0000-4000-a000-000000000b09', 'e6000000-0000-4000-a000-0000000000a4', 'approved');   -- inactive region
update public.regions set is_active = false where slug = 'testville';

-- ---------------------------------------------------------------- RLS flags
select ok((select relrowsecurity from pg_class where oid = 'public.photos'::regclass), 'RLS is enabled on public.photos');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.storage_jobs'::regclass),
          'RLS is enabled AND forced on private.storage_jobs');
select is((select count(*)::int from pg_policies where (schemaname, tablename) in (('public', 'photos'), ('private', 'storage_jobs'))),
          0, 'no policies on photos or storage_jobs');

-- ---------------------------------------------------------------- no column of photos is readable by an API role
select is(
  (select coalesce(array_agg(format('%s:%s', r.role, a.attname) order by 1), '{}')
     from pg_attribute a cross join (values ('anon'), ('authenticated')) r(role)
    where a.attrelid = 'public.photos'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege(r.role, 'public.photos', a.attname, 'SELECT')),
  '{}'::text[], 'anon/authenticated can read no column of photos (incl. upload_path, created_by, reserved_until, moderated_*, public_rotated_at)');
select is(
  (select coalesce(array_agg(format('%s:%s', r.role, p.priv) order by 1), '{}')
     from (values ('anon'), ('authenticated')) r(role)
     cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
    where has_table_privilege(r.role, 'public.photos', p.priv)),
  '{}'::text[], 'anon/authenticated have no table privilege on photos');

-- ---------------------------------------------------------------- anon: every direct path is denied
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok('select id from public.photos', '42501', null, 'anon: select photos -> 42501 (no approved row is visible either)');
select throws_ok('select count(*) from public.photos', '42501', null, 'anon: count(*) photos -> 42501');
select throws_ok($$insert into public.photos (house_id, upload_path, reserved_until) values (gen_random_uuid(), 'x', now())$$, '42501', null, 'anon: insert photos -> 42501');
select throws_ok($$update public.photos set status = 'approved'$$, '42501', null, 'anon: update photos -> 42501');
select throws_ok($$delete from public.photos$$, '42501', null, 'anon: delete photos -> 42501');
select throws_ok('select * from private.storage_jobs', '42501', null, 'anon: storage_jobs -> 42501');
select throws_ok($$select * from public.photo_sign_paths('e6000000-0000-4000-a000-0000000000a1')$$, '42501', null, 'anon: photo_sign_paths -> 42501');
reset role;

-- ---------------------------------------------------------------- authenticated (has private USAGE): still denied
select set_config('request.jwt.claims', json_build_object('sub', 'e6000000-0000-4000-a000-000000000001', 'role', 'authenticated',
                  'is_anonymous', true, 'aal', 'aal1', 'amr', '[{"method":"anonymous","timestamp":1791564302}]'::json)::text, true);
set local role authenticated;
select throws_ok('select id, public_path from public.photos', '42501', null, 'authenticated: select photos -> 42501 (even own rows)');
select throws_ok($$insert into public.photos (house_id, upload_path, reserved_until) values (gen_random_uuid(), 'x', now())$$, '42501', null, 'authenticated: insert photos -> 42501');
select throws_ok($$update public.photos set status = 'approved'$$, '42501', null, 'authenticated: update photos -> 42501');
select throws_ok($$delete from public.photos$$, '42501', null, 'authenticated: delete photos -> 42501');
select throws_ok('select * from private.storage_jobs', '42501', null, 'authenticated: select storage_jobs -> 42501 even with private USAGE');
select throws_ok($$update private.storage_jobs set done_at = now()$$, '42501', null, 'authenticated: update storage_jobs -> 42501');
select throws_ok($$select * from public.photo_sign_paths('e6000000-0000-4000-a000-0000000000a1')$$, '42501', null, 'authenticated: photo_sign_paths -> 42501');
select throws_ok($$select private.photo_object_readable('photos', 'x')$$, '42501', null, 'authenticated: photo_object_readable -> 42501');
reset role;

-- ---------------------------------------------------------------- service_role: the signer's input
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select results_eq($$select id from public.photo_sign_paths('e6000000-0000-4000-a000-0000000000a1')$$,
  $$values ('e6000000-0000-4000-a000-000000000b06'::uuid)$$,
  'sign_paths(public house): only the approved row (reserved/pending/rejected/revoked/expired excluded)');
select is((select count(*)::int from public.photo_sign_paths('e6000000-0000-4000-a000-0000000000a2')), 0, 'sign_paths(hidden house) -> none');
select is((select count(*)::int from public.photo_sign_paths('e6000000-0000-4000-a000-0000000000a3')), 0, 'sign_paths(other season) -> none');
select is((select count(*)::int from public.photo_sign_paths('e6000000-0000-4000-a000-0000000000a4')), 0, 'sign_paths(inactive region) -> none');
reset role;

-- grok r2 P1: the signer keeps the NEWEST 20 approved photos, so a new approval always appears.
select test_helpers.mk_photo(('e6000000-0000-4000-a000-0000000c' || lpad(n::text, 4, '0'))::uuid,
                             'e6000000-0000-4000-a000-0000000000a5', 'approved', now() - make_interval(mins => 100 - n))
  from generate_series(1, 21) n;                        -- n = 21 is the newest approval, n = 1 the oldest
set local role service_role;
select is((select count(*)::int from public.photo_sign_paths('e6000000-0000-4000-a000-0000000000a5')), 20, '21 approved -> at most 20 signed');
select ok(exists (select 1 from public.photo_sign_paths('e6000000-0000-4000-a000-0000000000a5')
                   where id = 'e6000000-0000-4000-a000-0000000c0021'), 'the newest (21st) approval is in the signed set');
select ok(not exists (select 1 from public.photo_sign_paths('e6000000-0000-4000-a000-0000000000a5')
                       where id = 'e6000000-0000-4000-a000-0000000c0001'), 'the oldest approval is not');
reset role;

-- AC10: photos_open is fail-closed.
select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'site_settings' and column_name = 'photos_open'), 'false',
          'site_settings.photos_open defaults to false');

select * from finish();
rollback;
