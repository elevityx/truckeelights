-- House votes: AC1-AC14d (vote path, limits, voids, photo hearts, photo counts, season switch) and
-- AC26-AC33c (network cap, fail open, retention, probe, cap switch). Headers are injected with
-- set_config('request.headers', ..., true); identities with request.jwt.claims. Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(116);

-- ---------------------------------------------------------------- fixtures (as postgres)
delete from private.vote_events;
delete from private.vote_salts;
delete from public.house_vote_totals;
update public.app_settings set vote_network_cap = false;   -- off unless a test turns it on
update public.site_settings s set active_season = 'halloween', active_year = 2026, votes_open = true
  from public.regions r where r.id = s.region_id and r.slug in ('truckee', 'testville');
update public.regions set is_active = true where slug = 'testville';
select set_config('t.truckee', (select id::text from public.regions where slug = 'truckee'), true);
select set_config('t.testville', (select id::text from public.regions where slug = 'testville'), true);
select set_config('t.today', (now() at time zone 'America/Los_Angeles')::date::text, true);

insert into auth.users (id, aud, role, email)
select ('e1200000-0000-4000-a000-0000000000' || x)::uuid, 'authenticated', 'authenticated', 'u12' || x || '@example.test'
  from unnest(array['a1', 'a2', 'a3']) x;
insert into public.admins (user_id, region_id, note) values
  ('e1200000-0000-4000-a000-0000000000a1', null, 'test global'),
  ('e1200000-0000-4000-a000-0000000000a2', current_setting('t.testville')::uuid, 'test testville');

-- a01..a20 visible Truckee houses; b1 hidden, b2 released, b3 past season; c01..c11 Testville.
insert into public.houses (id, region_id, season, year, address, normalized_address, lat, lng, coord_source, status, released_at)
select ('e1200000-0000-4000-a000-0000000a' || lpad(g::text, 4, '0'))::uuid, current_setting('t.truckee')::uuid,
       'halloween', 2026, g || ' Twelve Rd', g || ' twelve rd #12', 39.30, -120.20, 'admin', 'visible', null
  from generate_series(1, 20) g;
insert into public.houses (id, region_id, season, year, address, normalized_address, lat, lng, coord_source, status, released_at)
values ('e1200000-0000-4000-a000-0000000b0001', current_setting('t.truckee')::uuid, 'halloween', 2026, '1 Hidden Rd', '1 hidden rd #12', 39.3, -120.2, 'admin', 'hidden', null),
       ('e1200000-0000-4000-a000-0000000b0002', current_setting('t.truckee')::uuid, 'halloween', 2026, '2 Released Rd', '2 released rd #12', 39.3, -120.2, 'admin', 'released', now()),
       ('e1200000-0000-4000-a000-0000000b0003', current_setting('t.truckee')::uuid, 'christmas', 2024, '3 Past Rd', '3 past rd #12', 39.3, -120.2, 'admin', 'visible', null);
insert into public.houses (id, region_id, season, year, address, normalized_address, lat, lng, coord_source, status)
select ('e1200000-0000-4000-a000-0000000c' || lpad(g::text, 4, '0'))::uuid, current_setting('t.testville')::uuid,
       'halloween', 2026, g || ' Testtwelve Rd', g || ' testtwelve rd #12', 10.5, 10.5, 'admin', 'visible'
  from generate_series(1, 11) g;

-- Photos: a10 has approved P1, pending P2, rejected P3, revoked P4, expired P5; a11 has approved P6;
-- a12 has only pending/rejected/revoked; hidden b1 and past-season b3 each have an approved photo.
insert into public.photos (id, house_id, upload_path, public_path, status, reserved_until, moderated_at)
select v.id::uuid, v.house::uuid, v.house || '/' || v.id || '.jpg',
       case when v.status = 'approved' then v.house || '/' || gen_random_uuid() || '.jpg' end,
       v.status::public.photo_status, now(), now()
  from (values
    ('e1200000-0000-4000-a000-00000000f001', 'e1200000-0000-4000-a000-0000000a0010', 'approved'),
    ('e1200000-0000-4000-a000-00000000f002', 'e1200000-0000-4000-a000-0000000a0010', 'pending'),
    ('e1200000-0000-4000-a000-00000000f003', 'e1200000-0000-4000-a000-0000000a0010', 'rejected'),
    ('e1200000-0000-4000-a000-00000000f004', 'e1200000-0000-4000-a000-0000000a0010', 'revoked'),
    ('e1200000-0000-4000-a000-00000000f005', 'e1200000-0000-4000-a000-0000000a0010', 'expired'),
    ('e1200000-0000-4000-a000-00000000f006', 'e1200000-0000-4000-a000-0000000a0011', 'approved'),
    ('e1200000-0000-4000-a000-00000000f007', 'e1200000-0000-4000-a000-0000000a0012', 'pending'),
    ('e1200000-0000-4000-a000-00000000f008', 'e1200000-0000-4000-a000-0000000a0012', 'rejected'),
    ('e1200000-0000-4000-a000-00000000f009', 'e1200000-0000-4000-a000-0000000a0012', 'revoked'),
    ('e1200000-0000-4000-a000-00000000f010', 'e1200000-0000-4000-a000-0000000b0001', 'approved'),
    ('e1200000-0000-4000-a000-00000000f011', 'e1200000-0000-4000-a000-0000000b0003', 'approved')
  ) v(id, house, status);

create schema test_helpers;
grant usage on schema test_helpers to anon, authenticated;
create function test_helpers.h(n int) returns uuid language sql immutable as $$
  select ('e1200000-0000-4000-a000-0000000a' || lpad(n::text, 4, '0'))::uuid $$;
create function test_helpers.claims(p_uid uuid, p_anon boolean default true, p_aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_uid is null then '' else
      json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', p_anon, 'aal', p_aal)::text end, true)::text $$;
create function test_helpers.hdr(p text) returns void language sql as $$
  select set_config('request.headers', coalesce(p, ''), true)::text $$;
-- "message/detail" of the error a statement raises, or 'ok'.
create function test_helpers.err(q text) returns text language plpgsql as $$
declare m text; d text;
begin
  execute q; return 'ok';
exception when others then
  get stacked diagnostics m = message_text, d = pg_exception_detail;
  return m || coalesce('/' || nullif(d, ''), '');
end $$;
-- One vote as p_uid: 'ok/<total>/<left>' or the error.
create function test_helpers.v(p_uid uuid, p_house uuid, p_photo uuid default null) returns text language plpgsql as $$
declare r record; m text; d text;
begin
  perform test_helpers.claims(p_uid);
  select * into r from public.vote_house(p_house, p_photo);
  return 'ok/' || r.total_votes || '/' || r.left_today;
exception when others then
  get stacked diagnostics m = message_text, d = pg_exception_detail;
  return m || coalesce('/' || nullif(d, ''), '');
end $$;
-- p_uids fresh uids x p_per votes on one house under header p_hdr. Returns 'ok=<n>' plus any distinct errors.
create function test_helpers.burst(p_house uuid, p_uids int, p_per int, p_hdr text) returns text language plpgsql as $$
declare u uuid; n int := 0; errs text[] := '{}'; r text;
begin
  perform test_helpers.hdr(p_hdr);
  for i in 1..p_uids loop
    u := gen_random_uuid();
    for j in 1..p_per loop
      r := test_helpers.v(u, p_house);
      if r like 'ok/%' then n := n + 1; elsif not r = any(errs) then errs := errs || r; end if;
    end loop;
  end loop;
  return 'ok=' || n || coalesce(' ' || nullif(array_to_string(errs, ','), ''), '');
end $$;
create function test_helpers.err_as(p_uid uuid, p_anon boolean, p_aal text, q text) returns text language plpgsql as $$
begin
  perform test_helpers.claims(p_uid, p_anon, p_aal);
  return test_helpers.err(q);
end $$;
create function test_helpers.total(p_house uuid) returns int language sql as $$
  select coalesce((select votes from public.house_vote_totals where house_id = p_house), 0) $$;
grant execute on all functions in schema test_helpers to anon, authenticated;

-- ================================================================ AC1 / AC2: ledger private, totals public-by-visibility
select ok((select c.relrowsecurity and c.relforcerowsecurity from pg_class c where c.oid = 'private.vote_events'::regclass),
          'AC1: vote_events RLS enabled and forced');
select is((select count(*)::int from pg_policies where schemaname = 'private' and tablename = 'vote_events'), 0, 'AC1: vote_events has no policies');
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'private' and table_name in ('vote_events', 'vote_salts')
              and grantee in ('anon', 'authenticated', 'public')), 0, 'AC1: no grants on vote_events / vote_salts');
set local role anon;
select throws_ok('select * from private.vote_events', '42501', null, 'AC1: anon select vote_events -> 42501');
reset role;
set local role authenticated;
select throws_ok('select * from private.vote_events', '42501', null, 'AC1: authenticated select vote_events -> 42501');
reset role;

insert into public.house_vote_totals (house_id, region_id, votes) values
  (test_helpers.h(20), current_setting('t.truckee')::uuid, 7),
  ('e1200000-0000-4000-a000-0000000b0001', current_setting('t.truckee')::uuid, 3),
  ('e1200000-0000-4000-a000-0000000b0002', current_setting('t.truckee')::uuid, 4),
  ('e1200000-0000-4000-a000-0000000b0003', current_setting('t.truckee')::uuid, 5);
select test_helpers.claims(null);
set local role anon;
select results_eq($$select house_id, votes from public.house_vote_totals where house_id::text like 'e1200000-%' order by house_id$$,
  $$values (test_helpers.h(20), 7)$$, 'AC2: anon sees the visible active-season total only (not hidden/released/past)');
select throws_ok('select updated_at from public.house_vote_totals', '42501', null, 'AC2: updated_at is not granted');
select throws_ok($$update public.house_vote_totals set votes = 0$$, '42501', null, 'AC2: no write grant on totals');
reset role;
delete from public.house_vote_totals;

-- ================================================================ AC3: session, switch, visibility
select is(test_helpers.v(null, test_helpers.h(1)), 'not_signed_in', 'AC3: no session -> not_signed_in');
update public.site_settings set votes_open = false where region_id = current_setting('t.truckee')::uuid;
select is(test_helpers.v(gen_random_uuid(), test_helpers.h(1)), 'votes_closed', 'AC3: votes_open = false -> votes_closed');
update public.site_settings set votes_open = true where region_id = current_setting('t.truckee')::uuid;
select is(test_helpers.v(gen_random_uuid(), 'e1200000-0000-4000-a000-0000000b0001'), 'not_found', 'AC3: hidden -> not_found');
select is(test_helpers.v(gen_random_uuid(), 'e1200000-0000-4000-a000-0000000b0002'), 'not_found', 'AC3: released -> not_found');
select is(test_helpers.v(gen_random_uuid(), 'e1200000-0000-4000-a000-0000000b0003'), 'not_found', 'AC3: past season -> not_found');
select is(test_helpers.v(gen_random_uuid(), gen_random_uuid()), 'not_found', 'AC3: unknown house -> not_found');
select is(test_helpers.v(gen_random_uuid(), null), 'invalid_input', 'null house -> invalid_input');

-- ================================================================ AC4 / AC5: 5 per device per house per day
select set_config('t.u1', gen_random_uuid()::text, true);
select is(array[test_helpers.v(current_setting('t.u1')::uuid, test_helpers.h(1)),
                test_helpers.v(current_setting('t.u1')::uuid, test_helpers.h(1)),
                test_helpers.v(current_setting('t.u1')::uuid, test_helpers.h(1)),
                test_helpers.v(current_setting('t.u1')::uuid, test_helpers.h(1)),
                test_helpers.v(current_setting('t.u1')::uuid, test_helpers.h(1))],
          array['ok/1/4', 'ok/2/3', 'ok/3/2', 'ok/4/1', 'ok/5/0'], 'AC4: votes 1-5 return left 4..0 and total +1 each');
select is(test_helpers.v(current_setting('t.u1')::uuid, test_helpers.h(1)), 'rate_limited/house_daily', 'AC4: vote 6 -> rate_limited/house_daily');
select is(test_helpers.total(test_helpers.h(1)), 5, 'AC4: total unchanged by the rejected vote');
select is(test_helpers.v(current_setting('t.u1')::uuid, test_helpers.h(2)), 'ok/1/4', 'AC5: same uid on another house still has 5');
select is(test_helpers.v(gen_random_uuid(), test_helpers.h(1)), 'ok/6/4', 'AC5: a second uid on the same house has 5');
select is((select vote_day::text from private.vote_events where uid = current_setting('t.u1')::uuid limit 1),
          current_setting('t.today'), 'AC6: vote_day is the America/Los_Angeles date');

-- ================================================================ AC6: day boundary
select set_config('t.u2', gen_random_uuid()::text, true);
insert into private.vote_events (house_id, region_id, season, year, uid, vote_day, created_at)
select test_helpers.h(3), current_setting('t.truckee')::uuid, 'halloween', 2026, current_setting('t.u2')::uuid,
       current_setting('t.today')::date - 1, now() - interval '1 day'
  from generate_series(1, 5);
select is((select count(*)::int from generate_series(1, 5) g
            where test_helpers.v(current_setting('t.u2')::uuid, test_helpers.h(3)) like 'ok/%'), 5,
          'AC6: yesterday''s 5 do not count: 5 more today');
select is(test_helpers.v(current_setting('t.u2')::uuid, test_helpers.h(3)), 'rate_limited/house_daily', 'AC6: then the daily limit');

-- ================================================================ AC7: 60 per device per day
select set_config('t.u3', gen_random_uuid()::text, true);
insert into private.vote_events (house_id, region_id, season, year, uid, vote_day)
select ('e1200000-0000-4000-a000-0000000c' || lpad((1 + g % 11)::text, 4, '0'))::uuid, current_setting('t.testville')::uuid,
       'halloween', 2026, current_setting('t.u3')::uuid,
       current_setting('t.today')::date
  from generate_series(0, 59) g;
select is(test_helpers.v(current_setting('t.u3')::uuid, test_helpers.h(19)), 'rate_limited/uid_daily', 'AC7: 61st vote of the day -> uid_daily');

-- ================================================================ AC8: breakers
insert into private.vote_events (house_id, region_id, season, year, uid, vote_day)
select test_helpers.h(18), current_setting('t.truckee')::uuid, 'halloween', 2026, gen_random_uuid(), current_setting('t.today')::date
  from generate_series(1, 200);
select is(test_helpers.v(gen_random_uuid(), test_helpers.h(18)), 'rate_limited/house_breaker', 'AC8: 200 in 10 min on a house -> house_breaker');
insert into private.vote_events (house_id, region_id, season, year, uid, vote_day)
select ('e1200000-0000-4000-a000-0000000c' || lpad((1 + g % 10)::text, 4, '0'))::uuid, current_setting('t.testville')::uuid,
       'halloween', 2026, gen_random_uuid(), current_setting('t.today')::date
  from generate_series(1, 2000) g;
select is(test_helpers.v(gen_random_uuid(), 'e1200000-0000-4000-a000-0000000c0011'), 'rate_limited/region_breaker',
          'AC8: 2000 in 10 min in the region -> region_breaker');
delete from private.vote_events where region_id = current_setting('t.testville')::uuid or house_id = test_helpers.h(18);

-- ================================================================ AC9 / AC10 / AC11: admin void, reset, authz
select set_config('t.u4', gen_random_uuid()::text, true);
select set_config('t.u5', gen_random_uuid()::text, true);
select count(*) from generate_series(1, 5) g where test_helpers.v(current_setting('t.u4')::uuid, test_helpers.h(5)) like 'ok/%';
select count(*) from generate_series(1, 3) g where test_helpers.v(current_setting('t.u5')::uuid, test_helpers.h(5)) like 'ok/%';
select is(test_helpers.total(test_helpers.h(5)), 8, 'setup: house 5 has 8 votes');
select test_helpers.claims('e1200000-0000-4000-a000-0000000000a1', false, 'aal2');
select is(public.admin_void_votes(test_helpers.h(5), null, current_setting('t.u5')::uuid), 3, 'AC10: void top voter voids only that uid (3)');
select is(test_helpers.total(test_helpers.h(5)), (select count(*)::int from private.vote_events where house_id = test_helpers.h(5) and voided_at is null),
          'AC10: counter = non-voided events');
select is(test_helpers.total(test_helpers.h(5)), 5, 'AC10: 5 left');
select test_helpers.claims('e1200000-0000-4000-a000-0000000000a1', false, 'aal2');
select is(public.admin_void_votes(test_helpers.h(5), null, null), 5, 'AC9: reset voids every remaining event and returns the count');
select is(test_helpers.total(test_helpers.h(5)), 0, 'AC9: votes = 0 after reset');
select is((select count(*)::int from private.vote_events where house_id = test_helpers.h(5) and voided_at is not null
             and voided_by = 'e1200000-0000-4000-a000-0000000000a1'), 8, 'AC9: events are voided (soft), with voided_by');
select is(test_helpers.v(current_setting('t.u4')::uuid, test_helpers.h(5)), 'rate_limited/house_daily', 'AC9: voided votes still count toward house_daily');
select test_helpers.claims('e1200000-0000-4000-a000-0000000000a1', false, 'aal2');
select is(public.admin_void_votes(test_helpers.h(6), null, null), 0, 'void on a house with no totals row -> 0');
select is(public.admin_void_votes(test_helpers.h(1), now() + interval '1 hour', null), 0, 'void since a future time -> 0');
select is(test_helpers.err(format('select public.admin_void_votes(%L, null, null)', gen_random_uuid())), 'not_found', 'void on unknown house (global admin) -> not_found');

select is(
  (select array_agg(x) from (
     select test_helpers.err_as(c.uid, c.anon, c.aal, q.sql) as x
       from (values (null::uuid, true, 'aal1'), ('e1200000-0000-4000-a000-0000000000a3'::uuid, false, 'aal2'),
                    ('e1200000-0000-4000-a000-0000000000a1'::uuid, false, 'aal1'), (gen_random_uuid(), true, 'aal1')) c(uid, anon, aal)
      cross join (values
        (format('select public.admin_set_votes_open(%L, false)', current_setting('t.truckee'))),
        (format('select public.admin_vote_stats(%L)', current_setting('t.truckee'))),
        (format('select public.admin_void_votes(%L, null, null)', test_helpers.h(1))),
        ('select public.admin_set_network_cap(true)'),
        ('select public.admin_network_cap_status()')) q(sql)) t
    where x <> 'forbidden'),
  null, 'AC11: anonymous, non-admin, AAL1 admin, anonymous session -> forbidden on all 5 admin vote RPCs');
select test_helpers.claims('e1200000-0000-4000-a000-0000000000a2', false, 'aal2');
select is(test_helpers.err(format('select public.admin_void_votes(%L, null, null)', test_helpers.h(1))), 'forbidden', 'AC11: Testville admin cannot void a Truckee house');
select is(test_helpers.err(format('select public.admin_set_votes_open(%L, false)', current_setting('t.truckee'))), 'forbidden', 'AC11: Testville admin cannot close Truckee');
select is(test_helpers.err(format('select public.admin_set_votes_open(%L, true)', current_setting('t.testville'))), 'ok', 'region admin can switch their own region');
select test_helpers.claims('e1200000-0000-4000-a000-0000000000a1', false, 'aal2');
select is(test_helpers.err(format('select public.admin_set_votes_open(%L, null)', current_setting('t.truckee'))), 'invalid_input', 'admin_set_votes_open(null) -> invalid_input');
select lives_ok(format('select public.admin_set_votes_open(%L, false)', current_setting('t.truckee')), 'global admin closes voting');
select is((public.get_region_context('truckee') ->> 'votes_open')::boolean, false, 'get_region_context reports votes_open');
select lives_ok(format('select public.admin_set_votes_open(%L, true)', current_setting('t.truckee')), 'global admin reopens voting');

-- admin_vote_stats: activity excludes voided rows; voided counted; hashes never returned
select test_helpers.claims('e1200000-0000-4000-a000-0000000000a1', false, 'aal2');
select results_eq(
  format($$select total_votes, votes_today, votes_24h, voters_24h, top_voter, top_voter_24h, voided
             from public.admin_vote_stats(%L) where house_id = %L$$, current_setting('t.truckee'), test_helpers.h(1)),
  format($$values (6, 6, 6, 2, %L::uuid, 5, 0)$$, current_setting('t.u1')),
  'admin_vote_stats: totals, today, 24 h, voters, top voter for house 1');
select results_eq(
  format($$select total_votes, votes_today, votes_24h, voided from public.admin_vote_stats(%L) where house_id = %L$$,
         current_setting('t.truckee'), test_helpers.h(5)),
  $$values (0, 0, 0, 8)$$, 'admin_vote_stats: voided rows excluded from activity, counted in voided');
select is((select count(*)::int from public.admin_vote_stats(current_setting('t.truckee')::uuid)
            where house_id in ('e1200000-0000-4000-a000-0000000b0001', 'e1200000-0000-4000-a000-0000000b0003')), 0,
          'admin_vote_stats lists only visible active-season houses');

-- ================================================================ AC12 / AC14d: photo hearts
select set_config('t.u6', gen_random_uuid()::text, true);
select is(
  (select array_agg(test_helpers.v(current_setting('t.u6')::uuid, test_helpers.h(10), p::uuid) order by p)
     from unnest(array['e1200000-0000-4000-a000-00000000f002', 'e1200000-0000-4000-a000-00000000f003',
                       'e1200000-0000-4000-a000-00000000f004', 'e1200000-0000-4000-a000-00000000f005',
                       'e1200000-0000-4000-a000-00000000f006', 'e1200000-0000-4000-a000-00000000ffff']) p),
  array_fill('not_found/photo'::text, array[6]),
  'AC12: pending, rejected, revoked, expired, another house''s, unknown photo -> not_found/photo');
select is((select count(*)::int from private.vote_events where house_id = test_helpers.h(10)), 0, 'AC12: no event written');
select is(test_helpers.total(test_helpers.h(10)), 0, 'AC12: no counter change');
select is(test_helpers.v(current_setting('t.u6')::uuid, test_helpers.h(10), 'e1200000-0000-4000-a000-00000000f001'), 'ok/1/4',
          'AC14d: heart with an approved photo of the house succeeds');
select is((select photo_id from private.vote_events where house_id = test_helpers.h(10)), 'e1200000-0000-4000-a000-00000000f001'::uuid,
          'AC14d: the event stores photo_id');
select is(test_helpers.v(current_setting('t.u6')::uuid, test_helpers.h(10)), 'ok/2/3', 'AC12/AC14d: a plain vote shares the same 5/day');
select test_helpers.claims('e1200000-0000-4000-a000-0000000000a1', false, 'aal2');
select lives_ok($$select public.admin_revoke_photo('e1200000-0000-4000-a000-00000000f001')$$, 'admin revokes the hearted photo');
select is((select photo_id from private.vote_events where house_id = test_helpers.h(10) and photo_id is not null),
          'e1200000-0000-4000-a000-00000000f001'::uuid, 'AC14d: after revoke the event keeps photo_id');
select is(test_helpers.total(test_helpers.h(10)), 2, 'AC14d: after revoke the total is unchanged');
select is(test_helpers.v(current_setting('t.u6')::uuid, test_helpers.h(10), 'e1200000-0000-4000-a000-00000000f001'), 'not_found/photo',
          'AC14d: a revoked photo can no longer be hearted');

-- ================================================================ AC14b: my_vote_status
select test_helpers.claims(current_setting('t.u1')::uuid);
select results_eq(format('select total_votes, left_today from public.my_vote_status(%L)', test_helpers.h(1)),
  $$values (6, 0)$$, 'my_vote_status: total and 0 left after 5');
select test_helpers.claims(gen_random_uuid());
select results_eq(format('select total_votes, left_today from public.my_vote_status(%L)', test_helpers.h(7)),
  $$values (0, 5)$$, 'my_vote_status: never-voted house -> 0 total, 5 left');
select is(
  (select array_agg(test_helpers.err(format('select * from public.my_vote_status(%L)', h)))
     from unnest(array['e1200000-0000-4000-a000-0000000b0001', 'e1200000-0000-4000-a000-0000000b0002',
                       'e1200000-0000-4000-a000-0000000b0003', 'e1200000-0000-4000-a000-0000000bffff']) h),
  array_fill('not_found'::text, array[4]), 'AC14b: my_vote_status -> not_found for hidden, released, past-season, unknown');
select test_helpers.claims(null);
select is(test_helpers.err(format('select * from public.my_vote_status(%L)', test_helpers.h(1))), 'not_signed_in', 'my_vote_status without a session -> not_signed_in');

-- ================================================================ AC14c: get_house_photo_counts
update public.photos set status = 'approved', public_path = house_id || '/' || gen_random_uuid() || '.jpg'
 where id = 'e1200000-0000-4000-a000-00000000f001';   -- re-approve for the count
select test_helpers.claims(null);
set local role anon;
select results_eq(
  format($$select house_id, approved from public.get_house_photo_counts(%L) where house_id::text like 'e1200000-%%' order by house_id$$,
         current_setting('t.truckee')),
  $$values (test_helpers.h(10), 1), (test_helpers.h(11), 1)$$,
  'AC14c: anon may call; 1 approved each; pending/rejected/revoked-only, hidden, past-season houses absent');
reset role;

-- ================================================================ AC26-AC31: the network cap
update public.app_settings set vote_network_cap = true;
select is(test_helpers.burst(test_helpers.h(13), 5, 5, '{"cf-connecting-ip":"203.0.113.7"}'), 'ok=25',
          'AC26: 5 uids x 5 votes on one network -> all 25 succeed');
select is(test_helpers.v(gen_random_uuid(), test_helpers.h(13)), 'rate_limited/network_daily', 'AC26: a 6th uid on that network -> network_daily');
select is(test_helpers.v(gen_random_uuid(), test_helpers.h(14)), 'ok/1/4', 'AC26: the same network on another house succeeds');
select is((select count(*)::int from private.vote_events where house_id = test_helpers.h(13) and octet_length(net_hash) = 16), 25,
          'AC26/AC31: every capped vote stored a 16-byte hash');
select test_helpers.hdr('{"cf-connecting-ip":"203.0.113.8"}');
select is(test_helpers.v(gen_random_uuid(), test_helpers.h(13)), 'ok/26/4', 'AC27: IPv4 is exact: .8 in the same /24 has its own budget');
select test_helpers.hdr('{"cf-connecting-ip":" 203.0.113.7 "}');
select is(test_helpers.v(gen_random_uuid(), test_helpers.h(13)), 'rate_limited/network_daily', 'header whitespace is trimmed (same network)');
select is(test_helpers.burst(test_helpers.h(15), 5, 5, '{"cf-connecting-ip":"2001:db8:1:2::a"}'), 'ok=25', 'AC28: 25 from 2001:db8:1:2::a');
select test_helpers.hdr('{"cf-connecting-ip":"2001:db8:1:2:ffff::b"}');
select is(test_helpers.v(gen_random_uuid(), test_helpers.h(15)), 'rate_limited/network_daily', 'AC28: another address in the same /64 shares the budget');
select test_helpers.hdr('{"cf-connecting-ip":"2001:db8:1:3::a"}');
select is(test_helpers.v(gen_random_uuid(), test_helpers.h(15)), 'ok/26/4', 'AC28: a different /64 has its own budget');

-- AC29 / AC30: fail open. Each case: 6 uids x 5 votes on a fresh house all succeed, and no hash is stored.
create function test_helpers.failopen(p_house uuid, p_hdr text) returns text language plpgsql as $$
declare r text;
begin
  r := test_helpers.burst(p_house, 6, 5, p_hdr);
  return r || ' hashed=' || (select count(*) from private.vote_events where house_id = p_house and net_hash is not null);
end $$;
select is(test_helpers.failopen(test_helpers.h(16), null), 'ok=30 hashed=0', 'AC29: no request.headers -> fail open');
delete from private.vote_events where house_id = test_helpers.h(16);
select is(test_helpers.failopen(test_helpers.h(16), '{bad'), 'ok=30 hashed=0', 'AC29: invalid JSON headers -> fail open');
delete from private.vote_events where house_id = test_helpers.h(16);
select is(test_helpers.failopen(test_helpers.h(16), '{"cf-connecting-ip":"not-an-ip"}'), 'ok=30 hashed=0', 'AC29: not-an-ip -> fail open');
delete from private.vote_events where house_id = test_helpers.h(16);
select is(test_helpers.failopen(test_helpers.h(16), '{"cf-connecting-ip":"10.1.2.3"}'), 'ok=30 hashed=0', 'AC29: private 10.1.2.3 -> fail open');
delete from private.vote_events where house_id = test_helpers.h(16);
select is(test_helpers.failopen(test_helpers.h(16), '{"cf-connecting-ip":"::1"}'), 'ok=30 hashed=0', 'AC29: loopback ::1 -> fail open');
delete from private.vote_events where house_id = test_helpers.h(16);
select is(test_helpers.failopen(test_helpers.h(16), '{"cf-connecting-ip":"100.64.1.1"}'), 'ok=30 hashed=0', 'AC29: CGNAT 100.64.1.1 -> fail open');
delete from private.vote_events where house_id = test_helpers.h(16);
select is(test_helpers.failopen(test_helpers.h(16), '{"cf-connecting-ip":"192.0.2.5"}'), 'ok=30 hashed=0', 'AC29: documentation 192.0.2.5 -> fail open');
delete from private.vote_events where house_id = test_helpers.h(16);
select is(test_helpers.failopen(test_helpers.h(16), '{"x-forwarded-for":"198.51.100.1, 203.0.113.9"}'), 'ok=30 hashed=0', 'AC30: x-forwarded-for alone is never read');
delete from private.vote_events where house_id = test_helpers.h(16);
update public.app_settings set vote_network_cap = false;
select is(test_helpers.failopen(test_helpers.h(16), '{"cf-connecting-ip":"203.0.113.7"}'), 'ok=30 hashed=0', 'AC29: valid header but cap off -> no hash, no cap');
delete from private.vote_events where house_id = test_helpers.h(16);
update public.app_settings set vote_network_cap = true;

-- AC31: no raw address stored anywhere this feature writes
select is((select count(*)::int from information_schema.columns
            where table_schema in ('public', 'private') and table_name in ('vote_events', 'vote_salts', 'house_vote_totals')
              and data_type in ('inet', 'cidr', 'text', 'character varying', 'json', 'jsonb')), 0,
          'AC31: no inet/cidr/text/json column in the vote tables');
select is((select count(*)::int from private.vote_events e where row_to_json(e)::text like '%203.0.113%'
                                                          or row_to_json(e)::text like '%2001:db8%'), 0,
          'AC31: no stored value contains an address');
select is((select count(*)::int from private.vote_events where net_hash is not null and octet_length(net_hash) <> 16), 0,
          'AC31: every hash is 16 bytes');

-- ================================================================ AC32 / AC32b: retention
-- AC32b first: a vote (success or failure) never deletes or updates retention state.
insert into private.vote_salts (region_id, day) values (current_setting('t.truckee')::uuid, current_setting('t.today')::date - 1)
on conflict do nothing;
insert into private.vote_events (house_id, region_id, season, year, uid, vote_day, net_hash, created_at)
select test_helpers.h(17), current_setting('t.truckee')::uuid, 'halloween', 2026, gen_random_uuid(),
       current_setting('t.today')::date - 1, extensions.gen_random_bytes(16), now() - interval '1 day'
  from generate_series(1, 3);
select set_config('t.snap', (select md5(string_agg(region_id || day::text || encode(salt, 'hex'), ',' order by region_id, day))
                               || md5(coalesce((select string_agg(id || ':' || coalesce(encode(net_hash, 'hex'), '-'), ',' order by id)
                                                  from private.vote_events), ''))
                               from private.vote_salts), true);
select test_helpers.hdr('{"cf-connecting-ip":"203.0.113.7"}');
select is(test_helpers.v(gen_random_uuid(), test_helpers.h(13)), 'rate_limited/network_daily', 'AC32b: a rate-limited vote');
select is((select md5(string_agg(region_id || day::text || encode(salt, 'hex'), ',' order by region_id, day))
             || md5(coalesce((select string_agg(id || ':' || coalesce(encode(net_hash, 'hex'), '-'), ',' order by id)
                                from private.vote_events), ''))
             from private.vote_salts), current_setting('t.snap'), 'AC32b: salts and every net_hash unchanged after it');
select is(test_helpers.v(gen_random_uuid(), test_helpers.h(17)), 'ok/1/4', 'a successful capped vote');
select ok(exists (select 1 from private.vote_salts where region_id = current_setting('t.truckee')::uuid
                    and day = current_setting('t.today')::date - 1), 'AC32b: a successful vote does not delete a past salt');
select is((select count(*)::int from private.vote_events where house_id = test_helpers.h(17)
             and vote_day < current_setting('t.today')::date and net_hash is not null), 3, 'AC32b: nor null past hashes');

-- AC32: retention with no traffic, voting closed
insert into private.vote_salts (region_id, day) values (current_setting('t.testville')::uuid, current_setting('t.today')::date - 1)
on conflict do nothing;
update public.site_settings set votes_open = false;
select lives_ok('select private.vote_retention()', 'AC32: retention runs with no vote cast and voting closed');
select is((select count(*)::int from private.vote_salts s join public.regions r on r.id = s.region_id
            where s.day < (now() at time zone r.timezone)::date), 0, 'AC32: no salt of an ended day remains');
select is((select count(*)::int from private.vote_events e join public.regions r on r.id = e.region_id
            where e.net_hash is not null and e.vote_day < (now() at time zone r.timezone)::date), 0, 'AC32: past hashes are null');
select is((select count(*)::int from private.vote_salts
            where region_id in (current_setting('t.truckee')::uuid, current_setting('t.testville')::uuid)
              and day in (current_setting('t.today')::date, current_setting('t.today')::date + 1)), 4,
          'AC32: today''s and tomorrow''s salts exist for both regions');
select is((select count(*)::int from private.vote_events where house_id = test_helpers.h(13) and net_hash is not null), 26,
          'AC32: today''s hashes are kept');
select set_config('t.snap2', (select md5(string_agg(region_id || day::text || encode(salt, 'hex'), ',' order by region_id, day))
                                from private.vote_salts), true);
select private.vote_retention();
select is((select md5(string_agg(region_id || day::text || encode(salt, 'hex'), ',' order by region_id, day)) from private.vote_salts),
          current_setting('t.snap2'), 'AC32: a second run changes nothing');
select isnt((select salt from private.vote_salts where region_id = current_setting('t.truckee')::uuid and day = current_setting('t.today')::date),
            (select salt from private.vote_salts where region_id = current_setting('t.testville')::uuid and day = current_setting('t.today')::date),
            'AC32: two regions on the same day get different salts');
select results_eq($$select schedule from cron.job where jobname = 'tl-vote-retention'$$, $$values ('*/15 * * * *'::text)$$,
                  'AC32: cron job tl-vote-retention runs every 15 min');
update public.site_settings set votes_open = true;

-- ================================================================ AC33 / AC33c: probe and the cap switch
select test_helpers.hdr('{"cf-connecting-ip":"203.0.113.7"}');
select set_config('t.d7', encode(extensions.hmac('203.0.113.7/32', 'n0nce-n0nce-n0nce1', 'sha256'), 'hex'), true);
set local role anon;
select results_eq($$select source, family, digest from public.network_probe('n0nce-n0nce-n0nce1')$$,
  $$values ('cf-connecting-ip'::text, 4, current_setting('t.d7'))$$,
  'AC33: probe returns the source, family, and nonce-keyed digest of the /32');
select is((select count(*)::int from public.network_probe('n0nce-n0nce-n0nce1') p where row_to_json(p)::text like '%203.0.113%'), 0,
          'AC33: no output column contains the address');
reset role;
select test_helpers.hdr('{"cf-connecting-ip":"192.0.2.55"}');
select is((select digest from public.network_probe('n0nce-n0nce-n0nce1')),
          encode(extensions.hmac('192.0.2.55/32', 'n0nce-n0nce-n0nce1', 'sha256'), 'hex'), 'AC33: a documentation address is hashed, not filtered');
select test_helpers.hdr('{"cf-connecting-ip":"2001:db8:1:2:ffff::b"}');
select results_eq($$select family, digest from public.network_probe('n0nce-n0nce-n0nce1')$$,
  $$values (6, encode(extensions.hmac('2001:db8:1:2::/64', 'n0nce-n0nce-n0nce1', 'sha256'), 'hex'))$$, 'AC33: IPv6 is hashed as its /64');
select test_helpers.hdr(null);
select results_eq($$select source, family, digest from public.network_probe('n0nce-n0nce-n0nce1')$$,
  $$values ('none'::text, null::int, null::text)$$, 'AC33: no header -> none, null, null');
select test_helpers.hdr('{"x-forwarded-for":"198.51.100.1"}');
select is((select source from public.network_probe('n0nce-n0nce-n0nce1')), 'none', 'AC33: XFF is ignored by the probe too');
select is(test_helpers.err($$select * from public.network_probe('short')$$), 'invalid_input', 'AC33: a short nonce -> invalid_input');
select is(test_helpers.err($$select * from public.network_probe('bad nonce with spaces!!')$$), 'invalid_input', 'AC33: a bad-charset nonce -> invalid_input');

update public.app_settings set vote_network_cap = false;
select is(
  (select array_agg(test_helpers.err_as(c.uid, c.anon, c.aal, 'select public.admin_set_network_cap(true)') order by c.n)
     from (values (1, null::uuid, true, 'aal1'), (2, gen_random_uuid(), true, 'aal1'),
                  (3, 'e1200000-0000-4000-a000-0000000000a2'::uuid, false, 'aal2')) c(n, uid, anon, aal)),
  array['forbidden', 'forbidden', 'forbidden'], 'AC33: admin_set_network_cap forbidden for anon, non-admin, region-only admin');
select test_helpers.claims('e1200000-0000-4000-a000-0000000000a2', false, 'aal2');
select is(test_helpers.err('select public.admin_network_cap_status()'), 'forbidden', 'AC33c: region-only admin cannot read the cap');
select test_helpers.claims('e1200000-0000-4000-a000-0000000000a1', false, 'aal2');
select is(public.admin_network_cap_status(), false, 'AC33c: global AAL2 admin reads the current value (off)');
select lives_ok('select public.admin_set_network_cap(true)', 'AC33: global AAL2 admin turns the cap on');
select is(public.admin_network_cap_status(), true, 'AC33c: status reads true after the switch');
select is(test_helpers.err('select public.admin_set_network_cap(null)'), 'invalid_input', 'admin_set_network_cap(null) -> invalid_input');

-- ================================================================ AC14: season switch starts from zero
select set_config('t.vis', (select count(*)::text from public.house_vote_totals t join public.houses h on h.id = t.house_id
                             where h.region_id = current_setting('t.truckee')::uuid), true);
select ok(current_setting('t.vis')::int > 0, 'setup: Truckee has totals rows this season');
select test_helpers.claims('e1200000-0000-4000-a000-0000000000a1', false, 'aal2');
select lives_ok(format($$select public.admin_set_season(%L, 'christmas', 2026, true)$$, current_setting('t.truckee')), 'switch Truckee to christmas 2026');
insert into public.houses (id, region_id, season, year, address, normalized_address, lat, lng, coord_source, status)
values ('e1200000-0000-4000-a000-0000000d0001', current_setting('t.truckee')::uuid, 'christmas', 2026, '1 Newseason Rd', '1 newseason rd #12', 39.3, -120.2, 'admin', 'visible');
select test_helpers.claims(null);
set local role anon;
select is((select count(*)::int from public.house_vote_totals where region_id = current_setting('t.truckee')::uuid), 0,
          'AC14: the old season''s totals are invisible to anon, the new season has no rows (0)');
reset role;
select test_helpers.hdr(null);
select is(test_helpers.v(gen_random_uuid(), test_helpers.h(1)), 'not_found', 'AC14: old-season houses can no longer be voted on');
select is(test_helpers.v(gen_random_uuid(), 'e1200000-0000-4000-a000-0000000d0001'), 'ok/1/4', 'AC14: the new season starts from zero');

select * from finish();
rollback;
