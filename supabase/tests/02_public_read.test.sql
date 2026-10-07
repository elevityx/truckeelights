-- AC4: the public sees only visible houses of the active (season, year) in an active region.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Fixtures (as postgres). Do not rely on seed rows.
delete from public.houses;
insert into public.regions (slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng, default_zoom, timezone, is_active)
values ('testville', 'Testville', 10, 11, 10, 11, 10.5, 10.5, 12, 'America/Los_Angeles', true)
on conflict (slug) do update set is_active = true;
insert into public.site_settings (region_id, active_season, active_year, submissions_open)
  select id, 'halloween', 2026, true from public.regions where slug = 'testville'
on conflict (region_id) do update set active_season = 'halloween', active_year = 2026;
update public.site_settings s set active_season = 'halloween', active_year = 2026
  from public.regions r where r.id = s.region_id and r.slug = 'truckee';

insert into public.houses (id, region_id, season, year, address, normalized_address, lat, lng, coord_source, status, hidden_reason)
select v.id::uuid, r.id, v.season::public.season_kind, v.year, v.address, v.address, v.lat, v.lng, 'admin',
       v.status::public.house_status, v.reason
  from (values
    ('b2000000-0000-4000-a000-000000000001', 'truckee',   'halloween', 2026, '1 Visible Rd',   39.30, -120.20, 'visible', null),
    ('b2000000-0000-4000-a000-000000000002', 'truckee',   'halloween', 2026, '2 Hidden Rd',    39.30, -120.21, 'hidden',  'test'),
    ('b2000000-0000-4000-a000-000000000003', 'truckee',   'christmas', 2024, '3 Christmas Rd', 39.31, -120.20, 'visible', null),
    ('b2000000-0000-4000-a000-000000000004', 'testville', 'halloween', 2026, '4 Testville Rd', 10.50,   10.50, 'visible', null)
  ) v(id, slug, season, year, address, lat, lng, status, reason)
  join public.regions r on r.slug = v.slug;
update public.regions set is_active = false where slug = 'testville';

-- As anon.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select results_eq('select id from public.houses',
  $$values ('b2000000-0000-4000-a000-000000000001'::uuid)$$,
  'anon sees only the visible house of the active pair in the active region');
select is((select count(*)::int from public.regions where slug = 'testville'), 0, 'anon cannot see an inactive region');
select is((select count(*)::int from public.site_settings), 1, 'anon sees site_settings of active regions only');
select is(public.get_region_context(null) #>> '{region,slug}', 'truckee', 'get_region_context(null) returns the default region');
select is(public.get_region_context(null) ->> 'season', 'halloween', 'active season is halloween');
select is((public.get_region_context(null) ->> 'year')::int, 2026, 'active year is 2026');
select is(public.get_region_context(null) ->> 'wordmark', 'Truckee Frights', 'halloween wordmark');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.get_region_context(null)) k),
  array['region', 'season', 'submissions_open', 'wordmark', 'year'], 'context has the contract keys');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.get_region_context(null) -> 'region') k),
  array['center_lat', 'center_lng', 'country_code', 'default_zoom', 'id', 'max_lat', 'max_lng', 'min_lat',
        'min_lng', 'name', 'slug', 'timezone'], 'context.region has the contract keys');
select is(public.get_region_context('testville'), null, 'get_region_context on an inactive region returns null');
select is(public.get_region_context('nope'), null, 'get_region_context on an unknown region returns null');
reset role;

-- Switch the pair (as postgres): the public view follows.
update public.site_settings s set active_season = 'christmas', active_year = 2024
  from public.regions r where r.id = s.region_id and r.slug = 'truckee';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select results_eq('select id from public.houses',
  $$values ('b2000000-0000-4000-a000-000000000003'::uuid)$$,
  'after switching to christmas/2024 anon sees exactly the christmas row');
select is(public.get_region_context(null) ->> 'wordmark', 'Truckee Lights', 'christmas wordmark');
reset role;

-- Authenticated (anonymous session) gets the same public view.
insert into auth.users (id, aud, role, email) values ('b2000000-0000-4000-a000-0000000000a1', 'authenticated', 'authenticated', 'pr1@example.test');
select set_config('request.jwt.claims',
  json_build_object('sub', 'b2000000-0000-4000-a000-0000000000a1', 'role', 'authenticated', 'is_anonymous', true, 'aal', 'aal1')::text, true);
set local role authenticated;
select results_eq('select id from public.houses',
  $$values ('b2000000-0000-4000-a000-000000000003'::uuid)$$,
  'authenticated sees the same public set');
select is(public.get_region_context(null) ->> 'season', 'christmas', 'authenticated context follows the switch');
select is((select count(*)::int from public.houses where status <> 'visible'), 0, 'no non-visible rows leak to authenticated');
reset role;

select * from finish();
rollback;
