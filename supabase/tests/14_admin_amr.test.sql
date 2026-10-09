-- Subscribe v1, Amendment 2 C1: private.is_admin requires BOTH a password and a TOTP entry in the JWT `amr`.
-- The amr literals below are the exact shape GoTrue emits, captured from real local sessions by
-- tests/storage/50_admin_amr.test.mjs (password + TOTP, email code + TOTP, password only, anonymous). That
-- test also fails if any pgTAP fixture drifts from the captured shape (keys, value types, method order).
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

delete from public.admins;
insert into public.regions (slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng, default_zoom, timezone, is_active)
values ('testville', 'Testville', 10, 11, 10, 11, 10.5, 10.5, 12, 'America/Los_Angeles', true)
on conflict (slug) do update set is_active = true;
select set_config('t.truckee', (select id::text from public.regions where slug = 'truckee'), true);
select set_config('t.testville', (select id::text from public.regions where slug = 'testville'), true);

-- e14..01 global admin, e14..02 testville-only admin, e14..03 no admins row.
insert into auth.users (id, aud, role, email)
select ('e1400000-0000-4000-a000-00000000000' || n)::uuid, 'authenticated', 'authenticated', 'amr' || n || '@example.test'
  from generate_series(1, 3) n;
insert into public.admins (user_id, region_id, note) values
  ('e1400000-0000-4000-a000-000000000001', null, 'amr global'),
  ('e1400000-0000-4000-a000-000000000002', current_setting('t.testville')::uuid, 'amr testville');

create schema test_amr;
grant usage on schema test_amr to authenticated;
-- Captured shapes. GoTrue sorts newest first; two factors in the same second can come back in either order.
create function test_amr.pw_totp() returns json language sql as
  $$ select '[{"method":"totp","timestamp":1791564301},{"method":"password","timestamp":1791564300}]'::json $$;
create function test_amr.otp_totp() returns json language sql as
  $$ select '[{"method":"totp","timestamp":1791564303},{"method":"otp","timestamp":1791564302}]'::json $$;
create function test_amr.pw() returns json language sql as
  $$ select '[{"method":"password","timestamp":1791564302}]'::json $$;
create function test_amr.otp() returns json language sql as
  $$ select '[{"method":"otp","timestamp":1791564302}]'::json $$;
create function test_amr.anon() returns json language sql as
  $$ select '[{"method":"anonymous","timestamp":1791564302}]'::json $$;
-- Sets claims; p_amr is raw JSON text (or null to omit the claim) so malformed shapes can be tested too.
create function test_amr.claims(p_uid text, p_aal text, p_amr text, p_anon boolean default false) returns void language sql as $$
  select set_config('request.jwt.claims',
    (jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'is_anonymous', p_anon, 'aal', p_aal)
      || case when p_amr is null then '{}'::jsonb else jsonb_build_object('amr', p_amr::jsonb) end)::text, true)::text
$$;
create function test_amr.adm(p_aal text, p_amr text, p_region text default 'truckee') returns boolean language sql as $$
  select test_amr.claims('e1400000-0000-4000-a000-000000000001', p_aal, p_amr);
  select private.is_admin(case when p_region is null then null else current_setting('t.' || p_region)::uuid end)
$$;
grant execute on all functions in schema test_amr to authenticated;

-- ---------------------------------------------------------------- the function itself
select is((select prosecdef from pg_proc where oid = 'private.is_admin(uuid)'::regprocedure), true, 'is_admin stays SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'private.is_admin(uuid)'::regprocedure), array['search_path=""'], 'is_admin keeps search_path = ''''');
select ok(not has_function_privilege('anon', 'private.is_admin(uuid)', 'EXECUTE'), 'anon still cannot execute is_admin');
select ok(not has_function_privilege('authenticated', 'private.is_admin(uuid)', 'EXECUTE'), 'authenticated still cannot execute is_admin');

-- ---------------------------------------------------------------- the matrix (as postgres, impersonating via claims)
select is(test_amr.adm('aal2', test_amr.pw_totp()::text), true, 'password + TOTP (captured shape), aal2 -> admin');
select is(test_amr.adm('aal2', test_amr.pw_totp()::text, null), true, 'password + TOTP, global admin, global scope -> admin');
select is(test_amr.adm('aal2', /* fixture:reordered */ '[{"method":"password","timestamp":1791564300},{"method":"totp","timestamp":1791564301}]'), true,
  'password + TOTP in the other order -> admin (order does not matter)');
select is(test_amr.adm('aal2', test_amr.otp_totp()::text), false, 'email code + TOTP (captured shape), aal2 -> NOT admin');
select is(test_amr.adm('aal2', '[{"method":"totp","timestamp":1791564303},{"method":"magiclink","timestamp":1791564302}]'), false,
  'magic link + TOTP, aal2 -> NOT admin');
select is(test_amr.adm('aal1', test_amr.pw()::text), false, 'password only (captured shape), aal1 -> NOT admin');
select is(test_amr.adm('aal2', test_amr.pw()::text), false, 'password only even with an aal2 claim -> NOT admin');
select is(test_amr.adm('aal2', /* fixture:synthetic */ '[{"method":"totp","timestamp":1791564301}]'), false, 'TOTP only -> NOT admin');
select is(test_amr.adm('aal1', test_amr.pw_totp()::text), false, 'password + TOTP but aal1 -> NOT admin (aal check kept)');
select is(test_amr.adm('aal2', test_amr.otp()::text), false, 'email code only -> NOT admin');
select is(test_amr.adm('aal2', null), false, 'amr claim missing -> NOT admin (fails closed)');
select is(test_amr.adm('aal2', '[]'), false, 'amr empty array -> NOT admin');
select is(test_amr.adm('aal2', '"password totp"'), false, 'amr a string -> NOT admin, no error');
select is(test_amr.adm('aal2', '{"method":"password"}'), false, 'amr an object -> NOT admin, no error');
select is(test_amr.adm('aal2', 'null'), false, 'amr JSON null -> NOT admin, no error');
select is(test_amr.adm('aal2', '["password","totp"]'), false, 'amr as bare strings (not GoTrue shape) -> NOT admin');
select is(test_amr.adm('aal2', /* fixture:malformed */ '[{"method":"PASSWORD"},{"method":"TOTP"}]'), false, 'method names are case-sensitive');
select test_amr.claims('e1400000-0000-4000-a000-000000000001', 'aal2', test_amr.pw_totp()::text, true);
select is(private.is_admin(current_setting('t.truckee')::uuid), false, 'anonymous JWT with password + TOTP amr -> NOT admin');
select test_amr.claims('e1400000-0000-4000-a000-000000000003', 'aal2', test_amr.pw_totp()::text);
select is(private.is_admin(current_setting('t.truckee')::uuid), false, 'password + TOTP without an admins row -> NOT admin');
select test_amr.claims('e1400000-0000-4000-a000-000000000002', 'aal2', test_amr.pw_totp()::text);
select is(private.is_admin(current_setting('t.testville')::uuid), true, 'region admin, password + TOTP, own region -> admin');
select is(private.is_admin(current_setting('t.truckee')::uuid), false, 'region admin, password + TOTP, other region -> NOT admin');

-- ---------------------------------------------------------------- through the API role (what PostgREST does)
select test_amr.claims('e1400000-0000-4000-a000-000000000001', 'aal2', test_amr.pw_totp()::text);
set local role authenticated;
select is(public.admin_whoami(current_setting('t.truckee')::uuid), true, 'authenticated, password + TOTP: admin_whoami -> true');
select lives_ok($$select * from public.admin_list_houses(current_setting('t.truckee')::uuid, null, null)$$,
  'authenticated, password + TOTP: admin_list_houses runs');
reset role;
select test_amr.claims('e1400000-0000-4000-a000-000000000001', 'aal2', test_amr.otp_totp()::text);
set local role authenticated;
select is(public.admin_whoami(current_setting('t.truckee')::uuid), false, 'authenticated, email code + TOTP: admin_whoami -> false');
select throws_ok($$select * from public.admin_list_houses(current_setting('t.truckee')::uuid, null, null)$$, '42501', 'forbidden',
  'authenticated, email code + TOTP: admin_list_houses -> forbidden');
reset role;
select test_amr.claims('e1400000-0000-4000-a000-000000000001', 'aal1', test_amr.pw()::text);
set local role authenticated;
select is(public.admin_whoami(current_setting('t.truckee')::uuid), false, 'authenticated, password only (aal1): admin_whoami -> false');
reset role;

select * from finish();
rollback;
