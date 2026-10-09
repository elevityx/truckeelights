-- Events v1 (Spec_Events + Amendment 1): community-submitted seasonal events, admin moderation, and the
-- events_open switch. Same patterns as houses/photos: FORCE RLS, column grants, no write grants, every write
-- through a security definer RPC with search_path = '', exact EXECUTE allowlist.
-- Applies after 20261012000100_house_votes: get_region_context keeps votes_open, and the EXECUTE block keeps the
-- votes grants (01_acl.test.sql asserts the exact allowlist).

create type public.event_status as enum ('pending', 'approved', 'rejected', 'hidden');

-- A1: gates submissions only (fail-closed). Reading approved events does not depend on it.
alter table public.site_settings add column events_open boolean not null default false;
grant select (events_open) on public.site_settings to anon, authenticated;

alter table private.quota_events drop constraint quota_events_kind_check;
alter table private.quota_events add constraint quota_events_kind_check
  check (kind in ('house', 'photo_reserve', 'photo_confirm', 'event'));

create table public.events (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions(id) on delete restrict,
  season public.season_kind not null,
  year smallint not null check (year between 2024 and 2100),
  title text not null check (char_length(title) between 3 and 80 and title !~ '[<>]'),
  normalized_title text not null,                         -- trigger: lowercase, [a-z0-9 ] only, spaces collapsed
  description text not null check (char_length(description) between 10 and 600 and description !~ '[<>]'),
  venue text check (venue is null or (char_length(venue) between 1 and 80 and venue !~ '[<>]')),
  address text not null check (char_length(address) between 5 and 120),
  place_id text check (place_id ~ '^[A-Za-z0-9_-]+$' and char_length(place_id) between 10 and 300),
  lat double precision not null,
  lng double precision not null,
  starts_at timestamptz not null,
  ends_at timestamptz check (ends_at is null or (ends_at > starts_at and ends_at <= starts_at + interval '31 days')),
  start_day date not null,                                -- trigger: starts_at in the region's timezone
  -- A6 backstop for raw SQL seeds; the RPCs use private.valid_event_url (stricter).
  url text check (url is null or (char_length(url) <= 300 and url ~ '^https://[^\s@\\]+$')),
  adults_only boolean not null default false,
  status public.event_status not null default 'pending',
  source text not null default 'community' check (source in ('community', 'seed')),
  source_url text check (source_url is null or (char_length(source_url) <= 300 and source_url ~ '^https://[^\s@\\]+$')),
  reject_reason text check (reject_reason is null or char_length(reject_reason) <= 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  moderated_by uuid references auth.users(id) on delete set null,
  moderated_at timestamptz,
  updated_at timestamptz not null default now()
);
create index events_public_idx     on public.events (region_id, season, year, status, starts_at);
create index events_created_by_idx on public.events (created_by, created_at);
-- A2: dedupe on the exact start instant; a rejection frees the slot.
create unique index events_dedupe_idx on public.events (region_id, season, year, normalized_title, starts_at)
  where status <> 'rejected';
create index events_same_day_idx   on public.events (region_id, season, year, normalized_title, start_day);

alter table public.events enable row level security;
alter table public.events force row level security;
revoke all on public.events from anon, authenticated;
-- Public columns only. Not granted: source, source_url, created_by, moderation fields, reject_reason, derived columns.
grant select (id, region_id, season, year, title, description, venue, address, lat, lng,
              starts_at, ends_at, url, adults_only) on public.events to anon, authenticated;
-- Approved, active season pair, active region, not ended (ends_at, or 3 h after the start, plus 1 h grace).
create policy events_public_read on public.events for select to anon, authenticated
  using (status = 'approved'
     and coalesce(ends_at, starts_at + interval '3 hours') > now() - interval '1 hour'
     and exists (select 1 from public.site_settings s join public.regions r on r.id = s.region_id
                  where s.region_id = events.region_id and r.is_active
                    and s.active_season = events.season and s.active_year = events.year));

-- ---------------------------------------------------------------- helpers (private, no grants)
create function private.normalize_event_title(p text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9 ]', '', 'g'), ' +', ' ', 'g'))
$$;

-- Whole-word match against private.blocked_terms on a lowercased, punctuation-free copy.
create function private.has_blocked_term(p text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from private.blocked_terms t
                  where regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g') ~ ('\m' || t.term || '\M'))
$$;

-- A3: the region bbox + 0.05 deg on every side, east edge + 0.10 deg (Sand Harbor, Incline; not Reno).
-- Mirrored in TS by eventBounds() in src/lib/data/events.ts.
create function private.event_bounds(p_region_id uuid)
returns table (min_lat double precision, max_lat double precision, min_lng double precision, max_lng double precision)
language sql stable set search_path = '' as $$
  select r.min_lat - 0.05, r.max_lat + 0.05, r.min_lng - 0.05, r.max_lng + 0.10
    from public.regions r where r.id = p_region_id
$$;

-- BETWEEN, so NaN, Infinity and null all fail.
create function private.in_event_bounds(p_region_id uuid, p_lat double precision, p_lng double precision) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select p_lat between b.min_lat and b.max_lat and p_lng between b.min_lng and b.max_lng
                     from private.event_bounds(p_region_id) b), false)
$$;

-- A3: venue-friendly address check (no house-number requirement). validate_address / assert_street_level unchanged.
create function private.validate_event_address(p text) returns void
language plpgsql stable set search_path = '' as $$
declare v text := btrim(coalesce(p, ''));
begin
  if char_length(v) < 5 or char_length(v) > 120
     or v !~ '^[A-Za-z0-9 ,.#''/-]+$'
     or private.normalize_address(v) ~ '(address not found|unknown address|not a real|^\d+[a-z]? (unknown|none|test|n/?a)$)'
     or private.has_blocked_term(v) then
    raise exception 'invalid_input' using errcode = '22023', detail = 'address';
  end if;
end $$;

-- A6: the one URL validator for url and source_url in every write path.
create function private.valid_event_url(p text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_host text;
begin
  if p is null or char_length(p) > 300 or left(p, 8) <> 'https://' then return false; end if;
  -- userinfo, backslash, whitespace/control, quotes and angle brackets anywhere
  if p ~ '[@\\[:space:][:cntrl:]"''<>`]' then return false; end if;
  v_host := lower(substring(p from 9 for char_length(p)));
  v_host := split_part(split_part(split_part(v_host, '/', 1), '?', 1), '#', 1);
  -- explicit port and IPv6 literals ([..] / ':'), then DNS labels with a letters-only TLD. The TLD rule also
  -- rejects every IPv4 notation (dotted, decimal, hex, octal), single-label hosts and a trailing dot.
  if v_host ~ '[:\[\]]' then return false; end if;
  if v_host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then return false; end if;
  if v_host = 'localhost' or v_host like '%.localhost' then return false; end if;
  if exists (select 1 from unnest(array['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly',
                                        'rebrand.ly']) s
              where v_host = s or v_host like '%.' || s) then
    return false;
  end if;
  return true;
end $$;

-- Validates and cleans every event field (errors: invalid_input with detail = field name, then out_of_bounds).
-- p_admin skips the starts_at lower bound (admins can fix past typos).
create function private.clean_event(
  p_region_id uuid, p_title text, p_description text, p_venue text, p_address text, p_place_id text,
  p_lat double precision, p_lng double precision, p_starts_at timestamptz, p_ends_at timestamptz,
  p_url text, p_adults_only boolean, p_admin boolean,
  out title text, out description text, out venue text, out address text, out place_id text, out url text)
language plpgsql stable set search_path = '' as $$
declare v_nl integer;
begin
  title := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  -- needs a letter or digit, so the dedupe key (normalized_title) is never empty
  if char_length(title) not between 3 and 80 or title ~ '[<>[:cntrl:]]' or private.has_blocked_term(title)
     or private.normalize_event_title(title) !~ '[a-z0-9]' then
    raise exception 'invalid_input' using errcode = '22023', detail = 'title'; end if;

  description := replace(replace(replace(coalesce(p_description, ''), E'\r\n', E'\n'), E'\r', E'\n'), E'\t', ' ');
  description := regexp_replace(regexp_replace(description, '^\s+|\s+$', '', 'g'), ' {2,}', ' ', 'g');
  v_nl := char_length(description) - char_length(replace(description, E'\n', ''));
  if char_length(description) not between 10 and 600 or v_nl > 6
     or description ~ '[<>]' or description ~ '[\x01-\x09\x0b-\x1f\x7f]'
     or private.has_blocked_term(description) then
    raise exception 'invalid_input' using errcode = '22023', detail = 'description'; end if;

  venue := nullif(btrim(regexp_replace(coalesce(p_venue, ''), '\s+', ' ', 'g')), '');
  if venue is not null and (char_length(venue) > 80 or venue ~ '[<>[:cntrl:]]' or private.has_blocked_term(venue)) then
    raise exception 'invalid_input' using errcode = '22023', detail = 'venue'; end if;

  address := btrim(regexp_replace(coalesce(p_address, ''), '\s+', ' ', 'g'));
  perform private.validate_event_address(address);

  place_id := nullif(btrim(coalesce(p_place_id, '')), '');
  if place_id is not null and (place_id !~ '^[A-Za-z0-9_-]+$' or char_length(place_id) not between 10 and 300) then
    raise exception 'invalid_input' using errcode = '22023', detail = 'place_id'; end if;

  if p_lat is null or p_lng is null then
    raise exception 'invalid_input' using errcode = '22023', detail = 'coordinates'; end if;

  if p_starts_at is null or p_starts_at = 'infinity'::timestamptz or p_starts_at = '-infinity'::timestamptz
     or (not p_admin and p_starts_at < now() - interval '1 hour')
     or p_starts_at > now() + interval '120 days' then
    raise exception 'invalid_input' using errcode = '22023', detail = 'starts_at'; end if;
  if p_ends_at is not null and (p_ends_at <= p_starts_at or p_ends_at > p_starts_at + interval '31 days') then
    raise exception 'invalid_input' using errcode = '22023', detail = 'ends_at'; end if;

  url := nullif(btrim(coalesce(p_url, '')), '');
  if url is not null and not private.valid_event_url(url) then
    raise exception 'invalid_input' using errcode = '22023', detail = 'url'; end if;

  if p_adults_only is null then
    raise exception 'invalid_input' using errcode = '22023', detail = 'adults_only'; end if;

  if not private.in_event_bounds(p_region_id, p_lat, p_lng) then
    raise exception 'out_of_bounds' using errcode = '22023'; end if;
end $$;

-- Derived columns and the bounds backstop for every write (RPC or raw SQL seed).
create function private.events_before_write() returns trigger
language plpgsql set search_path = '' as $$
declare v_tz text;
begin
  select r.timezone into v_tz from public.regions r where r.id = new.region_id;
  if not found then raise exception 'region_not_found' using errcode = '23503'; end if;
  if not private.in_event_bounds(new.region_id, new.lat, new.lng) then
    raise exception 'out_of_bounds' using errcode = '23514'; end if;
  new.normalized_title := private.normalize_event_title(new.title);
  new.start_day := (new.starts_at at time zone v_tz)::date;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;
create trigger events_before_write before insert or update on public.events
  for each row execute function private.events_before_write();

-- Row RPCs: lock the row, derive its region; a missing row is not_found only for a global admin (photo pattern).
create function private.admin_lock_event(p_event_id uuid) returns public.events
language plpgsql set search_path = '' as $$
declare e public.events%rowtype;
begin
  select * into e from public.events where id = p_event_id for update;
  if not found then
    if private.is_admin(null) then raise exception 'not_found' using errcode = 'P0002';
    else raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  if not private.is_admin(e.region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return e;
end $$;

-- take_quota: re-created from the R2 body (20261010000400), plus the A5 event branch.
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
  else
    raise exception 'invalid_input' using errcode = '22023', detail = 'quota_kind';
  end if;
  insert into private.quota_events (kind, uid, region_id, house_id) values (p_kind, v_uid, p_region_id, p_house_id);
end $$;

-- ---------------------------------------------------------------- visitor RPC
-- Same order as submit_house: session, region, switch, fields, bounds, locks, dedupe, stock cap, quota, insert.
create function public.submit_event(p_region_slug text, p_title text, p_description text, p_venue text,
                                    p_address text, p_place_id text, p_lat double precision, p_lng double precision,
                                    p_starts_at timestamptz, p_ends_at timestamptz, p_url text, p_adults_only boolean)
returns table (result text, event_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_region public.regions%rowtype;
  v_set public.site_settings%rowtype;
  c record;
  v_norm text;
  v_hit_id uuid;
  v_hit_status public.event_status;
  v_n integer;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  select * into v_region from public.regions where slug = p_region_slug and is_active;
  if not found then raise exception 'region_not_found' using errcode = 'P0002'; end if;
  select * into v_set from public.site_settings where region_id = v_region.id;
  if not found or not v_set.events_open then raise exception 'submissions_closed' using errcode = 'P0001'; end if;
  select * into c from private.clean_event(v_region.id, p_title, p_description, p_venue, p_address, p_place_id,
                                           p_lat, p_lng, p_starts_at, p_ends_at, p_url, p_adults_only, false);
  v_norm := private.normalize_event_title(c.title);

  -- uid -> region locks first: every submit in a region serializes, so the dedupe and cap reads are exact.
  perform private.lock_quota('event', v_region.id);
  select e.id, e.status into v_hit_id, v_hit_status from public.events e
   where e.region_id = v_region.id and e.season = v_set.active_season and e.year = v_set.active_year
     and e.normalized_title = v_norm and e.starts_at = p_starts_at and e.status <> 'rejected'
   limit 1;
  if found then                                            -- duplicates never consume quota
    return query select 'exists'::text, case when v_hit_status = 'approved' then v_hit_id end;
    return;
  end if;
  -- A5: pending stock cap (active pair, so a season switch cannot strand it), checked under the region lock.
  select count(*) into v_n from public.events e
   where e.region_id = v_region.id and e.season = v_set.active_season and e.year = v_set.active_year
     and e.status = 'pending';
  if v_n >= 40 then raise exception 'queue_full' using errcode = 'P0001'; end if;

  perform private.take_quota('event', v_region.id, null);

  begin
    insert into public.events (region_id, season, year, title, description, venue, address, place_id, lat, lng,
                               starts_at, ends_at, url, adults_only, created_by)
    values (v_region.id, v_set.active_season, v_set.active_year, c.title, c.description, c.venue, c.address,
            c.place_id, p_lat, p_lng, p_starts_at, p_ends_at, c.url, p_adults_only, v_uid)
    returning id into v_id;
  exception when unique_violation then                      -- backstop; unreachable under the region lock
    select e.id, e.status into v_hit_id, v_hit_status from public.events e
     where e.region_id = v_region.id and e.season = v_set.active_season and e.year = v_set.active_year
       and e.normalized_title = v_norm and e.starts_at = p_starts_at and e.status <> 'rejected'
     limit 1;
    return query select 'exists'::text, case when v_hit_status = 'approved' then v_hit_id end;
    return;
  end;
  return query select 'created'::text, v_id;
end $$;

-- ---------------------------------------------------------------- admin RPCs (AAL2 admin of the row's region)
create function public.admin_event_queue(p_region_id uuid, p_status text)
returns table (id uuid, title text, description text, venue text, address text, lat double precision,
               lng double precision, starts_at timestamptz, ends_at timestamptz, url text, adults_only boolean,
               status text, source text, source_url text, reject_reason text, created_at timestamptz,
               same_day_warning boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.is_admin(p_region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('pending', 'approved', 'rejected', 'hidden') then
    raise exception 'invalid_input' using errcode = '22023', detail = 'status'; end if;
  return query
    select e.id, e.title, e.description, e.venue, e.address, e.lat, e.lng, e.starts_at, e.ends_at, e.url,
           e.adults_only, e.status::text, e.source, e.source_url, e.reject_reason, e.created_at,
           -- A2: same normalized title on the same local day (another row, not rejected) -> admin warning only
           exists (select 1 from public.events o
                    where o.id <> e.id and o.region_id = e.region_id and o.season = e.season and o.year = e.year
                      and o.normalized_title = e.normalized_title and o.start_day = e.start_day
                      and o.status <> 'rejected')
      from public.events e
      join public.site_settings s on s.region_id = e.region_id
     where e.region_id = p_region_id and e.season = s.active_season and e.year = s.active_year
       and e.status = p_status::public.event_status
     order by (e.status = 'pending') desc, e.created_at, e.id
     limit 500;
end $$;

create function public.admin_event_counts(p_region_id uuid) returns table (pending integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.is_admin(p_region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select count(*)::integer from public.events e
      join public.site_settings s on s.region_id = e.region_id
     where e.region_id = p_region_id and e.season = s.active_season and e.year = s.active_year
       and e.status = 'pending';
end $$;

-- Transitions: pending -> approved|rejected, approved -> hidden, hidden -> approved, rejected -> approved.
create function public.admin_moderate_event(p_event_id uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.events%rowtype;
begin
  e := private.admin_lock_event(p_event_id);
  if p_status is null or p_status not in ('pending', 'approved', 'rejected', 'hidden') then
    raise exception 'invalid_input' using errcode = '22023', detail = 'status'; end if;
  if (e.status::text, p_status) not in (('pending', 'approved'), ('pending', 'rejected'), ('approved', 'hidden'),
                                        ('hidden', 'approved'), ('rejected', 'approved')) then
    raise exception 'invalid_input' using errcode = '22023', detail = 'transition'; end if;
  if p_reason is not null and char_length(btrim(p_reason)) > 200 then
    raise exception 'invalid_input' using errcode = '22023', detail = 'reason'; end if;
  begin
    update public.events
       set status = p_status::public.event_status,
           reject_reason = case when p_status = 'rejected' then nullif(btrim(p_reason), '') end,
           moderated_by = auth.uid(), moderated_at = now()
     where id = e.id;
  exception when unique_violation then                      -- rejected -> approved over a newer duplicate
    raise exception 'exists' using errcode = '23505';
  end;
end $$;

-- Same validation as submit minus the starts_at lower bound. Never changes status or source.
create function public.admin_update_event(p_event_id uuid, p_title text, p_description text, p_venue text,
                                          p_address text, p_place_id text, p_lat double precision,
                                          p_lng double precision, p_starts_at timestamptz, p_ends_at timestamptz,
                                          p_url text, p_adults_only boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.events%rowtype; c record;
begin
  e := private.admin_lock_event(p_event_id);
  select * into c from private.clean_event(e.region_id, p_title, p_description, p_venue, p_address, p_place_id,
                                           p_lat, p_lng, p_starts_at, p_ends_at, p_url, p_adults_only, true);
  begin
    update public.events
       set title = c.title, description = c.description, venue = c.venue, address = c.address,
           place_id = c.place_id, lat = p_lat, lng = p_lng, starts_at = p_starts_at, ends_at = p_ends_at,
           url = c.url, adults_only = p_adults_only, moderated_by = auth.uid(), moderated_at = now()
     where id = e.id;
  exception when unique_violation then
    raise exception 'exists' using errcode = '23505';
  end;
end $$;

-- Seeding: inserts approved, source 'seed', no quota, same validation (minus the lower bound).
create function public.admin_create_event(p_region_id uuid, p_title text, p_description text, p_venue text,
                                          p_address text, p_place_id text, p_lat double precision,
                                          p_lng double precision, p_starts_at timestamptz, p_ends_at timestamptz,
                                          p_url text, p_adults_only boolean, p_source_url text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_set public.site_settings%rowtype; c record; v_src text; v_id uuid;
begin
  if not private.is_admin(p_region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_set from public.site_settings where region_id = p_region_id;
  if not found then raise exception 'region_not_found' using errcode = 'P0002'; end if;
  select * into c from private.clean_event(p_region_id, p_title, p_description, p_venue, p_address, p_place_id,
                                           p_lat, p_lng, p_starts_at, p_ends_at, p_url, p_adults_only, true);
  v_src := nullif(btrim(coalesce(p_source_url, '')), '');
  if v_src is not null and not private.valid_event_url(v_src) then
    raise exception 'invalid_input' using errcode = '22023', detail = 'source_url'; end if;
  begin
    insert into public.events (region_id, season, year, title, description, venue, address, place_id, lat, lng,
                               starts_at, ends_at, url, adults_only, status, source, source_url, created_by,
                               moderated_by, moderated_at)
    values (p_region_id, v_set.active_season, v_set.active_year, c.title, c.description, c.venue, c.address,
            c.place_id, p_lat, p_lng, p_starts_at, p_ends_at, c.url, p_adults_only, 'approved', 'seed', v_src,
            auth.uid(), auth.uid(), now())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'exists' using errcode = '23505';
  end;
  return v_id;
end $$;

create function public.admin_set_events_open(p_region_id uuid, p_open boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin(p_region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_open is null then raise exception 'invalid_input' using errcode = '22023', detail = 'open'; end if;
  update public.site_settings set events_open = p_open, updated_at = now(), updated_by = auth.uid()
   where region_id = p_region_id;
  if not found then raise exception 'region_not_found' using errcode = 'P0002'; end if;
end $$;

-- A5 retention: rejected events are deleted 30 days after moderation. Scheduled below; no API grant.
create function private.sweep_events() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from public.events where status = 'rejected' and coalesce(moderated_at, created_at) < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------- replaced votes RPC (same signature)
-- A1: security invoker, returns jsonb; adds the "events" capability object (a missing key = DB without events).
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
-- private.client_net_hash, unusable_ip, vote_limits, vote_retention: no grants.
-- Events (each admin RPC is gated inside by private.is_admin)
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

select cron.schedule('tl-sweep-events', '41 * * * *', $$select private.sweep_events()$$);
