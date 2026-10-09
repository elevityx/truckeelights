-- AC1, AC2, AC3: RLS everywhere, no write grants, column allowlist, private schema unreachable,
-- exact EXECUTE allowlist per API role. R2: photos, storage_jobs, private USAGE for authenticated only.
-- Votes: vote_events, vote_salts (private), house_vote_totals (public read), the vote RPCs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(73);

-- (1) RLS enabled on every table in public and private.
select is(
  (select coalesce(array_agg(format('%I.%I', n.nspname, c.relname) order by format('%I.%I', n.nspname, c.relname)), '{}')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p') and not c.relrowsecurity),
  '{}'::text[], 'every table in public and private has RLS enabled');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')),
  19, 'exactly 19 tables exist in public + private (R1 + photos + storage_jobs + votes + events + subscribe)');
select is(
  (select coalesce(array_agg(c.relname::text order by c.relname::text), '{}')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relkind in ('r', 'p') and not c.relforcerowsecurity),
  '{}'::text[], 'private tables use FORCE ROW LEVEL SECURITY');
select is(
  (select count(*)::int from pg_policies where schemaname = 'private'),
  0, 'private tables have no policies');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'admins'),
  0, 'public.admins has no policies');

-- (2) No write privileges (or other table-level privileges) for API roles on any table.
select is(
  (select coalesce(array_agg(format('%s:%I.%I:%s', r.role, n.nspname, c.relname, p.priv) order by format('%s:%I.%I:%s', r.role, n.nspname, c.relname, p.priv)), '{}')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('anon'), ('authenticated')) r(role)
     cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
      and has_table_privilege(r.role, c.oid, p.priv)),
  '{}'::text[], 'anon/authenticated have no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on any table');
select is(
  (select coalesce(array_agg(format('%s:%I.%I.%I:%s', r.role, n.nspname, c.relname, a.attname, p.priv) order by format('%s:%I.%I.%I:%s', r.role, n.nspname, c.relname, a.attname, p.priv)), '{}')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     cross join (values ('anon'), ('authenticated')) r(role)
     cross join (values ('INSERT'), ('UPDATE'), ('REFERENCES')) p(priv)
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
      and has_column_privilege(r.role, c.oid, a.attnum, p.priv)),
  '{}'::text[], 'anon/authenticated have no column-level INSERT/UPDATE/REFERENCES anywhere');
select is(
  (select coalesce(array_agg(format('%s:%I.%I', r.role, n.nspname, c.relname) order by format('%s:%I.%I', r.role, n.nspname, c.relname)), '{}')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('anon'), ('authenticated')) r(role)
    where n.nspname in ('public', 'private') and c.relkind = 'S'
      and (has_sequence_privilege(r.role, c.oid, 'USAGE') or has_sequence_privilege(r.role, c.oid, 'UPDATE')
           or has_sequence_privilege(r.role, c.oid, 'SELECT'))),
  '{}'::text[], 'anon/authenticated have no sequence privileges in public/private');

-- (3) No SELECT at all on admins and the private tables.
select ok(not has_any_column_privilege('anon', 'public.admins', 'SELECT'), 'anon cannot SELECT public.admins');
select ok(not has_any_column_privilege('authenticated', 'public.admins', 'SELECT'), 'authenticated cannot SELECT public.admins');
select ok(not has_any_column_privilege('anon', 'private.quota_events', 'SELECT'), 'anon cannot SELECT private.quota_events');
select ok(not has_any_column_privilege('authenticated', 'private.quota_events', 'SELECT'), 'authenticated cannot SELECT private.quota_events');
select ok(not has_any_column_privilege('anon', 'private.blocked_terms', 'SELECT'), 'anon cannot SELECT private.blocked_terms');
select ok(not has_any_column_privilege('authenticated', 'private.blocked_terms', 'SELECT'), 'authenticated cannot SELECT private.blocked_terms');
select ok(not has_any_column_privilege('anon', 'private.storage_jobs', 'SELECT')
          and not has_any_column_privilege('authenticated', 'private.storage_jobs', 'SELECT'), 'no API role can SELECT private.storage_jobs');
select ok(not has_any_column_privilege('anon', 'private.vote_events', 'SELECT')
          and not has_any_column_privilege('authenticated', 'private.vote_events', 'SELECT'), 'no API role can SELECT private.vote_events');
select ok(not has_any_column_privilege('anon', 'private.vote_salts', 'SELECT')
          and not has_any_column_privilege('authenticated', 'private.vote_salts', 'SELECT'), 'no API role can SELECT private.vote_salts');
select ok((select c.relrowsecurity and c.relforcerowsecurity from pg_class c where c.oid = 'private.vote_events'::regclass)
          and (select c.relrowsecurity and c.relforcerowsecurity from pg_class c where c.oid = 'private.vote_salts'::regclass),
          'vote_events and vote_salts have RLS enabled and forced');
select is((select count(*)::int from pg_policies where schemaname = 'private' and tablename in ('vote_events', 'vote_salts')), 0,
          'vote_events and vote_salts have no policies');
-- Amendment 1 (AC2): public.photos has NO grants and NO policies for anon/authenticated.
select ok(not has_any_column_privilege('anon', 'public.photos', 'SELECT')
          and not has_any_column_privilege('authenticated', 'public.photos', 'SELECT'), 'no API role can SELECT any column of public.photos');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'photos'), 0, 'public.photos has no policies');
-- Events: FORCE RLS and exactly one policy, a SELECT for anon/authenticated (writes only through the RPCs).
select ok((select c.relforcerowsecurity from pg_class c where c.oid = 'public.events'::regclass), 'public.events uses FORCE ROW LEVEL SECURITY');
select is((select array_agg(format('%s:%s:%s', policyname, cmd, array_to_string(roles, ','))) from pg_policies where schemaname = 'public' and tablename = 'events'),
  array['events_public_read:SELECT:anon,authenticated'], 'public.events has exactly one policy: SELECT for anon, authenticated');

-- Subscribe + Accounts: subscriptions and house_claims have FORCE RLS, no policies and no grants (RPCs only).
select ok(not has_any_column_privilege('anon', 'public.subscriptions', 'SELECT')
          and not has_any_column_privilege('authenticated', 'public.subscriptions', 'SELECT')
          and not has_any_column_privilege('anon', 'public.house_claims', 'SELECT')
          and not has_any_column_privilege('authenticated', 'public.house_claims', 'SELECT'),
          'no API role can SELECT public.subscriptions or public.house_claims');
select ok((select bool_and(c.relforcerowsecurity) from pg_class c where c.oid in ('public.subscriptions'::regclass, 'public.house_claims'::regclass))
          and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('subscriptions', 'house_claims')) = 0,
          'subscriptions and house_claims: FORCE RLS, no policies');
select ok(not has_any_column_privilege('authenticated', 'private.house_links', 'SELECT')
          and not has_any_column_privilege('authenticated', 'private.digest_runs', 'SELECT')
          and not has_any_column_privilege('authenticated', 'private.digest_sends', 'SELECT'),
          'no API role can SELECT house_links / digest_runs / digest_sends');

-- (4) Omitted columns are unreadable; the readable set equals the grant list exactly.
select is(
  (select coalesce(array_agg(format('%s:%s', r.role, x.col) order by format('%s:%s', r.role, x.col)), '{}')
     from (values ('anon'), ('authenticated')) r(role)
     cross join (values
       ('houses', 'place_id'), ('houses', 'normalized_address'), ('houses', 'coord_source'),
       ('houses', 'hidden_reason'), ('houses', 'moderated_by'), ('houses', 'moderated_at'),
       ('houses', 'released_at'), ('houses', 'created_by'), ('houses', 'created_at'),
       ('houses', 'legacy_source'), ('houses', 'legacy_id'), ('site_settings', 'updated_by'),
       ('regions', 'boundary'), ('regions', 'created_at'),
       ('events', 'normalized_title'), ('events', 'start_day'), ('events', 'place_id'), ('events', 'status'),
       ('events', 'source'), ('events', 'source_url'), ('events', 'reject_reason'), ('events', 'created_by'),
       ('events', 'created_at'), ('events', 'moderated_by'), ('events', 'moderated_at'), ('events', 'updated_at'),
       ('events', 'approved_at'), ('houses', 'owner_id'), ('houses', 'owner_since'),
       ('app_settings', 'digest_daily_cap')) x(tbl, col)
    where has_column_privilege(r.role, format('public.%I', x.tbl), x.col, 'SELECT')),
  '{}'::text[], 'omitted columns are unreadable by anon and authenticated');
select is(
  (select array_agg(format('%I.%I', c.relname, a.attname) order by c.relname, a.attname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
      and has_column_privilege('anon', c.oid, a.attnum, 'SELECT')),
  array['app_settings.default_region_id', 'app_settings.id',
        'events.address', 'events.adults_only', 'events.description', 'events.ends_at', 'events.id', 'events.lat',
        'events.lng', 'events.region_id', 'events.season', 'events.starts_at', 'events.title', 'events.url',
        'events.venue', 'events.year',
        'house_vote_totals.house_id', 'house_vote_totals.region_id', 'house_vote_totals.votes',
        'houses.address', 'houses.id', 'houses.lat', 'houses.lng', 'houses.region_id', 'houses.season',
        'houses.status', 'houses.year',
        'region_brands.region_id', 'region_brands.season', 'region_brands.wordmark',
        'regions.center_lat', 'regions.center_lng', 'regions.country_code', 'regions.default_zoom',
        'regions.id', 'regions.is_active', 'regions.max_lat', 'regions.max_lng', 'regions.min_lat',
        'regions.min_lng', 'regions.name', 'regions.slug', 'regions.timezone',
        'site_settings.active_season', 'site_settings.active_year', 'site_settings.events_open',
        'site_settings.photos_open', 'site_settings.region_id', 'site_settings.submissions_open',
        'site_settings.subscribe_open', 'site_settings.updated_at', 'site_settings.votes_open'],
  'anon readable columns equal the grant allowlist exactly (no photos column: Amendment 1; Events A1 adds events_open; Subscribe adds subscribe_open)');
select ok(not has_column_privilege('anon', 'public.app_settings', 'vote_network_cap', 'SELECT')
          and not has_column_privilege('authenticated', 'public.app_settings', 'vote_network_cap', 'SELECT'),
          'app_settings.vote_network_cap has no grant');
select ok(not has_column_privilege('anon', 'public.house_vote_totals', 'updated_at', 'SELECT'),
          'house_vote_totals.updated_at is not granted');
select is(
  (select array_agg(format('%I.%I', c.relname, a.attname) order by c.relname, a.attname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
      and has_column_privilege('authenticated', c.oid, a.attnum, 'SELECT')),
  (select array_agg(format('%I.%I', c.relname, a.attname) order by c.relname, a.attname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
      and has_column_privilege('anon', c.oid, a.attnum, 'SELECT')),
  'authenticated readable columns equal anon readable columns');

-- (5) Invariant 9 (amended): private USAGE for authenticated only (Storage policy helpers); anon has none.
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon has no USAGE on schema private');
select ok(has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated has USAGE on schema private (policy helpers)');
select ok(not has_schema_privilege('anon', 'private', 'CREATE')
          and not has_schema_privilege('authenticated', 'private', 'CREATE'), 'no CREATE on schema private');
select ok(not has_schema_privilege('anon', 'public', 'CREATE')
          and not has_schema_privilege('authenticated', 'public', 'CREATE'), 'no CREATE on schema public');

-- (6) Direct access to private tables and admins fails with 42501.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok('select * from private.quota_events', '42501', null, 'anon: select private.quota_events -> 42501');
select throws_ok($$insert into private.quota_events (kind, uid, region_id) values ('house', gen_random_uuid(), gen_random_uuid())$$,
                 '42501', null, 'anon: insert private.quota_events -> 42501');
select throws_ok('select * from private.blocked_terms', '42501', null, 'anon: select private.blocked_terms -> 42501');
select throws_ok($$insert into private.blocked_terms (term) values ('zzanon')$$, '42501', null, 'anon: insert private.blocked_terms -> 42501');
select throws_ok('select * from public.admins', '42501', null, 'anon: select public.admins -> 42501');
select throws_ok('select id from public.photos', '42501', null, 'anon: select public.photos -> 42501');
select throws_ok('select public.photo_sign_paths(gen_random_uuid())', '42501', null, 'anon: photo_sign_paths -> 42501');
select throws_ok('select * from private.vote_events', '42501', null, 'anon: select private.vote_events -> 42501');
select throws_ok($$insert into public.house_vote_totals (house_id, region_id, votes) select id, region_id, 1 from public.houses limit 1$$,
                 '42501', null, 'anon: insert house_vote_totals -> 42501');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', 'a1000000-0000-4000-a000-000000000001', 'role', 'authenticated',
                    'is_anonymous', false, 'aal', 'aal2', 'amr', '[{"method":"totp","timestamp":1791564301},{"method":"password","timestamp":1791564300}]'::json)::text, true);
set local role authenticated;
select throws_ok('select * from private.quota_events', '42501', null, 'authenticated: select private.quota_events -> 42501');
select throws_ok($$insert into private.quota_events (kind, uid, region_id) values ('house', gen_random_uuid(), gen_random_uuid())$$,
                 '42501', null, 'authenticated: insert private.quota_events -> 42501');
select throws_ok('select * from private.blocked_terms', '42501', null, 'authenticated: select private.blocked_terms -> 42501');
select throws_ok($$insert into private.blocked_terms (term) values ('zzauth')$$, '42501', null, 'authenticated: insert private.blocked_terms -> 42501');
select throws_ok('select * from public.admins', '42501', null, 'authenticated: select public.admins -> 42501');
select throws_ok('select private.is_admin(null)', '42501', null, 'authenticated: calling a private function -> 42501');
select throws_ok('select * from private.storage_jobs', '42501', null, 'authenticated (with private USAGE): select private.storage_jobs -> 42501');
select throws_ok($$insert into private.storage_jobs (kind, bucket, object_name) values ('delete_public', 'photos', 'x')$$,
                 '42501', null, 'authenticated: insert private.storage_jobs -> 42501');
select throws_ok('select id, public_path from public.photos', '42501', null, 'authenticated: select public.photos -> 42501');
select throws_ok($$update public.photos set status = 'approved'$$, '42501', null, 'authenticated: update public.photos -> 42501');
select throws_ok('select public.photo_sign_paths(gen_random_uuid())', '42501', null, 'authenticated: photo_sign_paths -> 42501');
select throws_ok('select private.run_storage_jobs(1, null)', '42501', null, 'authenticated: private.run_storage_jobs -> 42501');
select throws_ok('select * from private.vote_events', '42501', null, 'authenticated: select private.vote_events -> 42501');
select throws_ok('select * from private.vote_salts', '42501', null, 'authenticated: select private.vote_salts -> 42501');
select throws_ok($$update public.house_vote_totals set votes = 999$$, '42501', null, 'authenticated: update house_vote_totals -> 42501');
select throws_ok('select private.vote_retention()', '42501', null, 'authenticated: private.vote_retention -> 42501');

-- (9) Direct writes on houses fail with 42501.
select throws_ok($$insert into public.houses (region_id, season, year, address, normalized_address, lat, lng, coord_source)
                   select id, 'halloween', 2026, '1 Direct Rd', '1 direct rd', 39.3, -120.2, 'admin' from public.regions limit 1$$,
                 '42501', null, 'authenticated: direct insert into houses -> 42501');
select throws_ok($$update public.houses set status = 'hidden'$$, '42501', null, 'authenticated: direct update of houses -> 42501');
select throws_ok($$delete from public.houses$$, '42501', null, 'authenticated: direct delete from houses -> 42501');
select throws_ok($$select * from public.houses$$, '42501', null, 'authenticated: select * on houses -> 42501 (column grants)');
reset role;

-- (7) Exact EXECUTE allowlist per role in schema public.
select is(
  (select coalesce(array_agg(format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) order by format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes))), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  array['public.get_house_photo_counts(uuid)', 'public.get_region_context(text)', 'public.network_probe(text)'],
  'anon can execute exactly the allowlist');
select is(
  (select coalesce(array_agg(format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) order by format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes))), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  array['public.admin_approve_photo(uuid, text)',
        'public.admin_claim_queue(uuid, text)',
        'public.admin_clear_owner(uuid)',
        'public.admin_complete_storage_job(bigint)',
        'public.admin_create_event(uuid, text, text, text, text, text, double precision, double precision, timestamp with time zone, timestamp with time zone, text, boolean, text)',
        'public.admin_digest_today()',
        'public.admin_event_counts(uuid)',
        'public.admin_event_queue(uuid, text)',
        'public.admin_list_houses(uuid, text, text)',
        'public.admin_moderate_event(uuid, text, text)',
        'public.admin_network_cap_status()',
        'public.admin_photo_queue(uuid, text)',
        'public.admin_reject_photo(uuid)',
        'public.admin_release_house(uuid)',
        'public.admin_resolve_claim(uuid, boolean, text)',
        'public.admin_revoke_photo(uuid)',
        'public.admin_set_events_open(uuid, boolean)',
        'public.admin_set_house_status(uuid, text, text)',
        'public.admin_set_network_cap(boolean)',
        'public.admin_set_photos_open(uuid, boolean)',
        'public.admin_set_season(uuid, text, integer, boolean)',
        'public.admin_set_subscribe_open(uuid, boolean)',
        'public.admin_set_votes_open(uuid, boolean)',
        'public.admin_storage_jobs(uuid)',
        'public.admin_subscriber_counts(uuid)',
        'public.admin_update_event(uuid, text, text, text, text, text, double precision, double precision, timestamp with time zone, timestamp with time zone, text, boolean)',
        'public.admin_void_votes(uuid, timestamp with time zone, uuid)',
        'public.admin_vote_stats(uuid)',
        'public.admin_whoami(uuid)',
        'public.begin_house_link(text)',
        'public.claim_my_submissions()',
        'public.complete_house_link()',
        'public.confirm_photo_upload(uuid)',
        'public.get_house_photo_counts(uuid)',
        'public.get_region_context(text)',
        'public.my_account()',
        'public.my_vote_status(uuid)',
        'public.network_probe(text)',
        'public.owner_set_house_visibility(uuid, boolean)',
        'public.request_house_claim(uuid, text)',
        'public.request_house_removal(uuid, text)',
        'public.reserve_photo(uuid)',
        'public.set_subscription(text, boolean, boolean, text)',
        'public.stop_subscription()',
        'public.submit_event(text, text, text, text, text, text, double precision, double precision, timestamp with time zone, timestamp with time zone, text, boolean)',
        'public.submit_house(text, text, text, double precision, double precision)',
        'public.vote_house(uuid, uuid)',
        'public.withdraw_house_claim(uuid)'],
  'authenticated can execute exactly the allowlist');

-- service_role executes the signer input; nothing else in public beyond the two lists above.
select ok(has_function_privilege('service_role', 'public.photo_sign_paths(uuid)', 'EXECUTE'), 'service_role can execute photo_sign_paths');
-- C2: the svc_* routines are service_role only (anon/authenticated are covered by the exact lists above).
select is(
  (select array_agg(format('%I(%s)', p.proname, oidvectortypes(p.proargtypes)) order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'svc\_%' and has_function_privilege('service_role', p.oid, 'EXECUTE')),
  array['svc_delete_account(uuid)', 'svc_digest_batch(uuid, integer)', 'svc_digest_finish(uuid)',
        'svc_digest_mark(uuid, uuid, boolean, text)', 'svc_digest_start(text, date)',
        'svc_unsubscribe_lookup(uuid, integer)', 'svc_unsubscribe_set_prefs(uuid, integer, boolean, boolean, text)',
        'svc_unsubscribe_stop(uuid, integer)'],
  'service_role executes exactly the eight svc_* routines');
select ok(not has_function_privilege('anon', 'public.photo_sign_paths(uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.photo_sign_paths(uuid)', 'EXECUTE'), 'anon/authenticated cannot execute photo_sign_paths');

-- (8) In private, only the two Storage policy helpers are executable, and only by authenticated.
select is(
  (select coalesce(array_agg(format('%s:%I.%I(%s)', r.role, n.nspname, p.proname, oidvectortypes(p.proargtypes)) order by format('%s:%I.%I(%s)', r.role, n.nspname, p.proname, oidvectortypes(p.proargtypes))), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join (values ('anon'), ('authenticated')) r(role)
    where n.nspname = 'private' and has_function_privilege(r.role, p.oid, 'EXECUTE')),
  array['authenticated:private.photo_upload_allowed(text)', 'authenticated:private.storage_admin_ok(text, text)'],
  'private EXECUTE allowlist: only the two policy helpers, only for authenticated');

-- Every function in public and private pins search_path to empty, and only the intended ones are definers.
select is(
  (select coalesce(array_agg(format('%I.%I', n.nspname, p.proname) order by format('%I.%I', n.nspname, p.proname)), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not coalesce(p.proconfig @> array['search_path=""'], false)),
  '{}'::text[], 'every public/private function sets search_path = ''''');
select is(
  (select array_agg(format('%I.%I', n.nspname, p.proname) order by format('%I.%I', n.nspname, p.proname))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef),
  array['private.admin_photo_region', 'private.client_net_hash', 'private.enqueue_delete_public', 'private.enqueue_rotate',
        'private.enqueue_storage_job', 'private.finish_storage_job', 'private.house_is_public',
        'private.is_admin', 'private.lock_photo', 'private.lock_quota', 'private.photo_object_readable',
        'private.photo_upload_allowed', 'private.purge_rehearsal', 'private.reconcile_storage',
        'private.rotate_house_photos', 'private.run_storage_jobs', 'private.set_runner_secret',
        'private.set_storage_runner', 'private.storage_admin_ok', 'private.storage_job_satisfied',
        'private.storage_object_exists', 'private.sweep_events', 'private.sweep_photos', 'private.sweep_subscribe',
        'private.take_quota',
        'private.vote_retention',
        'public.admin_approve_photo', 'public.admin_claim_queue', 'public.admin_clear_owner',
        'public.admin_complete_storage_job', 'public.admin_create_event', 'public.admin_digest_today',
        'public.admin_event_counts', 'public.admin_event_queue', 'public.admin_list_houses',
        'public.admin_moderate_event', 'public.admin_network_cap_status', 'public.admin_photo_queue',
        'public.admin_reject_photo', 'public.admin_release_house', 'public.admin_resolve_claim', 'public.admin_revoke_photo',
        'public.admin_set_events_open', 'public.admin_set_house_status', 'public.admin_set_network_cap',
        'public.admin_set_photos_open', 'public.admin_set_season', 'public.admin_set_subscribe_open',
        'public.admin_set_votes_open', 'public.admin_storage_jobs', 'public.admin_subscriber_counts',
        'public.admin_update_event', 'public.admin_void_votes',
        'public.admin_vote_stats', 'public.admin_whoami', 'public.begin_house_link', 'public.claim_my_submissions',
        'public.complete_house_link', 'public.confirm_photo_upload',
        'public.get_house_photo_counts', 'public.my_account', 'public.my_vote_status', 'public.network_probe',
        'public.owner_set_house_visibility', 'public.photo_sign_paths', 'public.request_house_claim',
        'public.request_house_removal', 'public.reserve_photo', 'public.set_subscription', 'public.stop_subscription',
        'public.submit_event', 'public.submit_house',
        'public.svc_delete_account', 'public.svc_digest_batch', 'public.svc_digest_finish', 'public.svc_digest_mark',
        'public.svc_digest_start', 'public.svc_unsubscribe_lookup', 'public.svc_unsubscribe_set_prefs',
        'public.svc_unsubscribe_stop',
        'public.vote_house', 'public.withdraw_house_claim'],
  'security definer functions are exactly the intended set');
select is(
  (select coalesce(array_agg(format('%I.%I', n.nspname, p.proname) order by format('%I.%I', n.nspname, p.proname)), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef and pg_get_userbyid(p.proowner) <> 'postgres'),
  '{}'::text[], 'all security definer functions are owned by postgres');

select * from finish();
rollback;
