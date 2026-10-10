-- Subscribe + Accounts v1 (Spec_Subscribe_Accounts §9 + Amendments 1-2): the auth matrix of every RPC
-- (anon role / anonymous user / non-anonymous / owner / other owner / admin AAL1 / admin AAL2 / other-region admin),
-- subscriptions + quota + token versions, house links (anonymous only, confirmed email, expiry, reuse, limits),
-- claim_my_submissions scope, claims and removal requests, owner hide vs admin hide (shared routine + photo job),
-- the admin_release_house refactor, admin_clear_owner, masked emails only, column grants, the subscribe capability,
-- events.approved_at, and the svc_* routines (service_role only; digest idempotency and cap; unsubscribe; delete),
-- and Amendment 3's digest data (season + opener, town, votes, far; last_digest_* advanced only on sent).
begin;
create extension if not exists pgtap with schema extensions;
select plan(227);

-- ---------------------------------------------------------------- fixtures (as postgres)
delete from public.admins;
delete from private.quota_events;
insert into public.regions (slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng, default_zoom, timezone, is_active)
values ('subtown', 'Subtown', 30, 31, 30, 31, 30.5, 30.5, 12, 'America/Los_Angeles', true),
       ('othertown', 'Othertown', 32, 33, 32, 33, 32.5, 32.5, 12, 'America/Los_Angeles', true);
insert into public.site_settings (region_id, active_season, active_year, submissions_open)
  select id, 'halloween', 2026, true from public.regions where slug in ('subtown', 'othertown');
select set_config('t.r', (select id::text from public.regions where slug = 'subtown'), true);
select set_config('t.o', (select id::text from public.regions where slug = 'othertown'), true);

-- f5..01 alice, 02 bob (confirmed), 03 carol (unconfirmed), 0a/0b anonymous devices, d1 global admin, d2 othertown admin.
insert into auth.users (id, aud, role, email, email_confirmed_at, is_anonymous) values
  ('f5000000-0000-4000-a000-000000000001', 'authenticated', 'authenticated', 'alice@example.test', now(), false),
  ('f5000000-0000-4000-a000-000000000002', 'authenticated', 'authenticated', 'bob@example.test',   now(), false),
  ('f5000000-0000-4000-a000-000000000003', 'authenticated', 'authenticated', 'carol@example.test', null,  false),
  ('f5000000-0000-4000-a000-00000000000a', 'authenticated', 'authenticated', null, null, true),
  ('f5000000-0000-4000-a000-00000000000b', 'authenticated', 'authenticated', null, null, true),
  ('f5000000-0000-4000-a000-0000000000d1', 'authenticated', 'authenticated', 'admin1@example.test', now(), false),
  ('f5000000-0000-4000-a000-0000000000d2', 'authenticated', 'authenticated', 'admin2@example.test', now(), false);
insert into public.admins (user_id, region_id, note) values
  ('f5000000-0000-4000-a000-0000000000d1', null, 'test global'),
  ('f5000000-0000-4000-a000-0000000000d2', current_setting('t.o')::uuid, 'test othertown');

create schema test_helpers;
grant usage on schema test_helpers to anon, authenticated, service_role;
create function test_helpers.err(p_sql text) returns text language plpgsql as $$
declare st text; msg text; det text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics st = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return msg || coalesce('/' || nullif(det, ''), '');
end $$;
-- Session claims. Admin-style aal2 sessions carry a password + totp amr (the C1 shape) so the fixtures keep working
-- after 20261016000100_admin_amr; account sessions carry an otp amr.
create function test_helpers.as_(p_who text) returns void language plpgsql as $$
declare v_uid text; v_anon boolean := false; v_aal text := 'aal1'; v_amr jsonb := '[{"method":"otp","timestamp":1}]';
begin
  case p_who
    when 'alice' then v_uid := 'f5000000-0000-4000-a000-000000000001';
    when 'bob'   then v_uid := 'f5000000-0000-4000-a000-000000000002';
    when 'carol' then v_uid := 'f5000000-0000-4000-a000-000000000003';
    when 'anonA' then v_uid := 'f5000000-0000-4000-a000-00000000000a'; v_anon := true; v_amr := '[{"method":"anonymous","timestamp":1}]';
    when 'anonB' then v_uid := 'f5000000-0000-4000-a000-00000000000b'; v_anon := true; v_amr := '[{"method":"anonymous","timestamp":1}]';
    when 'admin1' then v_uid := 'f5000000-0000-4000-a000-0000000000d1'; v_aal := 'aal2';
                      v_amr := '[{"method":"password","timestamp":1},{"method":"totp","timestamp":2}]';
    when 'admin1_aal1' then v_uid := 'f5000000-0000-4000-a000-0000000000d1'; v_amr := '[{"method":"password","timestamp":1}]';
    when 'admin2' then v_uid := 'f5000000-0000-4000-a000-0000000000d2'; v_aal := 'aal2';
                      v_amr := '[{"method":"password","timestamp":1},{"method":"totp","timestamp":2}]';
  end case;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated',
    'is_anonymous', v_anon, 'aal', v_aal, 'amr', v_amr)::text, true);
end $$;
create function test_helpers.house(p_n int, p_created_by uuid, p_status text default 'visible', p_reason text default null,
                                   p_season text default 'halloween', p_year int default 2026) returns uuid
language sql as $$
  insert into public.houses (region_id, season, year, address, normalized_address, lat, lng, coord_source, status,
                             hidden_reason, released_at, created_by)
  values (current_setting('t.r')::uuid, p_season::public.season_kind, p_year, p_n || ' Sub St, Subtown',
          p_n || ' sub st, subtown' || case when p_status = 'released' then '#released' else '' end,
          30.5, 30.5, 'admin', p_status::public.house_status, p_reason,
          case when p_status = 'released' then now() end, p_created_by)
  returning id
$$;
-- The expected provider key for a subscriber claimed by a run now:
-- digest:<public_id>:<last_sent_through>/<run window_to> (ISO UTC with microseconds).
create function test_helpers.digest_key(p_uid uuid, p_run uuid) returns text language sql as $$
  select 'digest:' || s.public_id::text || ':' || to_char(s.last_sent_through at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
         || '/' || to_char(r.window_to at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    from public.subscriptions s, private.digest_runs r where s.user_id = p_uid and r.run_id = p_run
$$;
grant execute on all functions in schema test_helpers to anon, authenticated, service_role;

select set_config('t.h1', test_helpers.house(1, 'f5000000-0000-4000-a000-00000000000a')::text, true);
select set_config('t.h2', test_helpers.house(2, 'f5000000-0000-4000-a000-00000000000a')::text, true);
select set_config('t.h3', test_helpers.house(3, 'f5000000-0000-4000-a000-00000000000a', 'released')::text, true);
select set_config('t.h4', test_helpers.house(4, 'f5000000-0000-4000-a000-000000000001')::text, true);
select set_config('t.h5', test_helpers.house(5, null)::text, true);
select set_config('t.h6', test_helpers.house(6, 'f5000000-0000-4000-a000-000000000001', 'hidden', 'spam')::text, true);
select set_config('t.h7', test_helpers.house(7, null, 'visible', null, 'christmas', 2024)::text, true);
select set_config('t.h8', test_helpers.house(8, 'f5000000-0000-4000-a000-00000000000b')::text, true);
-- An approved photo on h1 (owner hide must rotate it).
select set_config('t.p1', gen_random_uuid()::text, true);
insert into public.photos (id, house_id, upload_path, public_path, status, reserved_until, moderated_at)
values (current_setting('t.p1')::uuid, current_setting('t.h1')::uuid,
        current_setting('t.h1') || '/' || current_setting('t.p1') || '.jpg',
        current_setting('t.h1') || '/' || gen_random_uuid() || '.jpg', 'approved', now(), now());

-- ---------------------------------------------------------------- capability + column grants
select is((public.get_region_context('subtown') -> 'subscribe'), '{"open": false}'::jsonb, 'get_region_context: subscribe.open defaults to false');
select test_helpers.as_('admin1');
set local role authenticated;
select is(test_helpers.err($$select public.admin_set_subscribe_open('$$ || current_setting('t.r') || $$', true)$$), 'ok', 'admin aal2: admin_set_subscribe_open');
select is((public.get_region_context('subtown') -> 'subscribe' ->> 'open'), 'true', 'subscribe.open follows the switch');
reset role;
select test_helpers.as_('admin1_aal1');
set local role authenticated;
select is(test_helpers.err($$select public.admin_set_subscribe_open('$$ || current_setting('t.r') || $$', false)$$), 'forbidden', 'admin aal1: admin_set_subscribe_open -> forbidden');
select is(test_helpers.err($$select owner_id from public.houses limit 1$$), 'permission denied for table houses', 'owner_id is not readable (no column grant)');
select is(test_helpers.err($$select approved_at from public.events limit 1$$), 'permission denied for table events', 'events.approved_at is not readable');
reset role;
select test_helpers.as_('admin2');
set local role authenticated;
select is(test_helpers.err($$select public.admin_set_subscribe_open('$$ || current_setting('t.r') || $$', false)$$), 'forbidden', 'other-region admin: admin_set_subscribe_open -> forbidden');
reset role;

-- ---------------------------------------------------------------- set_subscription / stop / my_account
set local role anon;
select is(test_helpers.err($$select public.set_subscription('subtown', true, false, 'daily')$$), 'permission denied for function set_subscription', 'anon role: set_subscription -> no EXECUTE');
select is(test_helpers.err($$select public.my_account()$$), 'permission denied for function my_account', 'anon role: my_account -> no EXECUTE');
reset role;
select test_helpers.as_('anonA');
set local role authenticated;
select is(test_helpers.err($$select public.set_subscription('subtown', true, false, 'daily')$$), 'not_signed_in', 'anonymous user: set_subscription -> not_signed_in');
select is(test_helpers.err($$select public.my_account()$$), 'not_signed_in', 'anonymous user: my_account -> not_signed_in');
select is(test_helpers.err($$select public.stop_subscription()$$), 'not_signed_in', 'anonymous user: stop_subscription -> not_signed_in');
select is(test_helpers.err($$select public.claim_my_submissions()$$), 'not_signed_in', 'anonymous user: claim_my_submissions -> not_signed_in');
select is(test_helpers.err($$select public.complete_house_link()$$), 'not_signed_in', 'anonymous user: complete_house_link -> not_signed_in');
select is(test_helpers.err($$select public.request_house_claim('$$ || current_setting('t.h5') || $$', null)$$), 'not_signed_in', 'anonymous user: request_house_claim -> not_signed_in');
select is(test_helpers.err($$select public.owner_set_house_visibility('$$ || current_setting('t.h1') || $$', false)$$), 'not_signed_in', 'anonymous user: owner_set_house_visibility -> not_signed_in');
reset role;
select test_helpers.as_('carol');
set local role authenticated;
select is(test_helpers.err($$select public.set_subscription('subtown', true, false, 'daily')$$), 'forbidden/email', 'unconfirmed email: set_subscription -> forbidden');
reset role;
select test_helpers.as_('admin1_aal1');
set local role authenticated;
select is(test_helpers.err($$select public.set_subscription('subtown', true, false, 'daily')$$), 'forbidden', 'admin at aal1: set_subscription -> forbidden (B4)');
select is(test_helpers.err($$select public.my_account()$$), 'forbidden', 'admin at aal1: my_account -> forbidden (B4)');
reset role;
select test_helpers.as_('alice');
set local role authenticated;
select is(test_helpers.err($$select public.set_subscription('subtown', false, false, 'daily')$$), 'invalid_input/topics', 'no topic -> invalid_input/topics');
select is(test_helpers.err($$select public.set_subscription('subtown', true, false, 'hourly')$$), 'invalid_input/cadence', 'bad cadence -> invalid_input/cadence');
select is(test_helpers.err($$select public.set_subscription('nowhere', true, false, 'daily')$$), 'region_not_found', 'unknown region -> region_not_found');
select is(public.set_subscription('subtown', true, false, 'daily') - 'confirmed_at',
  jsonb_build_object('region_slug', 'subtown', 'houses', true, 'events', false, 'cadence', 'daily', 'status', 'active'),
  'set_subscription creates an active subscription and returns it');
select is(public.set_subscription('subtown', true, true, 'weekly') ->> 'cadence', 'weekly', 'set_subscription is an idempotent upsert (changes prefs)');
select is((public.my_account() -> 'subscription' ->> 'events'), 'true', 'my_account shows the subscription');
select is((public.my_account() ->> 'email'), 'alice@example.test', 'my_account returns the account''s own email');
reset role;
select is((select token_version from public.subscriptions where user_id = 'f5000000-0000-4000-a000-000000000001'), 1, 'token_version starts at 1');
select test_helpers.as_('alice');
set local role authenticated;
select is(test_helpers.err('select public.stop_subscription()'), 'ok', 'stop_subscription');
select is((public.my_account() -> 'subscription' ->> 'status'), 'stopped', 'status stopped');
reset role;
select is((select token_version from public.subscriptions where user_id = 'f5000000-0000-4000-a000-000000000001'), 1, 'stop does NOT bump token_version (a retried one-click stop stays recognisable)');
select test_helpers.as_('alice');
set local role authenticated;
select is(public.set_subscription('subtown', true, true, 'daily') ->> 'status', 'active', 'resubscribe reactivates');
reset role;
select is((select token_version from public.subscriptions where user_id = 'f5000000-0000-4000-a000-000000000001'), 2, 'resubscribe bumps token_version (B8): every older link dies');
-- quota: 10 per account per day (5 used above: 3 ok + topics/cadence failures roll back? no: they fail before take_quota)
select test_helpers.as_('alice');
set local role authenticated;
select is((select count(*)::int from generate_series(1, 7) g where test_helpers.err($$select public.set_subscription('subtown', true, true, 'daily')$$) = 'ok'),
  7, 'subscribe quota: calls 4-10 of the day succeed');
select is(test_helpers.err($$select public.set_subscription('subtown', true, true, 'daily')$$), 'rate_limited/uid_daily', 'subscribe quota: the 11th call -> rate_limited/uid_daily');
reset role;

-- ---------------------------------------------------------------- house links (B3/C5)
select test_helpers.as_('alice');
set local role authenticated;
select is(test_helpers.err($$select public.begin_house_link('alice@example.test')$$), 'forbidden', 'non-anonymous: begin_house_link -> forbidden (C5)');
reset role;
set local role anon;
select is(test_helpers.err($$select public.begin_house_link('alice@example.test')$$), 'permission denied for function begin_house_link', 'anon role: begin_house_link -> no EXECUTE');
reset role;
select test_helpers.as_('anonA');
set local role authenticated;
select is(test_helpers.err($$select public.begin_house_link('not-an-email')$$), 'invalid_input/email', 'begin_house_link: bad email -> invalid_input/email');
select is(test_helpers.err($$select public.begin_house_link('  Alice@Example.TEST ')$$), 'ok', 'anonymous: begin_house_link');
select is(test_helpers.err($$select public.begin_house_link('alice@example.test')$$), 'ok', 'same email again is accepted (no new row)');
reset role;
select is((select count(*)::int from private.house_links where anon_uid = 'f5000000-0000-4000-a000-00000000000a'), 1, 'one live link (normalized email, not duplicated)');
-- The link ages; repeating begin_house_link never extends it (the one-hour authorization cannot be refreshed forever).
update private.house_links set expires_at = now() + interval '10 minutes' where anon_uid = 'f5000000-0000-4000-a000-00000000000a';
select test_helpers.as_('anonA');
set local role authenticated;
select is(test_helpers.err($$select public.begin_house_link('alice@example.test')$$), 'ok', 'repeat begin_house_link on a live link');
reset role;
select is((select expires_at = now() + interval '10 minutes' from private.house_links where anon_uid = 'f5000000-0000-4000-a000-00000000000a'),
  true, 'a repeat does not extend the live link''s expiry');
select test_helpers.as_('anonA');
set local role authenticated;
select is(test_helpers.err($$select public.begin_house_link('x1@example.test')$$), 'ok', 'second live link');
select is(test_helpers.err($$select public.begin_house_link('x2@example.test')$$), 'ok', 'third live link');
select is(test_helpers.err($$select public.begin_house_link('x3@example.test')$$), 'rate_limited/uid_live', '4th live link per device -> rate_limited/uid_live');
reset role;
-- per-email daily limit: 5 links per email hash per day (from 5 devices)
insert into private.house_links (email_hash, anon_uid, expires_at)
  select private.email_hash('dave@example.test'), 'f5000000-0000-4000-a000-00000000000b', now() - interval '1 minute' from generate_series(1, 5);
select test_helpers.as_('anonB');
set local role authenticated;
select is(test_helpers.err($$select public.begin_house_link('dave@example.test')$$), 'rate_limited/email_daily', '6th link for one email in a day -> rate_limited/email_daily');
reset role;
-- an expired link for bob from device B never links
insert into private.house_links (email_hash, anon_uid, expires_at)
  values (private.email_hash('bob@example.test'), 'f5000000-0000-4000-a000-00000000000b', now() - interval '1 second');
select test_helpers.as_('bob');
set local role authenticated;
select is(public.complete_house_link(), 0, 'expired link -> nothing linked');
reset role;
select test_helpers.as_('carol');
set local role authenticated;
select is(public.complete_house_link(), 0, 'unconfirmed email -> nothing linked');
reset role;
select test_helpers.as_('alice');
set local role authenticated;
select is(public.complete_house_link(), 2, 'complete_house_link links the device''s unowned, non-released houses (h1, h2; not released h3)');
select is(public.complete_house_link(), 0, 'reuse: the link is used once');
reset role;
select is((select array_agg(address order by address) from public.houses where owner_id = 'f5000000-0000-4000-a000-000000000001'),
  array['1 Sub St, Subtown', '2 Sub St, Subtown'], 'alice owns h1 and h2');
select ok((select used_at is not null and used_by = 'f5000000-0000-4000-a000-000000000001' from private.house_links
            where anon_uid = 'f5000000-0000-4000-a000-00000000000a' and email_hash = private.email_hash('alice@example.test')),
  'the link row is marked used by alice');
select ok((select owner_id is null from public.houses where id = current_setting('t.h3')::uuid), 'released house h3 stays unowned');

-- ---------------------------------------------------------------- claim_my_submissions scope
select test_helpers.as_('alice');
set local role authenticated;
select is(public.claim_my_submissions(), 2, 'claim_my_submissions: alice''s own unowned non-released houses (h4, admin-hidden h6)');
select is(public.claim_my_submissions(), 0, 'claim_my_submissions is idempotent');
reset role;
select ok((select owner_id is null from public.houses where id = current_setting('t.h8')::uuid)
          and (select owner_id is null from public.houses where id = current_setting('t.h5')::uuid),
          'claim_my_submissions never touches other creators'' houses');

-- ---------------------------------------------------------------- submit_house ownership (signed-in adds are owned)
select test_helpers.as_('bob');
set local role authenticated;
select set_config('t.sh1', (select s.house_id::text from public.submit_house('subtown', 'ChIJsubowned000001', '41 Ownedfixture Rd, Subtown, CA', 30.5, 30.5) s), true);
reset role;
select is((select (owner_id = 'f5000000-0000-4000-a000-000000000002' and owner_since is not null and created_by = owner_id)::text
             from public.houses where id = current_setting('t.sh1')::uuid), 'true',
  'submit_house by a signed-in (non-anonymous) account: owner_id = auth.uid(), owner_since set');
select test_helpers.as_('anonB');
set local role authenticated;
select set_config('t.sh2', (select s.house_id::text from public.submit_house('subtown', 'ChIJsubowned000002', '42 Ownedfixture Rd, Subtown, CA', 30.5, 30.5) s), true);
reset role;
select is((select (owner_id is null and owner_since is null)::text from public.houses where id = current_setting('t.sh2')::uuid), 'true',
  'submit_house by an anonymous session: unowned (linked later by complete_house_link)');
select test_helpers.as_('bob');
set local role authenticated;
select is((select count(*)::int from jsonb_array_elements(public.my_account() -> 'houses') h where h ->> 'id' = current_setting('t.sh1')), 1,
  'the signed-in add shows on My account at once');
reset role;
-- owner_since follows owner_id (trigger): clearing the owner clears owner_since, so the FK's SET NULL can never violate it.
update public.houses set owner_id = null where id = current_setting('t.sh1')::uuid;
select is((select owner_since is null from public.houses where id = current_setting('t.sh1')::uuid), true, 'owner_id -> null clears owner_since');
delete from public.houses where id in (current_setting('t.sh1')::uuid, current_setting('t.sh2')::uuid);

-- ---------------------------------------------------------------- my_account houses
select test_helpers.as_('alice');
set local role authenticated;
select is((select jsonb_array_length(public.my_account() -> 'houses')), 4, 'my_account lists the 4 owned houses');
select is((select h ->> 'approved_photos' from jsonb_array_elements(public.my_account() -> 'houses') h where h ->> 'id' = current_setting('t.h1')),
  '1', 'my_account: approved photo count');
select is((select h ->> 'hidden_by_owner' from jsonb_array_elements(public.my_account() -> 'houses') h where h ->> 'id' = current_setting('t.h6')),
  'false', 'my_account: admin-hidden house is not hidden_by_owner');
reset role;

-- ---------------------------------------------------------------- owner visibility (C6) + shared hide routine
select test_helpers.as_('bob');
set local role authenticated;
select is(test_helpers.err($$select public.owner_set_house_visibility('$$ || current_setting('t.h1') || $$', false)$$), 'forbidden', 'other user: owner_set_house_visibility -> forbidden');
select is(test_helpers.err($$select public.owner_set_house_visibility('$$ || gen_random_uuid() || $$', false)$$), 'not_found', 'unknown house -> not_found');
reset role;
select test_helpers.as_('alice');
set local role authenticated;
select is(test_helpers.err($$select public.owner_set_house_visibility('$$ || current_setting('t.h1') || $$', null)$$), 'invalid_input/visible', 'null visible -> invalid_input');
select is(test_helpers.err($$select public.owner_set_house_visibility('$$ || current_setting('t.h1') || $$', false)$$), 'ok', 'owner hides a visible house');
reset role;
select is((select status::text || '|' || hidden_reason from public.houses where id = current_setting('t.h1')::uuid), 'hidden|owner', 'owner hide: hidden, hidden_reason owner');
select ok(exists (select 1 from private.storage_jobs where photo_id = current_setting('t.p1')::uuid and kind = 'rotate_public'),
  'owner hide rotates the approved photo through the shared hide routine (storage job in the same transaction)');
select test_helpers.as_('alice');
set local role authenticated;
select is(test_helpers.err($$select public.owner_set_house_visibility('$$ || current_setting('t.h1') || $$', false)$$), 'ok', 'hiding an owner-hidden house again is a no-op');
select is(test_helpers.err($$select public.owner_set_house_visibility('$$ || current_setting('t.h1') || $$', true)$$), 'ok', 'owner unhides an owner-hidden house');
select is(test_helpers.err($$select public.owner_set_house_visibility('$$ || current_setting('t.h6') || $$', true)$$), 'forbidden', 'owner cannot unhide an admin-hidden house');
select is(test_helpers.err($$select public.owner_set_house_visibility('$$ || current_setting('t.h6') || $$', false)$$), 'forbidden', 'owner cannot re-hide an admin-hidden house');
select is(test_helpers.err($$select public.owner_set_house_visibility('$$ || current_setting('t.h1') || $$', false)$$), 'ok', 'third change of the day');
select is(test_helpers.err($$select public.owner_set_house_visibility('$$ || current_setting('t.h1') || $$', true)$$), 'rate_limited/house_daily', '4th visibility change per house per day -> rate_limited/house_daily');
reset role;
select test_helpers.as_('admin1');
set local role authenticated;
select is(test_helpers.err($$select public.admin_set_house_status('$$ || current_setting('t.h2') || $$', 'hidden', 'owner')$$), 'invalid_input', 'admin cannot use the reserved reason ''owner''');
select is(test_helpers.err($$select public.admin_set_house_status('$$ || current_setting('t.h1') || $$', 'hidden', 'reported')$$), 'ok', 'admin hides an owner-hidden house with its own reason');
reset role;
select test_helpers.as_('alice');
set local role authenticated;
select is((select h ->> 'hidden_by_owner' from jsonb_array_elements(public.my_account() -> 'houses') h where h ->> 'id' = current_setting('t.h1')),
  'false', 'after the admin hide the owner can no longer unhide');
reset role;
select test_helpers.as_('admin1');
set local role authenticated;
select is(test_helpers.err($$select public.admin_set_house_status('$$ || current_setting('t.h1') || $$', 'visible', null)$$), 'ok', 'admin unhides');
reset role;

-- ---------------------------------------------------------------- claims (B5)
select test_helpers.as_('bob');
set local role authenticated;
select is(test_helpers.err($$select public.request_house_claim('$$ || current_setting('t.h7') || $$', null)$$), 'not_found', 'claim on a past-season house -> not_found');
select is(test_helpers.err($$select public.request_house_claim('$$ || current_setting('t.h6') || $$', null)$$), 'not_found', 'claim on a hidden house -> not_found');
select is(test_helpers.err($$select public.request_house_claim('$$ || current_setting('t.h5') || $$', 'has <b>')$$), 'invalid_input/note', 'note with <> -> invalid_input/note');
select is(test_helpers.err($$select public.request_house_claim('$$ || current_setting('t.h5') || $$', 'I live here')$$), 'ok', 'bob claims unowned h5');
select is(test_helpers.err($$select public.request_house_claim('$$ || current_setting('t.h2') || $$', null)$$), 'claim_pending', 'one pending claim per user -> claim_pending');
reset role;
select test_helpers.as_('alice');
set local role authenticated;
select is(test_helpers.err($$select public.request_house_claim('$$ || current_setting('t.h5') || $$', null)$$), 'claim_pending', 'one pending claim per house -> claim_pending');
select is(test_helpers.err($$select public.request_house_claim('$$ || current_setting('t.h1') || $$', null)$$), 'already_owned', 'claiming your own house -> already_owned');
select is(test_helpers.err($$select public.withdraw_house_claim((select gen_random_uuid()))$$), 'not_found', 'withdraw someone else''s / unknown claim -> not_found');
reset role;
select set_config('t.c1', (select id::text from public.house_claims where house_id = current_setting('t.h5')::uuid and status = 'pending'), true);
-- admin queue authz + masking
select test_helpers.as_('alice');
set local role authenticated;
select is(test_helpers.err($$select * from public.admin_claim_queue('$$ || current_setting('t.r') || $$', 'pending')$$), 'forbidden', 'non-admin: admin_claim_queue -> forbidden');
reset role;
select test_helpers.as_('admin1_aal1');
set local role authenticated;
select is(test_helpers.err($$select * from public.admin_claim_queue('$$ || current_setting('t.r') || $$', 'pending')$$), 'forbidden', 'admin aal1: admin_claim_queue -> forbidden');
reset role;
select test_helpers.as_('admin2');
set local role authenticated;
select is(test_helpers.err($$select * from public.admin_claim_queue('$$ || current_setting('t.r') || $$', 'pending')$$), 'forbidden', 'other-region admin: admin_claim_queue -> forbidden');
select is(test_helpers.err($$select public.admin_resolve_claim('$$ || current_setting('t.c1') || $$', true, null)$$), 'forbidden', 'other-region admin: admin_resolve_claim -> forbidden');
select is(test_helpers.err($$select public.admin_clear_owner('$$ || current_setting('t.h1') || $$')$$), 'forbidden', 'other-region admin: admin_clear_owner -> forbidden');
reset role;
select test_helpers.as_('admin1');
set local role authenticated;
select is(test_helpers.err($$select * from public.admin_claim_queue('$$ || current_setting('t.r') || $$', 'bogus')$$), 'invalid_input/status', 'admin_claim_queue: bad status -> invalid_input');
select is((select claimant_masked || '|' || coalesce(current_owner_masked, '-') || '|' || kind from public.admin_claim_queue(current_setting('t.r')::uuid, 'pending')),
  'b•••@example.test|-|claim', 'admin_claim_queue: masked claimant, no owner, kind claim');
select ok((select bool_and(position('bob@' in row_to_json(q)::text) = 0 and position('alice@' in row_to_json(q)::text) = 0)
             from public.admin_claim_queue(current_setting('t.r')::uuid, 'pending') q), 'admin_claim_queue output has no email address');
select is(test_helpers.err($$select public.admin_resolve_claim('$$ || gen_random_uuid() || $$', true, null)$$), 'not_found', 'global admin: unknown claim -> not_found');
select is(test_helpers.err($$select public.admin_resolve_claim('$$ || current_setting('t.c1') || $$', true, null)$$), 'ok', 'admin approves bob''s claim');
select is(test_helpers.err($$select public.admin_resolve_claim('$$ || current_setting('t.c1') || $$', false, null)$$), 'not_pending', 'resolving twice -> not_pending');
reset role;
select is((select owner_id::text from public.houses where id = current_setting('t.h5')::uuid), 'f5000000-0000-4000-a000-000000000002', 'approve sets owner_id to the claimant');
-- an owned house stays claimable; approval replaces the owner (alice claims bob's h5)
select test_helpers.as_('alice');
set local role authenticated;
select is(test_helpers.err($$select public.request_house_claim('$$ || current_setting('t.h5') || $$', 'mine really')$$), 'ok', 'an owned house stays claimable');
reset role;
select test_helpers.as_('bob');
set local role authenticated;
select is(test_helpers.err($$select public.request_house_removal('$$ || current_setting('t.h5') || $$', 'please remove')$$), 'ok', 'owner requests removal');
select is(test_helpers.err($$select public.request_house_removal('$$ || current_setting('t.h5') || $$', null)$$), 'claim_pending', 'one pending removal per house');
reset role;
select test_helpers.as_('alice');
set local role authenticated;
select is(test_helpers.err($$select public.request_house_removal('$$ || current_setting('t.h5') || $$', null)$$), 'forbidden', 'non-owner: request_house_removal -> forbidden');
reset role;
select test_helpers.as_('admin1');
set local role authenticated;
select is((select claimant_masked || '|' || current_owner_masked from public.admin_claim_queue(current_setting('t.r')::uuid, 'pending') where kind = 'claim'),
  'a•••@example.test|b•••@example.test', 'admin sees the current owner, masked');
select is(test_helpers.err($$select public.admin_resolve_claim((select id from public.admin_claim_queue('$$ || current_setting('t.r') || $$', 'pending') where kind = 'claim'), true, null)$$),
  'ok', 'approve replaces the owner');
reset role;
select is((select owner_id::text from public.houses where id = current_setting('t.h5')::uuid), 'f5000000-0000-4000-a000-000000000001', 'alice now owns h5');
select is((select status || '|' || reason from public.house_claims where house_id = current_setting('t.h5')::uuid and kind = 'removal'),
  'rejected|owner_changed', 'the old owner''s pending removal request is closed');
-- removal approval releases through release_house_core
select test_helpers.as_('alice');
set local role authenticated;
select is(test_helpers.err($$select public.request_house_removal('$$ || current_setting('t.h2') || $$', null)$$), 'ok', 'alice requests removal of h2');
select is(test_helpers.err($$select public.withdraw_house_claim((select (c ->> 'id')::uuid from jsonb_array_elements(public.my_account() -> 'claims') c))$$), 'ok', 'alice withdraws it');
select is(test_helpers.err($$select public.request_house_removal('$$ || current_setting('t.h2') || $$', null)$$), 'ok', 'third claim/removal of the day');
select is(test_helpers.err($$select public.withdraw_house_claim((select (c ->> 'id')::uuid from jsonb_array_elements(public.my_account() -> 'claims') c))$$), 'ok', 'withdrawn again');
select is(test_helpers.err($$select public.request_house_removal('$$ || current_setting('t.h2') || $$', null)$$), 'rate_limited/uid_daily', 'claims + removals share 3 per day');
reset role;
delete from private.quota_events where kind = 'claim';
select test_helpers.as_('alice');
set local role authenticated;
select is(test_helpers.err($$select public.request_house_removal('$$ || current_setting('t.h2') || $$', null)$$), 'ok', 'alice requests removal of h2 again');
reset role;
select test_helpers.as_('admin1');
set local role authenticated;
select is(test_helpers.err($$select public.admin_resolve_claim((select id from public.admin_claim_queue('$$ || current_setting('t.r') || $$', 'pending') where kind = 'removal'), true, 'ok')$$),
  'ok', 'admin approves the removal');
reset role;
select is((select status::text || '|' || coalesce(owner_id::text, '-') from public.houses where id = current_setting('t.h2')::uuid), 'released|-', 'removal approval releases the house and clears the owner');
-- admin_release_house refactor: still requires hidden; still releases
select test_helpers.as_('admin1');
set local role authenticated;
select is(test_helpers.err($$select public.admin_release_house('$$ || current_setting('t.h4') || $$')$$), 'must_be_hidden', 'admin_release_house still requires a hidden house');
select is(test_helpers.err($$select public.admin_release_house('$$ || current_setting('t.h6') || $$')$$), 'ok', 'admin_release_house releases a hidden house');
reset role;
select is((select status::text || '|' || coalesce(owner_id::text, '-') || '|' || (place_id is null)::text from public.houses where id = current_setting('t.h6')::uuid),
  'released|-|true', 'released through release_house_core: owner cleared, place_id nulled');
-- admin_clear_owner
select test_helpers.as_('admin1');
set local role authenticated;
select is(test_helpers.err($$select public.admin_clear_owner('$$ || current_setting('t.h4') || $$')$$), 'ok', 'admin_clear_owner');
reset role;
select ok((select owner_id is null and owner_since is null from public.houses where id = current_setting('t.h4')::uuid), 'owner cleared; the house stays');
select is((select status::text from public.houses where id = current_setting('t.h4')::uuid), 'visible', 'the listing is unchanged');

-- ---------------------------------------------------------------- admin counts + digest banner
select test_helpers.as_('admin1');
set local role authenticated;
select is((select row(active, stopped, daily, weekly, houses, events)::text from public.admin_subscriber_counts(current_setting('t.r')::uuid)),
  '(1,0,1,0,1,1)', 'admin_subscriber_counts');
select is((select row(sent, failed, cap, cap_hit)::text from public.admin_digest_today()), '(0,0,500,f)', 'admin_digest_today before any run (digest emails vs digest_daily_cap, default 500)');
reset role;
select test_helpers.as_('admin2');
set local role authenticated;
select is(test_helpers.err($$select * from public.admin_subscriber_counts('$$ || current_setting('t.r') || $$')$$), 'forbidden', 'other-region admin: admin_subscriber_counts -> forbidden');
select is(test_helpers.err($$select * from public.admin_digest_today()$$), 'ok', 'any aal2 admin can read admin_digest_today');
reset role;
select test_helpers.as_('alice');
set local role authenticated;
select is(test_helpers.err($$select * from public.admin_digest_today()$$), 'forbidden', 'non-admin: admin_digest_today -> forbidden');
reset role;
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'admin\_%' and exists (select 1 from unnest(p.proargnames) a where a ilike '%email%' and a not like '%masked%')),
  0, 'no admin RPC has an email output column (only *_masked)');

-- ---------------------------------------------------------------- events.approved_at (B6)
select set_config('t.e1', gen_random_uuid()::text, true);
insert into public.events (id, region_id, season, year, title, description, address, lat, lng, starts_at, status, source)
values (current_setting('t.e1')::uuid, current_setting('t.r')::uuid, 'halloween', 2026, 'Fake Lantern Walk', 'A made-up test event here.',
        'Fixture Plaza, Subtown', 30.5, 30.5, now() + interval '2 days', 'pending', 'community');
select ok((select approved_at is null from public.events where id = current_setting('t.e1')::uuid), 'pending event: approved_at null');
update public.events set status = 'approved' where id = current_setting('t.e1')::uuid;
select ok((select approved_at is not null from public.events where id = current_setting('t.e1')::uuid), 'approval sets approved_at');
select set_config('t.e1at', (select approved_at::text from public.events where id = current_setting('t.e1')::uuid), true);
update public.events set status = 'hidden' where id = current_setting('t.e1')::uuid;
update public.events set status = 'approved' where id = current_setting('t.e1')::uuid;
select is((select approved_at::text from public.events where id = current_setting('t.e1')::uuid), current_setting('t.e1at'), 're-approval keeps the first approved_at');

-- ---------------------------------------------------------------- svc_* (C2, C8, B8, C4)
select test_helpers.as_('alice');
set local role authenticated;
select is(test_helpers.err($$select public.svc_digest_start('daily', null)$$), 'permission denied for function svc_digest_start', 'authenticated: svc_digest_start -> no EXECUTE');
select is(test_helpers.err($$select public.svc_delete_account('f5000000-0000-4000-a000-000000000001')$$), 'permission denied for function svc_delete_account', 'authenticated: svc_delete_account -> no EXECUTE');
reset role;
-- Make content: alice (daily, houses+events, region subtown) last saw everything up to 1 h ago; one new house + one new event.
update public.subscriptions set last_sent_through = now() - interval '1 hour', created_at = now() - interval '2 hours';
update public.houses set created_at = now() - interval '2 hours' where region_id = current_setting('t.r')::uuid;
update public.houses set created_at = now() - interval '5 minutes' where id = current_setting('t.h8')::uuid;
update public.events set approved_at = now() - interval '5 minutes' where id = current_setting('t.e1')::uuid;
insert into public.house_vote_totals (house_id, region_id, votes) values (current_setting('t.h8')::uuid, current_setting('t.r')::uuid, 3);
-- Amendment 3: private.town_from_address (pure; no geocoding)
select is(private.town_from_address('123 Main St, Truckee, CA 96161'), 'Truckee', 'town: the component after the street');
select is(private.town_from_address('Downtown Park, 10046 Church St, Truckee, CA 96161'), 'Truckee', 'town: a venue first, then the street, then the town');
select is(private.town_from_address('Fixture Plaza, Subtown'), 'Subtown', 'town: no numbered street -> the component after the first');
select is(private.town_from_address('27 Lantern Ridge Ln, O''Brien Flats, CA'), 'O''Brien Flats', 'town: letters, spaces and apostrophes');
select ok(private.town_from_address('123 Main St') is null, 'town: "123 Main St" (no town) -> null');
select ok(private.town_from_address('123 Main St, CA 96161') is null, 'town: a state + zip component -> null');
select ok(private.town_from_address('123 Main St, CA') is null and private.town_from_address('123 Main St, USA') is null, 'town: a bare state code or country -> null');
select ok(private.town_from_address('1 A St, <b>x</b>') is null and private.town_from_address('1 A St, T0wn') is null
          and private.town_from_address('1 A St, ' || repeat('a', 41)) is null and private.town_from_address('1 A St, X') is null
          and private.town_from_address(null) is null and private.town_from_address('') is null, 'town: junk, digits, >40 or 1 char, null, empty -> null');
-- bob: weekly, nothing new for him on the daily run
insert into public.subscriptions (user_id, region_id, houses, events, cadence)
values ('f5000000-0000-4000-a000-000000000002', current_setting('t.r')::uuid, true, false, 'weekly');
set local role service_role;
select set_config('t.run', public.svc_digest_start('daily', '2026-10-20')::text, true);
select is(public.svc_digest_start('daily', '2026-10-20')::text, current_setting('t.run'), 'svc_digest_start: a rerun of the same day returns the same run');
select is(test_helpers.err($$select public.svc_digest_start('hourly', null)$$), 'invalid_input/kind', 'svc_digest_start: bad kind');
-- window_to is the run's start; move it forward so the 5-minute-old items are inside the window (the run started "now").
reset role;
update private.digest_runs set window_to = now() where run_id = current_setting('t.run')::uuid;
select set_config('t.key1', test_helpers.digest_key('f5000000-0000-4000-a000-000000000001', current_setting('t.run')::uuid), true);
set local role service_role;
select set_config('t.b', (select coalesce(json_agg(b), '[]'::json)::text from public.svc_digest_batch(current_setting('t.run')::uuid, 100) b), true);
reset role;
select is((select string_agg((e ->> 'email') || '|' || (e ->> 'house_total') || '|' || (e ->> 'event_total') || '|' || (e -> 'houses' -> 0 ->> 'address')
                             || '|' || (e -> 'events' -> 0 ->> 'title'), ',') from json_array_elements(current_setting('t.b')::json) e),
  'alice@example.test|1|1|8 Sub St, Subtown|Fake Lantern Walk', 'svc_digest_batch: only daily subscribers with something new');
select is(current_setting('t.b')::json -> 0 ->> 'idempotency_key', current_setting('t.key1'),
  'C8: the key is per content window: digest:<public_id>:<last_sent_through ISO>/<window_to ISO>');
select ok((current_setting('t.b')::json -> 0 ->> 'payload') is null, 'a new claim carries no stored payload (render fresh)');
select is((select (e ->> 'season') || '|' || (e ->> 'season_year') || '|' || (e ->> 'season_opener') from json_array_elements(current_setting('t.b')::json) e),
  'halloween|2026|true', 'Amendment 3: the batch returns the claimed season; never sent before -> season_opener');
select is((select (e -> 'houses' -> 0 ->> 'town') || '|' || (e -> 'houses' -> 0 ->> 'votes') from json_array_elements(current_setting('t.b')::json) e),
  'Subtown|3', 'Amendment 3: each house carries town and votes (house_vote_totals)');
select is((select (e -> 'events' -> 0 ->> 'town') || '|' || (e -> 'events' -> 0 ->> 'far') from json_array_elements(current_setting('t.b')::json) e),
  'Subtown|false', 'Amendment 3: each event carries town and far (inside the local box -> false)');
select is((select season::text || '|' || season_year from private.digest_sends where run_id = current_setting('t.run')::uuid),
  'halloween|2026', 'Amendment 3: the season is fixed on the digest_sends row at claim time');
select ok((select last_digest_season is null and last_digest_year is null from public.subscriptions where user_id = 'f5000000-0000-4000-a000-000000000001'),
  'claiming does not touch last_digest_*');
select is(current_setting('t.b')::json -> 0 ->> 'run_id', current_setting('t.run'), 'the row belongs to this run');
select is((select d.idempotency_key || '|' || (d.window_from = s.last_sent_through)::text from private.digest_sends d
             join public.subscriptions s on s.user_id = d.user_id where d.run_id = current_setting('t.run')::uuid),
  current_setting('t.key1') || '|true', 'the key and the window start are stored on the digest_sends row');
set local role service_role;
select is((select count(*)::int from public.svc_digest_batch(current_setting('t.run')::uuid, 100)), 0, 'an in-flight (sending) row is not handed out twice');
select is(public.svc_digest_mark(current_setting('t.run')::uuid, 'f5000000-0000-4000-a000-000000000001', true, null), true, 'svc_digest_mark ok');
select is(public.svc_digest_mark(current_setting('t.run')::uuid, 'f5000000-0000-4000-a000-000000000001', true, null), false, 'a repeated mark is a no-op');
reset role;
select ok((select last_sent_through = (select window_to from private.digest_runs where run_id = current_setting('t.run')::uuid)
             from public.subscriptions where user_id = 'f5000000-0000-4000-a000-000000000001'), 'sent advances last_sent_through to the run window');
select is((select last_digest_season::text || '|' || last_digest_year from public.subscriptions where user_id = 'f5000000-0000-4000-a000-000000000001'),
  'halloween|2026', 'Amendment 3: sent advances last_digest_season/year to the row''s season');
select matches(test_helpers.err($$update public.subscriptions set last_digest_year = null where user_id = 'f5000000-0000-4000-a000-000000000001'$$),
  '^new row for relation "subscriptions" violates check constraint "subscriptions_last_digest_pair"', 'last_digest_season/year: both or neither');
select matches(test_helpers.err($$update private.digest_sends set season_year = null where run_id = '$$ || current_setting('t.run') || $$'$$),
  '^new row for relation "digest_sends" violates check constraint "digest_sends_season_pair"', 'digest_sends season/season_year: both or neither');
update private.digest_sends set updated_at = now() - interval '1 hour';
set local role service_role;
select is((select count(*)::int from public.svc_digest_batch(current_setting('t.run')::uuid, 100)), 0, 'rerun after sent: nothing is sent again');
select is((select row(sent, failed, cap_hit)::text from public.svc_digest_finish(current_setting('t.run')::uuid)), '(1,0,f)', 'svc_digest_finish counts');
reset role;
-- failure keeps the window; the cap stops the batch.
update public.subscriptions set last_sent_through = now() - interval '1 hour' where user_id = 'f5000000-0000-4000-a000-000000000001';
update public.app_settings set digest_daily_cap = 1;
set local role service_role;
select set_config('t.run2', public.svc_digest_start('daily', '2026-10-21')::text, true);
select is((select count(*)::int from public.svc_digest_batch(current_setting('t.run2')::uuid, 100)), 0, 'daily cap reached (1 sent today) -> nothing handed out');
reset role;
select ok((select cap_hit from private.digest_runs where run_id = current_setting('t.run2')::uuid), 'cap hit is recorded on the run');
update public.app_settings set digest_daily_cap = 500;
update private.digest_runs set window_to = now() where run_id = current_setting('t.run2')::uuid;
select set_config('t.key2', test_helpers.digest_key('f5000000-0000-4000-a000-000000000001', current_setting('t.run2')::uuid), true);
-- Amendment 3: move the event outside the local box (still inside the admin box) and drop h8's vote counter.
update public.events set lat = 31.1 where id = current_setting('t.e1')::uuid;
delete from public.house_vote_totals where house_id = current_setting('t.h8')::uuid;
set local role service_role;
select set_config('t.b2', (select coalesce(json_agg(b), '[]'::json)::text from public.svc_digest_batch(current_setting('t.run2')::uuid, 100) b), true);
reset role;
select is((select string_agg(e ->> 'idempotency_key', ',') from json_array_elements(current_setting('t.b2')::json) e), current_setting('t.key2'),
  'below the cap again -> handed out with the window key');
select is((select (e ->> 'season_opener') || '|' || (e -> 'events' -> 0 ->> 'far') || '|' || (e -> 'houses' -> 0 ->> 'votes')
             from json_array_elements(current_setting('t.b2')::json) e),
  'false|true|0', 'Amendment 3: same season as the last sent -> not an opener; outside the local box -> far; no vote row -> 0 votes');
set local role service_role;
select is(public.svc_digest_mark(current_setting('t.run2')::uuid, 'f5000000-0000-4000-a000-000000000001', false, 'Provider said: <bad>'), true, 'svc_digest_mark failure');
reset role;
select is((select status || '|' || error_code from private.digest_sends where run_id = current_setting('t.run2')::uuid), 'failed|error', 'failed row keeps only a sanitized code');
select ok((select last_sent_through < now() - interval '30 minutes' from public.subscriptions where user_id = 'f5000000-0000-4000-a000-000000000001'), 'failure does not advance last_sent_through');
-- Amendment 3: pretend alice's last sent digest was an older season, so a failure must leave that alone.
update public.subscriptions set last_digest_season = 'christmas', last_digest_year = 2025 where user_id = 'f5000000-0000-4000-a000-000000000001';
set local role service_role;
select is((select count(*)::int from public.svc_digest_batch(current_setting('t.run2')::uuid, 100)), 0, 'a failed row is retried on the next run, not this one');
reset role;
select test_helpers.as_('admin1');
set local role authenticated;
select is((select row(sent, failed, cap_hit)::text from public.admin_digest_today()), '(1,1,t)', 'admin_digest_today reflects the day');
reset role;
-- C8: the failed person is handed out again by the NEXT run with a NEW key (a definite refusal is never reused).
set local role service_role;
select set_config('t.run3', public.svc_digest_start('daily', '2026-10-22')::text, true);
reset role;
update private.digest_runs set window_to = now() + interval '1 second' where run_id = current_setting('t.run3')::uuid;
select set_config('t.key3', test_helpers.digest_key('f5000000-0000-4000-a000-000000000001', current_setting('t.run3')::uuid), true);
set local role service_role;
select is((select string_agg(run_id::text || '|' || idempotency_key, ',') from public.svc_digest_batch(current_setting('t.run3')::uuid, 100)),
  current_setting('t.run3') || '|' || current_setting('t.key3'), 'C8: the next run retries a failed send under a new key (its window end)');
select isnt(current_setting('t.key3'), current_setting('t.key2'), 'the failed row''s key is not reused');
-- The rendered email is stored once, before the provider call.
select is(public.svc_digest_store_payload(current_setting('t.run3')::uuid, 'f5000000-0000-4000-a000-000000000001',
  'Subj', '<p>A+B</p>', 'A+B', 'TL <d@example.test>', 'alice@example.test', '{"List-Unsubscribe": "<x>"}'), 'stored', 'svc_digest_store_payload stores the payload');
select is(public.svc_digest_store_payload(current_setting('t.run3')::uuid, 'f5000000-0000-4000-a000-000000000001',
  'Subj', '<p>A+B</p>', 'A+B', 'TL <d@example.test>', 'alice@example.test', '{"List-Unsubscribe": "<x>"}'), 'same', 'the same payload again is a no-op');
select is(test_helpers.err($$select public.svc_digest_store_payload('$$ || current_setting('t.run3') || $$', 'f5000000-0000-4000-a000-000000000001',
  'Subj', '<p>A only</p>', 'A only', 'TL <d@example.test>', 'alice@example.test', '{"List-Unsubscribe": "<x>"}')$$), 'payload_conflict',
  'a DIFFERENT second payload is refused');
select is(test_helpers.err($$select public.svc_digest_store_payload('$$ || current_setting('t.run2') || $$', 'f5000000-0000-4000-a000-000000000001',
  's', 'h', 't', 'f', 'alice@example.test', null)$$), 'not_found', 'store_payload only touches a sending row');
reset role;
select is((select payload ->> 'html' from private.digest_sends where run_id = current_setting('t.run3')::uuid), '<p>A+B</p>', 'the first payload is kept');
select test_helpers.as_('alice');
set local role authenticated;
select is(test_helpers.err($$select public.svc_digest_store_payload(null, null, 's', 'h', 't', 'f', 'x', null)$$),
  'permission denied for function svc_digest_store_payload', 'authenticated: svc_digest_store_payload -> no EXECUTE');
reset role;
-- A crash between the provider call and the mark: the row stays `sending`. Under 5 idle minutes it is in flight ...
update private.digest_sends set updated_at = now() - interval '4 minutes' where run_id = current_setting('t.run3')::uuid;
set local role service_role;
select is((select count(*)::int from public.svc_digest_batch(current_setting('t.run3')::uuid, 100)), 0, 'an unresolved send idle < 5 min is in flight: not handed out');
reset role;
-- ... after 5 minutes the next cron tick resumes it with the same key.
update private.digest_sends set updated_at = now() - interval '6 minutes' where run_id = current_setting('t.run3')::uuid;
-- State changes between the accepted send and the resume: alice drops events and her link version moves (as the
-- owner role: service_role has no table grants, it reaches subscriptions only through the svc_* routines).
update public.subscriptions set events = false, token_version = token_version + 1 where user_id = 'f5000000-0000-4000-a000-000000000001';
set local role service_role;
select set_config('t.b3', (select coalesce(json_agg(b), '[]'::json)::text from public.svc_digest_batch(current_setting('t.run3')::uuid, 100) b), true);
reset role;
select is((select string_agg(e ->> 'idempotency_key', ',') from json_array_elements(current_setting('t.b3')::json) e), current_setting('t.key3'),
  'C8: a stale sending row (crash between send and mark) is resumed with the same idempotency key');
select is((current_setting('t.b3')::json -> 0 -> 'payload')::jsonb,
  jsonb_build_object('from', 'TL <d@example.test>', 'to', 'alice@example.test', 'subject', 'Subj', 'html', '<p>A+B</p>', 'text', 'A+B',
                     'headers', jsonb_build_object('List-Unsubscribe', '<x>')),
  'C8: ... WITH its stored payload, unchanged although the content changed (sent verbatim, never re-rendered)');
select is((select attempts from private.digest_sends where run_id = current_setting('t.run3')::uuid), 2, 'C8: the retry is counted in attempts');
-- Never resolved that evening: the NEXT DAY's run resumes the old row (its run, key and window), it never mints a new key.
-- The cap is full (and this stuck row is part of what fills it): a resume needs no room, it was charged when claimed.
update private.digest_sends set updated_at = now() - interval '6 minutes' where run_id = current_setting('t.run3')::uuid;
update public.app_settings set digest_daily_cap = 1;
set local role service_role;
select set_config('t.run4', public.svc_digest_start('daily', '2026-10-23')::text, true);
reset role;
update private.digest_runs set window_to = now() + interval '1 minute' where run_id = current_setting('t.run4')::uuid;
-- Amendment 3: the admin switches the region to Christmas before the resume; the row keeps its claimed season.
update public.site_settings set active_season = 'christmas' where region_id = current_setting('t.r')::uuid;
set local role service_role;
select set_config('t.b4', (select coalesce(json_agg(b), '[]'::json)::text from public.svc_digest_batch(current_setting('t.run4')::uuid, 100) b), true);
reset role;
select is((select string_agg((e ->> 'run_id') || '|' || (e ->> 'idempotency_key') || '|' || ((e ->> 'window_to')::timestamptz = now() + interval '1 second')::text
                             || '|' || (e -> 'payload' ->> 'html'), ',')
             from json_array_elements(current_setting('t.b4')::json) e),
  current_setting('t.run3') || '|' || current_setting('t.key3') || '|true|<p>A+B</p>',
  'C8: a later run resumes the unresolved row with ITS run id, key, window and payload, even with the cap full');
select ok(not (select cap_hit from private.digest_runs where run_id = current_setting('t.run4')::uuid), 'a resume alone does not hit the cap');
select is((select (e ->> 'season') || '|' || (e ->> 'season_year') || '|' || (e ->> 'season_opener') from json_array_elements(current_setting('t.b4')::json) e),
  'halloween|2026|true', 'Amendment 3: a resumed row keeps its claimed season after a season switch (opener vs the older last season)');
update public.site_settings set active_season = 'halloween' where region_id = current_setting('t.r')::uuid;
update public.app_settings set digest_daily_cap = 500;
select is((select count(*)::int from private.digest_sends where run_id = current_setting('t.run4')::uuid), 0, 'no new row (no new key) while a send is unresolved');
set local role service_role;
select is(public.svc_digest_mark(current_setting('t.run3')::uuid, 'f5000000-0000-4000-a000-000000000001', true, null), true, 'the resumed row is marked sent on its own run');
reset role;
select ok((select last_sent_through = now() + interval '1 second' from public.subscriptions where user_id = 'f5000000-0000-4000-a000-000000000001'), 'last_sent_through advances to the resumed row''s window');
select ok((select payload is null from private.digest_sends where run_id = current_setting('t.run3')::uuid), 'the stored payload is cleared once the row is sent');
select is((select last_digest_season::text || '|' || last_digest_year from public.subscriptions where user_id = 'f5000000-0000-4000-a000-000000000001'),
  'halloween|2026', 'Amendment 3: the resumed row''s claimed season is what last_digest_* advances to');
update public.subscriptions set events = true where user_id = 'f5000000-0000-4000-a000-000000000001';
-- A fresh unresolved send blocks any new key; a stale one whose window no longer has content is closed (no_content).
update public.subscriptions set last_sent_through = now() - interval '1 hour' where user_id = 'f5000000-0000-4000-a000-000000000001';
set local role service_role;
select set_config('t.run5', public.svc_digest_start('daily', '2026-10-24')::text, true);
select set_config('t.run6', public.svc_digest_start('daily', '2026-10-25')::text, true);
reset role;
update private.digest_runs set window_to = now() where run_id in (current_setting('t.run5')::uuid, current_setting('t.run6')::uuid);
set local role service_role;
select is((select count(*)::int from public.svc_digest_batch(current_setting('t.run5')::uuid, 100)), 1, 'run 5 claims alice');
select is((select count(*)::int from public.svc_digest_batch(current_setting('t.run6')::uuid, 100)), 0, 'run 6: alice has a fresh unresolved send -> nothing new for her');
reset role;
update private.digest_sends set updated_at = now() - interval '6 minutes' where run_id = current_setting('t.run5')::uuid;
update public.subscriptions set last_sent_through = now() where user_id = 'f5000000-0000-4000-a000-000000000001';
set local role service_role;
select is((select count(*)::int from public.svc_digest_batch(current_setting('t.run6')::uuid, 100)), 0, 'a stale send with no content left is not sent ...');
reset role;
select is((select status || '|' || error_code from private.digest_sends where run_id = current_setting('t.run5')::uuid), 'failed|no_content', '... it is closed as failed/no_content');
-- Retention sweep: a `sending` row's payload is never cleared; one idle 2 days is closed failed/abandoned first.
insert into private.digest_sends (run_id, user_id, status, idempotency_key, window_from, window_to, payload, updated_at) values
  (current_setting('t.run5')::uuid, 'f5000000-0000-4000-a000-000000000002', 'sending',
   'digest:' || gen_random_uuid() || ':2026-10-01T00:00:00.000000Z/2026-10-02T00:00:00.000000Z',
   now() - interval '5 days', now() - interval '4 days', '{"html": "A"}', now() - interval '1 day 23 hours'),
  (current_setting('t.run6')::uuid, 'f5000000-0000-4000-a000-000000000002', 'sending',
   'digest:' || gen_random_uuid() || ':2026-10-02T00:00:00.000000Z/2026-10-03T00:00:00.000000Z',
   now() - interval '3 days', now() - interval '2 days', '{"html": "B"}', now() - interval '1 day');
update private.digest_sends set payload = '{"html": "leftover"}', updated_at = now() - interval '3 days'
 where run_id = current_setting('t.run5')::uuid and user_id = 'f5000000-0000-4000-a000-000000000001';
select set_config('t.failed5', (select failed::text from private.digest_runs where run_id = current_setting('t.run5')::uuid), true);
select set_config('t.sw', private.sweep_subscribe()::text, true);
select is((select status || '|' || (payload is not null) from private.digest_sends
            where run_id = current_setting('t.run5')::uuid and user_id = 'f5000000-0000-4000-a000-000000000002'), 'sending|true',
  'sweep: a sending row idle just under 2 days keeps its status and payload');
select is((select status || '|' || (payload is not null) from private.digest_sends
            where run_id = current_setting('t.run6')::uuid and user_id = 'f5000000-0000-4000-a000-000000000002'), 'sending|true',
  'sweep: a recent sending row keeps its payload');
update private.digest_sends set updated_at = now() - interval '3 days'
 where run_id = current_setting('t.run5')::uuid and user_id = 'f5000000-0000-4000-a000-000000000002';
select set_config('t.sw', private.sweep_subscribe()::text, true);
select is((select status || '|' || error_code from private.digest_sends
            where run_id = current_setting('t.run5')::uuid and user_id = 'f5000000-0000-4000-a000-000000000002'), 'failed|abandoned',
  'sweep: a sending row idle past 2 days is first closed failed/abandoned');
select ok((select payload is null from private.digest_sends
            where run_id = current_setting('t.run5')::uuid and user_id = 'f5000000-0000-4000-a000-000000000002'),
  'sweep: ... and only then is its payload cleared');
select ok((select payload is not null and status = 'sending' from private.digest_sends
            where run_id = current_setting('t.run6')::uuid and user_id = 'f5000000-0000-4000-a000-000000000002'),
  'sweep: the still-recent sending row keeps its payload');
select ok((select payload is null from private.digest_sends
            where run_id = current_setting('t.run5')::uuid and user_id = 'f5000000-0000-4000-a000-000000000001'),
  'sweep: a settled (failed) row idle 2 days has a leftover payload cleared');
select is((select count(*)::int from private.digest_sends where status = 'sending' and payload is null
            and run_id in (current_setting('t.run5')::uuid, current_setting('t.run6')::uuid)), 0,
  'sweep: never leaves a sending row with its payload nulled');
select is((select failed - current_setting('t.failed5')::int from private.digest_runs where run_id = current_setting('t.run5')::uuid), 1,
  'sweep: the run''s failed counter counts the abandoned row');
delete from private.digest_sends where user_id = 'f5000000-0000-4000-a000-000000000002' and run_id in (current_setting('t.run5')::uuid, current_setting('t.run6')::uuid);
-- The daily cap is one budget across run kinds: today's daily rows count against the weekly run.
update public.subscriptions set last_sent_through = now() - interval '1 hour' where user_id = 'f5000000-0000-4000-a000-000000000002';
select set_config('t.used', (select count(*)::text from private.digest_sends d
                               where d.status in ('sent', 'sending')
                                 and d.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'), true);
update public.app_settings set digest_daily_cap = current_setting('t.used')::smallint;
set local role service_role;
select set_config('t.run7', public.svc_digest_start('weekly', '2026-10-22')::text, true);
reset role;
update private.digest_runs set window_to = now() where run_id = current_setting('t.run7')::uuid;
set local role service_role;
select is((select count(*)::int from public.svc_digest_batch(current_setting('t.run7')::uuid, 100)), 0, 'weekly run: the daily sends already used the shared cap');
reset role;
update public.app_settings set digest_daily_cap = current_setting('t.used')::smallint + 1;
-- Amendment 3: bob's last sent digest is a NEWER season than this row's (halloween 2026).
update public.subscriptions set last_digest_season = 'christmas', last_digest_year = 2026 where user_id = 'f5000000-0000-4000-a000-000000000002';
set local role service_role;
select set_config('t.b7', (select coalesce(json_agg(b), '[]'::json)::text from public.svc_digest_batch(current_setting('t.run7')::uuid, 100) b), true);
reset role;
select is((select string_agg(e ->> 'user_id', ',') from json_array_elements(current_setting('t.b7')::json) e), 'f5000000-0000-4000-a000-000000000002',
  'weekly run: one more unit of cap -> bob (weekly) is handed out');
select is((select (e ->> 'season') || '|' || (e ->> 'season_opener') from json_array_elements(current_setting('t.b7')::json) e), 'halloween|true',
  'Amendment 3: a different last season -> season_opener');
set local role service_role;
select is(public.svc_digest_mark(current_setting('t.run7')::uuid, 'f5000000-0000-4000-a000-000000000002', true, null), true, 'bob''s weekly row is sent');
reset role;
select is((select last_digest_season::text || '|' || last_digest_year from public.subscriptions where user_id = 'f5000000-0000-4000-a000-000000000002'),
  'christmas|2026', 'Amendment 3: last_digest_* never moves backwards to an older season');
update public.app_settings set digest_daily_cap = 500;
-- unsubscribe
select set_config('t.pub', (select public_id::text from public.subscriptions where user_id = 'f5000000-0000-4000-a000-000000000001'), true);
select set_config('t.ver', (select token_version::text from public.subscriptions where user_id = 'f5000000-0000-4000-a000-000000000001'), true);
set local role service_role;
select is((select status || '|' || cadence || '|' || region_name from public.svc_unsubscribe_lookup(current_setting('t.pub')::uuid, current_setting('t.ver')::int)),
  'active|daily|Subtown', 'svc_unsubscribe_lookup with the current version');
select is((select count(*)::int from public.svc_unsubscribe_lookup(current_setting('t.pub')::uuid, current_setting('t.ver')::int - 1)), 0, 'old version -> nothing');
select is(public.svc_unsubscribe_set_prefs(current_setting('t.pub')::uuid, current_setting('t.ver')::int, false, true, 'weekly'), 'updated', 'svc_unsubscribe_set_prefs');
select is(test_helpers.err($$select public.svc_unsubscribe_set_prefs('$$ || current_setting('t.pub') || $$', 1, false, false, 'weekly')$$), 'invalid_input/topics', 'set_prefs validates topics');
select is(public.svc_unsubscribe_stop(current_setting('t.pub')::uuid, current_setting('t.ver')::int), 'stopped', 'svc_unsubscribe_stop');
select is(public.svc_unsubscribe_stop(current_setting('t.pub')::uuid, current_setting('t.ver')::int), 'already_stopped', 'the same token again (provider retry) -> already_stopped');
select is(public.svc_unsubscribe_stop(current_setting('t.pub')::uuid, current_setting('t.ver')::int - 1), 'invalid', 'an older version -> invalid');
select is((select status from public.svc_unsubscribe_lookup(current_setting('t.pub')::uuid, current_setting('t.ver')::int)), 'stopped', 'the link still reads the stopped subscription');
select is(public.svc_unsubscribe_set_prefs(current_setting('t.pub')::uuid, current_setting('t.ver')::int, true, true, 'daily'), 'invalid', 'prefs cannot change a stopped subscription');
reset role;
select is((select token_version::text from public.subscriptions where user_id = 'f5000000-0000-4000-a000-000000000001'), current_setting('t.ver'), 'stopping did not bump token_version');
-- delete account: check (admins refused, nothing changes) -> Auth delete (FKs) -> idempotent cleanup
insert into private.house_links (email_hash, anon_uid, expires_at, used_at, used_by)
  values (private.email_hash('x9@example.test'), 'f5000000-0000-4000-a000-00000000000b', now(), now(), 'f5000000-0000-4000-a000-000000000001');
set local role service_role;
select is(public.svc_delete_account_check('f5000000-0000-4000-a000-0000000000d1'), 'forbidden', 'svc_delete_account_check refuses admins');
select is(public.svc_delete_account_check('f5000000-0000-4000-a000-000000000001'), 'ok', 'svc_delete_account_check: a normal account -> ok');
select is(test_helpers.err($$select public.svc_delete_account('f5000000-0000-4000-a000-000000000001')$$), 'invalid_input/user_exists',
  'svc_delete_account never runs while the auth user exists (it can never strip a live account)');
reset role;
select is((select count(*)::int from public.houses where owner_id = 'f5000000-0000-4000-a000-000000000001'), 2, 'before: alice owns h1 and h5');
select ok(exists (select 1 from public.subscriptions where user_id = 'f5000000-0000-4000-a000-000000000001'), 'before: alice has a subscription');
delete from auth.users where id = 'f5000000-0000-4000-a000-000000000001';   -- what auth.admin.deleteUser does
select ok(not exists (select 1 from public.subscriptions where user_id = 'f5000000-0000-4000-a000-000000000001')
          and not exists (select 1 from public.house_claims where user_id = 'f5000000-0000-4000-a000-000000000001')
          and not exists (select 1 from private.digest_sends where user_id = 'f5000000-0000-4000-a000-000000000001')
          and not exists (select 1 from private.house_links where used_by = 'f5000000-0000-4000-a000-000000000001'),
  'the Auth delete alone removes the subscription, claims, digest rows and link use (FK cascade / set null)');
select ok((select bool_and(owner_id is null and owner_since is null) from public.houses
            where id in (current_setting('t.h1')::uuid, current_setting('t.h5')::uuid)),
  'owned houses are unowned by the FK (owner_since cleared by the trigger, no check violation)');
select is((select status::text from public.houses where id = current_setting('t.h5')::uuid), 'visible', 'deleting an account never removes a house (C4)');
set local role service_role;
select is(public.svc_delete_account_check('f5000000-0000-4000-a000-000000000001'), 'gone', 'after the Auth delete: gone');
select is(public.svc_delete_account('f5000000-0000-4000-a000-000000000001'), 0, 'the cleanup is idempotent and finds nothing left');
reset role;

select * from finish();
rollback;
