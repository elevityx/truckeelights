-- ROLLBACK for supabase/migrations/20261016000100_admin_amr.sql (Subscribe v1 spec, Amendment 2 C1).
-- NOT a migration: it lives outside supabase/migrations so `db reset` / `db push` never apply it.
-- Run it by hand (maintainer only) only if the post-push admin check fails. It restores
-- private.is_admin exactly as defined in 20261008000300_private_helpers.sql (no amr clause).
-- After running it, record the rollback in a follow-up migration so the history matches the database.

create or replace function private.is_admin(p_region_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) = false
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.admins a
                 where a.user_id = auth.uid()
                   and (a.region_id is null or a.region_id = p_region_id))
$$;
