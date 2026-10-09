-- Subscribe + Accounts v1 (Spec_Subscribe_Accounts; Amendment 2 > Amendment 1 > body).
-- Email digests of new houses and events, accounts (email OTP), house owners (view, hide/unhide, request removal),
-- claims with admin approval, unsubscribe/preferences links served by Edge Functions through svc_* routines.
-- Same patterns as before: FORCE RLS, no table write grants, column grants, security definer RPCs with
-- search_path = '', and an exact EXECUTE allowlist re-granted in full (01_acl.test.sql).
-- Independent of 20261016000100_admin_amr (it changes only private.is_admin, which this file calls but never redefines).
--
-- LOCK ORDER (never the reverse):
--   houses row (FOR SHARE / FOR UPDATE) -> house_claims rows -> quota advisory locks (claim:* / owner_vis:*)
--     -> photo advisory + photos rows -> storage_jobs rows        (owner hide, claims, admin resolve/clear, release)
--   house_link:uid -> house_link:email advisory locks -> house_links rows                 (begin_house_link)
--   house_links rows (id order) -> the UNION of their houses rows (one pass, global id order)  (complete_house_link)
--   subscribe:uid advisory (take_quota) -> subscriptions row                             (set_subscription)
--   digest_runs row -> digest_cap:<UTC day> advisory -> subscriptions rows (SKIP LOCKED) -> digest_sends rows
--                                                                                         (svc_digest_batch)
-- None of these paths takes a site_settings lock or an event:* / vote:* lock, so they add no edge to the votes or
-- events graphs. admin_set_house_status and admin_release_house keep their existing order (houses row, then photos).

-- ---------------------------------------------------------------- columns on existing tables
-- Capability switch for the Subscribe UI (B9/C9). It gates the UI only (the capability object); an emailed
-- preferences/unsubscribe link and an existing account keep working when it is off.
alter table public.site_settings add column subscribe_open boolean not null default false;
grant select (subscribe_open) on public.site_settings to anon, authenticated;

-- Owner identity (§2.2): never granted to an API role; owners read it only through my_account().
alter table public.houses add column owner_id uuid references auth.users(id) on delete set null;
alter table public.houses add column owner_since timestamptz;
alter table public.houses add constraint houses_owner_since check ((owner_id is null) = (owner_since is null));
create index houses_owner_idx on public.houses (owner_id) where owner_id is not null;
-- owner_since follows owner_id: whenever owner_id becomes null (an RPC, or the FK's ON DELETE SET NULL when the account
-- is deleted), owner_since is cleared too, so houses_owner_since can never block an auth.users delete.
create function private.houses_owner_since_sync() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.owner_id is null then new.owner_since := null;
  elsif new.owner_since is null then new.owner_since := now(); end if;
  return new;
end $$;
create trigger houses_owner_since_sync before insert or update of owner_id, owner_since on public.houses
  for each row execute function private.houses_owner_since_sync();

-- B6: when an event first became public (approved or admin-created). Not granted to API roles.
alter table public.events add column approved_at timestamptz;
update public.events set approved_at = coalesce(moderated_at, created_at) where status in ('approved', 'hidden');
create index events_approved_idx on public.events (region_id, season, year, approved_at) where status = 'approved';

-- C8: daily digest send cap, counted across every run kind (svc_digest_batch reserves it under one lock per UTC day).
-- The owner is on a paid Resend plan, so this is a cost/abuse guard, not the provider's limit.
alter table public.app_settings add column digest_daily_cap smallint not null default 500
  check (digest_daily_cap between 0 and 10000);

alter table private.quota_events drop constraint quota_events_kind_check;
alter table private.quota_events add constraint quota_events_kind_check
  check (kind in ('house', 'photo_reserve', 'photo_confirm', 'event', 'subscribe', 'claim', 'owner_vis'));

-- ---------------------------------------------------------------- tables
create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  region_id uuid not null references public.regions(id) on delete restrict,
  houses boolean not null default false,
  events boolean not null default false,
  cadence text not null default 'daily' check (cadence in ('daily', 'weekly')),
  status text not null default 'active' check (status in ('active', 'stopped')),  -- B2: no 'pending'
  public_id uuid not null unique default gen_random_uuid(),                        -- B8: link tokens never carry the uid
  token_version integer not null default 1 check (token_version >= 1),            -- bump = every emailed link dies
  confirmed_at timestamptz not null default now(),
  stopped_at timestamptz,
  last_sent_through timestamptz not null default now(),                           -- advances only on 'sent'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (houses or events),
  check ((status = 'stopped') = (stopped_at is not null))
);
create index subscriptions_digest_idx on public.subscriptions (status, cadence, last_sent_through);
create index subscriptions_region_idx on public.subscriptions (region_id, status);

-- B5/C7: claims ('claim') and removal requests ('removal') share one table and one admin queue.
create table public.house_claims (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'claim' check (kind in ('claim', 'removal')),
  house_id uuid not null references public.houses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  note text check (note is null or (char_length(note) between 1 and 300 and note !~ '[<>]')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  check ((status = 'pending') = (resolved_at is null))
);
create unique index house_claims_one_pending_per_house on public.house_claims (house_id) where status = 'pending' and kind = 'claim';
create unique index house_claims_one_pending_per_user  on public.house_claims (user_id)  where status = 'pending' and kind = 'claim';
create unique index house_claims_one_removal_per_house on public.house_claims (house_id) where status = 'pending' and kind = 'removal';
create index house_claims_queue_idx on public.house_claims (status, created_at);
create index house_claims_user_idx  on public.house_claims (user_id, status);

-- B3: an anonymous device asks for its houses to follow whoever verifies this email within 1 hour. Rows are kept
-- (used_at) for the per-email daily limit and swept after a day.
create table private.house_links (
  id bigint generated always as identity primary key,
  email_hash bytea not null check (octet_length(email_hash) = 32),     -- sha256(lower(trim(email)))
  anon_uid uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null
);
create index house_links_email_idx on private.house_links (email_hash, created_at);
create index house_links_uid_idx   on private.house_links (anon_uid, expires_at);

create table private.digest_runs (
  run_id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('daily', 'weekly')),
  run_date date not null,                                -- region-local (Pacific) date of the run
  window_to timestamptz not null default now(),          -- items up to this instant belong to the run
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  sent integer not null default 0,
  failed integer not null default 0,
  cap_hit boolean not null default false,
  unique (kind, run_date)
);

-- C8: one row per (run, user). error_code only, no provider text.
-- The provider Idempotency-Key is per CONTENT WINDOW, not per run: digest:<public_id>:<window_from, ISO UTC>, where
-- window_from is the subscription's last_sent_through when the row was claimed. It is stored here and reused for every
-- retry of the row: the same run's next cron tick, or a later day's run (svc_digest_batch resumes an unresolved
-- `sending` row with its own key and window before minting anything new). Resend dedupes a key for 24 h; an ambiguous
-- send resumed more than 24 h later can be delivered twice (accepted residual risk, Review_Code_Subscribe).
create table private.digest_sends (
  run_id uuid not null references private.digest_runs(run_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('sending', 'sent', 'failed')),
  attempts integer not null default 1,
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,40}$'),
  idempotency_key text not null check (idempotency_key ~ '^digest:[0-9a-f-]{36}:[0-9T:.Z-]{20,32}$'),
  window_from timestamptz not null,
  window_to timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (run_id, user_id)
);
create index digest_sends_day_idx on private.digest_sends (status, updated_at);
create index digest_sends_user_idx on private.digest_sends (user_id, status);

alter table public.subscriptions  enable row level security;
alter table public.subscriptions  force row level security;
alter table public.house_claims   enable row level security;
alter table public.house_claims   force row level security;
alter table private.house_links   enable row level security;
alter table private.house_links   force row level security;
alter table private.digest_runs   enable row level security;
alter table private.digest_runs   force row level security;
alter table private.digest_sends  enable row level security;
alter table private.digest_sends  force row level security;
-- No grants and no policies on any of them: every read and write goes through the RPCs below (deviation from §2.1's
-- owner SELECT policy: my_account() returns the row instead, so no API role reads a subscription table directly).
revoke all on public.subscriptions, public.house_claims from anon, authenticated;

-- ---------------------------------------------------------------- helpers (private, no grants)
-- §3/B4: a signed-in, non-anonymous account. A user listed in public.admins must be at aal2 (B4).
create function private.account_uid() returns uuid
language plpgsql stable set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) then
    raise exception 'not_signed_in' using errcode = '28000'; end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' and exists (select 1 from public.admins a where a.user_id = v_uid) then
    raise exception 'forbidden' using errcode = '42501'; end if;
  return v_uid;
end $$;

-- "s•••@example.com". Admin RPCs return only this, never an address.
create function private.mask_email(p text) returns text
language sql immutable set search_path = '' as $$
  select case when p is null or position('@' in p) < 2 then null
              else left(lower(split_part(p, '@', 1)), 1) || '•••@' || lower(split_part(p, '@', 2)) end
$$;

create function private.email_hash(p text) returns bytea
language sql immutable set search_path = '' as $$
  select sha256(convert_to(lower(btrim(coalesce(p, ''))), 'UTF8'))
$$;

create function private.clean_note(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(coalesce(p, '')), '');
begin
  if v is not null and (char_length(v) > 300 or v ~ '[<>]') then
    raise exception 'invalid_input' using errcode = '22023', detail = 'note'; end if;
  return v;
end $$;

-- Shared hide (B5/C6): the admin hide and the owner hide both end here. Caller holds the houses row FOR UPDATE
-- (re-taken here, re-entrant). visible -> hidden rotates every approved photo (storage job, same transaction).
create function private.hide_house_core(p_house_id uuid, p_reason text, p_actor uuid) returns void
language plpgsql set search_path = '' as $$
declare v_status public.house_status;
begin
  select status into v_status from public.houses where id = p_house_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_status = 'released' then raise exception 'house_released' using errcode = '22023'; end if;
  update public.houses
     set status = 'hidden', hidden_reason = p_reason, moderated_by = p_actor, moderated_at = now()
   where id = p_house_id;
  if v_status = 'visible' then
    if private.rotate_house_photos(array[p_house_id]) > 0 then
      perform private.run_storage_jobs(50, null);
    end if;
  end if;
end $$;

-- C7: the release body of admin_release_house, extracted. Caller holds the houses row FOR UPDATE and has checked
-- who may release. Clears the owner and closes the house's other pending claims/removal requests.
create function private.release_house_core(p_house_id uuid, p_actor uuid) returns void
language plpgsql set search_path = '' as $$
declare v_region uuid; r record; p public.photos%rowtype; v_n integer := 0;
begin
  select region_id into v_region from public.houses where id = p_house_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.houses
     set status = 'released', released_at = now(), place_id = null,
         normalized_address = normalized_address || '#released:' || id::text,
         moderated_by = p_actor, moderated_at = now(), owner_id = null, owner_since = null
   where id = p_house_id;
  update public.house_claims set status = 'rejected', reason = 'released', resolved_by = p_actor, resolved_at = now()
   where house_id = p_house_id and status = 'pending';
  -- R2: approved -> revoked (delete), pending -> rejected and reserved -> expired (delete upload). Id order.
  for r in select id from public.photos where house_id = p_house_id and status in ('approved', 'pending', 'reserved') order by id loop
    perform private.lock_photo(r.id);
    select * into p from public.photos where id = r.id for update;
    if p.status = 'approved' then
      update public.photos set status = 'revoked', public_path = null, moderated_by = p_actor, moderated_at = now() where id = p.id;
      perform private.enqueue_delete_public(p.id, p.public_path, v_region);
    elsif p.status = 'pending' then
      update public.photos set status = 'rejected', moderated_by = p_actor, moderated_at = now() where id = p.id;
      perform private.enqueue_storage_job('delete_upload', 'photo-uploads', p.upload_path, null, p.id, v_region);
    elsif p.status = 'reserved' then
      update public.photos set status = 'expired' where id = p.id;
      perform private.enqueue_storage_job('delete_upload', 'photo-uploads', p.upload_path, null, p.id, v_region);
    else
      continue;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then perform private.run_storage_jobs(50, null); end if;
end $$;

-- Owner row lock: the caller's own, non-released house, FOR UPDATE.
create function private.owner_lock_house(p_house_id uuid, p_uid uuid) returns public.houses
language plpgsql set search_path = '' as $$
declare h public.houses%rowtype;
begin
  select * into h from public.houses where id = p_house_id for update;
  if not found or h.status = 'released' then raise exception 'not_found' using errcode = 'P0002'; end if;
  if h.owner_id is distinct from p_uid then raise exception 'forbidden' using errcode = '42501'; end if;
  return h;
end $$;

-- B6: approved_at is set once, when a row first becomes approved (approve, or admin_create_event's insert).
create function private.events_set_approved_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'approved' and new.approved_at is null then new.approved_at := now(); end if;
  return new;
end $$;
create trigger events_approved_at before insert or update of status on public.events
  for each row execute function private.events_set_approved_at();

-- take_quota: re-created from the Events body (20261013000100), plus subscribe / claim / owner_vis.
create or replace function private.take_quota(p_kind text, p_region_id uuid, p_house_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_n integer;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_kind || ':uid:' || v_uid::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_kind || ':region:' || p_region_id::text, 0));
  if p_house_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_kind || ':house:' || p_house_id::text, 0));
  end if;
  if p_kind = 'house' then
    select count(*) into v_n from private.quota_events where kind = 'house' and uid = v_uid and created_at > now() - interval '1 hour';
    if v_n >= 5 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'uid_hourly'; end if;
    select count(*) into v_n from private.quota_events where kind = 'house' and region_id = p_region_id and created_at > now() - interval '10 minutes';
    if v_n >= 60 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'region_breaker'; end if;
  elsif p_kind = 'photo_reserve' then
    select count(*) into v_n from private.quota_events where kind = 'photo_reserve' and uid = v_uid and created_at > now() - interval '1 hour';
    if v_n >= 10 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'uid_hourly'; end if;
    -- "outstanding" is counted from LIVE rows under the uid lock, not from the ledger
    select count(*) into v_n from public.photos where created_by = v_uid and status = 'reserved' and reserved_until > now();
    if v_n >= 3 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'outstanding'; end if;
    select count(*) into v_n from private.quota_events where kind = 'photo_reserve' and region_id = p_region_id and created_at > now() - interval '1 hour';
    if v_n >= 200 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'region_breaker'; end if;
  elsif p_kind = 'event' then
    select count(*) into v_n from private.quota_events where kind = 'event' and uid = v_uid and created_at > now() - interval '1 hour';
    if v_n >= 3 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'uid_hourly'; end if;
    select count(*) into v_n from private.quota_events where kind = 'event' and uid = v_uid and created_at > now() - interval '24 hours';
    if v_n >= 6 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'uid_daily'; end if;
    select count(*) into v_n from private.quota_events where kind = 'event' and region_id = p_region_id and created_at > now() - interval '10 minutes';
    if v_n >= 30 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'region_breaker'; end if;
  elsif p_kind = 'subscribe' then                                     -- §3: 10 per account per day
    select count(*) into v_n from private.quota_events where kind = 'subscribe' and uid = v_uid and created_at > now() - interval '24 hours';
    if v_n >= 10 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'uid_daily'; end if;
  elsif p_kind = 'claim' then                                         -- §3: claims + removal requests, 3 per account per day
    select count(*) into v_n from private.quota_events where kind = 'claim' and uid = v_uid and created_at > now() - interval '24 hours';
    if v_n >= 3 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'uid_daily'; end if;
  elsif p_kind = 'owner_vis' then                                     -- C6: 3 visibility changes per house per day
    if p_house_id is null then raise exception 'invalid_input' using errcode = '22023', detail = 'quota_house'; end if;
    select count(*) into v_n from private.quota_events where kind = 'owner_vis' and house_id = p_house_id and created_at > now() - interval '24 hours';
    if v_n >= 3 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'house_daily'; end if;
  else
    raise exception 'invalid_input' using errcode = '22023', detail = 'quota_kind';
  end if;
  insert into private.quota_events (kind, uid, region_id, house_id) values (p_kind, v_uid, p_region_id, p_house_id);
end $$;

-- ---------------------------------------------------------------- replaced admin house RPCs (same signatures)
-- Hide goes through the shared routine. A reason equal to 'owner' is reserved for the owner path (an admin hide must
-- never become owner-unhideable).
create or replace function public.admin_set_house_status(p_house_id uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_region uuid; v_status public.house_status;
begin
  select region_id, status into v_region, v_status from public.houses where id = p_house_id for update;
  if not found then
    if private.is_admin(null) then raise exception 'not_found' using errcode = 'P0002';
    else raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  if not private.is_admin(v_region) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_status = 'released' then raise exception 'house_released' using errcode = '22023'; end if;
  if p_status is null or p_status not in ('visible', 'hidden')
     or (p_reason is not null and char_length(p_reason) > 200)
     or lower(btrim(coalesce(p_reason, ''))) = 'owner' then
    raise exception 'invalid_input' using errcode = '22023'; end if;
  if p_status = 'hidden' then
    perform private.hide_house_core(p_house_id, nullif(btrim(p_reason), ''), auth.uid());
  else
    update public.houses
       set status = 'visible', hidden_reason = null, moderated_by = auth.uid(), moderated_at = now()
     where id = p_house_id;
  end if;
end $$;

create or replace function public.admin_release_house(p_house_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_region uuid; v_status public.house_status;
begin
  select region_id, status into v_region, v_status from public.houses where id = p_house_id for update;
  if not found then
    if private.is_admin(null) then raise exception 'not_found' using errcode = 'P0002';
    else raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  if not private.is_admin(v_region) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_status <> 'hidden' then raise exception 'must_be_hidden' using errcode = '22023'; end if;
  perform private.release_house_core(p_house_id, auth.uid());
end $$;

-- Same body as 20261008000400 (unchanged dedupe, locks, quota), plus: when the caller is a signed-in, non-anonymous
-- account, the new house is owned by it (owner_id = auth.uid(), owner_since = now()). Anonymous adds stay unowned until
-- complete_house_link. (Fixes Review_Code_Subscribe P1: signed-in adds never became managed houses.)
create or replace function public.submit_house(p_region_slug text, p_place_id text, p_address text,
                                    p_lat double precision, p_lng double precision)
returns table (result text, house_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_region public.regions%rowtype;
  v_set public.site_settings%rowtype;
  v_address text := btrim(regexp_replace(coalesce(p_address, ''), '\s+', ' ', 'g'));
  v_norm text;
  v_hit public.houses%rowtype;
  v_id uuid;
  -- Subscribe v1: a signed-in (non-anonymous) account that adds a house manages it from the start.
  v_owner uuid := case when coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) = false then auth.uid() end;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  select * into v_region from public.regions where slug = p_region_slug and is_active;
  if not found then raise exception 'region_not_found' using errcode = 'P0002'; end if;
  select * into v_set from public.site_settings where region_id = v_region.id;
  if not found or not v_set.submissions_open then
    raise exception 'submissions_closed' using errcode = 'P0001'; end if;
  if p_place_id is null or p_place_id !~ '^[A-Za-z0-9_-]+$' or char_length(p_place_id) not between 10 and 300 then
    raise exception 'invalid_place_id' using errcode = '22023'; end if;
  perform private.validate_address(v_address);
  perform private.assert_street_level(v_address, v_region.name);
  if p_lat is null or p_lng is null then raise exception 'invalid_coordinates' using errcode = '22023'; end if;
  if not (p_lat between v_region.min_lat and v_region.max_lat and p_lng between v_region.min_lng and v_region.max_lng) then
    raise exception 'out_of_bounds' using errcode = '22023'; end if;            -- NaN fails BETWEEN too
  v_norm := private.normalize_address(v_address);

  -- Take the uid -> region locks FIRST, then dedupe, then quota, then insert.
  -- All submits in a region serialize on the region lock, so the dedupe read sees every committed
  -- earlier insert. Duplicates never reach take_quota and never return rate_limited.
  perform private.lock_quota('house', v_region.id);
  select * into v_hit from public.houses h
   where h.region_id = v_region.id and h.season = v_set.active_season and h.year = v_set.active_year
     and (h.place_id = p_place_id or h.normalized_address = v_norm)
   order by (h.status = 'visible') desc limit 1;
  if found then
    if v_hit.status = 'visible' then return query select 'exists_visible'::text, v_hit.id;
    else return query select 'blocked'::text, null::uuid; end if;            -- no id, no address leak
    return;
  end if;

  perform private.take_quota('house', v_region.id, null);   -- re-takes the same xact locks (re-entrant), counts, appends

  insert into public.houses (region_id, season, year, place_id, address, normalized_address,
                             lat, lng, coord_source, created_by, owner_id, owner_since)
  values (v_region.id, v_set.active_season, v_set.active_year, p_place_id, v_address, v_norm,
          p_lat, p_lng, 'user_confirmed', v_uid, v_owner, case when v_owner is not null then now() end)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then                                    -- backstop only (e.g. legacy import key); unreachable under the region lock
    select * into v_hit from public.houses h
     where h.region_id = v_region.id and h.season = v_set.active_season and h.year = v_set.active_year
       and (h.place_id = p_place_id or h.normalized_address = v_norm)
     order by (h.status = 'visible') desc limit 1;
    if v_hit.status = 'visible' then return query select 'exists_visible'::text, v_hit.id;
    else return query select 'blocked'::text, null::uuid; end if;
    return;
  end if;
  return query select 'created'::text, v_id;
end $$;

-- ---------------------------------------------------------------- account RPCs (non-anonymous)
create function public.set_subscription(p_region_slug text, p_houses boolean, p_events boolean, p_cadence text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.account_uid(); v_region public.regions%rowtype; s public.subscriptions%rowtype;
begin
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email is not null and u.email_confirmed_at is not null) then
    raise exception 'forbidden' using errcode = '42501', detail = 'email'; end if;
  select * into v_region from public.regions where slug = p_region_slug and is_active;
  if not found then raise exception 'region_not_found' using errcode = 'P0002'; end if;
  if p_houses is null or p_events is null or not (p_houses or p_events) then
    raise exception 'invalid_input' using errcode = '22023', detail = 'topics'; end if;
  if p_cadence is null or p_cadence not in ('daily', 'weekly') then
    raise exception 'invalid_input' using errcode = '22023', detail = 'cadence'; end if;
  perform private.take_quota('subscribe', v_region.id, null);
  insert into public.subscriptions as t (user_id, region_id, houses, events, cadence)
  values (v_uid, v_region.id, p_houses, p_events, p_cadence)
  on conflict (user_id) do update
     set region_id = excluded.region_id, houses = excluded.houses, events = excluded.events, cadence = excluded.cadence,
         status = 'active', stopped_at = null,
         token_version = t.token_version + case when t.status = 'stopped' then 1 else 0 end,        -- B8: resubscribe
         last_sent_through = case when t.status = 'stopped' or t.region_id <> excluded.region_id then now()
                                  else t.last_sent_through end,
         updated_at = now()
  returning * into s;
  return jsonb_build_object('region_slug', v_region.slug, 'houses', s.houses, 'events', s.events,
                            'cadence', s.cadence, 'status', s.status, 'confirmed_at', s.confirmed_at);
end $$;

-- Stopping does not bump token_version (B8 as amended): a repeated one-click POST must still recognise the token and
-- answer "already stopped". Resubscribing bumps it (set_subscription), and deleting the account removes the row.
create function public.stop_subscription() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.account_uid();
begin
  update public.subscriptions
     set status = 'stopped', stopped_at = now(), updated_at = now()
   where user_id = v_uid and status = 'active';
end $$;

create function public.my_account() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.account_uid();
begin
  return jsonb_build_object(
    'email', (select u.email from auth.users u where u.id = v_uid),
    'subscription', (select jsonb_build_object('region_slug', r.slug, 'houses', s.houses, 'events', s.events,
                                               'cadence', s.cadence, 'status', s.status, 'confirmed_at', s.confirmed_at)
                       from public.subscriptions s join public.regions r on r.id = s.region_id where s.user_id = v_uid),
    'houses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'address', h.address, 'status', h.status,
               'hidden_by_owner', (h.status = 'hidden' and h.hidden_reason = 'owner'),
               'votes', coalesce((select t.votes from public.house_vote_totals t where t.house_id = h.id), 0),
               'approved_photos', (select count(*) from public.photos p where p.house_id = h.id and p.status = 'approved'),
               'removal_pending', exists (select 1 from public.house_claims c
                                           where c.house_id = h.id and c.kind = 'removal' and c.status = 'pending'))
             order by h.created_at, h.id)
        from public.houses h where h.owner_id = v_uid and h.status <> 'released'), '[]'::jsonb),
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'house_id', c.house_id, 'address', h.address,
                                          'status', c.status, 'created_at', c.created_at) order by c.created_at)
        from public.house_claims c join public.houses h on h.id = c.house_id
       where c.user_id = v_uid and c.status = 'pending'), '[]'::jsonb));
end $$;

-- Houses this same account added while signed in (body §3).
create function public.claim_my_submissions() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.account_uid(); v_n integer;
begin
  update public.houses h set owner_id = v_uid, owner_since = now()
   where h.id in (select x.id from public.houses x
                   where x.created_by = v_uid and x.owner_id is null and x.status <> 'released'
                   order by x.id for update)
     and h.owner_id is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- B3/C5: anonymous sessions only. Never says whether the email has an account.
create function public.begin_house_link(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_email text := lower(btrim(coalesce(p_email, ''))); v_hash bytea; v_n integer;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s<>]{1,64}@[^@\s<>]+\.[^@\s<>]+$' then
    raise exception 'invalid_input' using errcode = '22023', detail = 'email'; end if;
  v_hash := private.email_hash(v_email);
  perform pg_advisory_xact_lock(hashtextextended('house_link:uid:' || v_uid::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('house_link:email:' || encode(v_hash, 'hex'), 0));
  -- A live link for the same (device, email) already exists: keep it as it is. Its expiry is never extended, so the
  -- one-hour authorization cannot be refreshed forever (and a repeat costs no daily attempt).
  if exists (select 1 from private.house_links
              where anon_uid = v_uid and email_hash = v_hash and used_at is null and expires_at > now()) then
    return;
  end if;
  select count(*) into v_n from private.house_links where anon_uid = v_uid and used_at is null and expires_at > now();
  if v_n >= 3 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'uid_live'; end if;
  select count(*) into v_n from private.house_links where email_hash = v_hash and created_at > now() - interval '24 hours';
  if v_n >= 5 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'email_daily'; end if;
  insert into private.house_links (email_hash, anon_uid, expires_at) values (v_hash, v_uid, now() + interval '1 hour');
end $$;

-- B3: matches the session's CONFIRMED email; each live link is used once (row lock + recheck).
-- Lock order: first every live link row for this email (id order), then the UNION of their candidate houses in one
-- pass in global house-id order. Two emails whose links name the same devices in opposite orders therefore never lock
-- houses in crossed order (no 40P01).
create function public.complete_house_link() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.account_uid(); v_email text; v_links bigint[]; v_anons uuid[]; v_n integer;
begin
  select u.email into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  select coalesce(array_agg(l.id order by l.id), '{}'), coalesce(array_agg(distinct l.anon_uid), '{}')
    into v_links, v_anons
    from (select x.id, x.anon_uid from private.house_links x
           where x.email_hash = private.email_hash(v_email) and x.used_at is null and x.expires_at > now()
           order by x.id for update) l;
  if cardinality(v_links) = 0 then return 0; end if;
  perform 1 from public.houses x
   where x.created_by = any (v_anons) and x.owner_id is null and x.status <> 'released'
   order by x.id for update;
  update public.houses h set owner_id = v_uid, owner_since = now()
   where h.created_by = any (v_anons) and h.owner_id is null and h.status <> 'released';
  get diagnostics v_n = row_count;
  update private.house_links set used_at = now(), used_by = v_uid where id = any (v_links);
  return v_n;
end $$;

-- B5: a visible, active-season house; owned houses stay claimable (the admin sees the current owner, masked).
create function public.request_house_claim(p_house_id uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.account_uid(); v_note text := private.clean_note(p_note); h public.houses%rowtype; v_id uuid;
begin
  select * into h from public.houses where id = p_house_id for share;
  if not found or not private.house_is_public(p_house_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if h.owner_id = v_uid then raise exception 'already_owned' using errcode = '22023'; end if;
  if exists (select 1 from public.house_claims c where c.status = 'pending' and c.kind = 'claim'
              and (c.user_id = v_uid or c.house_id = p_house_id)) then
    raise exception 'claim_pending' using errcode = '23505'; end if;
  begin
    perform private.take_quota('claim', h.region_id, null);
    insert into public.house_claims (kind, house_id, user_id, note) values ('claim', p_house_id, v_uid, v_note)
    returning id into v_id;
  exception when unique_violation then                     -- a parallel claim won the race
    raise exception 'claim_pending' using errcode = '23505';
  end;
  return v_id;
end $$;

-- C7: owner only, one pending removal per house.
create function public.request_house_removal(p_house_id uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.account_uid(); v_note text := private.clean_note(p_note); h public.houses%rowtype; v_id uuid;
begin
  h := private.owner_lock_house(p_house_id, v_uid);
  if exists (select 1 from public.house_claims c where c.house_id = p_house_id and c.kind = 'removal' and c.status = 'pending') then
    raise exception 'claim_pending' using errcode = '23505'; end if;
  begin
    perform private.take_quota('claim', h.region_id, null);
    insert into public.house_claims (kind, house_id, user_id, note) values ('removal', p_house_id, v_uid, v_note)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'claim_pending' using errcode = '23505';
  end;
  return v_id;
end $$;

create function public.withdraw_house_claim(p_claim_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.account_uid();
begin
  update public.house_claims set status = 'withdrawn', resolved_by = v_uid, resolved_at = now()
   where id = p_claim_id and user_id = v_uid and status = 'pending';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

-- C6: hide only a visible house; unhide only an owner-hidden one. Admin-hidden rows are never touched.
create function public.owner_set_house_visibility(p_house_id uuid, p_visible boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.account_uid(); h public.houses%rowtype;
begin
  if p_visible is null then raise exception 'invalid_input' using errcode = '22023', detail = 'visible'; end if;
  h := private.owner_lock_house(p_house_id, v_uid);
  if not p_visible then
    if h.status = 'hidden' and h.hidden_reason = 'owner' then return; end if;      -- already done; no quota
    if h.status <> 'visible' then raise exception 'forbidden' using errcode = '42501'; end if;
    perform private.take_quota('owner_vis', h.region_id, h.id);
    perform private.hide_house_core(h.id, 'owner', v_uid);
  else
    if h.status = 'visible' then return; end if;
    if not (h.status = 'hidden' and h.hidden_reason = 'owner') then raise exception 'forbidden' using errcode = '42501'; end if;
    perform private.take_quota('owner_vis', h.region_id, h.id);
    update public.houses set status = 'visible', hidden_reason = null, moderated_by = v_uid, moderated_at = now()
     where id = h.id;
  end if;
end $$;

-- ---------------------------------------------------------------- admin RPCs (AAL2 admin of the row's region)
create function public.admin_claim_queue(p_region_id uuid, p_status text)
returns table (id uuid, kind text, house_id uuid, address text, house_status text, claimant_masked text,
               current_owner_masked text, note text, status text, reason text, created_at timestamptz,
               resolved_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.is_admin(p_region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('pending', 'approved', 'rejected', 'withdrawn') then
    raise exception 'invalid_input' using errcode = '22023', detail = 'status'; end if;
  return query
    select c.id, c.kind, c.house_id, h.address, h.status::text,
           coalesce(private.mask_email(cu.email), '•••'), private.mask_email(ou.email),
           c.note, c.status, c.reason, c.created_at, c.resolved_at
      from public.house_claims c
      join public.houses h on h.id = c.house_id
      left join auth.users cu on cu.id = c.user_id
      left join auth.users ou on ou.id = h.owner_id
     where h.region_id = p_region_id and c.status = p_status
     order by case when p_status = 'pending' then extract(epoch from c.created_at) else -extract(epoch from c.created_at) end, c.id
     limit 200;
end $$;

-- B5/C7. Lock order: houses row, then the claim row (the same order as request_house_claim).
-- The claim is re-read under its row lock and the branch is chosen from its STORED kind. A claim that disappeared in
-- between (the claimant deleted their account), moved, or is no longer pending is `not_pending`: never a release.
create function public.admin_resolve_claim(p_claim_id uuid, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_house uuid; h public.houses%rowtype; c public.house_claims%rowtype; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select house_id into v_house from public.house_claims where id = p_claim_id;
  if not found then
    if private.is_admin(null) then raise exception 'not_found' using errcode = 'P0002';
    else raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  select * into h from public.houses where id = v_house for update;
  if not found then
    if private.is_admin(null) then raise exception 'not_pending' using errcode = '22023';
    else raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  if not private.is_admin(h.region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from public.house_claims where id = p_claim_id for update;
  if not found or c.house_id is distinct from v_house or c.status is distinct from 'pending' then
    raise exception 'not_pending' using errcode = '22023'; end if;
  if p_approve is null then raise exception 'invalid_input' using errcode = '22023', detail = 'approve'; end if;
  if v_reason is not null and char_length(v_reason) > 200 then
    raise exception 'invalid_input' using errcode = '22023', detail = 'reason'; end if;
  if not p_approve then
    update public.house_claims set status = 'rejected', reason = v_reason, resolved_by = auth.uid(), resolved_at = now()
     where id = c.id;
    return;
  end if;
  if h.status = 'released' then raise exception 'house_released' using errcode = '22023'; end if;
  update public.house_claims set status = 'approved', reason = v_reason, resolved_by = auth.uid(), resolved_at = now()
   where id = c.id;
  if c.kind = 'claim' then
    -- B5: approval replaces any current owner; the old owner's pending removal request is closed.
    update public.house_claims set status = 'rejected', reason = 'owner_changed', resolved_by = auth.uid(), resolved_at = now()
     where house_id = h.id and kind = 'removal' and status = 'pending';
    update public.houses set owner_id = c.user_id, owner_since = now() where id = h.id;
  elsif c.kind = 'removal' then
    perform private.release_house_core(h.id, auth.uid());
  else
    raise exception 'invalid_input' using errcode = '22023', detail = 'kind';   -- fail closed on anything else
  end if;
end $$;

create function public.admin_clear_owner(p_house_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare h public.houses%rowtype;
begin
  select * into h from public.houses where id = p_house_id for update;
  if not found then
    if private.is_admin(null) then raise exception 'not_found' using errcode = 'P0002';
    else raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  if not private.is_admin(h.region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.house_claims set status = 'rejected', reason = 'owner_cleared', resolved_by = auth.uid(), resolved_at = now()
   where house_id = h.id and kind = 'removal' and status = 'pending';
  update public.houses set owner_id = null, owner_since = null where id = h.id and owner_id is not null;
end $$;

create function public.admin_subscriber_counts(p_region_id uuid)
returns table (active integer, stopped integer, daily integer, weekly integer, houses integer, events integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.is_admin(p_region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select count(*) filter (where s.status = 'active')::integer,
           count(*) filter (where s.status = 'stopped')::integer,
           count(*) filter (where s.status = 'active' and s.cadence = 'daily')::integer,
           count(*) filter (where s.status = 'active' and s.cadence = 'weekly')::integer,
           count(*) filter (where s.status = 'active' and s.houses)::integer,
           count(*) filter (where s.status = 'active' and s.events)::integer
      from public.subscriptions s where s.region_id = p_region_id;
end $$;

-- Admin Overview: digest emails today against app_settings.digest_daily_cap. Digest mail only (sign-in mail is not in
-- this table and is not counted). Global numbers (the cap is global); any aal2 admin (of any region) may read.
create function public.admin_digest_today()
returns table (sent integer, failed integer, cap integer, cap_hit boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_day timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  if not exists (select 1 from public.admins a where a.user_id = auth.uid() and private.is_admin(a.region_id)) then
    raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select (select count(*) from private.digest_sends d where d.status = 'sent' and d.sent_at >= v_day)::integer,
           (select count(*) from private.digest_sends d where d.status = 'failed' and d.updated_at >= v_day)::integer,
           (select a.digest_daily_cap::integer from public.app_settings a),
           exists (select 1 from private.digest_runs r where r.cap_hit and r.started_at >= v_day);
end $$;

create function public.admin_set_subscribe_open(p_region_id uuid, p_open boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin(p_region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_open is null then raise exception 'invalid_input' using errcode = '22023', detail = 'open'; end if;
  update public.site_settings set subscribe_open = p_open, updated_at = now(), updated_by = auth.uid()
   where region_id = p_region_id;
  if not found then raise exception 'region_not_found' using errcode = 'P0002'; end if;
end $$;

-- ---------------------------------------------------------------- service routines (C2: service_role only)
-- Called by the send-digest / unsubscribe / delete-account Edge Functions with the service-role key. The functions
-- log counts and ids only; these routines return an email address only to send-digest (the recipient).

-- Start (or resume) the run for (kind, Pacific date). A rerun of the same day returns the same run and window.
create function public.svc_digest_start(p_kind text, p_run_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_date date := coalesce(p_run_date, (now() at time zone 'America/Los_Angeles')::date); v_id uuid;
begin
  if p_kind is null or p_kind not in ('daily', 'weekly') then
    raise exception 'invalid_input' using errcode = '22023', detail = 'kind'; end if;
  insert into private.digest_runs (kind, run_date) values (p_kind, v_date) on conflict (kind, run_date) do nothing
  returning run_id into v_id;
  if v_id is null then
    select run_id into v_id from private.digest_runs where kind = p_kind and run_date = v_date;
    update private.digest_runs set finished_at = null where run_id = v_id;
  end if;
  return v_id;
end $$;

-- Claim up to p_limit (max 100, and never past the daily cap) recipients and return their content, marked `sending`.
--  * Resume first: a user's unresolved `sending` row from ANY run whose last touch is over 5 minutes old (a crash, an
--    ambiguous provider outcome, or a worker that ran out of time) is handed out again with ITS run id, ITS stored
--    idempotency key and ITS window, so the payload and the key are identical and Resend dedupes it (24 h window).
--    While such a row exists the user gets nothing new. A resumed row whose window no longer has content is closed as
--    failed (no_content) instead.
--  * Then new rows for this run's kind: no row yet in this run, something new in (last_sent_through, window_to]. The
--    key is digest:<public_id>:<last_sent_through ISO>, stored on the row.
--  * Cap: one advisory lock per UTC day serializes the read-count-claim across daily and weekly batches.
create function public.svc_digest_batch(p_run_id uuid, p_limit integer)
returns table (run_id uuid, user_id uuid, email text, idempotency_key text, window_to timestamptz,
               public_id uuid, token_version integer,
               region_slug text, region_name text, timezone text, cadence text,
               houses jsonb, house_total integer, events jsonb, event_total integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_run private.digest_runs%rowtype;
  v_day timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v_room integer; v_n integer := 0; c record; v_key text;
begin
  select * into v_run from private.digest_runs r where r.run_id = p_run_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('digest_cap:' || to_char(v_day at time zone 'UTC', 'YYYY-MM-DD'), 0));
  select greatest(0, least(coalesce(p_limit, 100), 100,
           a.digest_daily_cap - (select count(*) from private.digest_sends d
                                  where (d.status = 'sent' and d.sent_at >= v_day)
                                     or (d.status = 'sending' and d.updated_at >= v_day))))::integer
    into v_room from public.app_settings a;
  for c in
    select s.user_id, u.email::text as email, s.public_id, s.token_version, r.slug, r.name, r.timezone, s.cadence,
           coalesce(s.last_sent_through, s.confirmed_at) as w_from,
           p.run_id as p_run, p.idempotency_key as p_key, coalesce(p.window_to, v_run.window_to) as w_to,
           hs.items as h_items, hs.total as h_total, ev.items as e_items, ev.total as e_total
      from public.subscriptions s
      join auth.users u on u.id = s.user_id
      join public.regions r on r.id = s.region_id
      join public.site_settings ss on ss.region_id = s.region_id
      left join lateral (
        select d.run_id, d.idempotency_key, d.window_to, d.updated_at from private.digest_sends d
         where d.user_id = s.user_id and d.status = 'sending'
         order by d.created_at limit 1
      ) p on true
      cross join lateral (
        select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'address', x.address) order by x.created_at desc, x.id)
                        filter (where x.rn <= 10), '[]'::jsonb) as items, count(*)::integer as total
          from (select h.id, h.address, h.created_at, row_number() over (order by h.created_at desc, h.id) as rn
                  from public.houses h
                 where s.houses and h.region_id = s.region_id and h.season = ss.active_season and h.year = ss.active_year
                   and h.status = 'visible' and h.created_at > s.last_sent_through
                   and h.created_at <= coalesce(p.window_to, v_run.window_to)) x
      ) hs
      cross join lateral (
        select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'starts_at', x.starts_at, 'venue', x.venue)
                                  order by x.starts_at, x.id) filter (where x.rn <= 10), '[]'::jsonb) as items,
               count(*)::integer as total
          from (select e.id, e.title, e.starts_at, e.venue, row_number() over (order by e.starts_at, e.id) as rn
                  from public.events e
                 where s.events and e.region_id = s.region_id and e.season = ss.active_season and e.year = ss.active_year
                   and e.status = 'approved' and e.approved_at > s.last_sent_through
                   and e.approved_at <= coalesce(p.window_to, v_run.window_to)
                   -- "still upcoming" is judged at the window's end, not now(), so a resumed send renders the same email
                   and coalesce(e.ends_at, e.starts_at + interval '3 hours') > coalesce(p.window_to, v_run.window_to)) x
      ) ev
     where s.status = 'active' and r.is_active
       and u.email is not null and u.email_confirmed_at is not null
       and case when p.run_id is not null
                then p.updated_at <= now() - interval '5 minutes'                     -- resume a stale unresolved send
                else s.cadence = v_run.kind and (hs.total > 0 or ev.total > 0)
                     and not exists (select 1 from private.digest_sends d
                                      where d.run_id = p_run_id and d.user_id = s.user_id) end
     order by (p.run_id is null), s.last_sent_through, s.user_id
     for update of s skip locked
  loop
    if c.p_run is not null and c.h_total = 0 and c.e_total = 0 then
      update private.digest_sends d set status = 'failed', error_code = 'no_content', updated_at = now()
       where d.run_id = c.p_run and d.user_id = c.user_id and d.status = 'sending';
      update private.digest_runs r set failed = r.failed + 1 where r.run_id = c.p_run;
      continue;
    end if;
    if v_n >= v_room then
      update private.digest_runs r set cap_hit = true where r.run_id = p_run_id;
      exit;
    end if;
    if c.p_run is not null then
      update private.digest_sends d set attempts = d.attempts + 1, updated_at = now()
       where d.run_id = c.p_run and d.user_id = c.user_id and d.status = 'sending';
      run_id := c.p_run; idempotency_key := c.p_key;
    else
      v_key := 'digest:' || c.public_id::text || ':'
               || to_char(c.w_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
      insert into private.digest_sends (run_id, user_id, status, idempotency_key, window_from, window_to)
      values (p_run_id, c.user_id, 'sending', v_key, c.w_from, v_run.window_to);
      run_id := p_run_id; idempotency_key := v_key;
    end if;
    v_n := v_n + 1;
    user_id := c.user_id; email := c.email; window_to := c.w_to;
    public_id := c.public_id; token_version := c.token_version; region_slug := c.slug; region_name := c.name;
    timezone := c.timezone; cadence := c.cadence; houses := c.h_items; house_total := c.h_total;
    events := c.e_items; event_total := c.e_total;
    return next;
  end loop;
end $$;

-- After a DEFINITE provider outcome. ok -> 'sent' and last_sent_through advances to the row's window; else 'failed'
-- with a short code. An ambiguous outcome (timeout, network error, 5xx) is never marked: the row stays `sending` and is
-- resumed with the same key. Only a 'sending' row changes, so a repeated mark is a no-op (returns false). p_run_id is
-- the row's run (svc_digest_batch returns it; a resumed row can belong to an earlier run).
create function public.svc_digest_mark(p_run_id uuid, p_user_id uuid, p_ok boolean, p_error_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_to timestamptz;
  v_code text := case when coalesce(p_error_code, '') ~ '^[a-z0-9_]{1,40}$' then p_error_code else 'error' end;
begin
  if p_ok is null then raise exception 'invalid_input' using errcode = '22023', detail = 'ok'; end if;
  update private.digest_sends
     set status = case when p_ok then 'sent' else 'failed' end,
         sent_at = case when p_ok then now() end,
         error_code = case when p_ok then null else v_code end,
         updated_at = now()
   where run_id = p_run_id and user_id = p_user_id and status = 'sending'
  returning window_to into v_to;
  if not found then return false; end if;
  if p_ok then
    update public.subscriptions set last_sent_through = greatest(last_sent_through, v_to) where user_id = p_user_id;
    update private.digest_runs set sent = sent + 1 where run_id = p_run_id;
  else
    update private.digest_runs set failed = failed + 1 where run_id = p_run_id;
  end if;
  return true;
end $$;

create function public.svc_digest_finish(p_run_id uuid) returns table (sent integer, failed integer, cap_hit boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
    update private.digest_runs r set finished_at = now() where r.run_id = p_run_id
    returning r.sent, r.failed, r.cap_hit;
end $$;

-- B8: link tokens carry (public_id, token_version); the HMAC is verified by the Edge Function before these run.
create function public.svc_unsubscribe_lookup(p_public_id uuid, p_version integer)
returns table (status text, houses boolean, events boolean, cadence text, region_name text)
language sql stable security definer set search_path = '' as $$
  select s.status, s.houses, s.events, s.cadence, r.name
    from public.subscriptions s join public.regions r on r.id = s.region_id
   where s.public_id = p_public_id and s.token_version = p_version
$$;

-- POST only (a GET never calls this). 'stopped', 'already_stopped' (a provider retry of the same one-click POST, or a
-- second tap), or 'invalid' (unknown id, or a version bumped by a resubscribe). Stopping does NOT bump token_version,
-- so retries stay recognisable; a resubscribe bumps it and kills every older link.
create function public.svc_unsubscribe_stop(p_public_id uuid, p_version integer) returns text
language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.subscriptions
   where public_id = p_public_id and token_version = p_version for update;
  if not found then return 'invalid'; end if;
  if v_status = 'stopped' then return 'already_stopped'; end if;
  update public.subscriptions set status = 'stopped', stopped_at = now(), updated_at = now()
   where public_id = p_public_id and token_version = p_version and status = 'active';
  return 'stopped';
end $$;

-- prefs tokens: change topics/cadence of an active subscription without signing in. 'updated' or 'invalid'.
create function public.svc_unsubscribe_set_prefs(p_public_id uuid, p_version integer, p_houses boolean,
                                                 p_events boolean, p_cadence text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if p_houses is null or p_events is null or not (p_houses or p_events) then
    raise exception 'invalid_input' using errcode = '22023', detail = 'topics'; end if;
  if p_cadence is null or p_cadence not in ('daily', 'weekly') then
    raise exception 'invalid_input' using errcode = '22023', detail = 'cadence'; end if;
  update public.subscriptions set houses = p_houses, events = p_events, cadence = p_cadence, updated_at = now()
   where public_id = p_public_id and token_version = p_version and status = 'active';
  return case when found then 'updated' else 'invalid' end;
end $$;

-- B7/C4 account deletion, in this order (the delete-account Edge Function):
--   1. svc_delete_account_check(uid): read-only. 'forbidden' for anyone in public.admins (admins are refused BEFORE
--      anything changes; their admins row would otherwise cascade away), 'gone' when the auth user no longer exists
--      (a retry after step 2 succeeded), else 'ok'.
--   2. auth.admin.deleteUser(uid). This is the atomic cascade point: the FKs delete the subscription, claims, digest
--      rows and house links (on delete cascade) and unown houses (owner_id on delete set null; the owner_since trigger
--      clears owner_since). If it fails, nothing has changed.
--   3. svc_delete_account(uid): idempotent cleanup of anything not covered by an FK (today: nothing, but it re-checks
--      every table). It refuses to run while the auth user still exists, so it can never strip a live account.
create function public.svc_delete_account_check(p_user_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_user_id is null then 'invalid'
              when exists (select 1 from public.admins a where a.user_id = p_user_id) then 'forbidden'
              when not exists (select 1 from auth.users u where u.id = p_user_id) then 'gone'
              else 'ok' end
$$;

create function public.svc_delete_account(p_user_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if p_user_id is null then raise exception 'invalid_input' using errcode = '22023', detail = 'user'; end if;
  if exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'invalid_input' using errcode = '22023', detail = 'user_exists'; end if;
  update public.houses h set owner_id = null, owner_since = null
   where h.id in (select x.id from public.houses x where x.owner_id = p_user_id order by x.id for update);
  get diagnostics v_n = row_count;
  delete from public.house_claims where user_id = p_user_id;
  delete from public.subscriptions where user_id = p_user_id;
  delete from private.digest_sends where user_id = p_user_id;
  delete from private.house_links where anon_uid = p_user_id or used_by = p_user_id;
  return v_n;
end $$;

-- Retention: links after a day, digest bookkeeping after 60 days, resolved claims after 180 days.
create function private.sweep_subscribe() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer; v_t integer := 0;
begin
  delete from private.house_links where created_at < now() - interval '1 day';
  get diagnostics v_n = row_count; v_t := v_t + v_n;
  delete from private.digest_runs where started_at < now() - interval '60 days';
  get diagnostics v_n = row_count; v_t := v_t + v_n;
  delete from public.house_claims where status <> 'pending' and resolved_at < now() - interval '180 days';
  get diagnostics v_n = row_count; v_t := v_t + v_n;
  return v_t;
end $$;

-- ---------------------------------------------------------------- region context (same signature)
create or replace function public.get_region_context(p_slug text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'region', jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name,
       'min_lat', r.min_lat, 'max_lat', r.max_lat, 'min_lng', r.min_lng, 'max_lng', r.max_lng,
       'center_lat', r.center_lat, 'center_lng', r.center_lng, 'default_zoom', r.default_zoom,
       'timezone', r.timezone, 'country_code', r.country_code),
    'season', s.active_season, 'year', s.active_year, 'submissions_open', s.submissions_open,
    'photos_open', s.photos_open, 'votes_open', s.votes_open,
    'events', jsonb_build_object('open', s.events_open),
    'subscribe', jsonb_build_object('open', s.subscribe_open),
    'wordmark', coalesce(b.wordmark, r.name))
  from public.regions r
  join public.site_settings s on s.region_id = r.id
  left join public.region_brands b on b.region_id = r.id and b.season = s.active_season
  where r.is_active
    and r.slug = coalesce(p_slug, (select r2.slug from public.app_settings a
                                   join public.regions r2 on r2.id = a.default_region_id))
$$;

-- ---------------------------------------------------------------- EXECUTE: deny all, then the exact allowlist
revoke execute on all functions in schema public  from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
-- R2's list, verbatim
grant execute on function public.get_region_context(text) to anon, authenticated;
grant execute on function public.submit_house(text, text, text, double precision, double precision) to authenticated;
grant execute on function public.admin_whoami(uuid) to authenticated;
grant execute on function public.admin_set_season(uuid, text, integer, boolean) to authenticated;
grant execute on function public.admin_list_houses(uuid, text, text) to authenticated;
grant execute on function public.admin_set_house_status(uuid, text, text) to authenticated;
grant execute on function public.admin_release_house(uuid) to authenticated;
grant execute on function public.reserve_photo(uuid) to authenticated;
grant execute on function public.confirm_photo_upload(uuid) to authenticated;
grant execute on function public.admin_set_photos_open(uuid, boolean) to authenticated;
grant execute on function public.admin_photo_queue(uuid, text) to authenticated;
grant execute on function public.admin_approve_photo(uuid, text) to authenticated;
grant execute on function public.admin_reject_photo(uuid) to authenticated;
grant execute on function public.admin_revoke_photo(uuid) to authenticated;
grant execute on function public.admin_storage_jobs(uuid) to authenticated;
grant execute on function public.admin_complete_storage_job(bigint) to authenticated;
grant execute on function private.photo_upload_allowed(text)   to authenticated;
grant execute on function private.storage_admin_ok(text, text) to authenticated;
-- public.photo_sign_paths(uuid) stays service_role only (granted in 20261010000200).
-- Votes (20261012000100), verbatim
grant execute on function public.get_house_photo_counts(uuid) to anon, authenticated;
grant execute on function public.network_probe(text) to anon, authenticated;
grant execute on function public.vote_house(uuid, uuid) to authenticated;
grant execute on function public.my_vote_status(uuid) to authenticated;
grant execute on function public.admin_set_votes_open(uuid, boolean) to authenticated;
grant execute on function public.admin_set_network_cap(boolean) to authenticated;
grant execute on function public.admin_network_cap_status() to authenticated;
grant execute on function public.admin_vote_stats(uuid) to authenticated;
grant execute on function public.admin_void_votes(uuid, timestamp with time zone, uuid) to authenticated;
-- Events (20261013000100), verbatim
grant execute on function public.submit_event(text, text, text, text, text, text, double precision, double precision,
                                              timestamptz, timestamptz, text, boolean) to authenticated;
grant execute on function public.admin_event_queue(uuid, text) to authenticated;
grant execute on function public.admin_event_counts(uuid) to authenticated;
grant execute on function public.admin_moderate_event(uuid, text, text) to authenticated;
grant execute on function public.admin_update_event(uuid, text, text, text, text, text, double precision,
                                                    double precision, timestamptz, timestamptz, text, boolean) to authenticated;
grant execute on function public.admin_create_event(uuid, text, text, text, text, text, double precision,
                                                    double precision, timestamptz, timestamptz, text, boolean, text) to authenticated;
grant execute on function public.admin_set_events_open(uuid, boolean) to authenticated;
-- Subscribe + Accounts. Each RPC checks its caller inside (account_uid, anonymous-only, owner, is_admin).
grant execute on function public.set_subscription(text, boolean, boolean, text) to authenticated;
grant execute on function public.stop_subscription() to authenticated;
grant execute on function public.my_account() to authenticated;
grant execute on function public.claim_my_submissions() to authenticated;
grant execute on function public.begin_house_link(text) to authenticated;
grant execute on function public.complete_house_link() to authenticated;
grant execute on function public.request_house_claim(uuid, text) to authenticated;
grant execute on function public.request_house_removal(uuid, text) to authenticated;
grant execute on function public.withdraw_house_claim(uuid) to authenticated;
grant execute on function public.owner_set_house_visibility(uuid, boolean) to authenticated;
grant execute on function public.admin_claim_queue(uuid, text) to authenticated;
grant execute on function public.admin_resolve_claim(uuid, boolean, text) to authenticated;
grant execute on function public.admin_clear_owner(uuid) to authenticated;
grant execute on function public.admin_subscriber_counts(uuid) to authenticated;
grant execute on function public.admin_digest_today() to authenticated;
grant execute on function public.admin_set_subscribe_open(uuid, boolean) to authenticated;
-- C2: service routines, service_role only.
grant execute on function public.svc_digest_start(text, date) to service_role;
grant execute on function public.svc_digest_batch(uuid, integer) to service_role;
grant execute on function public.svc_digest_mark(uuid, uuid, boolean, text) to service_role;
grant execute on function public.svc_digest_finish(uuid) to service_role;
grant execute on function public.svc_unsubscribe_lookup(uuid, integer) to service_role;
grant execute on function public.svc_unsubscribe_stop(uuid, integer) to service_role;
grant execute on function public.svc_unsubscribe_set_prefs(uuid, integer, boolean, boolean, text) to service_role;
grant execute on function public.svc_delete_account_check(uuid) to service_role;
grant execute on function public.svc_delete_account(uuid) to service_role;

select cron.schedule('tl-sweep-subscribe', '23 4 * * *', $$select private.sweep_subscribe()$$);
