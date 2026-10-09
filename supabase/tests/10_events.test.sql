-- Events v1 (Spec_Events §5 + Amendment 1 A1-A6): submit_event validation, bounds, the starts_at window, the URL
-- validator, quotas and the breaker, the pending stock cap, dedupe, the events_open gate, public reads, admin authz,
-- every moderation transition, admin update/create, retention, and the region-context capability object.
begin;
create extension if not exists pgtap with schema extensions;
select plan(169);

-- ---------------------------------------------------------------- fixtures (as postgres). Do not rely on seed rows.
delete from public.events;
delete from public.admins;
delete from private.quota_events;
insert into public.regions (slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng, default_zoom, timezone, is_active)
values ('testville', 'Testville', 10, 11, 10, 11, 10.5, 10.5, 12, 'America/Los_Angeles', true)
on conflict (slug) do update set is_active = true;
insert into public.site_settings (region_id, active_season, active_year, submissions_open)
  select id, 'halloween', 2026, true from public.regions where slug = 'testville'
on conflict (region_id) do update set active_season = 'halloween', active_year = 2026;
update public.site_settings s set active_season = 'halloween', active_year = 2026, events_open = false
  from public.regions r where r.id = s.region_id and r.slug = 'truckee';
select set_config('t.truckee', (select id::text from public.regions where slug = 'truckee'), true);
select set_config('t.testville', (select id::text from public.regions where slug = 'testville'), true);

-- e5..0001-0009 visitors; e5..00a1 global admin, 00a2 testville-only admin, 00a3 truckee-only admin, 00a4 anonymous user WITH a global row.
insert into auth.users (id, aud, role, email)
select ('e5000000-0000-4000-a000-00000000000' || n)::uuid, 'authenticated', 'authenticated', 'ev' || n || '@example.test'
  from generate_series(1, 9) n
union all
select ('e5000000-0000-4000-a000-0000000000a' || n)::uuid, 'authenticated', 'authenticated', 'evadm' || n || '@example.test'
  from generate_series(1, 4) n;
insert into public.admins (user_id, region_id, note) values
  ('e5000000-0000-4000-a000-0000000000a1', null, 'test global'),
  ('e5000000-0000-4000-a000-0000000000a2', current_setting('t.testville')::uuid, 'test testville'),
  ('e5000000-0000-4000-a000-0000000000a3', current_setting('t.truckee')::uuid, 'test truckee region admin'),
  ('e5000000-0000-4000-a000-0000000000a4', null, 'test anonymous-with-row');

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
create function test_helpers.submit(
  p_title text default 'Fake Pumpkin Walk', p_description text default 'A made-up test event with lanterns.',
  p_venue text default 'Fakepine Park', p_address text default 'Fakepine Park, Truckee, CA',
  p_place_id text default null, p_lat double precision default 39.33, p_lng double precision default -120.18,
  p_starts_at timestamptz default now() + interval '2 days', p_ends_at timestamptz default null,
  p_url text default null, p_adults_only boolean default false, p_slug text default 'truckee') returns text
language sql as $$
  select s.result || '|' || coalesce(s.event_id::text, '')
    from public.submit_event(p_slug, p_title, p_description, p_venue, p_address, p_place_id, p_lat, p_lng,
                             p_starts_at, p_ends_at, p_url, p_adults_only) s
$$;
create function test_helpers.as_user(p_n int) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', 'e5000000-0000-4000-a000-00000000000' || p_n, 'role', 'authenticated',
                      'is_anonymous', true, 'aal', 'aal1')::text, true)::text
$$;
create function test_helpers.claims(p_uid text, p_anon boolean, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', p_anon, 'aal', p_aal)::text, true)::text
$$;
-- Raw row insert (as postgres) for read/admin fixtures.
create function test_helpers.raw(p_id uuid, p_title text, p_status text, p_starts timestamptz, p_ends timestamptz,
                                 p_slug text default 'truckee', p_season text default 'halloween', p_year int default 2026)
returns void language sql as $$
  insert into public.events (id, region_id, season, year, title, description, address, lat, lng, starts_at, ends_at, status,
                             source, source_url)
  select p_id, r.id, p_season::public.season_kind, p_year, p_title, 'Raw fixture description.', 'Fixture Plaza, Truckee',
         case when p_slug = 'truckee' then 39.33 else 10.5 end, case when p_slug = 'truckee' then -120.18 else 10.5 end,
         p_starts, p_ends, p_status::public.event_status, 'seed', 'https://example.org/source'
    from public.regions r where r.slug = p_slug
$$;
grant execute on all functions in schema test_helpers to anon, authenticated;

-- ---------------------------------------------------------------- events_open gate, session, region
select test_helpers.as_user(1);
set local role authenticated;
select throws_ok($$select test_helpers.submit()$$, 'P0001', 'submissions_closed', 'events_open = false -> submissions_closed');
reset role;
update public.site_settings s set events_open = true from public.regions r where r.id = s.region_id and r.slug = 'truckee';
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select test_helpers.submit()$$, '28000', 'not_signed_in', 'no sub -> not_signed_in');
select test_helpers.as_user(1);
select throws_ok($$select test_helpers.submit(p_slug => 'nope')$$, 'P0002', 'region_not_found', 'unknown slug -> region_not_found');
reset role;
update public.regions set is_active = false where slug = 'testville';
select test_helpers.as_user(1);
set local role authenticated;
select throws_ok($$select test_helpers.submit(p_slug => 'testville', p_lat => 10.5, p_lng => 10.5)$$, 'P0002', 'region_not_found',
                 'inactive region -> region_not_found');
reset role;
update public.regions set is_active = true where slug = 'testville';

-- ---------------------------------------------------------------- validation: invalid_input + detail = field
select test_helpers.as_user(1);
set local role authenticated;
select is(test_helpers.err($$select test_helpers.submit(p_title => 'ab')$$), '22023:invalid_input:title', 'title under 3 chars');
select is(test_helpers.err(format('select test_helpers.submit(p_title => %L)', repeat('a', 81))), '22023:invalid_input:title', 'title over 80 chars');
select is(test_helpers.err($$select test_helpers.submit(p_title => 'Spooky <b>night</b>')$$), '22023:invalid_input:title', 'title with <>');
select is(test_helpers.err($$select test_helpers.submit(p_title => 'Shit Show Parade')$$), '22023:invalid_input:title', 'title with a blocked term');
select is(test_helpers.err(format('select test_helpers.submit(p_title => %L)', E'Harvest fu\u200bck Fest')), '22023:invalid_input:title', 'title with a blocked term split by a zero-width space');
select is(test_helpers.err($$select test_helpers.submit(p_title => 'F.u.c.k Fest Night')$$), '22023:invalid_input:title', 'title with a blocked term spelled with dots');
select is(test_helpers.err($$select test_helpers.submit(p_description => 'Come to the f-u-c-k fair')$$), '22023:invalid_input:description', 'description with a dash-spelled blocked term');
select is(test_helpers.err($$select test_helpers.submit(p_title => '   ')$$), '22023:invalid_input:title', 'blank title');
select is(test_helpers.err($$select test_helpers.submit(p_title => '!!! ###')$$), '22023:invalid_input:title', 'punctuation-only title (empty dedupe key)');
select is(test_helpers.err($$select test_helpers.submit(p_description => 'too short')$$), '22023:invalid_input:description', 'description under 10 chars');
select is(test_helpers.err(format('select test_helpers.submit(p_description => %L)', repeat('a', 601))), '22023:invalid_input:description', 'description over 600 chars');
select is(test_helpers.err(format('select test_helpers.submit(p_description => %L)', 'line' || repeat(E'\nline', 7))), '22023:invalid_input:description', 'description with 7 newlines');
select is(test_helpers.err($$select test_helpers.submit(p_description => 'Come by > it is fun')$$), '22023:invalid_input:description', 'description with >');
select is(test_helpers.err($$select test_helpers.submit(p_description => 'A whore of a good time')$$), '22023:invalid_input:description', 'description with a blocked term');
select is(test_helpers.err(format('select test_helpers.submit(p_description => %L)', E'Bell\x07 ringing night')), '22023:invalid_input:description', 'description with a control character');
select is(test_helpers.err(format('select test_helpers.submit(p_venue => %L)', repeat('v', 81))), '22023:invalid_input:venue', 'venue over 80 chars');
select is(test_helpers.err($$select test_helpers.submit(p_venue => '<script>')$$), '22023:invalid_input:venue', 'venue with <>');
select is(test_helpers.err($$select test_helpers.submit(p_address => 'Park')$$), '22023:invalid_input:address', 'address under 5 chars');
select is(test_helpers.err(format('select test_helpers.submit(p_address => %L)', repeat('a', 121))), '22023:invalid_input:address', 'address over 120 chars');
select is(test_helpers.err($$select test_helpers.submit(p_address => 'Park <x>, Truckee')$$), '22023:invalid_input:address', 'address with bad characters');
select is(test_helpers.err($$select test_helpers.submit(p_address => '123 Address Not Found')$$), '22023:invalid_input:address', 'address on the denylist');
select is(test_helpers.err($$select test_helpers.submit(p_address => 'Nazi Park, Truckee')$$), '22023:invalid_input:address', 'address with a blocked term');
select is(test_helpers.err($$select test_helpers.submit(p_place_id => 'abc')$$), '22023:invalid_input:place_id', 'bad place_id');
select is(test_helpers.err($$select test_helpers.submit(p_lat => null)$$), '22023:invalid_input:coordinates', 'null lat');
select is(test_helpers.err($$select test_helpers.submit(p_starts_at => null)$$), '22023:invalid_input:starts_at', 'null starts_at');
select is(test_helpers.err($$select test_helpers.submit(p_ends_at => now() + interval '1 day')$$), '22023:invalid_input:ends_at', 'ends_at before starts_at');
select is(test_helpers.err($$select test_helpers.submit(p_ends_at => now() + interval '2 days')$$), '22023:invalid_input:ends_at', 'ends_at equal to starts_at');
select is(test_helpers.err($$select test_helpers.submit(p_ends_at => now() + interval '33 days 1 minute')$$), '22023:invalid_input:ends_at', 'ends_at more than 31 days after the start');
select is(test_helpers.err($$select test_helpers.submit(p_url => 'http://example.com')$$), '22023:invalid_input:url', 'http url');
select is(test_helpers.err($$select test_helpers.submit(p_url => 'javascript:alert(1)')$$), '22023:invalid_input:url', 'javascript: url');
select is(test_helpers.err($$select test_helpers.submit(p_adults_only => null)$$), '22023:invalid_input:adults_only', 'null adults_only');
-- field order: a bad field wins over out-of-bounds coordinates
select is(test_helpers.err($$select test_helpers.submit(p_title => 'ab', p_lat => 40.5)$$), '22023:invalid_input:title', 'field errors are reported before bounds');
reset role;
select is((select count(*)::int from public.events), 0, 'no validation failure inserted a row');
select is((select count(*)::int from private.quota_events), 0, 'no validation failure consumed quota');

-- ---------------------------------------------------------------- A3 bounds
select results_eq(format('select round(min_lat::numeric, 6), round(max_lat::numeric, 6), round(min_lng::numeric, 6), round(max_lng::numeric, 6) from private.event_bounds(%L)', current_setting('t.truckee')),
  $$values (39.1::numeric, 39.5::numeric, -120.47::numeric, -119.88::numeric)$$,
  'event_bounds = bbox + 0.05 on every side, east + 0.10 (TS eventBounds mirrors this)');
select ok(private.in_event_bounds(current_setting('t.truckee')::uuid, 39.328, -120.183), 'Truckee is inside the event bounds');
select ok(private.in_event_bounds(current_setting('t.truckee')::uuid, 39.1677, -120.1452), 'Tahoe City is inside the event bounds');
select ok(private.in_event_bounds(current_setting('t.truckee')::uuid, 39.1979, -119.9306), 'Sand Harbor is inside the event bounds');
select ok(private.in_event_bounds(current_setting('t.truckee')::uuid, 39.2266, -120.0039), 'Crystal Bay is inside the event bounds');
select ok(not private.in_event_bounds(current_setting('t.truckee')::uuid, 39.5296, -119.8138), 'Reno is outside the event bounds');
select ok(not private.in_event_bounds(current_setting('t.truckee')::uuid, 39.40, -119.81), 'a point east of the padded edge is outside');
select ok(not private.in_event_bounds(current_setting('t.truckee')::uuid, 'NaN'::float8, -120.18), 'NaN lat is outside');
select ok(not private.in_event_bounds(current_setting('t.truckee')::uuid, 39.33, 'Infinity'::float8), 'Infinity lng is outside');
select test_helpers.as_user(1);
set local role authenticated;
select throws_ok($$select test_helpers.submit(p_lat => 39.5296, p_lng => -119.8138)$$, '22023', 'out_of_bounds', 'submit at Reno -> out_of_bounds');
select throws_ok($$select test_helpers.submit(p_lat => 'NaN'::float8)$$, '22023', 'out_of_bounds', 'submit with NaN lat -> out_of_bounds');
reset role;

-- ---------------------------------------------------------------- positive submits, starts_at window
select test_helpers.as_user(2);
set local role authenticated;
select set_config('t.sand', test_helpers.submit(p_title => 'Fake Sand Harbor Night', p_address => 'Sand Harbor State Park, Incline Village, NV',
                                                  p_lat => 39.1979, p_lng => -119.9306), true);
select is(split_part(current_setting('t.sand'), '|', 1), 'created', 'venue-style address at Sand Harbor is created (outside the house bbox)');
select is(test_helpers.err($$select test_helpers.submit(p_starts_at => now() - interval '2 hours')$$), '22023:invalid_input:starts_at', 'starts 2 h ago -> starts_at');
select is(split_part(test_helpers.submit(p_title => 'Fake Already Started', p_starts_at => now() - interval '30 minutes'), '|', 1), 'created',
          'starts 30 min ago is inside the 1 h grace');
select is(test_helpers.err($$select test_helpers.submit(p_starts_at => now() + interval '121 days')$$), '22023:invalid_input:starts_at', 'starts in 121 days -> starts_at');
select is(split_part(test_helpers.submit(p_title => 'Fake Far Future', p_starts_at => now() + interval '119 days'), '|', 1), 'created',
          'starts in 119 days is allowed');
reset role;
select results_eq(
  format('select status::text, source, season::text, year::int, created_by, venue, url, adults_only from public.events where id = %L',
         split_part(current_setting('t.sand'), '|', 2)),
  $$values ('pending', 'community', 'halloween', 2026, 'e5000000-0000-4000-a000-000000000002'::uuid, 'Fakepine Park', null::text, false)$$,
  'a submit inserts pending/community with the active pair and created_by');

-- cleaning: whitespace collapse, blank optionals -> null, description newlines kept
select test_helpers.as_user(8);
set local role authenticated;
select set_config('t.clean', test_helpers.submit(p_title => '  Fake   Crystal   Bay  Ball ', p_venue => '   ',
       p_description => E'  First line.\r\nSecond   line.  ', p_address => 'Crystal Bay Casino, Crystal Bay, NV',
       p_lat => 39.2266, p_lng => -120.0039, p_place_id => '', p_url => 'https://www.example.org/ball',
       p_ends_at => now() + interval '2 days 3 hours', p_adults_only => true), true);
reset role;
select results_eq(format('select title, venue, description, place_id, url, adults_only from public.events where id = %L',
                         split_part(current_setting('t.clean'), '|', 2)),
  $$values ('Fake Crystal Bay Ball', null::text, E'First line.\nSecond line.', null::text, 'https://www.example.org/ball', true)$$,
  'fields are trimmed and collapsed; blank venue/place_id -> null; newlines kept');

-- ---------------------------------------------------------------- A6 URL validator
select is(
  (select coalesce(array_agg(u order by u), '{}') from unnest(array[
     'http://example.com', 'javascript:alert(1)', 'https://user@example.com', 'https://example.com@evil.com',
     'https://127.0.0.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://0x7f.0.0.1/', 'https://[::1]/',
     'https://example.com:8443/', 'https://localhost/', 'https://a.localhost/', 'https://intranet/',
     'https://bit.ly/x', 'https://www.tinyurl.com/x', 'https://t.co/x', 'https://goo.gl/x', 'https://ow.ly/x',
     'https://is.gd/x', 'https://buff.ly/x', 'https://rebrand.ly/x', 'https://exa mple.com', E'https://example.com/\tx',
     'https://example.com/"x', 'https://example.com/''x', 'https://example.com\evil', 'https://example.com.',
     'https://example.com/<x>', 'https://', 'HTTPS://example.com', 'https://' || repeat('a', 290) || '.com']) u
    where private.valid_event_url(u)),
  '{}'::text[], 'the URL validator rejects every bad form (scheme, userinfo, IPs, port, localhost, single label, shorteners, quotes, whitespace, length)');
select is(
  (select coalesce(array_agg(u order by u), '{}') from unnest(array[
     'https://truckee.com/events', 'https://www.Example.org/a?b=c#d', 'https://sub.domain.example.co.uk/path',
     'https://xn--bcher-kva.example/x', 'https://my-site.org']) u
    where not private.valid_event_url(u)),
  '{}'::text[], 'the URL validator accepts ordinary https URLs');
select test_helpers.raw('e5000000-0000-4000-a000-0000000000f0', 'Raw Bad Url', 'approved', now() + interval '1 day', null);
select throws_ok($$update public.events set url = 'https://bad host.com' where id = 'e5000000-0000-4000-a000-0000000000f0'$$,
                 '23514', null, 'table CHECK backstop rejects a raw url with whitespace');
select throws_ok($$update public.events set source_url = 'https://u@x.com' where id = 'e5000000-0000-4000-a000-0000000000f0'$$,
                 '23514', null, 'table CHECK backstop rejects a raw source_url with userinfo');
select throws_ok($$insert into public.events (region_id, season, year, title, description, address, lat, lng, starts_at)
                   values (current_setting('t.truckee')::uuid, 'halloween', 2026, 'Raw Reno', 'Raw fixture description.',
                           'Somewhere, Reno', 39.5296, -119.8138, now() + interval '1 day')$$,
                 '23514', 'out_of_bounds', 'the trigger rejects a raw insert outside the event bounds');

-- ---------------------------------------------------------------- A2 derived columns (Pacific day, normalized title)
select test_helpers.raw('e5000000-0000-4000-a000-0000000000f1', '  Trick-or-Treat  on  Main St.! ', 'pending',
                        '2026-11-01 06:30:00+00', null);
select results_eq($$select normalized_title, start_day from public.events where id = 'e5000000-0000-4000-a000-0000000000f1'$$,
  $$values ('trickortreat on main st', '2026-10-31'::date)$$,
  'normalized_title is lowercased [a-z0-9 ]; start_day is the region-local date (06:30 UTC Nov 1 = Oct 31 Pacific)');
delete from public.events where id = 'e5000000-0000-4000-a000-0000000000f1';

-- ---------------------------------------------------------------- A5 quotas
select test_helpers.as_user(3);
set local role authenticated;
select is(split_part(test_helpers.submit(p_title => 'Fake Quota One'), '|', 1), 'created', 'uid quota: 1st');
select is(split_part(test_helpers.submit(p_title => 'Fake Quota Two'), '|', 1), 'created', 'uid quota: 2nd');
select is(split_part(test_helpers.submit(p_title => 'Fake Quota Three'), '|', 1), 'created', 'uid quota: 3rd');
select is(test_helpers.err($$select test_helpers.submit(p_title => 'Fake Quota Four')$$), 'P0001:rate_limited:uid_hourly', '4th in an hour -> rate_limited uid_hourly');
reset role;
-- uid_daily: 5 older (2 h ago) ledger rows, then one submit (6th in 24 h) is allowed, the 7th is not.
insert into private.quota_events (kind, uid, region_id, created_at)
select 'event', 'e5000000-0000-4000-a000-000000000004', current_setting('t.truckee')::uuid, now() - interval '2 hours'
  from generate_series(1, 5);
select test_helpers.as_user(4);
set local role authenticated;
select is(split_part(test_helpers.submit(p_title => 'Fake Daily Six'), '|', 1), 'created', '6th in 24 h (1st this hour) is created');
select is(test_helpers.err($$select test_helpers.submit(p_title => 'Fake Daily Seven')$$), 'P0001:rate_limited:uid_daily', '7th in 24 h -> rate_limited uid_daily');
reset role;
-- region breaker: 30 event submits in the region in 10 min (other users).
delete from private.quota_events where kind = 'event';
insert into private.quota_events (kind, uid, region_id) select 'event', gen_random_uuid(), current_setting('t.truckee')::uuid from generate_series(1, 30);
select test_helpers.as_user(7);
set local role authenticated;
select is(test_helpers.err($$select test_helpers.submit(p_title => 'Fake Breaker')$$), 'P0001:rate_limited:region_breaker', '31st in the region in 10 min -> region_breaker');
reset role;
select is((select count(*)::int from private.quota_events where kind = 'event' and uid = 'e5000000-0000-4000-a000-000000000007'), 0,
          'a rate-limited submit appends nothing');
delete from private.quota_events where kind = 'event';
select is((select count(*)::int from private.quota_events where kind = 'house'), 0, 'event quota is separate from house quota');

-- ---------------------------------------------------------------- A2 dedupe
select set_config('t.T', (now() + interval '5 days')::text, true);
select test_helpers.as_user(5);
set local role authenticated;
select set_config('t.lan', test_helpers.submit(p_title => 'Fake Lantern Parade', p_starts_at => current_setting('t.T')::timestamptz), true);
select is(split_part(current_setting('t.lan'), '|', 1), 'created', 'dedupe: first is created');
select test_helpers.as_user(6);
select is(test_helpers.submit(p_title => '  fake LANTERN parade!! ', p_starts_at => current_setting('t.T')::timestamptz), 'exists|',
          'same normalized title and instant, pending -> exists with no id');
reset role;
select is((select count(*)::int from private.quota_events where uid = 'e5000000-0000-4000-a000-000000000006'), 0, 'a duplicate consumes no quota');
update public.events set status = 'approved' where id = split_part(current_setting('t.lan'), '|', 2)::uuid;
select test_helpers.as_user(6);
set local role authenticated;
select is(test_helpers.submit(p_title => 'Fake Lantern Parade', p_starts_at => current_setting('t.T')::timestamptz),
          'exists|' || split_part(current_setting('t.lan'), '|', 2), 'approved duplicate -> exists with the id');
select test_helpers.as_user(5);
select set_config('t.lan2', test_helpers.submit(p_title => 'Fake Lantern Parade', p_starts_at => current_setting('t.T')::timestamptz + interval '2 hours'), true);
select is(split_part(current_setting('t.lan2'), '|', 1), 'created', 'same title, same day, different start instant -> created (two sessions)');
reset role;
update public.events set status = 'hidden' where id = split_part(current_setting('t.lan'), '|', 2)::uuid;
select test_helpers.as_user(6);
set local role authenticated;
select is(test_helpers.submit(p_title => 'Fake Lantern Parade', p_starts_at => current_setting('t.T')::timestamptz), 'exists|',
          'hidden duplicate -> exists with no id');
reset role;
update public.events set status = 'rejected' where id = split_part(current_setting('t.lan'), '|', 2)::uuid;
select test_helpers.as_user(5);
set local role authenticated;
select is(split_part(test_helpers.submit(p_title => 'Fake Lantern Parade', p_starts_at => current_setting('t.T')::timestamptz), '|', 1), 'created',
          'a rejection frees the slot');
reset role;
select throws_ok(format($$insert into public.events (region_id, season, year, title, description, address, lat, lng, starts_at)
                          values (%L, 'halloween', 2026, 'FAKE lantern parade', 'Raw fixture description.', 'Fixture Plaza, Truckee',
                                  39.33, -120.18, %L)$$, current_setting('t.truckee'), current_setting('t.T')),
                 '23505', null, 'the partial unique index blocks a raw duplicate');

-- ---------------------------------------------------------------- A5 pending stock cap (40 per region, active pair)
insert into public.events (region_id, season, year, title, description, address, lat, lng, starts_at)
select current_setting('t.truckee')::uuid, 'halloween', 2026, 'Cap filler ' || g, 'Raw fixture description.', 'Fixture Plaza, Truckee',
       39.33, -120.18, now() + interval '3 days'
  from generate_series(1, 40 - (select count(*)::int from public.events
                                 where region_id = current_setting('t.truckee')::uuid and status = 'pending')) g;
select is((select count(*)::int from public.events where region_id = current_setting('t.truckee')::uuid and status = 'pending'), 40,
          '40 pending events in the region');
select test_helpers.as_user(7);
set local role authenticated;
select throws_ok($$select test_helpers.submit(p_title => 'Fake Over Cap')$$, 'P0001', 'queue_full', '41st pending -> queue_full');
select is(test_helpers.submit(p_title => 'Fake Lantern Parade', p_starts_at => current_setting('t.T')::timestamptz + interval '2 hours'),
          'exists|', 'a duplicate still answers exists while the queue is full');
reset role;
select is((select count(*)::int from private.quota_events where uid = 'e5000000-0000-4000-a000-000000000007'), 0, 'queue_full consumes no quota');
-- Amendment 2: the cap is region-wide. A season switch must not reset it, and old-pair pending rows count.
update public.site_settings set active_season = 'christmas' where region_id = current_setting('t.truckee')::uuid;
update public.site_settings set events_open = true where region_id = current_setting('t.truckee')::uuid;
select test_helpers.as_user(7);
set local role authenticated;
select throws_ok($$select test_helpers.submit(p_title => 'Fake Christmas Event')$$, 'P0001', 'queue_full',
                 '40 pending rows from the OLD pair still give queue_full after a season switch');
reset role;
update public.site_settings set active_season = 'halloween' where region_id = current_setting('t.truckee')::uuid;
delete from public.events where title like 'Cap filler %';
insert into public.events (region_id, season, year, title, description, address, lat, lng, starts_at)
select current_setting('t.truckee')::uuid, 'christmas', 2024, 'Old pair filler ' || g, 'Raw fixture description.', 'Fixture Plaza, Truckee',
       39.33, -120.18, now() + interval '3 days'
  from generate_series(1, 40) g;
select test_helpers.as_user(7);
set local role authenticated;
select throws_ok($$select test_helpers.submit(p_title => 'Fake Over Old Cap')$$, 'P0001', 'queue_full',
                 '40 old-pair pending rows -> queue_full for the active pair');
reset role;
select is((select count(*)::int from private.quota_events where uid = 'e5000000-0000-4000-a000-000000000007'), 0, 'old-pair queue_full consumes no quota');
delete from public.events where title like 'Old pair filler %';

-- ---------------------------------------------------------------- public reads (anon / authenticated)
delete from public.events;
select test_helpers.raw('e5000000-0000-4000-a000-00000000b001', 'Read Future', 'approved', now() + interval '1 day', null);
select test_helpers.raw('e5000000-0000-4000-a000-00000000b002', 'Read In Progress', 'approved', now() - interval '2 hours', now() + interval '1 hour');
select test_helpers.raw('e5000000-0000-4000-a000-00000000b003', 'Read Ended', 'approved', now() - interval '5 hours', now() - interval '2 hours');
select test_helpers.raw('e5000000-0000-4000-a000-00000000b004', 'Read No End Recent', 'approved', now() - interval '3 hours 30 minutes', null);
select test_helpers.raw('e5000000-0000-4000-a000-00000000b005', 'Read No End Old', 'approved', now() - interval '4 hours 30 minutes', null);
select test_helpers.raw('e5000000-0000-4000-a000-00000000b006', 'Read Pending', 'pending', now() + interval '1 day', null);
select test_helpers.raw('e5000000-0000-4000-a000-00000000b007', 'Read Hidden', 'hidden', now() + interval '1 day', null);
select test_helpers.raw('e5000000-0000-4000-a000-00000000b008', 'Read Rejected', 'rejected', now() + interval '1 day', null);
select test_helpers.raw('e5000000-0000-4000-a000-00000000b009', 'Read Other Season', 'approved', now() + interval '1 day', null, 'truckee', 'christmas', 2024);
select test_helpers.raw('e5000000-0000-4000-a000-00000000b00a', 'Read Ended 30m', 'approved', now() - interval '3 hours', now() - interval '30 minutes');
select test_helpers.raw('e5000000-0000-4000-a000-00000000b00b', 'Read Inactive Region', 'approved', now() + interval '1 day', null, 'testville');
update public.regions set is_active = false where slug = 'testville';
update public.site_settings set events_open = false where region_id = current_setting('t.truckee')::uuid;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select results_eq('select id from public.events order by id',
  $$values ('e5000000-0000-4000-a000-00000000b001'::uuid), ('e5000000-0000-4000-a000-00000000b002'::uuid),
           ('e5000000-0000-4000-a000-00000000b004'::uuid), ('e5000000-0000-4000-a000-00000000b00a'::uuid)$$,
  'anon sees only approved, active-pair, active-region, not-ended events (events_open = false does not hide them)');
select lives_ok($$select id, region_id, season, year, title, description, venue, address, lat, lng, starts_at, ends_at, url, adults_only
                  from public.events$$, 'anon can read every granted column');
select throws_ok('select source_url from public.events', '42501', null, 'anon: source_url -> 42501');
select throws_ok('select * from public.events', '42501', null, 'anon: select * -> 42501 (column grants)');
select throws_ok('select created_by, reject_reason from public.events', '42501', null, 'anon: created_by/reject_reason -> 42501');
select throws_ok('select status from public.events', '42501', null, 'anon: status -> 42501');
select throws_ok($$insert into public.events (title) values ('x')$$, '42501', null, 'anon: insert -> 42501');
select is(public.get_region_context('truckee') -> 'events', '{"open": false}'::jsonb, 'anon: get_region_context returns events.open');
select throws_ok('select updated_by from public.site_settings', '42501', null, 'anon still cannot select site_settings.updated_by');
select lives_ok('select events_open from public.site_settings', 'anon can select site_settings.events_open (security invoker context)');
reset role;
update public.site_settings set events_open = true where region_id = current_setting('t.truckee')::uuid;
select test_helpers.as_user(9);
set local role authenticated;
select is((select count(*)::int from public.events), 4, 'authenticated sees the same public set');
select is(public.get_region_context('truckee') -> 'events', '{"open": true}'::jsonb, 'authenticated: get_region_context returns events.open');
select throws_ok('select source_url from public.events', '42501', null, 'authenticated: source_url -> 42501');
select throws_ok($$update public.events set status = 'approved'$$, '42501', null, 'authenticated: update -> 42501');
select throws_ok($$delete from public.events$$, '42501', null, 'authenticated: delete -> 42501');
select throws_ok('select private.valid_event_url(''https://x.com'')', '42501', null, 'authenticated: private helpers are not executable');
reset role;
update public.regions set is_active = true where slug = 'testville';

-- ---------------------------------------------------------------- A4 admin authorization (per RPC)
delete from public.events;
select test_helpers.raw('e5000000-0000-4000-a000-00000000c001', 'Admin Pending One', 'pending', now() + interval '1 day', null);
select set_config('t.c1', 'e5000000-0000-4000-a000-00000000c001', true);
create function test_helpers.admin_calls() returns table (name text, sql text) language sql as $$
  values
    ('admin_event_queue',     format('select * from public.admin_event_queue(%L, %L)', current_setting('t.truckee'), 'pending')),
    ('admin_event_counts',    format('select * from public.admin_event_counts(%L)', current_setting('t.truckee'))),
    ('admin_moderate_event',  format('select public.admin_moderate_event(%L, %L, null)', current_setting('t.c1'), 'approved')),
    ('admin_update_event',    format('select public.admin_update_event(%L, %L, %L, null, %L, null, 39.33, -120.18, %L, null, null, false)',
                                     current_setting('t.c1'), 'Admin Edited', 'Edited description here.', 'Fixture Plaza, Truckee',
                                     (now() + interval '1 day')::text)),
    ('admin_create_event',    format('select public.admin_create_event(%L, %L, %L, null, %L, null, 39.33, -120.18, %L, null, null, false, null)',
                                     current_setting('t.truckee'), 'Admin Created', 'Created description here.', 'Fixture Plaza, Truckee',
                                     (now() + interval '1 day')::text)),
    ('admin_set_events_open', format('select public.admin_set_events_open(%L, false)', current_setting('t.truckee')))
$$;
grant execute on function test_helpers.admin_calls() to authenticated;

select test_helpers.claims('e5000000-0000-4000-a000-0000000000a4', true, 'aal2');
set local role authenticated;
select is((select array_agg(name || '=' || test_helpers.err(sql) order by name) from test_helpers.admin_calls()),
  (select array_agg(name || '=42501:forbidden:' order by name) from test_helpers.admin_calls()),
  'anonymous user with a global admins row: every event admin RPC -> forbidden');
select test_helpers.claims('e5000000-0000-4000-a000-0000000000a1', false, 'aal1');
select is((select array_agg(name || '=' || test_helpers.err(sql) order by name) from test_helpers.admin_calls()),
  (select array_agg(name || '=42501:forbidden:' order by name) from test_helpers.admin_calls()),
  'global admin at aal1: every event admin RPC -> forbidden');
select test_helpers.claims('e5000000-0000-4000-a000-0000000000a2', false, 'aal2');
select is((select array_agg(name || '=' || test_helpers.err(sql) order by name) from test_helpers.admin_calls()),
  (select array_agg(name || '=42501:forbidden:' order by name) from test_helpers.admin_calls()),
  'another region''s admin: every event admin RPC on truckee -> forbidden');
select test_helpers.claims('e5000000-0000-4000-a000-000000000001', true, 'aal1');
select is((select array_agg(name || '=' || test_helpers.err(sql) order by name) from test_helpers.admin_calls()),
  (select array_agg(name || '=42501:forbidden:' order by name) from test_helpers.admin_calls()),
  'a visitor: every event admin RPC -> forbidden');
-- missing row: not_found only for a global admin
select test_helpers.claims('e5000000-0000-4000-a000-0000000000a2', false, 'aal2');
select throws_ok($$select public.admin_moderate_event('e5000000-0000-4000-a000-0000000000ff', 'approved', null)$$, '42501', 'forbidden',
                 'region admin: unknown event -> forbidden (no existence oracle)');
select throws_ok($$select public.admin_update_event('e5000000-0000-4000-a000-0000000000ff', 'Xyz event', 'Long enough text.', null, 'Fixture Plaza', null, 39.33, -120.18, now() + interval '1 day', null, null, false)$$,
                 '42501', 'forbidden', 'region admin: update unknown event -> forbidden');
select is((select pending from public.admin_event_counts(current_setting('t.testville')::uuid)), 0, 'region admin: counts for own region work');
reset role;
select results_eq($$select title, status::text from public.events order by id$$, $$values ('Admin Pending One', 'pending')$$,
                  'forbidden calls changed nothing');
select is((select events_open from public.site_settings where region_id = current_setting('t.truckee')::uuid), true, 'forbidden set_open changed nothing');

select test_helpers.claims('e5000000-0000-4000-a000-0000000000a1', false, 'aal2');
set local role authenticated;
select throws_ok($$select public.admin_moderate_event('e5000000-0000-4000-a000-0000000000ff', 'approved', null)$$, 'P0002', 'not_found',
                 'global admin: unknown event -> not_found');
select throws_ok($$select public.admin_update_event('e5000000-0000-4000-a000-0000000000ff', 'Xyz event', 'Long enough text.', null, 'Fixture Plaza', null, 39.33, -120.18, now() + interval '1 day', null, null, false)$$,
                 'P0002', 'not_found', 'global admin: update unknown event -> not_found');
select is((select pending from public.admin_event_counts(current_setting('t.truckee')::uuid)), 1, 'global admin: admin_event_counts');
select is((select count(*)::int from public.admin_event_queue(current_setting('t.truckee')::uuid, 'pending')), 1, 'global admin: admin_event_queue');
select is(test_helpers.err(format('select * from public.admin_event_queue(%L, %L)', current_setting('t.truckee'), 'bogus')),
          '22023:invalid_input:status', 'admin_event_queue bad status -> invalid_input status');

-- positive matrix: a Truckee-only region admin (aal2, not anonymous) can use every event admin RPC on Truckee
reset role;
select test_helpers.raw('e5000000-0000-4000-a000-00000000c005', 'Region Admin Pending', 'pending', now() + interval '1 day', null);
select test_helpers.claims('e5000000-0000-4000-a000-0000000000a3', false, 'aal2');
set local role authenticated;
select is((select count(*)::int from public.admin_event_queue(current_setting('t.truckee')::uuid, 'pending')), 2, 'region admin: admin_event_queue');
select is((select pending from public.admin_event_counts(current_setting('t.truckee')::uuid)), 2, 'region admin: admin_event_counts');
select lives_ok($$select public.admin_moderate_event('e5000000-0000-4000-a000-00000000c005', 'approved', null)$$, 'region admin: admin_moderate_event');
select lives_ok(format($$select public.admin_update_event('e5000000-0000-4000-a000-00000000c005', 'Region Admin Edited', 'An edited description.',
                         null, 'Fixture Plaza, Truckee', null, 39.33, -120.18, %L, null, null, false)$$, (now() + interval '1 day')::text),
                'region admin: admin_update_event');
select lives_ok(format($$select public.admin_create_event(%L, 'Region Admin Seeded', 'Created by a region admin.', null,
                         'Fixture Plaza, Truckee', null, 39.33, -120.18, %L, null, null, false, null)$$,
                       current_setting('t.truckee'), (now() + interval '2 days')::text), 'region admin: admin_create_event');
select lives_ok(format('select public.admin_set_events_open(%L, false)', current_setting('t.truckee')), 'region admin: admin_set_events_open(false)');
reset role;
select is((select events_open from public.site_settings where region_id = current_setting('t.truckee')::uuid), false, 'region admin: toggle stuck');
select test_helpers.claims('e5000000-0000-4000-a000-0000000000a3', false, 'aal2');
set local role authenticated;
select lives_ok(format('select public.admin_set_events_open(%L, true)', current_setting('t.truckee')), 'region admin: admin_set_events_open(true)');
reset role;
select results_eq($$select title, status::text, moderated_by from public.events where id = 'e5000000-0000-4000-a000-00000000c005'$$,
  $$values ('Region Admin Edited', 'approved', 'e5000000-0000-4000-a000-0000000000a3'::uuid)$$, 'region admin: moderate and update stuck');
select results_eq($$select status::text, source, created_by from public.events where title = 'Region Admin Seeded'$$,
  $$values ('approved', 'seed', 'e5000000-0000-4000-a000-0000000000a3'::uuid)$$, 'region admin: create stuck');
select is((select count(*)::int from public.events where id <> 'e5000000-0000-4000-a000-00000000c001' and title like 'Region Admin %'), 2,
          'region admin: no stray rows');
select test_helpers.claims('e5000000-0000-4000-a000-0000000000a1', false, 'aal2');
set local role authenticated;

-- ---------------------------------------------------------------- admin_set_events_open
select lives_ok(format('select public.admin_set_events_open(%L, false)', current_setting('t.truckee')), 'admin_set_events_open(false)');
reset role;
select results_eq(format('select events_open, updated_by from public.site_settings where region_id = %L', current_setting('t.truckee')),
  $$values (false, 'e5000000-0000-4000-a000-0000000000a1'::uuid)$$, 'events_open off, updated_by recorded');
set local role authenticated;
select lives_ok(format('select public.admin_set_events_open(%L, true)', current_setting('t.truckee')), 'admin_set_events_open(true)');
select is(test_helpers.err(format('select public.admin_set_events_open(%L, null)', current_setting('t.truckee'))), '22023:invalid_input:open', 'null open -> invalid_input');
select throws_ok($$select public.admin_set_events_open('e5000000-0000-4000-a000-0000000000ff', true)$$, 'P0002', 'region_not_found', 'unknown region -> region_not_found');

-- ---------------------------------------------------------------- every transition (global admin)
select is(test_helpers.err(format('select public.admin_moderate_event(%L, %L, null)', current_setting('t.c1'), 'hidden')),
          '22023:invalid_input:transition', 'pending -> hidden is illegal');
select is(test_helpers.err(format('select public.admin_moderate_event(%L, %L, null)', current_setting('t.c1'), 'pending')),
          '22023:invalid_input:transition', 'pending -> pending is illegal');
select is(test_helpers.err(format('select public.admin_moderate_event(%L, %L, null)', current_setting('t.c1'), 'bogus')),
          '22023:invalid_input:status', 'unknown status -> invalid_input status');
select is(test_helpers.err(format('select public.admin_moderate_event(%L, %L, null)', current_setting('t.c1'), null)),
          '22023:invalid_input:status', 'null status -> invalid_input status');
select lives_ok(format('select public.admin_moderate_event(%L, %L, null)', current_setting('t.c1'), 'approved'), 'pending -> approved');
reset role;
select results_eq(format('select status::text, moderated_by, moderated_at is not null from public.events where id = %L', current_setting('t.c1')),
  $$values ('approved', 'e5000000-0000-4000-a000-0000000000a1'::uuid, true)$$, 'approve sets status, moderated_by and moderated_at');
set local role authenticated;
select is(test_helpers.err(format('select public.admin_moderate_event(%L, %L, null)', current_setting('t.c1'), 'rejected')),
          '22023:invalid_input:transition', 'approved -> rejected is illegal');
select is(test_helpers.err(format('select public.admin_moderate_event(%L, %L, null)', current_setting('t.c1'), 'pending')),
          '22023:invalid_input:transition', 'approved -> pending is illegal');
select lives_ok(format('select public.admin_moderate_event(%L, %L, null)', current_setting('t.c1'), 'hidden'), 'approved -> hidden');
select is(test_helpers.err(format('select public.admin_moderate_event(%L, %L, null)', current_setting('t.c1'), 'rejected')),
          '22023:invalid_input:transition', 'hidden -> rejected is illegal');
select is(test_helpers.err(format('select public.admin_moderate_event(%L, %L, null)', current_setting('t.c1'), 'pending')),
          '22023:invalid_input:transition', 'hidden -> pending is illegal');
select lives_ok(format('select public.admin_moderate_event(%L, %L, null)', current_setting('t.c1'), 'approved'), 'hidden -> approved (restore)');
reset role;
select test_helpers.raw('e5000000-0000-4000-a000-00000000c002', 'Admin Pending Two', 'pending', now() + interval '2 days', null);
set local role authenticated;
select is(test_helpers.err(format('select public.admin_moderate_event(%L, %L, %L)', 'e5000000-0000-4000-a000-00000000c002', 'rejected', repeat('r', 201))),
          '22023:invalid_input:reason', 'reason over 200 chars -> invalid_input reason');
select lives_ok($$select public.admin_moderate_event('e5000000-0000-4000-a000-00000000c002', 'rejected', '  Not a public event  ')$$, 'pending -> rejected with a reason');
reset role;
select is((select reject_reason from public.events where id = 'e5000000-0000-4000-a000-00000000c002'), 'Not a public event', 'reject_reason stored (trimmed)');
set local role authenticated;
select is(test_helpers.err($$select public.admin_moderate_event('e5000000-0000-4000-a000-00000000c002', 'hidden', null)$$),
          '22023:invalid_input:transition', 'rejected -> hidden is illegal');
select is(test_helpers.err($$select public.admin_moderate_event('e5000000-0000-4000-a000-00000000c002', 'pending', null)$$),
          '22023:invalid_input:transition', 'rejected -> pending is illegal');
select lives_ok($$select public.admin_moderate_event('e5000000-0000-4000-a000-00000000c002', 'approved', null)$$, 'rejected -> approved');
reset role;
select results_eq($$select status::text, reject_reason from public.events where id = 'e5000000-0000-4000-a000-00000000c002'$$,
  $$values ('approved', null::text)$$, 'approving a rejected event clears reject_reason');
-- rejected -> approved over a newer duplicate (the slot was freed) -> exists
select test_helpers.raw('e5000000-0000-4000-a000-00000000c003', 'Admin Dup', 'rejected', '2026-12-01 18:00:00+00', null);
select test_helpers.raw('e5000000-0000-4000-a000-00000000c004', 'admin dup!', 'pending', '2026-12-01 18:00:00+00', null);
set local role authenticated;
select is(test_helpers.err($$select public.admin_moderate_event('e5000000-0000-4000-a000-00000000c003', 'approved', null)$$),
          '23505:exists:', 'approving a rejected event over a live duplicate -> exists');

-- ---------------------------------------------------------------- admin_update_event
select lives_ok(format($$select public.admin_update_event(%L, '  Admin   Edited ', 'An edited description.', 'Edited Venue',
                         'Heritage Plaza, Tahoe City', null, 39.1677, -120.1452, %L, null, 'https://example.org/e', true)$$,
                       current_setting('t.c1'), (now() - interval '10 days')::text),
                'admin_update_event works and may set a past start (no lower bound)');
reset role;
select results_eq(format('select title, venue, address, status::text, source, url, adults_only, starts_at < now() from public.events where id = %L', current_setting('t.c1')),
  $$values ('Admin Edited', 'Edited Venue', 'Heritage Plaza, Tahoe City', 'approved', 'seed', 'https://example.org/e', true, true)$$,
  'update cleaned the fields and kept status and source');
set local role authenticated;
select is(test_helpers.err(format($$select public.admin_update_event(%L, 'Admin Edited', 'An edited description.', null,
                                   'Heritage Plaza, Tahoe City', null, 39.1677, -120.1452, %L, null, 'https://bit.ly/x', false)$$,
                                 current_setting('t.c1'), (now() + interval '1 day')::text)),
          '22023:invalid_input:url', 'admin_update_event validates (shortener url)');
select is(test_helpers.err(format($$select public.admin_update_event(%L, 'Admin Edited', 'An edited description.', null,
                                   'Heritage Plaza, Tahoe City', null, 39.1677, -120.1452, %L, null, null, false)$$,
                                 current_setting('t.c1'), (now() + interval '121 days')::text)),
          '22023:invalid_input:starts_at', 'admin_update_event keeps the 120-day upper bound');
select is(test_helpers.err(format($$select public.admin_update_event(%L, 'Admin Dup', 'An edited description.', null,
                                   'Fixture Plaza, Truckee', null, 39.33, -120.18, '2026-12-01 18:00:00+00', null, null, false)$$,
                                 current_setting('t.c1'))),
          '23505:exists:', 'admin_update_event onto a live duplicate -> exists');

-- ---------------------------------------------------------------- admin_create_event
select set_config('t.created', public.admin_create_event(current_setting('t.truckee')::uuid, 'Admin Seeded Walk',
       'Our own wording for a seeded event.', 'Downtown Park', 'Downtown Park, Truckee, CA', null, 39.328, -120.183,
       now() - interval '3 days', now() - interval '3 days' + interval '2 hours', 'https://example.org/walk', false,
       'https://example.org/source-page')::text, true);
reset role;
select results_eq(format('select status::text, source, source_url, created_by, moderated_by from public.events where id = %L', current_setting('t.created')),
  $$values ('approved', 'seed', 'https://example.org/source-page', 'e5000000-0000-4000-a000-0000000000a1'::uuid,
            'e5000000-0000-4000-a000-0000000000a1'::uuid)$$,
  'admin_create_event inserts approved/seed with source_url, past start allowed');
select is((select count(*)::int from private.quota_events where uid = 'e5000000-0000-4000-a000-0000000000a1'), 0, 'admin_create_event takes no quota');
set local role authenticated;
select is(test_helpers.err(format($$select public.admin_create_event(%L, 'Admin Seeded Two', 'Our own wording for a seeded event.',
                                   null, 'Downtown Park, Truckee', null, 39.328, -120.183, %L, null, null, false, 'http://example.org')$$,
                                 current_setting('t.truckee'), (now() + interval '1 day')::text)),
          '22023:invalid_input:source_url', 'admin_create_event validates source_url');
select is(test_helpers.err(format($$select public.admin_create_event(%L, 'Admin Seeded Two', 'Our own wording for a seeded event.',
                                   null, 'Somewhere, Reno', null, 39.5296, -119.8138, %L, null, null, false, null)$$,
                                 current_setting('t.truckee'), (now() + interval '1 day')::text)),
          '22023:out_of_bounds:', 'admin_create_event checks bounds');
select is(test_helpers.err(format($$select public.admin_create_event(%L, 'admin seeded walk', 'Our own wording for a seeded event.',
                                   null, 'Downtown Park, Truckee', null, 39.328, -120.183, %L, null, null, false, null)$$,
                                 current_setting('t.truckee'), (now() - interval '3 days')::text)),
          '23505:exists:', 'admin_create_event duplicate -> exists');

-- ---------------------------------------------------------------- queue order, same-day warning, source_url
reset role;
delete from public.events;
insert into public.events (id, region_id, season, year, title, description, address, lat, lng, starts_at, status, source_url, created_at)
values
  ('e5000000-0000-4000-a000-00000000d001', current_setting('t.truckee')::uuid, 'halloween', 2026, 'Queue Newer', 'Raw fixture description.',
   'Fixture Plaza, Truckee', 39.33, -120.18, '2026-10-30 23:00:00+00', 'pending', null, now() - interval '1 hour'),
  ('e5000000-0000-4000-a000-00000000d002', current_setting('t.truckee')::uuid, 'halloween', 2026, 'Queue Older', 'Raw fixture description.',
   'Fixture Plaza, Truckee', 39.33, -120.18, '2026-10-30 23:00:00+00', 'pending', 'https://example.org/q', now() - interval '2 hours'),
  ('e5000000-0000-4000-a000-00000000d003', current_setting('t.truckee')::uuid, 'halloween', 2026, 'queue older!', 'Raw fixture description.',
   'Fixture Plaza, Truckee', 39.33, -120.18, '2026-10-31 02:00:00+00', 'approved', null, now() - interval '3 hours'),
  ('e5000000-0000-4000-a000-00000000d004', current_setting('t.truckee')::uuid, 'christmas', 2024, 'Queue Old Season', 'Raw fixture description.',
   'Fixture Plaza, Truckee', 39.33, -120.18, '2026-10-30 23:00:00+00', 'pending', null, now() - interval '9 hours');
set local role authenticated;
select results_eq(format('select id, source_url, same_day_warning from public.admin_event_queue(%L, %L)', current_setting('t.truckee'), 'pending'),
  $$values ('e5000000-0000-4000-a000-00000000d004'::uuid, null::text, false),
           ('e5000000-0000-4000-a000-00000000d002'::uuid, 'https://example.org/q', true),
           ('e5000000-0000-4000-a000-00000000d001'::uuid, null::text, false)$$,
  'queue: oldest first, source_url included, same-day warning (Oct 30 16:00 and 19:00 Pacific)');
select results_eq(format('select id, season, year from public.admin_event_queue(%L, %L)', current_setting('t.truckee'), 'pending'),
  $$values ('e5000000-0000-4000-a000-00000000d004'::uuid, 'christmas', 2024), ('e5000000-0000-4000-a000-00000000d002'::uuid, 'halloween', 2026),
           ('e5000000-0000-4000-a000-00000000d001'::uuid, 'halloween', 2026)$$,
  'queue: pending rows of every season/year, each carrying its season and year (Amendment 2)');
select is((select pending from public.admin_event_counts(current_setting('t.truckee')::uuid)), 3, 'counts: pending in every season/year');
select is((select count(*)::int from public.admin_event_queue(current_setting('t.truckee')::uuid, 'approved')), 1, 'queue: non-pending statuses stay on the active pair');
reset role;

-- ---------------------------------------------------------------- retention sweep
update public.events set status = 'rejected', moderated_at = now() - interval '31 days' where id = 'e5000000-0000-4000-a000-00000000d001';
update public.events set status = 'rejected', moderated_at = now() - interval '29 days' where id = 'e5000000-0000-4000-a000-00000000d002';
select is(private.sweep_events(), 1, 'sweep_events deletes rejected events moderated over 30 days ago');
select is((select count(*)::int from public.events where id = 'e5000000-0000-4000-a000-00000000d002'), 1, 'a newer rejection is kept');
select is((select count(*)::int from cron.job where jobname = 'tl-sweep-events'), 1, 'the tl-sweep-events cron job exists');

select * from finish();
rollback;
