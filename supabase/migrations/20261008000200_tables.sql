create type public.season_kind  as enum ('halloween', 'christmas');
create type public.house_status as enum ('visible', 'hidden', 'released');
create type public.coord_source as enum ('user_confirmed', 'census', 'admin');

create table public.regions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (char_length(name) between 2 and 60),
  min_lat double precision not null, max_lat double precision not null,
  min_lng double precision not null, max_lng double precision not null,
  boundary jsonb,                                         -- reserved (polygon), unused in R1
  center_lat double precision not null, center_lng double precision not null,
  default_zoom smallint not null check (default_zoom between 1 and 20),
  timezone text not null,
  country_code text not null default 'US' check (country_code ~ '^[A-Z]{2}$'),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  check (min_lat < max_lat and min_lng < max_lng),
  check (center_lat between min_lat and max_lat and center_lng between min_lng and max_lng)
);

create table public.app_settings (
  id boolean primary key default true check (id),
  default_region_id uuid not null references public.regions(id) on delete restrict
);

create table public.region_brands (
  region_id uuid not null references public.regions(id) on delete cascade,
  season public.season_kind not null,
  wordmark text not null check (char_length(wordmark) between 2 and 40),
  primary key (region_id, season)
);

create table public.site_settings (
  region_id uuid primary key references public.regions(id) on delete cascade,
  active_season public.season_kind not null,
  active_year smallint not null check (active_year between 2024 and 2100),
  submissions_open boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table public.houses (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions(id) on delete restrict,
  season public.season_kind not null,
  year smallint not null check (year between 2024 and 2100),
  place_id text check (place_id ~ '^[A-Za-z0-9_-]+$' and char_length(place_id) between 10 and 300),  -- PG regex counts max out at 255
  address text not null check (char_length(address) between 5 and 120),
  normalized_address text not null,
  lat double precision not null,
  lng double precision not null,
  coord_source public.coord_source not null,
  status public.house_status not null default 'visible',
  hidden_reason text check (hidden_reason is null or char_length(hidden_reason) <= 200),
  moderated_by uuid references auth.users(id) on delete set null,
  moderated_at timestamptz,
  released_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  legacy_source text,
  legacy_id text,
  check (coord_source <> 'user_confirmed' or place_id is not null or status = 'released'),
  check ((status = 'released') = (released_at is not null)),
  unique (region_id, season, year, place_id),
  unique (region_id, season, year, normalized_address),
  unique (region_id, legacy_source, legacy_id)
);
create index houses_public_idx     on public.houses (region_id, season, year, status);
create index houses_created_by_idx on public.houses (created_by, created_at);

create table public.admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  region_id uuid references public.regions(id) on delete cascade,   -- null = global
  note text,
  created_at timestamptz not null default now(),
  unique nulls not distinct (user_id, region_id)
);

create table private.quota_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('house')),          -- R2 adds photo kinds
  uid uuid not null,
  region_id uuid not null,
  house_id uuid,
  created_at timestamptz not null default now()
);
create index quota_events_uid_idx    on private.quota_events (kind, uid, created_at);
create index quota_events_region_idx on private.quota_events (kind, region_id, created_at);

create table private.blocked_terms (
  term text primary key check (term ~ '^[a-z0-9 ]{2,40}$')
);

-- RLS on EVERY table in EVERY schema. Private tables: RLS on, no policies, no grants.
alter table public.regions        enable row level security;
alter table public.app_settings   enable row level security;
alter table public.region_brands  enable row level security;
alter table public.site_settings  enable row level security;
alter table public.houses         enable row level security;
alter table public.admins         enable row level security;
alter table private.quota_events  enable row level security;
alter table private.blocked_terms enable row level security;
alter table private.quota_events  force row level security;
alter table private.blocked_terms force row level security;
-- Ownership model for private tables: owned by postgres; written and read only inside security definer
-- functions owned by postgres. FORCE applies RLS to the table owner too, so with no policy every
-- non-BYPASSRLS role (owner included) sees zero rows and cannot write. postgres on Supabase has
-- BYPASSRLS, so the definer RPCs keep working; pgTAP 04 asserts the RPC path still writes quota_events.

-- Public column grants (reads only). No INSERT/UPDATE/DELETE grants anywhere.
grant select (id, slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng,
              default_zoom, timezone, country_code, is_active) on public.regions to anon, authenticated;
grant select (id, default_region_id) on public.app_settings to anon, authenticated;
grant select (region_id, season, wordmark) on public.region_brands to anon, authenticated;
grant select (region_id, active_season, active_year, submissions_open, updated_at) on public.site_settings to anon, authenticated;
grant select (id, region_id, season, year, address, lat, lng, status) on public.houses to anon, authenticated;

create policy regions_public_read on public.regions for select to anon, authenticated using (is_active);
create policy app_settings_public_read on public.app_settings for select to anon, authenticated using (true);
create policy region_brands_public_read on public.region_brands for select to anon, authenticated
  using (exists (select 1 from public.regions r where r.id = region_brands.region_id and r.is_active));
create policy site_settings_public_read on public.site_settings for select to anon, authenticated
  using (exists (select 1 from public.regions r where r.id = site_settings.region_id and r.is_active));
create policy houses_public_read on public.houses for select to anon, authenticated
  using (status = 'visible' and exists (
    select 1 from public.site_settings s join public.regions r on r.id = s.region_id
    where s.region_id = houses.region_id and r.is_active
      and s.active_season = houses.season and s.active_year = houses.year));
-- admins: RLS on, no policy, no grant.
