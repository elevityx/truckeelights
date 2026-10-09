-- AC8, AC9, AC10, AC23 and the private-table RLS variant: admin authz (non-anonymous + aal2 + admins row),
-- season switch, hide/unhide/release as plain row updates, default-region guards.
begin;
create extension if not exists pgtap with schema extensions;
select plan(71);

-- Fixtures (as postgres). Do not rely on seed rows.
delete from public.houses;
delete from public.admins;
delete from private.quota_events;
insert into public.regions (slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng, default_zoom, timezone, is_active)
values ('testville', 'Testville', 10, 11, 10, 11, 10.5, 10.5, 12, 'America/Los_Angeles', true)
on conflict (slug) do update set is_active = true;
insert into public.site_settings (region_id, active_season, active_year, submissions_open)
  select id, 'halloween', 2026, true from public.regions where slug = 'testville'
on conflict (region_id) do update set active_season = 'halloween', active_year = 2026, submissions_open = true;
update public.site_settings s set active_season = 'halloween', active_year = 2026, submissions_open = true, updated_by = null
  from public.regions r where r.id = s.region_id and r.slug = 'truckee';
select set_config('t.truckee', (select id::text from public.regions where slug = 'truckee'), true);
select set_config('t.testville', (select id::text from public.regions where slug = 'testville'), true);

-- d4..01 global admin, d4..02 testville-only admin, d4..03 no admins row, d4..04 anonymous user WITH a global row.
insert into auth.users (id, aud, role, email)
select ('d4000000-0000-4000-a000-00000000000' || n)::uuid, 'authenticated', 'authenticated', 'adm' || n || '@example.test'
  from generate_series(1, 5) n;
insert into public.admins (user_id, region_id, note) values
  ('d4000000-0000-4000-a000-000000000001', null, 'test global'),
  ('d4000000-0000-4000-a000-000000000002', current_setting('t.testville')::uuid, 'test testville'),
  ('d4000000-0000-4000-a000-000000000004', null, 'test anonymous-with-row');

insert into public.houses (id, region_id, season, year, place_id, address, normalized_address, lat, lng, coord_source, status)
values ('d4000000-0000-4000-a000-00000000aa01', current_setting('t.truckee')::uuid, 'halloween', 2026, 'ChIJadminfix0001',
        '10 Admin Rd, Truckee', '10 admin rd, truckee', 39.30, -120.20, 'user_confirmed', 'visible'),
       ('d4000000-0000-4000-a000-00000000aa02', current_setting('t.truckee')::uuid, 'halloween', 2026, 'ChIJadminfix0002',
        '12 Admin Rd, Truckee', '12 admin rd, truckee', 39.30, -120.21, 'user_confirmed', 'visible');

create schema test_helpers;
grant usage on schema test_helpers to anon, authenticated;
create function test_helpers.claims(p_uid text, p_anon boolean, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', p_anon, 'aal', p_aal)::text, true)::text
$$;
grant execute on all functions in schema test_helpers to anon, authenticated;

-- ---------------------------------------------------------------- private.is_admin (as postgres, impersonating via claims)
select test_helpers.claims('d4000000-0000-4000-a000-000000000004', true, 'aal2');
select is(private.is_admin(current_setting('t.truckee')::uuid), false, 'is_admin: anonymous JWT (even with an admins row) -> false');
select test_helpers.claims('d4000000-0000-4000-a000-000000000001', false, 'aal1');
select is(private.is_admin(current_setting('t.truckee')::uuid), false, 'is_admin: admin row at aal1 -> false');
select test_helpers.claims('d4000000-0000-4000-a000-000000000003', false, 'aal2');
select is(private.is_admin(current_setting('t.truckee')::uuid), false, 'is_admin: aal2 without a row -> false');
select test_helpers.claims('d4000000-0000-4000-a000-000000000002', false, 'aal2');
select is(private.is_admin(current_setting('t.truckee')::uuid), false, 'is_admin: testville admin asking about truckee -> false');
select is(private.is_admin(current_setting('t.testville')::uuid), true, 'is_admin: testville admin asking about testville -> true');
select is(private.is_admin(null), false, 'is_admin: region admin is not global');
select test_helpers.claims('d4000000-0000-4000-a000-000000000001', false, 'aal2');
select is(private.is_admin(current_setting('t.truckee')::uuid), true, 'is_admin: global admin at aal2 -> true');
select set_config('request.jwt.claims', json_build_object('sub', 'd4000000-0000-4000-a000-000000000001', 'role', 'authenticated', 'aal', 'aal2')::text, true);
select is(private.is_admin(current_setting('t.truckee')::uuid), false, 'is_admin: missing is_anonymous claim fails closed');
select set_config('request.jwt.claims', json_build_object('sub', 'd4000000-0000-4000-a000-000000000001', 'role', 'authenticated', 'is_anonymous', false)::text, true);
select is(private.is_admin(current_setting('t.truckee')::uuid), false, 'is_admin: missing aal claim fails closed');

-- ---------------------------------------------------------------- every admin RPC is forbidden for non-admin callers
-- anonymous
select test_helpers.claims('d4000000-0000-4000-a000-000000000004', true, 'aal2');
set local role authenticated;
select is(public.admin_whoami(current_setting('t.truckee')::uuid), false, 'anonymous: admin_whoami -> false');
select throws_ok(format('select public.admin_set_season(%L, %L, 2026, true)', current_setting('t.truckee'), 'christmas'), '42501', 'forbidden', 'anonymous: admin_set_season -> forbidden');
select throws_ok(format('select * from public.admin_list_houses(%L, null, null)', current_setting('t.truckee')), '42501', 'forbidden', 'anonymous: admin_list_houses -> forbidden');
select throws_ok($$select public.admin_set_house_status('d4000000-0000-4000-a000-00000000aa01', 'hidden', 'x')$$, '42501', 'forbidden', 'anonymous: admin_set_house_status -> forbidden');
select throws_ok($$select public.admin_release_house('d4000000-0000-4000-a000-00000000aa01')$$, '42501', 'forbidden', 'anonymous: admin_release_house -> forbidden');
reset role;
-- aal1 admin
select test_helpers.claims('d4000000-0000-4000-a000-000000000001', false, 'aal1');
set local role authenticated;
select is(public.admin_whoami(current_setting('t.truckee')::uuid), false, 'aal1 admin: admin_whoami -> false');
select throws_ok(format('select public.admin_set_season(%L, %L, 2026, true)', current_setting('t.truckee'), 'christmas'), '42501', 'forbidden', 'aal1 admin: admin_set_season -> forbidden');
select throws_ok(format('select * from public.admin_list_houses(%L, null, null)', current_setting('t.truckee')), '42501', 'forbidden', 'aal1 admin: admin_list_houses -> forbidden');
select throws_ok($$select public.admin_set_house_status('d4000000-0000-4000-a000-00000000aa01', 'hidden', 'x')$$, '42501', 'forbidden', 'aal1 admin: admin_set_house_status -> forbidden');
select throws_ok($$select public.admin_release_house('d4000000-0000-4000-a000-00000000aa01')$$, '42501', 'forbidden', 'aal1 admin: admin_release_house -> forbidden');
reset role;
-- aal2 without a row
select test_helpers.claims('d4000000-0000-4000-a000-000000000003', false, 'aal2');
set local role authenticated;
select is(public.admin_whoami(current_setting('t.truckee')::uuid), false, 'aal2 no-row: admin_whoami -> false');
select throws_ok(format('select public.admin_set_season(%L, %L, 2026, true)', current_setting('t.truckee'), 'christmas'), '42501', 'forbidden', 'aal2 no-row: admin_set_season -> forbidden');
select throws_ok(format('select * from public.admin_list_houses(%L, null, null)', current_setting('t.truckee')), '42501', 'forbidden', 'aal2 no-row: admin_list_houses -> forbidden');
select throws_ok($$select public.admin_set_house_status('d4000000-0000-4000-a000-00000000aa01', 'hidden', 'x')$$, '42501', 'forbidden', 'aal2 no-row: admin_set_house_status -> forbidden');
select throws_ok($$select public.admin_release_house('d4000000-0000-4000-a000-00000000aa01')$$, '42501', 'forbidden', 'aal2 no-row: admin_release_house -> forbidden');
select throws_ok($$select public.admin_set_house_status('d4000000-0000-4000-a000-0000000000ff', 'hidden', 'x')$$, '42501', 'forbidden', 'aal2 no-row: unknown house -> forbidden (no existence oracle)');
reset role;
-- cross-region admin (testville admin acting on truckee)
select test_helpers.claims('d4000000-0000-4000-a000-000000000002', false, 'aal2');
set local role authenticated;
select is(public.admin_whoami(current_setting('t.truckee')::uuid), false, 'cross-region: admin_whoami(truckee) -> false');
select throws_ok(format('select public.admin_set_season(%L, %L, 2026, true)', current_setting('t.truckee'), 'christmas'), '42501', 'forbidden', 'cross-region: admin_set_season -> forbidden');
select throws_ok(format('select * from public.admin_list_houses(%L, null, null)', current_setting('t.truckee')), '42501', 'forbidden', 'cross-region: admin_list_houses -> forbidden');
select throws_ok($$select public.admin_set_house_status('d4000000-0000-4000-a000-00000000aa01', 'hidden', 'x')$$, '42501', 'forbidden', 'cross-region: admin_set_house_status -> forbidden');
select throws_ok($$select public.admin_release_house('d4000000-0000-4000-a000-00000000aa01')$$, '42501', 'forbidden', 'cross-region: admin_release_house -> forbidden');
select is(public.admin_whoami(current_setting('t.testville')::uuid), true, 'cross-region: admin_whoami(own region) -> true');
reset role;
select results_eq(
  $$select status::text, active_season::text from public.houses h join public.site_settings s on s.region_id = h.region_id order by h.id$$,
  $$values ('visible', 'halloween'), ('visible', 'halloween')$$,
  'forbidden calls changed nothing');

-- ---------------------------------------------------------------- global admin at aal2
select test_helpers.claims('d4000000-0000-4000-a000-000000000001', false, 'aal2');
set local role authenticated;
select is(public.admin_whoami(current_setting('t.truckee')::uuid), true, 'global aal2: admin_whoami -> true');
select lives_ok(format('select public.admin_set_season(%L, %L, 2025, false)', current_setting('t.truckee'), 'christmas'), 'global aal2: admin_set_season works');
reset role;
select results_eq(
  format('select active_season::text, active_year::int, submissions_open, updated_by from public.site_settings where region_id = %L', current_setting('t.truckee')),
  $$values ('christmas', 2025, false, 'd4000000-0000-4000-a000-000000000001'::uuid)$$,
  'admin_set_season changed the row and set updated_by');
set local role authenticated;
select throws_ok(format('select public.admin_set_season(%L, %L, 2026, true)', current_setting('t.truckee'), 'easter'), '22023', 'invalid_input', 'season easter -> invalid_input');
select throws_ok(format('select public.admin_set_season(%L, %L, 2023, true)', current_setting('t.truckee'), 'halloween'), '22023', 'invalid_input', 'year 2023 -> invalid_input');
select throws_ok(format('select public.admin_set_season(%L, %L, 2026, null)', current_setting('t.truckee'), 'halloween'), '22023', 'invalid_input', 'null submissions_open -> invalid_input');
select throws_ok($$select public.admin_set_season('d4000000-0000-4000-a000-0000000000ff', 'halloween', 2026, true)$$, 'P0002', 'region_not_found', 'unknown region -> region_not_found');
select lives_ok(format('select public.admin_set_season(%L, %L, 2026, true)', current_setting('t.truckee'), 'halloween'), 'switch back to halloween/2026');

-- hide -> list shows hidden_reason -> unhide
select lives_ok($$select public.admin_set_house_status('d4000000-0000-4000-a000-00000000aa01', 'hidden', '  spooky reason ')$$, 'hide works');
select results_eq(
  format('select id, status::text, hidden_reason from public.admin_list_houses(%L, %L, null)', current_setting('t.truckee'), 'hidden'),
  $$values ('d4000000-0000-4000-a000-00000000aa01'::uuid, 'hidden', 'spooky reason')$$,
  'admin_list_houses returns hidden houses with hidden_reason');
select is((select count(*)::int from public.admin_list_houses(current_setting('t.truckee')::uuid, null, 'admin rd')), 2, 'admin_list_houses query filter (case-insensitive)');
select is((select count(*)::int from public.admin_list_houses(current_setting('t.truckee')::uuid, null, '%')), 0, 'admin_list_houses escapes LIKE wildcards');
select throws_ok(format('select * from public.admin_list_houses(%L, %L, null)', current_setting('t.truckee'), 'bogus'), '22023', 'invalid_input', 'admin_list_houses bad status -> invalid_input');
select throws_ok($$select public.admin_set_house_status('d4000000-0000-4000-a000-00000000aa01', 'released', null)$$, '22023', 'invalid_input', 'set_house_status cannot release');
select throws_ok(format('select public.admin_set_house_status(%L, %L, %L)', 'd4000000-0000-4000-a000-00000000aa01', 'hidden', repeat('x', 201)), '22023', 'invalid_input', 'reason over 200 chars -> invalid_input');
select lives_ok($$select public.admin_set_house_status('d4000000-0000-4000-a000-00000000aa01', 'visible', null)$$, 'unhide works');
reset role;
select results_eq($$select status::text, hidden_reason, moderated_by from public.houses where id = 'd4000000-0000-4000-a000-00000000aa01'$$,
  $$values ('visible', null::text, 'd4000000-0000-4000-a000-000000000001'::uuid)$$, 'unhide restored visible, cleared the reason, recorded the moderator');

-- release: only from hidden; tombstones keys; irreversible
set local role authenticated;
select throws_ok($$select public.admin_release_house('d4000000-0000-4000-a000-00000000aa01')$$, '22023', 'must_be_hidden', 'release on a visible house -> must_be_hidden');
select lives_ok($$select public.admin_set_house_status('d4000000-0000-4000-a000-00000000aa01', 'hidden', 'bad entry')$$, 'hide before release');
select lives_ok($$select public.admin_release_house('d4000000-0000-4000-a000-00000000aa01')$$, 'release on a hidden house works');
reset role;
select results_eq($$select status::text, place_id, released_at is not null, normalized_address like '%#released:%' from public.houses where id = 'd4000000-0000-4000-a000-00000000aa01'$$,
  $$values ('released', null::text, true, true)$$, 'release: status released, place_id null, released_at set, address key tombstoned');
set local role authenticated;
select throws_ok($$select public.admin_set_house_status('d4000000-0000-4000-a000-00000000aa01', 'visible', null)$$, '22023', 'house_released', 'released -> visible is refused (house_released)');
select throws_ok($$select public.admin_release_house('d4000000-0000-4000-a000-00000000aa01')$$, '22023', 'must_be_hidden', 'release is not repeatable');
select throws_ok($$select public.admin_set_house_status('d4000000-0000-4000-a000-0000000000ff', 'hidden', null)$$, 'P0002', 'not_found', 'global admin: unknown house -> not_found');
select throws_ok($$select public.admin_release_house('d4000000-0000-4000-a000-0000000000ff')$$, 'P0002', 'not_found', 'global admin: release unknown house -> not_found');
reset role;

-- ---------------------------------------------------------------- AC23 (R2): exactly two PRIVATE photo buckets
select results_eq(
  $$select id, public, file_size_limit::bigint, allowed_mime_types from storage.buckets order by id$$,
  $$values ('photo-uploads'::text, false, 5242880::bigint, array['image/jpeg']::text[]),
           ('photos'::text, false, 5242880::bigint, array['image/jpeg']::text[])$$,
  'AC23: storage.buckets = 2, both private, 5 MiB, JPEG only');
select ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where (n.nspname, c.relname) in (('public', 'photos'), ('private', 'storage_jobs'))) = 2,
          'AC23: photos and storage_jobs tables exist');
select ok(exists (select 1 from pg_extension where extname = 'pg_cron')
          and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname in ('public', 'private')
                             and p.proname in ('submit_house', 'admin_whoami', 'admin_list_houses', 'is_admin', 'lock_quota')
                             and p.prosrc ~* '\m(net|storage|cron)\.'),
          'AC23: pg_cron installed; the unchanged R1 functions still touch no net.*, storage.* or cron.*');

-- ---------------------------------------------------------------- AC10: default region + app_settings guards
select is((select count(*)::int from public.app_settings), 1, 'app_settings row exists');
select throws_ok($$update public.regions set is_active = false where slug = 'truckee'$$, '23514', 'invalid_input', 'deactivating the default region raises');
update public.regions set is_active = false where slug = 'testville';
select throws_ok($$update public.app_settings set default_region_id = (select id from public.regions where slug = 'testville')$$,
                 '23514', 'invalid_input', 'pointing app_settings at an inactive region raises');
update public.regions set is_active = true where slug = 'testville';
select test_helpers.claims('d4000000-0000-4000-a000-000000000001', false, 'aal2');
set local role authenticated;
select throws_ok($$delete from public.app_settings$$, '42501', null, 'authenticated (even a global aal2 admin) cannot delete app_settings');
select throws_ok($$update public.regions set is_active = false$$, '42501', null, 'authenticated cannot update regions directly');
select throws_ok($$update public.site_settings set submissions_open = true$$, '42501', null, 'authenticated cannot update site_settings directly');
reset role;
select is((select count(*)::int from public.app_settings), 1, 'app_settings row still exists');

-- ---------------------------------------------------------------- private tables still work through the RPC path
-- Proves the shipped private-table RLS variant (FORCE RLS, no policies) does not break definer access.
select ok((select rolbypassrls from pg_roles where rolname = 'postgres'), 'postgres (definer owner) has BYPASSRLS');
select set_config('t.qbefore', (select count(*)::text from private.quota_events), true);
select test_helpers.claims('d4000000-0000-4000-a000-000000000005', true, 'aal1');
set local role authenticated;
select is((select result from public.submit_house('truckee', 'ChIJadminfix0005', '55 Quotapath Rd, Truckee', 39.31, -120.19)),
          'created', 'submit_house works with FORCE RLS on private tables');
reset role;
select is((select count(*)::int from private.quota_events), current_setting('t.qbefore')::int + 1, 'submit_house wrote exactly one quota_events row');
select is((select count(*)::int from private.blocked_terms), 10, 'blocked_terms readable by the definer owner (10 frozen rows)');

select * from finish();
rollback;
