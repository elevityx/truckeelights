-- Release 2: photos, the photo quota kinds, and the storage-jobs queue.
create type public.photo_status as enum ('reserved', 'expired', 'pending', 'approved', 'rejected', 'revoked');

alter table public.site_settings add column photos_open boolean not null default false;   -- fail-closed
grant select (photos_open) on public.site_settings to anon, authenticated;

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  upload_path text not null unique,                       -- {house_id}/{id}.jpg in photo-uploads
  public_path text unique,                                -- {house_id}/{random}.jpg in photos; approved only
  status public.photo_status not null default 'reserved',
  reserved_until timestamptz not null,
  public_rotated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  moderated_by uuid references auth.users(id) on delete set null,
  moderated_at timestamptz,
  check ((status = 'approved') = (public_path is not null)),
  check (upload_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),
  check (public_path is null or public_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$')
);
create index photos_status_created_idx on public.photos (status, created_at);
create index photos_house_status_idx   on public.photos (house_id, status);
create index photos_created_by_idx     on public.photos (created_by, created_at);
create index photos_reserved_idx       on public.photos (status, reserved_until);
alter table public.photos enable row level security;
-- No grants and no policies on photos for anon/authenticated. Public reads go through
-- public.photo_sign_paths (service_role only) via the photo-urls Edge Function; admin reads go through admin RPCs.

alter table private.quota_events drop constraint quota_events_kind_check;
alter table private.quota_events add constraint quota_events_kind_check
  check (kind in ('house', 'photo_reserve', 'photo_confirm'));
create index quota_events_house_idx on private.quota_events (kind, house_id, created_at);

create table private.storage_jobs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('delete_upload', 'delete_public', 'rotate_public')),
  bucket text not null check (bucket in ('photo-uploads', 'photos')),
  object_name text not null,
  new_object_name text,
  photo_id uuid references public.photos(id) on delete set null,
  region_id uuid references public.regions(id) on delete set null,   -- null only for orphan reconciliation
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_request_id bigint,
  last_error text,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  check ((kind = 'rotate_public') = (new_object_name is not null)),
  check ((kind = 'delete_upload') = (bucket = 'photo-uploads'))
);
create index storage_jobs_open_idx   on private.storage_jobs (next_attempt_at) where done_at is null;
create index storage_jobs_region_idx on private.storage_jobs (region_id) where done_at is null;
create index storage_jobs_photo_idx  on private.storage_jobs (photo_id) where done_at is null;
create index storage_jobs_object_idx on private.storage_jobs (bucket, object_name) where done_at is null;
alter table private.storage_jobs enable row level security;
alter table private.storage_jobs force row level security;          -- invariant 10 pattern

-- Invariant 9 (amended): authenticated only, so the Storage policies can call the two policy helpers.
-- anon keeps no USAGE. Private tables keep FORCE RLS and no grants.
grant usage on schema private to authenticated;
