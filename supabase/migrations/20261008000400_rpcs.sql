create function public.get_region_context(p_slug text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'region', jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name,
       'min_lat', r.min_lat, 'max_lat', r.max_lat, 'min_lng', r.min_lng, 'max_lng', r.max_lng,
       'center_lat', r.center_lat, 'center_lng', r.center_lng, 'default_zoom', r.default_zoom,
       'timezone', r.timezone, 'country_code', r.country_code),
    'season', s.active_season, 'year', s.active_year, 'submissions_open', s.submissions_open,
    'wordmark', coalesce(b.wordmark, r.name))
  from public.regions r
  join public.site_settings s on s.region_id = r.id
  left join public.region_brands b on b.region_id = r.id and b.season = s.active_season
  where r.is_active
    and r.slug = coalesce(p_slug, (select r2.slug from public.app_settings a
                                   join public.regions r2 on r2.id = a.default_region_id))
$$;

create function public.submit_house(p_region_slug text, p_place_id text, p_address text,
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
                             lat, lng, coord_source, created_by)
  values (v_region.id, v_set.active_season, v_set.active_year, p_place_id, v_address, v_norm,
          p_lat, p_lng, 'user_confirmed', v_uid)
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

create function public.admin_whoami(p_region_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.is_admin(p_region_id) $$;

create function public.admin_set_season(p_region_id uuid, p_season text, p_year integer, p_submissions_open boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin(p_region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_season is null or p_season not in ('halloween', 'christmas')
     or p_year is null or p_year not between 2024 and 2100 or p_submissions_open is null then
    raise exception 'invalid_input' using errcode = '22023'; end if;
  update public.site_settings
     set active_season = p_season::public.season_kind, active_year = p_year,
         submissions_open = p_submissions_open, updated_at = now(), updated_by = auth.uid()
   where region_id = p_region_id;
  if not found then raise exception 'region_not_found' using errcode = 'P0002'; end if;
end $$;

create function public.admin_list_houses(p_region_id uuid, p_status text, p_query text)
returns table (id uuid, address text, season public.season_kind, year smallint, status public.house_status,
               hidden_reason text, created_at timestamptz, legacy_source text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.is_admin(p_region_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('visible', 'hidden', 'released') then
    raise exception 'invalid_input' using errcode = '22023'; end if;
  return query
    select h.id, h.address, h.season, h.year, h.status, h.hidden_reason, h.created_at, h.legacy_source
      from public.houses h
      join public.site_settings s on s.region_id = h.region_id
     where h.region_id = p_region_id and h.season = s.active_season and h.year = s.active_year
       and (p_status is null or h.status = p_status::public.house_status)
       and (coalesce(p_query, '') = '' or h.address ilike
            '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%')
     order by h.created_at desc
     limit 500;
end $$;

create function public.admin_set_house_status(p_house_id uuid, p_status text, p_reason text)
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
     or (p_reason is not null and char_length(p_reason) > 200) then
    raise exception 'invalid_input' using errcode = '22023'; end if;
  update public.houses
     set status = p_status::public.house_status,
         hidden_reason = case when p_status = 'hidden' then nullif(btrim(p_reason), '') end,
         moderated_by = auth.uid(), moderated_at = now()
   where id = p_house_id;
  -- R2: create-or-replace adds rotate_public jobs for approved photos on hide.
end $$;

create function public.admin_release_house(p_house_id uuid)
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
  update public.houses
     set status = 'released', released_at = now(), place_id = null,
         normalized_address = normalized_address || '#released:' || id::text,
         moderated_by = auth.uid(), moderated_at = now()
   where id = p_house_id;
end $$;

-- EXECUTE: deny all, then exact allowlist (spec §1.4).
revoke execute on all functions in schema public  from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function public.get_region_context(text) to anon, authenticated;
grant execute on function public.submit_house(text, text, text, double precision, double precision) to authenticated;
grant execute on function public.admin_whoami(uuid) to authenticated;
grant execute on function public.admin_set_season(uuid, text, integer, boolean) to authenticated;
grant execute on function public.admin_list_houses(uuid, text, text) to authenticated;
grant execute on function public.admin_set_house_status(uuid, text, text) to authenticated;
grant execute on function public.admin_release_house(uuid) to authenticated;
