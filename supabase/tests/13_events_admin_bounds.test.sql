-- Spec_Events Amendment 3 ("Worth the drive", admin-only): private.event_bounds_admin pins the admin box, the admin
-- RPCs accept Reno-area points, submit_event and the local box still reject them, the trigger backstop is the admin
-- box, and the admin RPC grants are unchanged by the re-created helpers.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- ---------------------------------------------------------------- fixtures (as postgres)
delete from public.admins;
delete from private.quota_events;
update public.site_settings s set active_season = 'halloween', active_year = 2026, events_open = true
  from public.regions r where r.id = s.region_id and r.slug = 'truckee';
select set_config('t.truckee', (select id::text from public.regions where slug = 'truckee'), true);
insert into auth.users (id, aud, role, email) values
  ('ab000000-0000-4000-a000-000000000001', 'authenticated', 'authenticated', 'abvisitor@example.test'),
  ('ab000000-0000-4000-a000-0000000000a1', 'authenticated', 'authenticated', 'abadmin@example.test');
insert into public.admins (user_id, region_id, note) values
  ('ab000000-0000-4000-a000-0000000000a1', current_setting('t.truckee')::uuid, 'test truckee region admin');

create schema test_ab;
grant usage on schema test_ab to authenticated;
create function test_ab.err(p_sql text) returns text language plpgsql as $$
declare st text; msg text; det text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics st = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return st || ':' || msg || ':' || coalesce(det, '');
end $$;
create function test_ab.claims(p_uid text, p_anon boolean, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', p_anon, 'aal', p_aal)::text, true)::text
$$;
create function test_ab.submit(p_title text, p_lat double precision, p_lng double precision) returns text
language sql as $$
  select s.result from public.submit_event('truckee', p_title, 'A made-up test event for the bounds.', null,
                                           'Somewhere Plaza, Reno, NV', null, p_lat, p_lng,
                                           now() + interval '2 days', null, null, false) s
$$;
create function test_ab.create(p_title text, p_lat double precision, p_lng double precision) returns uuid
language sql as $$
  select public.admin_create_event(current_setting('t.truckee')::uuid, p_title, 'Our own wording for a test event.',
                                   null, 'Somewhere Plaza, Reno, NV', null, p_lat, p_lng,
                                   now() + interval '3 days', null, null, false, null)
$$;
create function test_ab.move(p_id uuid, p_lat double precision, p_lng double precision) returns void
language sql as $$
  select public.admin_update_event(p_id, 'Moved Test Event', 'Our own wording for a test event.', null,
                                   'Somewhere Plaza, Reno, NV', null, p_lat, p_lng,
                                   now() + interval '4 days', null, null, false)
$$;
grant execute on all functions in schema test_ab to authenticated;

-- ---------------------------------------------------------------- the two boxes
select results_eq(format('select round(min_lat::numeric, 6), round(max_lat::numeric, 6), round(min_lng::numeric, 6), round(max_lng::numeric, 6) from private.event_bounds_admin(%L)', current_setting('t.truckee')),
  $$values (39.090000::numeric, 39.600000::numeric, -120.470000::numeric, -119.600000::numeric)$$,
  'event_bounds_admin = lat 39.09-39.60, lng -120.47 to -119.60 (TS eventBoundsAdmin mirrors this)');
select results_eq(format('select round(min_lat::numeric, 6), round(max_lat::numeric, 6), round(min_lng::numeric, 6), round(max_lng::numeric, 6) from private.event_bounds(%L)', current_setting('t.truckee')),
  $$values (39.100000::numeric, 39.500000::numeric, -120.470000::numeric, -119.880000::numeric)$$,
  'the local box (event_bounds) is unchanged: lat 39.10-39.50, lng -120.47 to -119.88');

select ok(private.in_event_bounds_admin(current_setting('t.truckee')::uuid, 39.328, -120.183), 'admin box: Truckee inside');
select ok(private.in_event_bounds_admin(current_setting('t.truckee')::uuid, 39.1979, -119.9306), 'admin box: Sand Harbor inside');
select ok(private.in_event_bounds_admin(current_setting('t.truckee')::uuid, 39.545, -119.825), 'admin box: Reno (Wilbur May Arboretum) inside');
select ok(private.in_event_bounds_admin(current_setting('t.truckee')::uuid, 39.164, -119.767), 'admin box: Carson City inside');
select ok(not private.in_event_bounds_admin(current_setting('t.truckee')::uuid, 38.94, -119.75), 'admin box: Gardnerville outside');
select ok(not private.in_event_bounds_admin(current_setting('t.truckee')::uuid, 39.61, -119.25), 'admin box: Fernley outside');
select ok(not private.in_event_bounds_admin(current_setting('t.truckee')::uuid, 'NaN'::float8, -119.8), 'admin box: NaN lat outside');
select ok(not private.in_event_bounds_admin(current_setting('t.truckee')::uuid, 39.5, 'Infinity'::float8), 'admin box: Infinity lng outside');
select ok(not private.in_event_bounds_admin(gen_random_uuid(), 39.328, -120.183), 'admin box: unknown region -> false');
select ok(not private.in_event_bounds(current_setting('t.truckee')::uuid, 39.545, -119.825), 'local box: Reno still outside');
select ok(not private.in_event_bounds(current_setting('t.truckee')::uuid, 39.164, -119.767), 'local box: Carson City still outside');

-- ---------------------------------------------------------------- visitors: submit_event keeps the local box
select test_ab.claims('ab000000-0000-4000-a000-000000000001', true, 'aal1');
set local role authenticated;
select is(test_ab.err($$select test_ab.submit('Reno Visitor Event', 39.545, -119.825)$$), '22023:out_of_bounds:',
          'submit_event at Reno -> out_of_bounds');
select is(test_ab.err($$select test_ab.submit('Carson Visitor Event', 39.164, -119.767)$$), '22023:out_of_bounds:',
          'submit_event at Carson City -> out_of_bounds');
select is(test_ab.submit('Truckee Visitor Event', 39.33, -120.18), 'created', 'submit_event inside the local box still works');
reset role;
select is((select count(*)::int from public.events where title in ('Reno Visitor Event', 'Carson Visitor Event')), 0,
          'no out-of-bounds visitor row was inserted');

-- ---------------------------------------------------------------- admins: create/update use the admin box
select test_ab.claims('ab000000-0000-4000-a000-0000000000a1', false, 'aal2');
set local role authenticated;
select set_config('t.reno', test_ab.create('Reno Worth The Drive', 39.545, -119.825)::text, true);
select set_config('t.carson', test_ab.create('Carson Worth The Drive', 39.164, -119.767)::text, true);
select is(test_ab.err($$select test_ab.create('Gardnerville Event', 38.94, -119.75)$$), '22023:out_of_bounds:',
          'admin_create_event at Gardnerville -> out_of_bounds');
select is(test_ab.err($$select test_ab.create('Fernley Event', 39.61, -119.25)$$), '22023:out_of_bounds:',
          'admin_create_event at Fernley -> out_of_bounds');
select is(test_ab.err($$select test_ab.create('NaN Event', 'NaN'::float8, -119.8)$$), '22023:out_of_bounds:',
          'admin_create_event with NaN lat -> out_of_bounds');
select is(test_ab.err($$select test_ab.create('ab', 39.545, -119.825)$$), '22023:invalid_input:title',
          'admin_create_event still validates fields before bounds');
reset role;
select results_eq(format('select status::text, source, round(lat::numeric, 3), round(lng::numeric, 3) from public.events where id = %L', current_setting('t.reno')),
  $$values ('approved', 'seed', 39.545::numeric, -119.825::numeric)$$, 'admin_create_event at Reno inserts an approved seed row');
select is((select count(*)::int from public.events where id = current_setting('t.carson')::uuid and status = 'approved'), 1,
          'admin_create_event at Carson City inserts an approved row');
select is((select count(*)::int from public.events where title in ('Gardnerville Event', 'Fernley Event', 'NaN Event')), 0,
          'no out-of-bounds admin row was inserted');

select set_config('t.local', (select e.id::text from public.events e where e.title = 'Truckee Visitor Event'), true);
select test_ab.claims('ab000000-0000-4000-a000-0000000000a1', false, 'aal2');
set local role authenticated;
select lives_ok(format('select test_ab.move(%L, 39.545, -119.825)', current_setting('t.local')),
                'admin_update_event may move a row to Reno');
select is(test_ab.err(format('select test_ab.move(%L, 39.61, -119.25)', current_setting('t.local'))), '22023:out_of_bounds:',
          'admin_update_event to Fernley -> out_of_bounds');
reset role;
select results_eq(format('select round(lat::numeric, 3), round(lng::numeric, 3) from public.events where id = %L', current_setting('t.local')),
  $$values (39.545::numeric, -119.825::numeric)$$, 'the moved row is at Reno');

-- ---------------------------------------------------------------- trigger backstop = admin box
select lives_ok($$insert into public.events (region_id, season, year, title, description, address, lat, lng, starts_at)
                  values (current_setting('t.truckee')::uuid, 'halloween', 2026, 'Raw Reno Row', 'Raw fixture description.',
                          'Somewhere Plaza, Reno', 39.545, -119.825, now() + interval '1 day')$$,
                'the trigger accepts a raw insert inside the admin box (Reno)');
select throws_ok($$insert into public.events (region_id, season, year, title, description, address, lat, lng, starts_at)
                   values (current_setting('t.truckee')::uuid, 'halloween', 2026, 'Raw Fernley Row', 'Raw fixture description.',
                           'Somewhere Plaza, Fernley', 39.61, -119.25, now() + interval '1 day')$$,
                 '23514', 'out_of_bounds', 'the trigger rejects a raw insert outside the admin box (Fernley)');

-- ---------------------------------------------------------------- grants unchanged
select ok(has_function_privilege('authenticated', 'public.admin_create_event(uuid, text, text, text, text, text, double precision, double precision, timestamp with time zone, timestamp with time zone, text, boolean, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.admin_create_event(uuid, text, text, text, text, text, double precision, double precision, timestamp with time zone, timestamp with time zone, text, boolean, text)', 'EXECUTE'),
          'admin_create_event: authenticated only (grant unchanged)');
select ok(has_function_privilege('authenticated', 'public.admin_update_event(uuid, text, text, text, text, text, double precision, double precision, timestamp with time zone, timestamp with time zone, text, boolean)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.admin_update_event(uuid, text, text, text, text, text, double precision, double precision, timestamp with time zone, timestamp with time zone, text, boolean)', 'EXECUTE'),
          'admin_update_event: authenticated only (grant unchanged)');
select ok(has_function_privilege('authenticated', 'public.submit_event(text, text, text, text, text, text, double precision, double precision, timestamp with time zone, timestamp with time zone, text, boolean)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.submit_event(text, text, text, text, text, text, double precision, double precision, timestamp with time zone, timestamp with time zone, text, boolean)', 'EXECUTE'),
          'submit_event: authenticated only (grant unchanged)');
select is(
  (select coalesce(array_agg(format('%s:%s', r.role, p.proname) order by r.role, p.proname), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join (values ('public'), ('anon'), ('authenticated')) r(role)
    where n.nspname = 'private'
      and p.proname in ('event_bounds_admin', 'in_event_bounds_admin', 'clean_event', 'events_before_write')
      and (r.role = 'public' and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                          where a.grantee = 0 and a.privilege_type = 'EXECUTE')
           or r.role <> 'public' and has_function_privilege(r.role, p.oid, 'EXECUTE'))),
  '{}'::text[], 'the new and re-created private helpers are not executable by PUBLIC, anon or authenticated');
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('event_bounds_admin', 'in_event_bounds_admin', 'clean_event', 'events_before_write')
      and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false))),
  '{}'::text[], 'the helpers are not security definer and pin search_path = ''''');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('admin_create_event', 'admin_update_event', 'submit_event')
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  array['admin_create_event', 'admin_update_event', 'submit_event'],
  'the three event write RPCs are still security definer with search_path = ''''');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('admin_create_event', 'admin_update_event')), 2,
          'one overload each of admin_create_event and admin_update_event');

select * from finish();
rollback;
