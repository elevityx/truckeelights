-- AC5, AC6, AC9 (re-add side), AC24, AC25: submit_house results, validation, quotas, street-level check.
begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

-- Fixtures (as postgres). Do not rely on seed rows.
delete from public.houses;
delete from private.quota_events;
insert into public.regions (slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng, default_zoom, timezone, is_active)
values ('testville', 'Testville', 10, 11, 10, 11, 10.5, 10.5, 12, 'America/Los_Angeles', false)
on conflict (slug) do update set is_active = false;
insert into public.site_settings (region_id, active_season, active_year, submissions_open)
  select id, 'halloween', 2026, true from public.regions where slug = 'testville'
on conflict (region_id) do update set submissions_open = true;
update public.site_settings s set active_season = 'halloween', active_year = 2026, submissions_open = true
  from public.regions r where r.id = s.region_id and r.slug = 'truckee';
insert into auth.users (id, aud, role, email)
select ('c3000000-0000-4000-a000-00000000000' || n)::uuid, 'authenticated', 'authenticated', 'sub' || n || '@example.test'
  from generate_series(1, 8) n;

-- Test helpers (rolled back with the transaction).
create schema test_helpers;
grant usage on schema test_helpers to anon, authenticated;
create function test_helpers.err(p_sql text) returns text language plpgsql as $$
declare st text; msg text; det text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics st = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return st || ':' || msg || ':' || coalesce(det, '');
end $$;
create function test_helpers.submit(p_address text, p_place text,
                                    p_lat double precision default 39.33, p_lng double precision default -120.18,
                                    p_slug text default 'truckee') returns text
language sql as $$
  select s.result || '|' || coalesce(s.house_id::text, '') from public.submit_house(p_slug, p_place, p_address, p_lat, p_lng) s
$$;
create function test_helpers.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', true, 'aal', 'aal1')::text, true)::text
$$;
grant execute on all functions in schema test_helpers to anon, authenticated;

-- ---------------------------------------------------------------- results: created / exists_visible / blocked
select test_helpers.as_user('c3000000-0000-4000-a000-000000000001');
set local role authenticated;
select set_config('t.r1', test_helpers.submit('100 Testfixture Rd, Truckee, CA', 'ChIJfixture000001'), true);
select is(split_part(current_setting('t.r1'), '|', 1), 'created', 'first submit is created');
select isnt(nullif(split_part(current_setting('t.r1'), '|', 2), ''), null, 'created returns an id');
select is(test_helpers.submit('999 Otherplace Ave, Truckee, CA', 'ChIJfixture000001'),
          'exists_visible|' || split_part(current_setting('t.r1'), '|', 2),
          'same place_id, different address -> exists_visible with the same id');
select is(test_helpers.submit('  100   TESTFIXTURE  Rd ,Truckee, CA, USA', 'ChIJfixture000099'),
          'exists_visible|' || split_part(current_setting('t.r1'), '|', 2),
          'different place_id, same normalized address -> exists_visible with the same id');
reset role;

select is((select count(*)::int from public.houses), 1, 'duplicates did not insert rows');
select results_eq(
  $$select season::text, year::int, created_by, coord_source::text, status::text from public.houses$$,
  $$values ('halloween', 2026, 'c3000000-0000-4000-a000-000000000001'::uuid, 'user_confirmed', 'visible')$$,
  'row has the active season/year, created_by = uid, coord_source user_confirmed');
select is((select count(*)::int from private.quota_events where uid = 'c3000000-0000-4000-a000-000000000001'),
          1, 'duplicate submits did not consume quota');

-- hidden -> blocked (no id)
update public.houses set status = 'hidden', hidden_reason = 'test' where id = split_part(current_setting('t.r1'), '|', 2)::uuid;
select test_helpers.as_user('c3000000-0000-4000-a000-000000000001');
set local role authenticated;
select is(test_helpers.submit('100 Testfixture Rd, Truckee, CA', 'ChIJfixture000001'), 'blocked|',
          'hidden house -> blocked with null id (same place_id)');
select is(test_helpers.submit('100 Testfixture Rd, Truckee, CA', 'ChIJfixture000077'), 'blocked|',
          'hidden house -> blocked with null id (same normalized address)');
reset role;
select is((select count(*)::int from private.quota_events where uid = 'c3000000-0000-4000-a000-000000000001'),
          1, 'blocked submits did not consume quota');

-- released -> re-add allowed
update public.houses set status = 'released', released_at = now(), place_id = null,
       normalized_address = normalized_address || '#released:' || id::text
 where id = split_part(current_setting('t.r1'), '|', 2)::uuid;
select test_helpers.as_user('c3000000-0000-4000-a000-000000000001');
set local role authenticated;
select set_config('t.r2', test_helpers.submit('100 Testfixture Rd, Truckee, CA', 'ChIJfixture000001'), true);
select is(split_part(current_setting('t.r2'), '|', 1), 'created', 'after release, re-adding the same house is created');
select isnt(split_part(current_setting('t.r2'), '|', 2), split_part(current_setting('t.r1'), '|', 2), 're-add gets a new id');

-- ---------------------------------------------------------------- validation errors (message + SQLSTATE)
select throws_ok($$select test_helpers.submit('<b>1 Main</b>', 'ChIJfixture000002')$$, '22023', 'invalid_address', 'invalid characters -> invalid_address');
select is(test_helpers.err($$select test_helpers.submit('<b>1 Main</b>', 'ChIJfixture000002')$$), '22023:invalid_address:characters', 'detail characters');
select throws_ok($$select test_helpers.submit('Main Street, Truckee', 'ChIJfixture000002')$$, '22023', 'invalid_address', 'no house number -> invalid_address');
select is(test_helpers.err($$select test_helpers.submit('Main Street, Truckee', 'ChIJfixture000002')$$), '22023:invalid_address:house_number', 'detail house_number');
select throws_ok(format('select test_helpers.submit(%L, %L)', '1 ' || repeat('a', 119), 'ChIJfixture000002'), '22023', 'invalid_address', '121 chars -> invalid_address');
select is(test_helpers.err(format('select test_helpers.submit(%L, %L)', '1 ' || repeat('a', 119), 'ChIJfixture000002')), '22023:invalid_address:length', 'detail length');
select is(char_length('1 ' || repeat('a', 119)), 121, 'the long fixture is 121 chars');
select throws_ok($$select test_helpers.submit('123 Address Not Found', 'ChIJfixture000002')$$, '22023', 'invalid_address', 'denylist -> invalid_address');
select is(test_helpers.err($$select test_helpers.submit('123 Address Not Found', 'ChIJfixture000002')$$), '22023:invalid_address:denylist', 'detail denylist');
reset role;
insert into private.blocked_terms (term) values ('zzbadterm');
select test_helpers.as_user('c3000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok($$select test_helpers.submit('12 Zzbadterm Rd, Truckee', 'ChIJfixture000002')$$, '22023', 'invalid_address', 'blocked term -> invalid_address');
select is(test_helpers.err($$select test_helpers.submit('12 Zzbadterm Rd, Truckee', 'ChIJfixture000002')$$), '22023:invalid_address:blocked_term', 'detail blocked_term');
select is(test_helpers.err($$select test_helpers.submit('12 Fuck Rd, Truckee', 'ChIJfixture000002')$$), '22023:invalid_address:blocked_term', 'a migration-seeded blocked term is rejected');
select throws_ok($$select test_helpers.submit('5 Edge Rd, Truckee', 'ChIJfixture000002', 40.0, -120.18)$$, '22023', 'out_of_bounds', 'lat 40.0 -> out_of_bounds');
select throws_ok($$select test_helpers.submit('5 Edge Rd, Truckee', 'ChIJfixture000002', 39.33, -119.0)$$, '22023', 'out_of_bounds', 'lng outside bbox -> out_of_bounds');
select throws_ok($$select test_helpers.submit('5 Edge Rd, Truckee', 'ChIJfixture000002', null, -120.18)$$, '22023', 'invalid_coordinates', 'null lat -> invalid_coordinates');
select throws_ok($$select test_helpers.submit('5 Edge Rd, Truckee', 'ChIJfixture000002', 'NaN'::float8, -120.18)$$, '22023', 'out_of_bounds', 'NaN lat -> out_of_bounds');
select throws_ok($$select test_helpers.submit('5 Edge Rd, Truckee', 'ChIJfixture000002', 39.33, 'Infinity'::float8)$$, '22023', 'out_of_bounds', 'Infinity lng -> out_of_bounds');
select throws_ok($$select test_helpers.submit('5 Edge Rd, Truckee', 'ChIJfixture000002', 39.33, -120.18, 'nope')$$, 'P0002', 'region_not_found', 'unknown slug -> region_not_found');
select throws_ok($$select test_helpers.submit('5 Edge Rd, Testville', 'ChIJfixture000002', 10.5, 10.5, 'testville')$$, 'P0002', 'region_not_found', 'inactive region -> region_not_found');
select throws_ok($$select test_helpers.submit('5 Edge Rd, Truckee', 'abc')$$, '22023', 'invalid_place_id', 'bad place_id -> invalid_place_id');
select throws_ok($$select test_helpers.submit('5 Edge Rd, Truckee', null)$$, '22023', 'invalid_place_id', 'null place_id -> invalid_place_id');
select throws_ok($$select test_helpers.submit('5 Edge Rd, Truckee', 'ChIJ<script>xx')$$, '22023', 'invalid_place_id', 'place_id with bad characters -> invalid_place_id');
reset role;
update public.site_settings s set submissions_open = false from public.regions r where r.id = s.region_id and r.slug = 'truckee';
select test_helpers.as_user('c3000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok($$select test_helpers.submit('5 Edge Rd, Truckee', 'ChIJfixture000002')$$, 'P0001', 'submissions_closed', 'closed submissions -> submissions_closed');
reset role;
update public.site_settings s set submissions_open = true from public.regions r where r.id = s.region_id and r.slug = 'truckee';

-- Not signed in / anon role.
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select test_helpers.submit('5 Edge Rd, Truckee', 'ChIJfixture000002')$$, '28000', 'not_signed_in', 'authenticated without sub -> not_signed_in');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$select * from public.submit_house('truckee', 'ChIJfixture000002', '5 Edge Rd, Truckee', 39.33, -120.18)$$, '42501', null, 'anon cannot execute submit_house');
reset role;
select is((select count(*)::int from public.houses), 2, 'no rejected submit wrote a row');

-- Backstop: the bbox trigger rejects direct out-of-bounds inserts even by the owner.
select throws_ok($$insert into public.houses (region_id, season, year, address, normalized_address, lat, lng, coord_source)
                   select id, 'halloween', 2026, '1 Far Rd', '1 far rd', 45.0, -120.2, 'admin' from public.regions where slug = 'truckee'$$,
                 '23514', 'out_of_bounds', 'bbox trigger rejects out-of-bounds rows');

-- ---------------------------------------------------------------- street-level check (AC25)
select test_helpers.as_user('c3000000-0000-4000-a000-000000000001');
set local role authenticated;
select is(test_helpers.err($$select test_helpers.submit('123 Truckee', 'ChIJfixture000003')$$), '22023:invalid_address:street_level', '"123 Truckee" -> street_level');
select is(test_helpers.err($$select test_helpers.submit('123 Truckee CA, USA', 'ChIJfixture000003')$$), '22023:invalid_address:street_level', '"123 Truckee CA, USA" -> street_level');
select is(test_helpers.err($$select test_helpers.submit('45 CA', 'ChIJfixture000003')$$), '22023:invalid_address:street_level', '"45 CA" -> street_level');
select is(test_helpers.err($$select test_helpers.submit('123 4567', 'ChIJfixture000003')$$), '22023:invalid_address:street_level', '"123 4567" -> street_level');
select is(test_helpers.err($$select test_helpers.submit('7 A B', 'ChIJfixture000003')$$), '22023:invalid_address:street_level', '"7 A B" -> street_level');
reset role;
select lives_ok($$select private.assert_street_level('10013 Jibboom St', 'Truckee')$$, '"10013 Jibboom St" passes the street-level check');
select lives_ok($$select private.assert_street_level('15212 Waterloo Cir, Truckee, CA 96161, USA', 'Truckee')$$, '"15212 Waterloo Cir, Truckee, CA 96161, USA" passes');
select lives_ok($$select private.assert_street_level('12B Donner Pass Rd', 'Truckee')$$, '"12B Donner Pass Rd" passes');
select test_helpers.as_user('c3000000-0000-4000-a000-000000000007');
set local role authenticated;
select is(split_part(test_helpers.submit('10013 Jibboom St', 'ChIJfixture000701'), '|', 1), 'created', '"10013 Jibboom St" is created');
select is(split_part(test_helpers.submit('15212 Waterloo Cir, Truckee, CA 96161, USA', 'ChIJfixture000702'), '|', 1), 'created', '"15212 Waterloo Cir, Truckee, CA 96161, USA" is created');
select is(split_part(test_helpers.submit('12B Donner Pass Rd', 'ChIJfixture000703'), '|', 1), 'created', '"12B Donner Pass Rd" is created');
reset role;

-- ---------------------------------------------------------------- per-uid quota (AC6) + duplicates after quota (AC24)
select test_helpers.as_user('c3000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(split_part(test_helpers.submit('201 Quota Rd, Truckee', 'ChIJfixture000201'), '|', 1), 'created', 'quota: create 1');
select is(split_part(test_helpers.submit('202 Quota Rd, Truckee', 'ChIJfixture000202'), '|', 1), 'created', 'quota: create 2');
select is(split_part(test_helpers.submit('203 Quota Rd, Truckee', 'ChIJfixture000203'), '|', 1), 'created', 'quota: create 3');
select is(split_part(test_helpers.submit('204 Quota Rd, Truckee', 'ChIJfixture000204'), '|', 1), 'created', 'quota: create 4');
select is(split_part(test_helpers.submit('205 Quota Rd, Truckee', 'ChIJfixture000205'), '|', 1), 'created', 'quota: create 5');
select throws_ok($$select test_helpers.submit('206 Quota Rd, Truckee', 'ChIJfixture000206')$$, 'P0001', 'rate_limited', 'quota: 6th create -> rate_limited');
select is(test_helpers.err($$select test_helpers.submit('206 Quota Rd, Truckee', 'ChIJfixture000206')$$), 'P0001:rate_limited:uid_hourly', 'detail uid_hourly');
select is(split_part(test_helpers.submit('203 Quota Rd, Truckee', 'ChIJfixture000203'), '|', 1), 'exists_visible',
          'with the quota used up, resubmitting one of the 5 -> exists_visible, not rate_limited');
select is(split_part(test_helpers.submit('203  QUOTA RD , Truckee, USA', 'ChIJfixture000999'), '|', 1), 'exists_visible',
          'with the quota used up, a normalized-address duplicate -> exists_visible');
reset role;
select is((select count(*)::int from private.quota_events where uid = 'c3000000-0000-4000-a000-000000000002'),
          5, 'exactly 5 quota events for the capped uid (rejections and duplicates add none)');

-- Events older than 61 minutes don't count.
insert into private.quota_events (kind, uid, region_id, created_at)
select 'house', 'c3000000-0000-4000-a000-000000000003', id, now() - interval '61 minutes'
  from public.regions, generate_series(1, 5) where slug = 'truckee';
select test_helpers.as_user('c3000000-0000-4000-a000-000000000003');
set local role authenticated;
select is(split_part(test_helpers.submit('301 Oldquota Rd, Truckee', 'ChIJfixture000301'), '|', 1), 'created', 'events older than 61 minutes do not count');
reset role;

-- Region breaker: 60 events in the last 10 minutes trips it; 59 does not.
delete from private.quota_events;
insert into private.quota_events (kind, uid, region_id, created_at)
select 'house', 'c3000000-0000-4000-a000-000000000005', id, now() - interval '5 minutes'
  from public.regions, generate_series(1, 59) where slug = 'truckee';
select test_helpers.as_user('c3000000-0000-4000-a000-000000000004');
set local role authenticated;
select is(split_part(test_helpers.submit('401 Breaker Rd, Truckee', 'ChIJfixture000401'), '|', 1), 'created', 'region breaker: 59 recent events -> still created');
reset role;
select test_helpers.as_user('c3000000-0000-4000-a000-000000000006');
set local role authenticated;
select throws_ok($$select test_helpers.submit('601 Breaker Rd, Truckee', 'ChIJfixture000601')$$, 'P0001', 'rate_limited', 'region breaker: 60 recent events -> rate_limited');
select is(test_helpers.err($$select test_helpers.submit('601 Breaker Rd, Truckee', 'ChIJfixture000601')$$), 'P0001:rate_limited:region_breaker', 'detail region_breaker');
select is(split_part(test_helpers.submit('401 Breaker Rd, Truckee', 'ChIJfixture000401'), '|', 1), 'exists_visible', 'a duplicate still returns exists_visible while the breaker is tripped');
reset role;
select is((select count(*)::int from private.quota_events), 60, 'breaker rejections and duplicates add no quota events');

-- The client cannot choose the season: rows always get the active pair.
select is((select count(*)::int from public.houses where (season, year) <> ('halloween', 2026) and status <> 'released'), 0,
          'every submitted row has the active (season, year)');

select * from finish();
rollback;
