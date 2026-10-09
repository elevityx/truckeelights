-- AC7, AC9, AC10, AC18, AC19: storage jobs are enqueued in the same transaction as the state change; completion
-- is verified against storage.objects; revocation retries stay <= 30 s; sweep/reconcile; the guarded rehearsal
-- purge (Amendment 1, replaces purge_pair); idempotent runner setup. Objects are faked with storage.objects rows.
begin;
create extension if not exists pgtap with schema extensions;
select plan(69);

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
on conflict (region_id) do update set active_season = 'halloween', active_year = 2026;
update public.site_settings s set active_season = 'halloween', active_year = 2026, submissions_open = true, photos_open = true
  from public.regions r where r.id = s.region_id and r.slug = 'truckee';
select set_config('t.truckee', (select id::text from public.regions where slug = 'truckee'), true);
select set_config('t.testville', (select id::text from public.regions where slug = 'testville'), true);
insert into auth.users (id, aud, role, email)
select ('e8000000-0000-4000-a000-0000000000' || x)::uuid, 'authenticated', 'authenticated', 'u8' || x || '@example.test'
  from unnest(array['01', 'a1', 'a2']) x;
insert into public.admins (user_id, region_id, note) values
  ('e8000000-0000-4000-a000-0000000000a1', null, 'test global'),
  ('e8000000-0000-4000-a000-0000000000a2', current_setting('t.testville')::uuid, 'test testville');

insert into public.houses (id, region_id, season, year, address, normalized_address, lat, lng, coord_source, status)
select v.id::uuid, r.id, v.season::public.season_kind, v.year, v.address, v.address || ' #8', v.lat, v.lng, 'admin', v.status::public.house_status
  from (values
    ('e8000000-0000-4000-a000-0000000000b1', 'truckee', 'halloween', 2026, '1 Eight Rd', 39.30, -120.20, 'visible'),
    ('e8000000-0000-4000-a000-0000000000b2', 'truckee', 'halloween', 2026, '2 Eight Rd', 39.30, -120.21, 'visible'),
    ('e8000000-0000-4000-a000-0000000000b3', 'truckee', 'halloween', 2026, '3 Eight Rd', 39.31, -120.20, 'visible'),
    ('e8000000-0000-4000-a000-0000000000b4', 'truckee', 'halloween', 2026, '4 Eight Rd', 39.31, -120.21, 'hidden'),
    ('e8000000-0000-4000-a000-0000000000b5', 'truckee', 'christmas', 2025, '5 Eight Rd', 39.32, -120.21, 'visible')
  ) v(id, slug, season, year, address, lat, lng, status)
  join public.regions r on r.slug = v.slug;

create schema test_helpers;
grant usage on schema test_helpers to authenticated;
create function test_helpers.claims(p_uid text, p_anon boolean, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', p_anon, 'aal', p_aal)::text, true)::text
$$;
create function test_helpers.err(q text) returns text language plpgsql as $$
declare m text; d text;
begin
  execute q; return 'ok';
exception when others then
  get stacked diagnostics m = message_text, d = pg_exception_detail;
  return m || coalesce('/' || nullif(d, ''), '');
end $$;
grant execute on all functions in schema test_helpers to authenticated;
create function test_helpers.obj(p_bucket text, p_name text) returns void language sql as $$
  insert into storage.objects (bucket_id, name) values (p_bucket, p_name)
$$;
create function test_helpers.rm(p_bucket text, p_name text) returns void language sql as $$
  select set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = p_bucket and name = p_name;
$$;
-- A photo in a given status. Its objects exist: the upload (unless approved) and the public object (if approved).
create function test_helpers.mk(p_house uuid, p_status text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_pub text;
begin
  if p_status = 'approved' then v_pub := p_house::text || '/' || gen_random_uuid()::text || '.jpg'; end if;
  insert into public.photos (id, house_id, upload_path, public_path, status, reserved_until, created_by)
  values (v_id, p_house, p_house::text || '/' || v_id::text || '.jpg', v_pub, p_status::public.photo_status,
          now() + interval '15 minutes', 'e8000000-0000-4000-a000-000000000001');
  if p_status in ('reserved', 'pending') then perform test_helpers.obj('photo-uploads', p_house::text || '/' || v_id::text || '.jpg'); end if;
  if v_pub is not null then perform test_helpers.obj('photos', v_pub); end if;
  return v_id;
end $$;
revoke all on function test_helpers.obj(text, text), test_helpers.rm(text, text), test_helpers.mk(uuid, text) from authenticated;

select set_config('t.a1', test_helpers.mk('e8000000-0000-4000-a000-0000000000b1', 'approved')::text, true);
select set_config('t.a2', test_helpers.mk('e8000000-0000-4000-a000-0000000000b1', 'approved')::text, true);
select set_config('t.pend', test_helpers.mk('e8000000-0000-4000-a000-0000000000b1', 'pending')::text, true);
select set_config('t.res', test_helpers.mk('e8000000-0000-4000-a000-0000000000b1', 'reserved')::text, true);
select set_config('t.b2a', test_helpers.mk('e8000000-0000-4000-a000-0000000000b2', 'approved')::text, true);
select set_config('t.b3a', test_helpers.mk('e8000000-0000-4000-a000-0000000000b3', 'approved')::text, true);
select set_config('t.b4a', test_helpers.mk('e8000000-0000-4000-a000-0000000000b4', 'approved')::text, true);   -- hidden house
select set_config('t.b5a', test_helpers.mk('e8000000-0000-4000-a000-0000000000b5', 'approved')::text, true);   -- other pair

-- ================================================================ hide / unhide / release
select test_helpers.claims('e8000000-0000-4000-a000-0000000000a1', false, 'aal2');
set local role authenticated;
select lives_ok($$select public.admin_set_house_status('e8000000-0000-4000-a000-0000000000b1', 'hidden', 'x')$$, 'hide house b1');
reset role;
-- still inside the test transaction: the hide and its jobs commit (or roll back) together
select is((select count(*)::int from private.storage_jobs j join public.photos p on p.id = j.photo_id
            where p.house_id = 'e8000000-0000-4000-a000-0000000000b1' and j.kind = 'rotate_public'), 2,
          'hide -> one rotate_public per approved photo, in the same transaction');
select ok((select bool_and(private.path_house_id(j.new_object_name) = 'e8000000-0000-4000-a000-0000000000b1'
                           and j.object_name = p.public_path and j.new_object_name <> j.object_name and j.done_at is null)
             from private.storage_jobs j join public.photos p on p.id = j.photo_id where j.kind = 'rotate_public'),
          'rotate jobs: old = current public_path, new = fresh name in the same house folder, open');
select is((select count(*)::int from private.storage_jobs where photo_id in (current_setting('t.pend')::uuid, current_setting('t.res')::uuid)), 0,
          'hide queues nothing for pending/reserved photos');
set local role authenticated;
select lives_ok($$select public.admin_set_house_status('e8000000-0000-4000-a000-0000000000b1', 'visible', null)$$, 'unhide');
reset role;
select is((select count(*)::int from private.storage_jobs), 2, 'unhide -> no new jobs');
set local role authenticated;
select lives_ok($$select public.admin_set_house_status('e8000000-0000-4000-a000-0000000000b1', 'hidden', 'again')$$, 'hide again while the rotations are open');
reset role;
select is((select count(*)::int from private.storage_jobs where kind = 'rotate_public' and done_at is null), 2,
          'a second hide does not queue a second rotate per photo (the open one already moves the current name)');

-- release: approved -> revoked + delete_public (supersedes the open rotates), pending -> rejected, reserved -> expired
set local role authenticated;
select lives_ok($$select public.admin_release_house('e8000000-0000-4000-a000-0000000000b1')$$, 'release b1');
reset role;
select results_eq(format($$select status::text, public_path from public.photos where id in (%L, %L) order by id$$, current_setting('t.a1'), current_setting('t.a2')),
  $$values ('revoked', null::text), ('revoked', null::text)$$, 'release: approved photos are revoked, public_path null');
select is((select status::text from public.photos where id = current_setting('t.pend')::uuid), 'rejected', 'release: pending -> rejected');
select is((select status::text from public.photos where id = current_setting('t.res')::uuid), 'expired', 'release: reserved -> expired');
select is((select count(*)::int from private.storage_jobs where photo_id in (current_setting('t.a1')::uuid, current_setting('t.a2')::uuid)
            and kind = 'delete_public'), 4, 'release: delete_public for each old name and each superseded rotate destination');
select is((select count(*)::int from private.storage_jobs where kind = 'rotate_public' and last_error = 'superseded' and done_at is not null), 2,
          'release: the open rotates are superseded');
select is((select count(*)::int from private.storage_jobs where photo_id in (current_setting('t.pend')::uuid, current_setting('t.res')::uuid)
            and kind = 'delete_upload'), 2, 'release: delete_upload for the pending and the reserved upload');

-- ================================================================ season switch rotates the old pair's public photos
set local role authenticated;
select lives_ok(format('select public.admin_set_season(%L, %L, 2026, true)', current_setting('t.truckee'), 'halloween'), 'season "switch" to the same pair');
reset role;
select is((select count(*)::int from private.storage_jobs where kind = 'rotate_public' and done_at is null), 0, 'same pair -> no rotate jobs');
set local role authenticated;
select lives_ok(format('select public.admin_set_season(%L, %L, 2025, true)', current_setting('t.truckee'), 'christmas'), 'switch to christmas/2025');
reset role;
select results_eq($$select photo_id from private.storage_jobs where kind = 'rotate_public' and done_at is null order by photo_id$$,
  format('select x::uuid from unnest(array[%L, %L]) x order by 1', current_setting('t.b2a'), current_setting('t.b3a')),
  'season switch -> rotate jobs for the old pair''s approved photos of visible houses only (not hidden, not other pair)');

-- ================================================================ revoke during an open rotate
set local role authenticated;
select lives_ok(format('select public.admin_revoke_photo(%L)', current_setting('t.b2a')), 'revoke b2a while its rotate is open');
reset role;
select is((select last_error from private.storage_jobs where photo_id = current_setting('t.b2a')::uuid and kind = 'rotate_public'), 'superseded',
          'revoke supersedes the open rotate');
select is((select count(*)::int from private.storage_jobs where photo_id = current_setting('t.b2a')::uuid and kind = 'delete_public'), 2,
          'revoke during a rotate -> 2 delete_public jobs (old name + rotate destination)');

-- ================================================================ satisfied / finish / admin_complete
select set_config('t.jrot', (select id::text from private.storage_jobs where photo_id = current_setting('t.b3a')::uuid and kind = 'rotate_public'), true);
select set_config('t.b3old', (select public_path from public.photos where id = current_setting('t.b3a')::uuid), true);
select set_config('t.b3new', (select new_object_name from private.storage_jobs where id = current_setting('t.jrot')::bigint), true);
select is(private.storage_job_satisfied(current_setting('t.jrot')::bigint), false, 'satisfied = false while the old object exists');
select test_helpers.claims('e8000000-0000-4000-a000-0000000000a1', false, 'aal2');
set local role authenticated;
select is(public.admin_complete_storage_job(current_setting('t.jrot')::bigint), false, 'admin_complete -> false while the object exists (never early)');
reset role;
select test_helpers.claims('e8000000-0000-4000-a000-0000000000a2', false, 'aal2');
set local role authenticated;
select is(test_helpers.err(format('select public.admin_complete_storage_job(%L)', current_setting('t.jrot'))), 'forbidden', 'admin_complete cross-region -> forbidden');
select is(test_helpers.err(format('select * from public.admin_storage_jobs(%L)', current_setting('t.truckee'))), 'forbidden', 'admin_storage_jobs cross-region -> forbidden');
select is((select count(*)::int from public.admin_storage_jobs(current_setting('t.testville')::uuid)), 0, 'region admin sees only its region''s jobs');
reset role;
-- simulate the fallback "copy then delete"
select test_helpers.obj('photos', current_setting('t.b3new'));
select test_helpers.rm('photos', current_setting('t.b3old'));
select is(private.storage_job_satisfied(current_setting('t.jrot')::bigint), true, 'satisfied = true once the old name is gone');
select test_helpers.claims('e8000000-0000-4000-a000-0000000000a1', false, 'aal2');
set local role authenticated;
select ok((select count(*) > 0 from public.admin_storage_jobs(current_setting('t.truckee')::uuid) where id = current_setting('t.jrot')::bigint), 'admin_storage_jobs lists the open job');
select is(public.admin_complete_storage_job(current_setting('t.jrot')::bigint), true, 'admin_complete -> true after the storage action');
select is(public.admin_complete_storage_job(current_setting('t.jrot')::bigint), true, 'admin_complete on a done job -> true');
select is(test_helpers.err('select public.admin_complete_storage_job(-1)'), 'not_found', 'admin_complete unknown job (global admin) -> not_found');
reset role;
select results_eq(format('select public_path, public_rotated_at is not null from public.photos where id = %L', current_setting('t.b3a')),
  format('values (%L, true)', current_setting('t.b3new')), 'finish(rotate, new exists) promotes public_path to the new name');
-- finish(rotate) with both names missing: the object is lost -> revoke (fail closed)
select set_config('t.lost', test_helpers.mk('e8000000-0000-4000-a000-0000000000b5', 'approved')::text, true);
select set_config('t.jlost', private.enqueue_storage_job('rotate_public', 'photos', (select public_path from public.photos where id = current_setting('t.lost')::uuid),
  'e8000000-0000-4000-a000-0000000000b5/' || gen_random_uuid()::text || '.jpg', current_setting('t.lost')::uuid, current_setting('t.truckee')::uuid)::text, true);
select test_helpers.rm('photos', (select public_path from public.photos where id = current_setting('t.lost')::uuid));
select private.finish_storage_job(current_setting('t.jlost')::bigint);
select results_eq(format('select status::text, public_path from public.photos where id = %L', current_setting('t.lost')),
  $$values ('revoked', null::text)$$, 'finish(rotate, both missing) revokes the photo');
select results_eq(format('select last_error, done_at is not null from private.storage_jobs where id = %L', current_setting('t.jlost')),
  $$values ('object_missing', true)$$, 'and records object_missing');

-- ================================================================ AC18: revocation retries never grow past 30 s
select ok(private.storage_job_backoff('delete_public', 10) <= interval '30 seconds'
          and private.storage_job_backoff('rotate_public', 50) <= interval '30 seconds', 'revocation backoff stays <= 30 s');
select is(private.storage_job_backoff('delete_upload', 100), interval '600 seconds', 'upload deletes back off to at most 10 min');
select set_config('t.jbk', (select min(id)::text from private.storage_jobs where photo_id = current_setting('t.b2a')::uuid and kind = 'delete_public' and done_at is null), true);
update private.storage_jobs set attempts = 10, next_attempt_at = now() - interval '1 second' where id = current_setting('t.jbk')::bigint;
select private.run_storage_jobs(50, current_setting('t.b2a')::uuid);
select ok((select attempts = 11 and next_attempt_at - now() <= interval '30 seconds' from private.storage_jobs where id = current_setting('t.jbk')::bigint),
          'after 10 failed attempts a delete_public is retried within 30 s');
-- runner not configured: still <= 30 s for revocation kinds
update private.storage_jobs set next_attempt_at = now() - interval '1 second' where id = current_setting('t.jbk')::bigint;
select set_config('storage.allow_delete_query', 'true', true);
delete from vault.secrets where name in ('storage_api_url', 'storage_api_key');
select private.run_storage_jobs(50, current_setting('t.b2a')::uuid);
select ok((select last_error = 'runner_not_configured' and next_attempt_at - now() <= interval '30 seconds' from private.storage_jobs where id = current_setting('t.jbk')::bigint),
          'runner not configured: revocation retry still <= 30 s');

-- ================================================================ AC19: idempotent runner setup
select lives_ok($$select private.set_runner_secret('storage_api_url', 'http://local.invalid:1')$$, 'set_runner_secret creates');
select lives_ok($$select private.set_runner_secret('storage_api_url', 'http://local.invalid:2')$$, 'set_runner_secret again updates');
select ok((select count(*) = 1 and bool_and(decrypted_secret = 'http://local.invalid:2') from vault.decrypted_secrets where name = 'storage_api_url'),
  'one Vault secret per name, with the latest value');
select is(test_helpers.err($$select private.set_runner_secret('other', 'x')$$), 'invalid_input/runner_secret', 'set_runner_secret rejects other names');
select private.set_storage_runner(true);
select private.set_storage_runner(true);
select results_eq($$select count(*)::int, max(schedule) from cron.job where jobname = 'tl-storage-jobs'$$, $$values (1, '30 seconds')$$,
  'set_storage_runner(true) twice -> one job, every 30 seconds');
select private.set_storage_runner(false);
select private.set_storage_runner(false);
select is((select count(*)::int from cron.job where jobname = 'tl-storage-jobs'), 0, 'set_storage_runner(false) twice -> unscheduled');
select private.set_storage_runner(true);
select is((select count(*)::int from cron.job where jobname in ('tl-storage-jobs', 'tl-sweep-photos', 'tl-reconcile-storage')), 3, 'the 3 tl-* cron jobs exist');

-- ================================================================ AC9: sweep and reconcile
select set_config('t.sw', test_helpers.mk('e8000000-0000-4000-a000-0000000000b3', 'reserved')::text, true);
update public.photos set reserved_until = now() - interval '1 minute' where id = current_setting('t.sw')::uuid;
insert into private.quota_events (kind, uid, region_id, created_at) values
  ('house', gen_random_uuid(), current_setting('t.truckee')::uuid, now() - interval '49 hours'),
  ('house', gen_random_uuid(), current_setting('t.truckee')::uuid, now() - interval '47 hours');
select set_config('t.nphotos', (select count(*)::text from public.photos), true);
select is(private.sweep_photos(), 1, 'sweep expires the stale reservation');
select is((select count(*)::int from public.photos), current_setting('t.nphotos')::int, 'sweep never deletes photo rows');
select is((select count(*)::int from private.storage_jobs where photo_id = current_setting('t.sw')::uuid and kind = 'delete_upload'), 1, 'sweep queues the upload delete');
select is((select count(*)::int from private.quota_events where created_at < now() - interval '48 hours'), 0, 'sweep prunes ledger rows older than 48 h');
select is((select count(*)::int from private.quota_events where created_at < now() - interval '46 hours'), 1, 'sweep keeps ledger rows younger than 48 h');
-- reconcile: an unreferenced object older than 1 day (a half-failed approval), a young one, and a referenced old one
select test_helpers.obj('photos', 'e8000000-0000-4000-a000-0000000000b3/e8000000-0000-4000-a000-00000000dead.jpg');
select test_helpers.obj('photos', 'e8000000-0000-4000-a000-0000000000b3/e8000000-0000-4000-a000-00000000beef.jpg');
select test_helpers.obj('photo-uploads', 'e8000000-0000-4000-a000-0000000000b3/e8000000-0000-4000-a000-00000000f00d.jpg');
update storage.objects set created_at = now() - interval '2 days'
 where name in ('e8000000-0000-4000-a000-0000000000b3/e8000000-0000-4000-a000-00000000dead.jpg',
                'e8000000-0000-4000-a000-0000000000b3/e8000000-0000-4000-a000-00000000f00d.jpg',
                current_setting('t.b3new'));
select is(private.reconcile_storage(), 2, 'reconcile queues exactly the two old unreferenced objects');
select results_eq($$select kind, object_name, region_id from private.storage_jobs where photo_id is null order by kind$$,
  format($$values ('delete_public', 'e8000000-0000-4000-a000-0000000000b3/e8000000-0000-4000-a000-00000000dead.jpg', %L::uuid),
                  ('delete_upload', 'e8000000-0000-4000-a000-0000000000b3/e8000000-0000-4000-a000-00000000f00d.jpg', %L::uuid)$$,
         current_setting('t.truckee'), current_setting('t.truckee')),
  'reconcile: orphan deletes carry the region from the path (referenced and young objects untouched)');
select is(private.reconcile_storage(), 0, 'reconcile is idempotent while the jobs are open');

-- ================================================================ AC10: purge_rehearsal (replaces purge_pair)
select is(test_helpers.err('select private.purge_rehearsal(false)'), 'invalid_input/no_rehearsal_region', 'purge: no rehearsal region -> refuses');
insert into public.regions (slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng, default_zoom, timezone, is_active)
values ('rehearsal', 'Rehearsal', 0.10, 0.20, -150.20, -150.10, 0.15, -150.15, 12, 'America/Los_Angeles', true);
select set_config('t.reh', (select id::text from public.regions where slug = 'rehearsal'), true);
insert into public.site_settings (region_id, active_season, active_year, submissions_open, photos_open)
values (current_setting('t.reh')::uuid, 'halloween', 2026, true, true);
insert into public.houses (id, region_id, season, year, address, normalized_address, lat, lng, coord_source, status) values
  ('e8000000-0000-4000-a000-0000000000c1', current_setting('t.reh')::uuid, 'halloween', 2026, '1 Ocean Rd', '1 ocean rd', 0.15, -150.15, 'admin', 'visible'),
  ('e8000000-0000-4000-a000-0000000000c2', current_setting('t.reh')::uuid, 'halloween', 2026, '2 Ocean Rd', '2 ocean rd', 0.16, -150.15, 'admin', 'visible');
select is(test_helpers.err('select private.purge_rehearsal(false)'), 'invalid_input/rehearsal_open', 'purge: rehearsal open -> refuses');
update public.site_settings set submissions_open = false, photos_open = true where region_id = current_setting('t.reh')::uuid;
select is(test_helpers.err('select private.purge_rehearsal(false)'), 'invalid_input/rehearsal_open', 'purge: photos still open -> refuses');
update public.site_settings set photos_open = false where region_id = current_setting('t.reh')::uuid;
select set_config('t.default', (select default_region_id::text from public.app_settings), true);
update public.app_settings set default_region_id = current_setting('t.reh')::uuid;
select is(test_helpers.err('select private.purge_rehearsal(false)'), 'invalid_input/rehearsal_is_default', 'purge: rehearsal is the default region -> refuses');
update public.app_settings set default_region_id = current_setting('t.default')::uuid;

-- rehearsal photos: one with a QUEUED rotate, one with a MOVED-BUT-UNFINISHED rotate, one pending, one plain approved
select set_config('t.rq', test_helpers.mk('e8000000-0000-4000-a000-0000000000c1', 'approved')::text, true);
select set_config('t.rm', test_helpers.mk('e8000000-0000-4000-a000-0000000000c1', 'approved')::text, true);
select set_config('t.rp', test_helpers.mk('e8000000-0000-4000-a000-0000000000c2', 'pending')::text, true);
select set_config('t.ra', test_helpers.mk('e8000000-0000-4000-a000-0000000000c2', 'approved')::text, true);
select set_config('t.rq_new', 'e8000000-0000-4000-a000-0000000000c1/' || gen_random_uuid()::text || '.jpg', true);
select set_config('t.rm_new', 'e8000000-0000-4000-a000-0000000000c1/' || gen_random_uuid()::text || '.jpg', true);
select private.enqueue_storage_job('rotate_public', 'photos', (select public_path from public.photos where id = current_setting('t.rq')::uuid),
  current_setting('t.rq_new'), current_setting('t.rq')::uuid, current_setting('t.reh')::uuid);
select private.enqueue_storage_job('rotate_public', 'photos', (select public_path from public.photos where id = current_setting('t.rm')::uuid),
  current_setting('t.rm_new'), current_setting('t.rm')::uuid, current_setting('t.reh')::uuid);
-- "moved but unfinished": the object already sits at the new name, the old name is gone, the job is still open
select test_helpers.rm('photos', (select public_path from public.photos where id = current_setting('t.rm')::uuid));
select test_helpers.obj('photos', current_setting('t.rm_new'));
select set_config('t.other_counts', (select format('%s/%s', (select count(*) from public.houses where region_id <> current_setting('t.reh')::uuid),
                                                      (select count(*) from public.photos p join public.houses h on h.id = p.house_id
                                                        where h.region_id <> current_setting('t.reh')::uuid))), true);

-- other-region rollback guard: a sabotage trigger changes a Truckee count mid-purge -> the whole call rolls back
create function test_helpers.sabotage() returns trigger language plpgsql as $$
begin
  insert into public.houses (region_id, season, year, address, normalized_address, lat, lng, coord_source)
  values (current_setting('t.truckee')::uuid, 'halloween', 2026, '9 Sabotage Rd', '9 sabotage rd ' || gen_random_uuid(), 39.3, -120.2, 'admin');
  return null;
end $$;
create trigger sabotage after update on public.photos for each statement execute function test_helpers.sabotage();
select is(test_helpers.err('select private.purge_rehearsal(false)'), 'invalid_input/other_region_changed', 'purge: another region''s count changes -> refuses');
drop trigger sabotage on public.photos;
select is((select count(*)::int from public.photos where house_id in ('e8000000-0000-4000-a000-0000000000c1', 'e8000000-0000-4000-a000-0000000000c2') and status = 'approved'), 3,
          'the refused purge rolled back completely');

select ok((select (private.purge_rehearsal(false) ->> 'photos_touched')::int = 4), 'purge(false) touches the 4 rehearsal photos');
select is((select count(*)::int from public.photos where house_id in ('e8000000-0000-4000-a000-0000000000c1', 'e8000000-0000-4000-a000-0000000000c2')
            and (status not in ('revoked', 'expired') or public_path is not null)), 0, 'purge(false): every rehearsal photo is revoked/expired, public_path null');
select is((select count(*)::int from private.storage_jobs where kind = 'rotate_public' and photo_id in (current_setting('t.rq')::uuid, current_setting('t.rm')::uuid)
            and done_at is not null and last_error = 'superseded'), 2, 'purge supersedes both the queued and the moved-but-unfinished rotate');
select ok(exists (select 1 from private.storage_jobs where kind = 'delete_public' and object_name = current_setting('t.rq_new'))
          and exists (select 1 from private.storage_jobs where kind = 'delete_public' and object_name = current_setting('t.rm_new') and done_at is null),
          'purge deletes every rotate destination (the moved object is queued and still open)');
select is(test_helpers.err('select private.purge_rehearsal(true)'), 'invalid_input/jobs_open', 'purge(true) refuses while jobs are open');
-- finish the storage side: remove every object under the rehearsal folders, run the jobs
select test_helpers.rm(o.bucket_id, o.name) from storage.objects o
 where split_part(o.name, '/', 1) in ('e8000000-0000-4000-a000-0000000000c1', 'e8000000-0000-4000-a000-0000000000c2');
select private.run_storage_jobs(100, x.id) from public.photos x where x.house_id in ('e8000000-0000-4000-a000-0000000000c1', 'e8000000-0000-4000-a000-0000000000c2');
select test_helpers.obj('photo-uploads', 'e8000000-0000-4000-a000-0000000000c2/e8000000-0000-4000-a000-00000000aaaa.jpg');
select is(test_helpers.err('select private.purge_rehearsal(true)'), 'invalid_input/objects_remain', 'purge(true) refuses while objects remain');
select test_helpers.rm('photo-uploads', 'e8000000-0000-4000-a000-0000000000c2/e8000000-0000-4000-a000-00000000aaaa.jpg');
select results_eq($$select (r ->> 'photos_deleted')::int, (r ->> 'houses_deleted')::int from private.purge_rehearsal(true) r$$,
  $$values (4, 2)$$, 'purge(true) deletes the rehearsal photos and houses');
select is((select format('%s/%s', (select count(*) from public.houses where region_id <> current_setting('t.reh')::uuid),
                                  (select count(*) from public.photos p join public.houses h on h.id = p.house_id
                                    where h.region_id <> current_setting('t.reh')::uuid))),
          current_setting('t.other_counts'), 'other regions are untouched');
select ok(exists (select 1 from public.regions where slug = 'rehearsal'), 'the rehearsal region itself is kept');

select * from finish();
rollback;
