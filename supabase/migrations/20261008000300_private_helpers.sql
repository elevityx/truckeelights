create function private.normalize_address(p text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           lower(coalesce(p, '')), '[.#]', '', 'g'),
           '\s*,\s*', ', ', 'g'),
           '\s+', ' ', 'g'),
           ',\s*(usa|united states)\s*$', ''))
$$;

create function private.validate_address(p text) returns void
language plpgsql stable set search_path = '' as $$
declare v text := btrim(coalesce(p, '')); n text;
begin
  if char_length(v) < 5 or char_length(v) > 120 then
    raise exception 'invalid_address' using errcode = '22023', detail = 'length'; end if;
  if v !~ '^[A-Za-z0-9 ,.#''/-]+$' then
    raise exception 'invalid_address' using errcode = '22023', detail = 'characters'; end if;
  if v !~ '^\d{1,6}[A-Za-z]?\s+\S' then
    raise exception 'invalid_address' using errcode = '22023', detail = 'house_number'; end if;
  n := private.normalize_address(v);
  if n ~ '(address not found|unknown address|not a real|^\d+[a-z]? (unknown|none|test|n/?a)$)' then
    raise exception 'invalid_address' using errcode = '22023', detail = 'denylist'; end if;
  if exists (select 1 from private.blocked_terms t where n ~ ('\m' || t.term || '\M')) then
    raise exception 'invalid_address' using errcode = '22023', detail = 'blocked_term'; end if;
end $$;

create function private.is_admin(p_region_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) = false
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.admins a
                 where a.user_id = auth.uid()
                   and (a.region_id is null or a.region_id = p_region_id))
$$;

create function private.take_quota(p_kind text, p_region_id uuid, p_house_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_n integer;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  -- fixed lock order uid -> region (R2 adds -> house); keys are kind- and dimension-prefixed
  perform pg_advisory_xact_lock(hashtextextended(p_kind || ':uid:' || v_uid::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_kind || ':region:' || p_region_id::text, 0));
  if p_kind = 'house' then
    select count(*) into v_n from private.quota_events
      where kind = 'house' and uid = v_uid and created_at > now() - interval '1 hour';
    if v_n >= 5 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'uid_hourly'; end if;
    select count(*) into v_n from private.quota_events
      where kind = 'house' and region_id = p_region_id and created_at > now() - interval '10 minutes';
    if v_n >= 60 then raise exception 'rate_limited' using errcode = 'P0001', detail = 'region_breaker'; end if;
  else
    raise exception 'invalid_input' using errcode = '22023', detail = 'quota_kind';
  end if;
  insert into private.quota_events (kind, uid, region_id, house_id) values (p_kind, v_uid, p_region_id, p_house_id);
end $$;

create function private.lock_quota(p_kind text, p_region_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_kind || ':uid:' || v_uid::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_kind || ':region:' || p_region_id::text, 0));
end $$;

-- Server-side street-level check (Plan v5 §3.3, "stated honestly").
-- Proves the shape of a street address, not that Google returned one. Place verification needs a
-- server and stays the recorded future option.
create function private.assert_street_level(p_address text, p_region_name text) returns void
language plpgsql immutable set search_path = '' as $$
declare
  v_first text := btrim(split_part(btrim(coalesce(p_address, '')), ',', 1));
  v_street text;
begin
  v_street := btrim(regexp_replace(v_first, '^\d{1,6}[A-Za-z]?(-\d{1,5})?\s+', ''));
  -- the street part must exist and contain a word of at least 2 letters
  if v_street = v_first or v_street !~ '[A-Za-z]{2,}' then
    raise exception 'invalid_address' using errcode = '22023', detail = 'street_level'; end if;
  -- "123 Truckee" / "123 Truckee CA" / "123 California": a number plus a place name is not a street
  if lower(regexp_replace(v_street, '\s+(ca|california|nv|nevada|usa)$', '', 'i')) in
       (lower(coalesce(p_region_name, '')), 'ca', 'california', 'nv', 'nevada', 'usa', 'united states') then
    raise exception 'invalid_address' using errcode = '22023', detail = 'street_level'; end if;
end $$;

-- READ COMMITTED: each statement after the lock takes a fresh snapshot, so counts include rows
-- committed by the transaction that held the lock before us. Counts are exact under concurrency.

create function private.enforce_region_bounds() returns trigger
language plpgsql set search_path = '' as $$
declare r public.regions%rowtype;
begin
  select * into r from public.regions where id = new.region_id;
  if not found then raise exception 'region_not_found' using errcode = '23503'; end if;
  if new.lat is null or new.lng is null
     or not (new.lat between r.min_lat and r.max_lat)
     or not (new.lng between r.min_lng and r.max_lng) then
    raise exception 'out_of_bounds' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger houses_region_bounds before insert or update of lat, lng, region_id on public.houses
  for each row execute function private.enforce_region_bounds();

create function private.guard_default_region() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not new.is_active and exists (select 1 from public.app_settings a where a.default_region_id = new.id) then
    raise exception 'invalid_input' using errcode = '23514', detail = 'default_region_must_be_active';
  end if;
  return new;
end $$;
create trigger regions_guard_default before update of is_active on public.regions
  for each row execute function private.guard_default_region();

create function private.guard_app_settings() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.regions r where r.id = new.default_region_id and r.is_active) then
    raise exception 'invalid_input' using errcode = '23514', detail = 'default_region_must_be_active';
  end if;
  return new;
end $$;
create trigger app_settings_guard before insert or update on public.app_settings
  for each row execute function private.guard_app_settings();
