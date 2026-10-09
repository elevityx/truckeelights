-- House votes (Pumpkin Power, Ghost Power, Snowfall). Layered on Release 2 (photos).
-- A device gets 5 votes per house per day and 60 per day overall; exact per-house and per-region breakers;
-- an optional per-network cap (25 per house per day) keyed by a daily, per-region salted HMAC of the
-- network prefix. Raw IP addresses are never stored, logged, or returned.
--
-- Global lock order (every path follows it; nothing here takes R2's photo:/house:/photo_reserve: keys):
--   L0 site_settings row of the region, FOR KEY SHARE (vote_house, admin_void_votes). purge_rehearsal and
--      admin_set_season take that row FOR UPDATE first, so they never interleave with a vote or a void.
--   L1 advisory vote:uid:<uid>                 (vote_house)
--   L2 private.vote_salts row (region, day)    (vote_house, only on the rare get-or-create)
--   L3 advisory vote:net:<house>:<hash hex>    (vote_house, only when the network cap applies)
--   L4 public.house_vote_totals row            (vote_house, admin_void_votes)
--   L5 advisory vote:region:<region>           (vote_house)
--   FK key-share on houses/regions/photos      (vote_house inserts only, always after L0)
--   L6 private.vote_events rows                (vote_house: its new row; admin_void_votes: after L4;
--                                               vote_retention: past days, SKIP LOCKED, never waits)

-- ---------------------------------------------------------------- switches
-- Emergency off switch. Voting ships on.
alter table public.site_settings add column votes_open boolean not null default true;
grant select (votes_open) on public.site_settings to anon, authenticated;

-- The network cap stays OFF until the hosted authority probe passes. No grant: invisible to the API.
alter table public.app_settings add column vote_network_cap boolean not null default false;

-- ---------------------------------------------------------------- tables
-- Ledger. Holds uids, so it is private. Voids are soft so the limits still count them.
create table private.vote_events (
  id bigint generated always as identity primary key,
  house_id uuid not null references public.houses(id) on delete cascade,
  region_id uuid not null references public.regions(id) on delete cascade,
  season public.season_kind not null,
  year smallint not null,
  uid uuid not null,
  photo_id uuid references public.photos(id) on delete set null,     -- photo-heart attribution
  vote_day date not null,                                             -- region-local day at insert
  net_hash bytea check (net_hash is null or octet_length(net_hash) = 16),  -- nulled by retention after the day
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null
);
create index vote_events_uid_house_day_idx  on private.vote_events (uid, house_id, vote_day);
create index vote_events_uid_day_idx        on private.vote_events (uid, vote_day);
create index vote_events_house_day_idx      on private.vote_events (house_id, vote_day);
create index vote_events_house_created_idx  on private.vote_events (house_id, created_at);
create index vote_events_region_created_idx on private.vote_events (region_id, created_at);
create index vote_events_net_idx  on private.vote_events (house_id, vote_day, net_hash) where net_hash is not null;
create index vote_events_hashed_day_idx on private.vote_events (vote_day) where net_hash is not null;
create index vote_events_photo_idx on private.vote_events (photo_id) where photo_id is not null;

-- Salts per REGION and region-local day, so hashes from two regions on the same day cannot be correlated.
create table private.vote_salts (
  region_id uuid not null references public.regions(id) on delete cascade,
  day date not null,
  salt bytea not null default extensions.gen_random_bytes(32),
  created_at timestamptz not null default now(),
  primary key (region_id, day)
);
alter table private.vote_events enable row level security;
alter table private.vote_events force row level security;      -- invariant 10: no policies, no grants
alter table private.vote_salts  enable row level security;
alter table private.vote_salts  force row level security;

-- Public counter. One row per house that has been voted on; a missing row means 0.
create table public.house_vote_totals (
  house_id uuid primary key references public.houses(id) on delete cascade,
  region_id uuid not null references public.regions(id) on delete cascade,
  votes integer not null default 0 check (votes >= 0),
  updated_at timestamptz not null default now()
);
alter table public.house_vote_totals enable row level security;
grant select (house_id, region_id, votes) on public.house_vote_totals to anon, authenticated;
-- Visible exactly when the house is visible to the caller (the subquery runs under the caller's houses RLS).
create policy house_vote_totals_public_read on public.house_vote_totals for select to anon, authenticated
  using (exists (select 1 from public.houses h where h.id = house_vote_totals.house_id));

-- ---------------------------------------------------------------- helpers (private, no grants)
-- The limits, in one place. Every RPC reads them from here.
create function private.vote_limits() returns table (per_house_day int, per_uid_day int,
  per_net_house_day int, house_10m int, region_10m int)
language sql immutable set search_path = '' as $$ select 5, 60, 25, 200, 2000 $$;

-- Addresses that never identify a public client network. 203.0.113.0/24 and 2001:db8::/32 are deliberately
-- NOT listed: the local seed and tests use them, and a real Cloudflare header never carries them.
create function private.unusable_ip(p inet) returns boolean
language sql immutable set search_path = '' as $$
  select p is null or p <<= any (array[
    '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
    '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '224.0.0.0/3',
    '::/127', '::ffff:0:0/96', 'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8'
  ]::inet[])
$$;

-- Fail open: returns null on any problem. Never raises. Never logs, stores, or returns the address.
-- Reads ONLY cf-connecting-ip (x-forwarded-for is client-controlled and never read).
create function private.client_net_hash(p_region_id uuid, p_day date) returns bytea
language plpgsql security definer set search_path = '' as $$
declare v_ip inet; v_net inet; v_salt bytea;
begin
  begin
    if not coalesce((select a.vote_network_cap from public.app_settings a), false) then return null; end if;
    v_ip := btrim(nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip')::inet;
    if v_ip is null or private.unusable_ip(v_ip) then return null; end if;
    v_net := case when family(v_ip) = 4 then set_masklen(v_ip, 32) else network(set_masklen(v_ip, 64)) end;
    select s.salt into v_salt from private.vote_salts s where s.region_id = p_region_id and s.day = p_day;
    if v_salt is null then
      insert into private.vote_salts (region_id, day) values (p_region_id, p_day) on conflict do nothing;
      select s.salt into v_salt from private.vote_salts s where s.region_id = p_region_id and s.day = p_day;
    end if;
    if v_salt is null then return null; end if;
    return substring(extensions.hmac(convert_to(host(v_net) || '/' || masklen(v_net), 'UTF8'), v_salt, 'sha256') from 1 for 16);
  exception when others then
    return null;
  end;
end $$;

-- Scheduled retention (pg_cron, every 15 min, its own transaction, idempotent). The vote path never runs it.
create function private.vote_retention() returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- 1. Destroy salts for every region-local day that has ended. After this, past hashes are unlinkable.
  delete from private.vote_salts s using public.regions r
   where r.id = s.region_id and s.day < (now() at time zone r.timezone)::date;
  -- 2. Null hashes of ended days. SKIP LOCKED: never waits on a row an admin void holds; leftovers go next run.
  update private.vote_events e set net_hash = null
   where e.id in (select e2.id from private.vote_events e2 join public.regions r on r.id = e2.region_id
                   where e2.net_hash is not null and e2.vote_day < (now() at time zone r.timezone)::date
                   order by e2.id limit 20000
                   for update of e2 skip locked);
  -- 3. Pre-create today's and tomorrow's salts so the vote path normally only reads.
  insert into private.vote_salts (region_id, day)
  select r.id, d.day from public.regions r
   cross join lateral (values ((now() at time zone r.timezone)::date),
                              ((now() at time zone r.timezone)::date + 1)) d(day)
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------- public RPCs
create function public.vote_house(p_house_id uuid, p_photo_id uuid default null)
returns table (total_votes int, left_today int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_lim record;
  v_region uuid; v_season public.season_kind; v_year smallint; v_tz text; v_open boolean;
  v_day date; v_house_n int; v_n int; v_net bytea; v_total int;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if p_house_id is null then raise exception 'invalid_input' using errcode = '22023'; end if;
  select * into v_lim from private.vote_limits();

  -- L0: the region's settings row, FOR KEY SHARE, before any other lock.
  perform 1 from public.site_settings s
   where s.region_id = (select h.region_id from public.houses h where h.id = p_house_id)
   for key share;
  -- The public-house predicate, read after L0 (fresh snapshot: a purge or season switch that finished
  -- while we waited is seen here). Hidden, released, past-season, and unknown all give the same error.
  select h.region_id, h.season, h.year, r.timezone, s.votes_open
    into v_region, v_season, v_year, v_tz, v_open
    from public.houses h
    join public.site_settings s on s.region_id = h.region_id
    join public.regions r on r.id = h.region_id
   where h.id = p_house_id and h.status = 'visible' and r.is_active
     and s.active_season = h.season and s.active_year = h.year;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  -- Photo heart: the photo must be approved and belong to this house (plain read, no lock).
  if p_photo_id is not null and not exists (
       select 1 from public.photos p where p.id = p_photo_id and p.house_id = p_house_id and p.status = 'approved') then
    raise exception 'not_found' using errcode = 'P0002', detail = 'photo';
  end if;

  if not v_open then raise exception 'votes_closed' using errcode = 'P0001'; end if;
  v_day := (now() at time zone v_tz)::date;

  -- L1: device limits (voided votes still count).
  perform pg_advisory_xact_lock(hashtextextended('vote:uid:' || v_uid::text, 0));
  select count(*) into v_house_n from private.vote_events e
   where e.uid = v_uid and e.house_id = p_house_id and e.vote_day = v_day;
  if v_house_n >= v_lim.per_house_day then
    raise exception 'rate_limited' using errcode = 'P0001', detail = 'house_daily'; end if;
  select count(*) into v_n from private.vote_events e where e.uid = v_uid and e.vote_day = v_day;
  if v_n >= v_lim.per_uid_day then
    raise exception 'rate_limited' using errcode = 'P0001', detail = 'uid_daily'; end if;

  -- L2 (inside, fail open) + L3: the optional per-network cap.
  v_net := private.client_net_hash(v_region, v_day);
  if v_net is not null then
    perform pg_advisory_xact_lock(hashtextextended('vote:net:' || p_house_id::text || ':' || encode(v_net, 'hex'), 0));
    select count(*) into v_n from private.vote_events e
     where e.house_id = p_house_id and e.vote_day = v_day and e.net_hash = v_net;
    if v_n >= v_lim.per_net_house_day then
      raise exception 'rate_limited' using errcode = 'P0001', detail = 'network_daily'; end if;
  end if;

  -- L4: make sure the totals row exists, then lock it.
  insert into public.house_vote_totals (house_id, region_id, votes) values (p_house_id, v_region, 0)
  on conflict (house_id) do nothing;
  select t.votes into v_total from public.house_vote_totals t where t.house_id = p_house_id for update;

  -- L5, then the exact breakers (every voter on the house holds L4, every voter in the region holds L5).
  perform pg_advisory_xact_lock(hashtextextended('vote:region:' || v_region::text, 0));
  select count(*) into v_n from private.vote_events e
   where e.house_id = p_house_id and e.created_at > now() - interval '10 minutes';
  if v_n >= v_lim.house_10m then
    raise exception 'rate_limited' using errcode = 'P0001', detail = 'house_breaker'; end if;
  select count(*) into v_n from private.vote_events e
   where e.region_id = v_region and e.created_at > now() - interval '10 minutes';
  if v_n >= v_lim.region_10m then
    raise exception 'rate_limited' using errcode = 'P0001', detail = 'region_breaker'; end if;

  insert into private.vote_events (house_id, region_id, season, year, uid, photo_id, vote_day, net_hash)
  values (p_house_id, v_region, v_season, v_year, v_uid, p_photo_id, v_day, v_net);
  update public.house_vote_totals t set votes = t.votes + 1, updated_at = now()
   where t.house_id = p_house_id
  returning t.votes into v_total;

  return query select v_total, v_lim.per_house_day - (v_house_n + 1);
end $$;

create function public.my_vote_status(p_house_id uuid) returns table (total_votes int, left_today int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_lim record; v_tz text; v_n int;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  select * into v_lim from private.vote_limits();
  select r.timezone into v_tz
    from public.houses h
    join public.site_settings s on s.region_id = h.region_id
    join public.regions r on r.id = h.region_id
   where h.id = p_house_id and h.status = 'visible' and r.is_active
     and s.active_season = h.season and s.active_year = h.year;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select count(*) into v_n from private.vote_events e
   where e.uid = v_uid and e.house_id = p_house_id and e.vote_day = (now() at time zone v_tz)::date;
  return query select coalesce((select t.votes from public.house_vote_totals t where t.house_id = p_house_id), 0),
                      greatest(0, v_lim.per_house_day - v_n);
end $$;

-- Approved-photo counts per public house of the region's active season (the D1 meter cap reads these).
-- Approved photos are already public through the signer, so counts reveal nothing new.
create function public.get_house_photo_counts(p_region_id uuid) returns table (house_id uuid, approved int)
language sql stable security definer set search_path = '' as $$
  select h.id, count(p.id)::int from public.houses h
    join public.site_settings s on s.region_id = h.region_id
    join public.regions r on r.id = h.region_id and r.is_active
    join public.photos p on p.house_id = h.id and p.status = 'approved'
   where h.region_id = p_region_id and h.status = 'visible'
     and h.season = s.active_season and h.year = s.active_year
   group by h.id
$$;

-- Authority probe for the network header. Never returns an address: the digest is keyed by the caller's own
-- random nonce. Ignores vote_network_cap and does not apply unusable_ip (a forged documentation address must
-- show up as a mismatch, not as a missing header).
create function public.network_probe(p_nonce text) returns table (source text, family int, digest text)
language plpgsql security definer set search_path = '' as $$
declare v_ip inet; v_net inet;
begin
  if p_nonce is null or p_nonce !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'invalid_input' using errcode = '22023'; end if;
  begin
    v_ip := btrim(nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip')::inet;
  exception when others then
    v_ip := null;
  end;
  if v_ip is null then
    return query select 'none'::text, null::int, null::text;
    return;
  end if;
  v_net := case when pg_catalog.family(v_ip) = 4 then set_masklen(v_ip, 32) else network(set_masklen(v_ip, 64)) end;
  return query select 'cf-connecting-ip'::text, pg_catalog.family(v_ip),
    encode(extensions.hmac(host(v_net) || '/' || masklen(v_net), p_nonce, 'sha256'), 'hex');
end $$;

-- ---------------------------------------------------------------- admin RPCs
create function public.admin_set_votes_open(p_region_id uuid, p_open boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin(p_region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_open is null then raise exception 'invalid_input' using errcode = '22023'; end if;
  update public.site_settings set votes_open = p_open, updated_at = now(), updated_by = auth.uid()
   where region_id = p_region_id;
  if not found then raise exception 'region_not_found' using errcode = 'P0002'; end if;
end $$;

-- Global admins only (is_admin(null) is true only for a region_id-is-null admin row), AAL2.
create function public.admin_network_cap_status() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin(null) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select a.vote_network_cap from public.app_settings a), false);
end $$;

create function public.admin_set_network_cap(p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin(null) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_enabled is null then raise exception 'invalid_input' using errcode = '22023'; end if;
  update public.app_settings set vote_network_cap = p_enabled;
end $$;

-- Activity columns exclude voided rows; `voided` counts them. Hashes are never returned.
create function public.admin_vote_stats(p_region_id uuid)
returns table (house_id uuid, address text, total_votes int, votes_today int, votes_24h int, voters_24h int,
               top_voter uuid, top_voter_24h int, networks_today int, top_network_today int, voided int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_day date;
begin
  if not private.is_admin(p_region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select (now() at time zone r.timezone)::date into v_day from public.regions r where r.id = p_region_id;
  if not found then raise exception 'region_not_found' using errcode = 'P0002'; end if;
  return query
  select h.id, h.address, coalesce(t.votes, 0),
         (select count(*)::int from private.vote_events e
           where e.house_id = h.id and e.voided_at is null and e.vote_day = v_day),
         (select count(*)::int from private.vote_events e
           where e.house_id = h.id and e.voided_at is null and e.created_at > now() - interval '24 hours'),
         (select count(distinct e.uid)::int from private.vote_events e
           where e.house_id = h.id and e.voided_at is null and e.created_at > now() - interval '24 hours'),
         tv.uid, coalesce(tv.n, 0),
         (select count(distinct e.net_hash)::int from private.vote_events e
           where e.house_id = h.id and e.voided_at is null and e.vote_day = v_day and e.net_hash is not null),
         coalesce((select max(x.n)::int from (select count(*) as n from private.vote_events e
                    where e.house_id = h.id and e.voided_at is null and e.vote_day = v_day and e.net_hash is not null
                    group by e.net_hash) x), 0),
         (select count(*)::int from private.vote_events e where e.house_id = h.id and e.voided_at is not null)
    from public.houses h
    join public.site_settings s on s.region_id = h.region_id
    left join public.house_vote_totals t on t.house_id = h.id
    left join lateral (select e.uid, count(*)::int as n from private.vote_events e
                        where e.house_id = h.id and e.voided_at is null and e.created_at > now() - interval '24 hours'
                        group by e.uid order by count(*) desc, e.uid limit 1) tv on true
   where h.region_id = p_region_id and h.status = 'visible'
     and h.season = s.active_season and h.year = s.active_year
   order by coalesce(t.votes, 0) desc, h.address
   limit 500;
end $$;

-- Void (soft) a house's votes: all (reset), since a time, or one uid. Recomputes the counter exactly.
create function public.admin_void_votes(p_house_id uuid, p_since timestamptz, p_uid uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_region uuid; v_n integer;
begin
  select h.region_id into v_region from public.houses h where h.id = p_house_id;
  if not found then
    if private.is_admin(null) then raise exception 'not_found' using errcode = 'P0002';
    else raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  if not private.is_admin(v_region) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform 1 from public.site_settings s where s.region_id = v_region for key share;          -- L0
  perform 1 from public.house_vote_totals t where t.house_id = p_house_id for update;        -- L4
  if not found then return 0; end if;
  update private.vote_events e set voided_at = now(), voided_by = auth.uid()                  -- L6
   where e.house_id = p_house_id and e.voided_at is null
     and (p_since is null or e.created_at >= p_since)
     and (p_uid is null or e.uid = p_uid);
  get diagnostics v_n = row_count;
  update public.house_vote_totals t
     set votes = (select count(*)::int from private.vote_events e where e.house_id = p_house_id and e.voided_at is null),
         updated_at = now()
   where t.house_id = p_house_id;
  return v_n;
end $$;

-- ---------------------------------------------------------------- replaced R2 RPC (same signature)
create or replace function public.get_region_context(p_slug text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'region', jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name,
       'min_lat', r.min_lat, 'max_lat', r.max_lat, 'min_lng', r.min_lng, 'max_lng', r.max_lng,
       'center_lat', r.center_lat, 'center_lng', r.center_lng, 'default_zoom', r.default_zoom,
       'timezone', r.timezone, 'country_code', r.country_code),
    'season', s.active_season, 'year', s.active_year, 'submissions_open', s.submissions_open,
    'photos_open', s.photos_open, 'votes_open', s.votes_open,
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
-- Votes
grant execute on function public.get_house_photo_counts(uuid) to anon, authenticated;
grant execute on function public.network_probe(text) to anon, authenticated;
grant execute on function public.vote_house(uuid, uuid) to authenticated;
grant execute on function public.my_vote_status(uuid) to authenticated;
grant execute on function public.admin_set_votes_open(uuid, boolean) to authenticated;
grant execute on function public.admin_set_network_cap(boolean) to authenticated;
grant execute on function public.admin_network_cap_status() to authenticated;
grant execute on function public.admin_vote_stats(uuid) to authenticated;
grant execute on function public.admin_void_votes(uuid, timestamptz, uuid) to authenticated;
-- private.client_net_hash, unusable_ip, vote_limits, vote_retention: no grants.

select private.vote_retention();
select cron.schedule('tl-vote-retention', '*/15 * * * *', $$select private.vote_retention()$$);
