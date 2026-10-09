-- Admin factor check, made precise (Subscribe v1 spec, Amendment 2 C1). Shipped first and alone.
--
-- AAL2 alone is not enough once ordinary users can sign in by email code: a subscriber who signs in
-- with a one-time code and then enrolls TOTP would also reach aal2. An admin session must carry BOTH
-- a password and a TOTP entry in the JWT `amr` claim. GoTrue emits `amr` as an array of objects,
-- e.g. [{"method":"totp","timestamp":...},{"method":"password","timestamp":...}] (captured from a real
-- local password + TOTP session by tests/storage/50_admin_amr.test.mjs, which also checks that the
-- pgTAP fixtures use that shape). A missing or non-array `amr` fails closed.
--
-- `create or replace` keeps the owner, SECURITY DEFINER, and the existing (empty) API-role grants.
-- Rollback, if the hosted check fails: supabase/rollback/20261016000100_admin_amr_down.sql
-- (kept outside supabase/migrations on purpose so it never runs by itself).

create or replace function private.is_admin(p_region_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with j as (
    select case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr'
                else '[]'::jsonb end as amr
  )
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) = false
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from j, jsonb_array_elements(j.amr) e where e ->> 'method' = 'password')
     and exists (select 1 from j, jsonb_array_elements(j.amr) e where e ->> 'method' = 'totp')
     and exists (select 1 from public.admins a
                 where a.user_id = auth.uid()
                   and (a.region_id is null or a.region_id = p_region_id))
$$;
