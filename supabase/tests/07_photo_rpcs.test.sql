-- AC4, AC5, AC6, AC10: reserve/confirm caps and gates, admin approve/reject/revoke, admin authz on every
-- photo RPC, photos_open switch. Storage objects are faked with storage.objects rows (as postgres).
begin;
create extension if not exists pgtap with schema extensions;
select plan(70);

-- ---------------------------------------------------------------- fixtures (as postgres)
delete from public.photos;
delete from private.storage_jobs;
delete from private.quota_events;
delete from public.admins;
insert into public.regions (slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng, default_zoom, timezone, is_active)
values ('testville', 'Testville', 10, 11, 10, 11, 10.5, 10.5, 12, 'America/Los_Angeles', true)
on conflict (slug) do update set is_active = true;
insert into public.site_settings (region_id, active_season, active_year, submissions_open)
  select id, 'halloween', 2026, true from public.regions where slug = 'testville'
on conflict (region_id) do update set active_season = 'halloween', active_year = 2026, submissions_open = true;
update public.site_settings s set active_season = 'halloween', active_year = 2026, submissions_open = true, photos_open = true
  from public.regions r where r.id = s.region_id and r.slug = 'truckee';
select set_config('t.truckee', (select id::text from public.regions where slug = 'truckee'), true);
select set_config('t.testville', (select id::text from public.regions where slug = 'testville'), true);

insert into auth.users (id, aud, role, email)
select ('e7000000-0000-4000-a000-0000000000' || x)::uuid, 'authenticated', 'authenticated', 'u7' || x || '@example.test'
  from unnest(array['01', '02', '03', '04', 'a1', 'a2', 'a3', 'a4']) x;
insert into public.admins (user_id, region_id, note) values
  ('e7000000-0000-4000-a000-0000000000a1', null, 'test global'),
  ('e7000000-0000-4000-a000-0000000000a2', current_setting('t.testville')::uuid, 'test testville'),
  ('e7000000-0000-4000-a000-0000000000a4', null, 'test anonymous-with-row');

insert into public.houses (id, region_id, season, year, address, normalized_address, lat, lng, coord_source, status)
select v.id::uuid, r.id, 'halloween', 2026, v.address, v.address || ' #7', v.lat, v.lng, 'admin', v.status::public.house_status
  from (values
    ('e7000000-0000-4000-a000-0000000000b1', 'truckee', '1 Seven Rd',   39.30, -120.20, 'visible'),
    ('e7000000-0000-4000-a000-0000000000b2', 'truckee', '2 Seven Rd',   39.30, -120.21, 'hidden'),
    ('e7000000-0000-4000-a000-0000000000b3', 'truckee', '3 Seven Rd',   39.31, -120.20, 'visible'),
    ('e7000000-0000-4000-a000-0000000000b4', 'truckee', '4 Seven Rd',   39.31, -120.21, 'visible')
  ) v(id, slug, address, lat, lng, status)
  join public.regions r on r.slug = v.slug;

create schema test_helpers;
grant usage on schema test_helpers to anon, authenticated;
create function test_helpers.claims(p_uid text, p_anon boolean, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', p_anon, 'aal', p_aal)::text, true)::text
$$;
-- "message/detail" of the error a statement raises, or 'ok'.
create function test_helpers.err(q text) returns text language plpgsql as $$
declare m text; d text;
begin
  execute q; return 'ok';
exception when others then
  get stacked diagnostics m = message_text, d = pg_exception_detail;
  return m || coalesce('/' || nullif(d, ''), '');
end $$;
create function test_helpers.reserve(p_house uuid) returns uuid language sql as $$
  select photo_id from public.reserve_photo(p_house)
$$;
grant execute on all functions in schema test_helpers to anon, authenticated;
-- as postgres only
create function test_helpers.obj(p_bucket text, p_name text) returns void language sql as $$
  insert into storage.objects (bucket_id, name) values (p_bucket, p_name)
$$;
create function test_helpers.upload_of(p_photo uuid) returns void language sql as $$
  insert into storage.objects (bucket_id, name) select 'photo-uploads', upload_path from public.photos where id = p_photo
$$;
create function test_helpers.mk(p_house uuid, p_status text, p_by uuid) returns uuid language sql as $$
  insert into public.photos (house_id, upload_path, public_path, status, reserved_until, created_by)
  select p_house, p_house::text || '/' || g::text || '.jpg',
         case when p_status = 'approved' then p_house::text || '/' || gen_random_uuid()::text || '.jpg' end,
         p_status::public.photo_status, now() + interval '15 minutes', p_by
    from gen_random_uuid() g
  returning id
$$;
revoke all on function test_helpers.obj(text, text), test_helpers.upload_of(uuid), test_helpers.mk(uuid, text, uuid) from anon, authenticated;

-- ================================================================ reserve_photo
select set_config('request.jwt.claims', '', true);
select is(test_helpers.err($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000b1')$$), 'not_signed_in',
          'reserve without a session -> not_signed_in');
select test_helpers.claims('e7000000-0000-4000-a000-000000000001', true, 'aal1');
set local role anon;
select throws_ok($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000b1')$$, '42501', null, 'anon role cannot execute reserve_photo');
reset role;
set local role authenticated;
select is(test_helpers.err($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000b2')$$), 'not_found', 'reserve on a hidden house -> not_found');
select is(test_helpers.err($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000ff')$$), 'not_found', 'reserve on an unknown house -> not_found');
reset role;
update public.site_settings set submissions_open = false where region_id = current_setting('t.truckee')::uuid;
set local role authenticated;
select is(test_helpers.err($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000b1')$$), 'submissions_closed', 'submissions closed -> submissions_closed');
reset role;
update public.site_settings set submissions_open = true, photos_open = false where region_id = current_setting('t.truckee')::uuid;
set local role authenticated;
select is(test_helpers.err($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000b1')$$), 'photos_closed', 'photos closed -> photos_closed');
reset role;
update public.site_settings set photos_open = true where region_id = current_setting('t.truckee')::uuid;

-- outstanding cap (3 live reservations per uid)
set local role authenticated;
select set_config('t.r1', test_helpers.reserve('e7000000-0000-4000-a000-0000000000b1')::text, true);
select ok(current_setting('t.r1') <> '', 'first reservation returns a photo id');
select set_config('t.r2', test_helpers.reserve('e7000000-0000-4000-a000-0000000000b1')::text, true);
select set_config('t.r3', test_helpers.reserve('e7000000-0000-4000-a000-0000000000b3')::text, true);
select is(test_helpers.err($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000b1')$$), 'rate_limited/outstanding',
          '4th outstanding reservation -> rate_limited/outstanding');
reset role;
select results_eq(format($$select upload_path, status::text, created_by from public.photos where id = %L$$, current_setting('t.r1')),
  format($$values (%L, 'reserved', 'e7000000-0000-4000-a000-000000000001'::uuid)$$,
         'e7000000-0000-4000-a000-0000000000b1/' || current_setting('t.r1') || '.jpg'),
  'reservation row: path {house}/{id}.jpg, reserved, created_by = caller');
select ok((select reserved_until between now() + interval '14 minutes' and now() + interval '16 minutes' from public.photos where id = current_setting('t.r1')::uuid),
          'reservation lives 15 minutes');
-- expire one -> a slot frees
update public.photos set reserved_until = now() - interval '1 minute' where id = current_setting('t.r1')::uuid;
select is(private.sweep_photos(), 1, 'sweep expires exactly the stale reservation');
select is((select status::text from public.photos where id = current_setting('t.r1')::uuid), 'expired', 'expired row is tombstoned, not deleted');
select is((select count(*)::int from private.storage_jobs where photo_id = current_setting('t.r1')::uuid and kind = 'delete_upload'), 1,
          'expiry enqueued one delete_upload');
set local role authenticated;
select is(test_helpers.err($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000b1')$$), 'ok', 'after expiry a slot frees (4th ledger event)');
reset role;
-- uid hourly ledger: two more full reserve-and-expire cycles; the 11th reservation fails (no refund)
update public.photos set reserved_until = now() - interval '1 minute' where created_by = 'e7000000-0000-4000-a000-000000000001' and status = 'reserved';
select private.sweep_photos();
set local role authenticated;
select is(test_helpers.err($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000b1')$$) || test_helpers.err($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000b1')$$)
          || test_helpers.err($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000b1')$$), 'okokok', 'cycle 2: 3 reservations (events 5-7)');
reset role;
update public.photos set reserved_until = now() - interval '1 minute' where created_by = 'e7000000-0000-4000-a000-000000000001' and status = 'reserved';
select private.sweep_photos();
set local role authenticated;
select is(test_helpers.err($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000b1')$$) || test_helpers.err($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000b1')$$)
          || test_helpers.err($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000b1')$$), 'okokok', 'cycle 3: 3 reservations (events 8-10)');
reset role;
update public.photos set reserved_until = now() - interval '1 minute' where created_by = 'e7000000-0000-4000-a000-000000000001' and status = 'reserved';
select private.sweep_photos();
set local role authenticated;
select is(test_helpers.err($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000b1')$$), 'rate_limited/uid_hourly',
          '11th reservation in an hour -> rate_limited/uid_hourly (ledger, no refund)');
reset role;
select is((select count(*)::int from private.quota_events where kind = 'photo_reserve' and uid = 'e7000000-0000-4000-a000-000000000001'), 10,
          'the ledger holds exactly 10 reserve events for the uid');
-- region breaker: 200 reserve events per region per hour
insert into private.quota_events (kind, uid, region_id, house_id)
  select 'photo_reserve', gen_random_uuid(), current_setting('t.truckee')::uuid, null from generate_series(1, 190);
select test_helpers.claims('e7000000-0000-4000-a000-000000000002', true, 'aal1');
set local role authenticated;
select is(test_helpers.err($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000b4')$$), 'rate_limited/region_breaker',
          '200 region reserve events in an hour -> rate_limited/region_breaker');
reset role;
delete from private.quota_events where kind = 'photo_reserve' and uid <> all(array['e7000000-0000-4000-a000-000000000001'::uuid]);

-- ================================================================ confirm_photo_upload
select test_helpers.claims('e7000000-0000-4000-a000-000000000002', true, 'aal1');
set local role authenticated;
select set_config('t.c1', test_helpers.reserve('e7000000-0000-4000-a000-0000000000b3')::text, true);
select set_config('t.c2', test_helpers.reserve('e7000000-0000-4000-a000-0000000000b3')::text, true);
select is(test_helpers.err(format('select public.confirm_photo_upload(%L)', current_setting('t.c1'))), 'upload_missing',
          'confirm before the object exists -> upload_missing');
reset role;
select test_helpers.upload_of(current_setting('t.c1')::uuid);
select test_helpers.upload_of(current_setting('t.c2')::uuid);
select test_helpers.claims('e7000000-0000-4000-a000-000000000003', true, 'aal1');
set local role authenticated;
select is(test_helpers.err(format('select public.confirm_photo_upload(%L)', current_setting('t.c1'))), 'not_found',
          'confirming someone else''s photo -> not_found');
reset role;
update public.photos set reserved_until = now() - interval '1 second' where id = current_setting('t.c2')::uuid;
select test_helpers.claims('e7000000-0000-4000-a000-000000000002', true, 'aal1');
set local role authenticated;
select is(test_helpers.err(format('select public.confirm_photo_upload(%L)', current_setting('t.c2'))), 'photo_expired',
          'confirm after reserved_until -> photo_expired');
select is(public.confirm_photo_upload(current_setting('t.c1')::uuid), 'pending', 'confirm with the object present -> pending');
select is(test_helpers.err(format('select public.confirm_photo_upload(%L)', current_setting('t.c1'))), 'photo_expired',
          'a second confirm of the same photo -> photo_expired (no longer reserved)');
reset role;
select is((select count(*)::int from private.quota_events where kind = 'photo_confirm' and uid = 'e7000000-0000-4000-a000-000000000002'), 1,
          'a pending confirm appends one photo_confirm ledger row');

-- house stock: 20 pending on a house, then the 21st confirm -> over_cap, committed as expired + delete_upload
select test_helpers.mk('e7000000-0000-4000-a000-0000000000b4', 'pending', 'e7000000-0000-4000-a000-000000000004') from generate_series(1, 20);
select test_helpers.claims('e7000000-0000-4000-a000-000000000003', true, 'aal1');
set local role authenticated;
select set_config('t.c3', test_helpers.reserve('e7000000-0000-4000-a000-0000000000b4')::text, true);
reset role;
select test_helpers.upload_of(current_setting('t.c3')::uuid);
set local role authenticated;
select is(public.confirm_photo_upload(current_setting('t.c3')::uuid), 'over_cap', '21st pending on a house -> over_cap (returned, not raised)');
reset role;
select is((select status::text from public.photos where id = current_setting('t.c3')::uuid), 'expired', 'over_cap row is expired');
select is((select count(*)::int from private.storage_jobs where photo_id = current_setting('t.c3')::uuid and kind = 'delete_upload' and done_at is null), 1,
          'over_cap: exactly one open delete_upload job');
select is((select count(*)::int from public.photos where house_id = 'e7000000-0000-4000-a000-0000000000b4' and status = 'pending'), 20,
          'house stays at 20 pending');

-- region: 100 confirms per hour
insert into private.quota_events (kind, uid, region_id, house_id)
  select 'photo_confirm', gen_random_uuid(), current_setting('t.truckee')::uuid, null from generate_series(1, 99);
select test_helpers.claims('e7000000-0000-4000-a000-000000000003', true, 'aal1');
set local role authenticated;
select set_config('t.c4', test_helpers.reserve('e7000000-0000-4000-a000-0000000000b3')::text, true);
reset role;
select test_helpers.upload_of(current_setting('t.c4')::uuid);
set local role authenticated;
select is(public.confirm_photo_upload(current_setting('t.c4')::uuid), 'over_cap', '100 region confirms in an hour -> over_cap');
reset role;
delete from private.quota_events where kind = 'photo_confirm';

-- ================================================================ admin: approve / reject / revoke
-- p_pend: a pending photo on b1 (from user 01's set), with its upload object
select set_config('t.p_pend', test_helpers.mk('e7000000-0000-4000-a000-0000000000b1', 'pending', 'e7000000-0000-4000-a000-000000000001')::text, true);
select set_config('t.p_rej',  test_helpers.mk('e7000000-0000-4000-a000-0000000000b1', 'pending', 'e7000000-0000-4000-a000-000000000001')::text, true);
select test_helpers.upload_of(current_setting('t.p_pend')::uuid);
select test_helpers.upload_of(current_setting('t.p_rej')::uuid);
select set_config('t.pub_ok', 'e7000000-0000-4000-a000-0000000000b1/' || gen_random_uuid()::text || '.jpg', true);
select set_config('t.pub_other', 'e7000000-0000-4000-a000-0000000000b3/' || gen_random_uuid()::text || '.jpg', true);
select test_helpers.obj('photos', current_setting('t.pub_ok'));
select test_helpers.obj('photos', current_setting('t.pub_other'));

-- forbidden for anonymous, aal1, no-row and cross-region callers on every admin photo RPC
create function test_helpers.denials() returns text language plpgsql as $$
declare v text := '';
begin
  v := v || test_helpers.err(format('select * from public.admin_photo_queue(%L, %L)', current_setting('t.truckee'), 'pending')) || ',';
  v := v || test_helpers.err(format('select public.admin_approve_photo(%L, %L)', current_setting('t.p_pend'), current_setting('t.pub_ok'))) || ',';
  v := v || test_helpers.err(format('select public.admin_reject_photo(%L)', current_setting('t.p_rej'))) || ',';
  v := v || test_helpers.err(format('select public.admin_revoke_photo(%L)', current_setting('t.p_pend'))) || ',';
  v := v || test_helpers.err(format('select public.admin_set_photos_open(%L, false)', current_setting('t.truckee'))) || ',';
  v := v || test_helpers.err(format('select * from public.admin_storage_jobs(%L)', current_setting('t.truckee')));
  return v;
end $$;
grant execute on function test_helpers.denials() to authenticated;
select test_helpers.claims('e7000000-0000-4000-a000-0000000000a4', true, 'aal2');
set local role authenticated;
select is(test_helpers.denials(), 'forbidden,forbidden,forbidden,forbidden,forbidden,forbidden', 'anonymous (with an admins row): every admin photo RPC -> forbidden');
reset role;
select test_helpers.claims('e7000000-0000-4000-a000-0000000000a1', false, 'aal1');
set local role authenticated;
select is(test_helpers.denials(), 'forbidden,forbidden,forbidden,forbidden,forbidden,forbidden', 'aal1 admin: every admin photo RPC -> forbidden');
reset role;
select test_helpers.claims('e7000000-0000-4000-a000-0000000000a3', false, 'aal2');
set local role authenticated;
select is(test_helpers.denials(), 'forbidden,forbidden,forbidden,forbidden,forbidden,forbidden', 'aal2 no-row: every admin photo RPC -> forbidden');
select is(test_helpers.err($$select public.admin_reject_photo('e7000000-0000-4000-a000-0000000000ff')$$), 'forbidden', 'no-row: unknown photo -> forbidden (no oracle)');
reset role;
select test_helpers.claims('e7000000-0000-4000-a000-0000000000a2', false, 'aal2');
set local role authenticated;
select is(test_helpers.denials(), 'forbidden,forbidden,forbidden,forbidden,forbidden,forbidden', 'cross-region admin: every admin photo RPC -> forbidden');
select is((select count(*)::int from public.admin_photo_queue(current_setting('t.testville')::uuid, 'pending')), 0, 'cross-region admin: own region queue works');
reset role;
select is((select count(*)::int from public.photos where status in ('approved', 'rejected')), 0, 'denied calls changed nothing');
select is((select photos_open from public.site_settings where region_id = current_setting('t.truckee')::uuid), true, 'denied set_photos_open changed nothing');

-- positive: global admin at aal2
select test_helpers.claims('e7000000-0000-4000-a000-0000000000a1', false, 'aal2');
set local role authenticated;
select is(test_helpers.err(format('select * from public.admin_photo_queue(%L, %L)', current_setting('t.truckee'), 'bogus')), 'invalid_input', 'queue: bad status -> invalid_input');
select ok((select bool_and(upload_path is not null and public_path is null and address = '1 Seven Rd' or house_id <> 'e7000000-0000-4000-a000-0000000000b1')
             from public.admin_photo_queue(current_setting('t.truckee')::uuid, 'pending')),
          'queue (pending): upload_path only, with the house address');
select ok((select count(*) from public.admin_photo_queue(current_setting('t.truckee')::uuid, 'pending')) >= 2, 'queue (pending) lists pending photos');
select is(test_helpers.err(format('select public.admin_approve_photo(%L, %L)', current_setting('t.p_pend'), current_setting('t.pub_other'))),
          'invalid_input/public_path', 'approve with a public_path in another house folder -> invalid_input');
select is(test_helpers.err(format('select public.admin_approve_photo(%L, %L)', current_setting('t.p_pend'), 'not/a-path.jpg')),
          'invalid_input/public_path', 'approve with a malformed public_path -> invalid_input');
select is(test_helpers.err(format('select public.admin_approve_photo(%L, %L)', current_setting('t.p_pend'),
          'e7000000-0000-4000-a000-0000000000b1/' || gen_random_uuid()::text || '.jpg')),
          'upload_missing', 'approve when the public object is missing -> upload_missing');
select is(test_helpers.err(format('select public.admin_revoke_photo(%L)', current_setting('t.p_pend'))), 'not_approved', 'revoke a pending photo -> not_approved');
select lives_ok(format('select public.admin_approve_photo(%L, %L)', current_setting('t.p_pend'), current_setting('t.pub_ok')), 'approve works');
select is(test_helpers.err(format('select public.admin_approve_photo(%L, %L)', current_setting('t.p_pend'), current_setting('t.pub_ok'))),
          'not_pending', 'approve twice -> not_pending');
select is(test_helpers.err(format('select public.admin_reject_photo(%L)', current_setting('t.p_pend'))), 'not_pending', 'reject an approved photo -> not_pending');
reset role;
select results_eq(format('select status::text, public_path, moderated_by from public.photos where id = %L', current_setting('t.p_pend')),
  format($$values ('approved', %L, 'e7000000-0000-4000-a000-0000000000a1'::uuid)$$, current_setting('t.pub_ok')),
  'approve: approved + public_path + moderated_by in one statement');
select results_eq(format('select kind, bucket, object_name from private.storage_jobs where photo_id = %L', current_setting('t.p_pend')),
  format($$values ('delete_upload', 'photo-uploads', %L)$$, (select upload_path from public.photos where id = current_setting('t.p_pend')::uuid)),
  'approve: exactly one delete_upload job for the original upload');
set local role authenticated;
select ok((select count(*) = 1 and bool_and(public_path = current_setting('t.pub_ok') and upload_path is null)
             from public.admin_photo_queue(current_setting('t.truckee')::uuid, 'approved')),
          'queue (approved): public_path only');
select lives_ok(format('select public.admin_reject_photo(%L)', current_setting('t.p_rej')), 'reject works');
reset role;
select is((select status::text from public.photos where id = current_setting('t.p_rej')::uuid), 'rejected', 'reject: rejected');
select is((select string_agg(kind, ',') from private.storage_jobs where photo_id = current_setting('t.p_rej')::uuid), 'delete_upload', 'reject: one delete_upload job');
set local role authenticated;
select lives_ok(format('select public.admin_revoke_photo(%L)', current_setting('t.p_pend')), 'revoke works');
select is(test_helpers.err(format('select public.admin_revoke_photo(%L)', current_setting('t.p_pend'))), 'not_approved', 'revoke twice -> not_approved');
select is(test_helpers.err($$select public.admin_revoke_photo('e7000000-0000-4000-a000-0000000000ff')$$), 'not_found', 'global admin: unknown photo -> not_found');
reset role;
select results_eq(format('select status::text, public_path from public.photos where id = %L', current_setting('t.p_pend')),
  $$values ('revoked', null::text)$$, 'revoke: revoked + public_path null');
select results_eq(format($$select object_name from private.storage_jobs where photo_id = %L and kind = 'delete_public'$$, current_setting('t.p_pend')),
  format('values (%L)', current_setting('t.pub_ok')), 'revoke: one delete_public job for the old public path');
select ok((select bool_and(next_attempt_at <= now() + interval '30 seconds') from private.storage_jobs where photo_id = current_setting('t.p_pend')::uuid and kind = 'delete_public'),
          'revoke: the delete_public is due within 30 s (dispatched inline)');

-- region admin of testville can moderate testville photos only (positive region-scoped case)
update public.regions set is_active = true where slug = 'testville';
insert into public.houses (id, region_id, season, year, address, normalized_address, lat, lng, coord_source, status)
values ('e7000000-0000-4000-a000-0000000000b9', current_setting('t.testville')::uuid, 'halloween', 2026, '9 Testville Rd', '9 testville rd #7', 10.5, 10.5, 'admin', 'visible');
select set_config('t.p_tv', test_helpers.mk('e7000000-0000-4000-a000-0000000000b9', 'pending', 'e7000000-0000-4000-a000-000000000001')::text, true);
select test_helpers.claims('e7000000-0000-4000-a000-0000000000a2', false, 'aal2');
set local role authenticated;
select lives_ok(format('select public.admin_reject_photo(%L)', current_setting('t.p_tv')), 'region admin rejects a photo in its own region');
reset role;

-- ================================================================ photos_open switch + context
select test_helpers.claims('e7000000-0000-4000-a000-0000000000a1', false, 'aal2');
set local role authenticated;
select lives_ok(format('select public.admin_set_photos_open(%L, false)', current_setting('t.truckee')), 'admin_set_photos_open(false) works');
select is((public.get_region_context('truckee') ->> 'photos_open')::boolean, false, 'get_region_context returns photos_open = false');
select is(test_helpers.err($$select public.reserve_photo('e7000000-0000-4000-a000-0000000000b3')$$), 'photos_closed', 'closed switch gates reserve_photo');
select lives_ok(format('select public.admin_set_photos_open(%L, true)', current_setting('t.truckee')), 'admin_set_photos_open(true) works');
select is((public.get_region_context('truckee') ->> 'photos_open')::boolean, true, 'get_region_context returns photos_open = true');
select is(test_helpers.err(format('select public.admin_set_photos_open(%L, null)', current_setting('t.truckee'))), 'invalid_input', 'null switch -> invalid_input');
select is(test_helpers.err($$select public.admin_set_photos_open('e7000000-0000-4000-a000-0000000000ff', true)$$), 'region_not_found', 'unknown region -> region_not_found');
reset role;
select is((select updated_by from public.site_settings where region_id = current_setting('t.truckee')::uuid), 'e7000000-0000-4000-a000-0000000000a1'::uuid,
          'set_photos_open records updated_by');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is((public.get_region_context(null) ->> 'photos_open')::boolean, true, 'anon sees photos_open through get_region_context');
reset role;

select * from finish();
rollback;
