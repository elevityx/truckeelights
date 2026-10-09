-- Spec_Events Amendment 3: "Worth the drive" events (Reno area), admin-only.
-- 20261013000100_events is applied on hosted and never edited; this migration only adds and re-creates.
--
-- Two boxes:
--   local box  private.event_bounds        (A3, unchanged): bbox + 0.05 deg, east + 0.10 deg. submit_event uses it.
--   admin box  private.event_bounds_admin  (new): the local box joined with the Reno-area box. admin_create_event and
--              admin_update_event use it. For Truckee: lat 39.09-39.60, lng -120.47 to -119.60 (Reno and Carson City
--              inside; Gardnerville and Fernley outside; pgTAP 13 pins it). TS mirror: eventBoundsAdmin().
--
-- The bounds check of every event write lives in private.clean_event (p_admin = true for the two admin RPCs, false for
-- submit_event), so the admin RPCs keep their bodies, signatures and grants: only clean_event's final check and the
-- events_before_write backstop change. All functions here are plain (not security definer), search_path = '', and get
-- no grants (default privileges in schema private revoke EXECUTE from public, anon, authenticated).

-- Region bbox: south - 0.06, north + 0.15, west - 0.05 (as the local box), east + 0.38 deg.
create function private.event_bounds_admin(p_region_id uuid)
returns table (min_lat double precision, max_lat double precision, min_lng double precision, max_lng double precision)
language sql stable set search_path = '' as $$
  select r.min_lat - 0.06, r.max_lat + 0.15, r.min_lng - 0.05, r.max_lng + 0.38
    from public.regions r where r.id = p_region_id
$$;

-- BETWEEN, so NaN, Infinity and null all fail.
create function private.in_event_bounds_admin(p_region_id uuid, p_lat double precision, p_lng double precision)
returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select p_lat between b.min_lat and b.max_lat and p_lng between b.min_lng and b.max_lng
                     from private.event_bounds_admin(p_region_id) b), false)
$$;

-- Validates and cleans every event field (errors: invalid_input with detail = field name, then out_of_bounds).
-- p_admin skips the starts_at lower bound (admins can fix past typos) and checks the admin box (Amendment 3).
create or replace function private.clean_event(
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

  -- Amendment 3: visitors (submit_event) keep the local box; admin create/update may use the admin box (Reno area).
  if not (case when p_admin then private.in_event_bounds_admin(p_region_id, p_lat, p_lng)
               else private.in_event_bounds(p_region_id, p_lat, p_lng) end) then
    raise exception 'out_of_bounds' using errcode = '22023'; end if;
end $$;

-- Derived columns and the bounds backstop for every write (RPC or raw SQL seed). Amendment 3: the backstop is the
-- admin box (the widest box any write path accepts); submit_event still enforces the local box in clean_event.
create or replace function private.events_before_write() returns trigger
language plpgsql set search_path = '' as $$
declare v_tz text;
begin
  select r.timezone into v_tz from public.regions r where r.id = new.region_id;
  if not found then raise exception 'region_not_found' using errcode = '23503'; end if;
  if not private.in_event_bounds_admin(new.region_id, new.lat, new.lng) then
    raise exception 'out_of_bounds' using errcode = '23514'; end if;
  new.normalized_title := private.normalize_event_title(new.title);
  new.start_day := (new.starts_at at time zone v_tz)::date;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;

-- Belt and braces: nothing in private is executable by API roles except the two Storage policy helpers.
revoke execute on function private.event_bounds_admin(uuid) from public, anon, authenticated;
revoke execute on function private.in_event_bounds_admin(uuid, double precision, double precision) from public, anon, authenticated;
