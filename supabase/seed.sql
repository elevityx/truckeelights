-- LOCAL ONLY. Fake data for the local stack. `supabase db push` never applies this file.
-- Every address, coordinate, and account below is made up.

-- A second, non-default region for cross-region tests (fake bbox far from Truckee).
insert into public.regions (slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng,
                            default_zoom, timezone, country_code, is_active)
values ('testville', 'Testville', 10, 11, 10, 11, 10.5, 10.5, 12, 'America/Los_Angeles', 'US', true);
insert into public.site_settings (region_id, active_season, active_year, submissions_open)
  select id, 'halloween', 2026, true from public.regions where slug = 'testville';

-- Local dev convenience: Truckee open for submissions.
update public.site_settings s set submissions_open = true, updated_at = now()
  from public.regions r where r.id = s.region_id and r.slug = 'truckee';

-- 12 fake Truckee houses for halloween/2026 (one hidden) and 4 fake christmas/2024 houses.
insert into public.houses (region_id, season, year, address, normalized_address, lat, lng, coord_source,
                           status, hidden_reason)
select r.id, v.season::public.season_kind, v.year, v.address, private.normalize_address(v.address),
       v.lat, v.lng, 'admin', v.status::public.house_status, v.reason
  from public.regions r
 cross join (values
   ('halloween', 2026, '101 Fakepine Ln, Truckee, CA',     39.3301, -120.1801, 'visible', null),
   ('halloween', 2026, '102 Fakepine Ln, Truckee, CA',     39.3305, -120.1808, 'visible', null),
   ('halloween', 2026, '215 Mockridge Rd, Truckee, CA',    39.3352, -120.1902, 'visible', null),
   ('halloween', 2026, '217 Mockridge Rd, Truckee, CA',    39.3356, -120.1910, 'visible', null),
   ('halloween', 2026, '330 Sampleview Dr, Truckee, CA',   39.3210, -120.2050, 'visible', null),
   ('halloween', 2026, '332 Sampleview Dr, Truckee, CA',   39.3214, -120.2056, 'visible', null),
   ('halloween', 2026, '48 Placeholder Way, Truckee, CA',  39.3402, -120.1701, 'visible', null),
   ('halloween', 2026, '50 Placeholder Way, Truckee, CA',  39.3406, -120.1706, 'visible', null),
   ('halloween', 2026, '9 Dummyhill Ct, Truckee, CA',      39.3150, -120.2200, 'visible', null),
   ('halloween', 2026, '11 Dummyhill Ct, Truckee, CA',     39.3155, -120.2206, 'visible', null),
   ('halloween', 2026, '600 Examplecreek Rd, Truckee, CA', 39.3500, -120.1500, 'visible', null),
   ('halloween', 2026, '602 Examplecreek Rd, Truckee, CA', 39.3504, -120.1506, 'hidden',  'local seed: hidden example'),
   ('christmas', 2024, '12 Tinselfake St, Truckee, CA',    39.3280, -120.1830, 'visible', null),
   ('christmas', 2024, '14 Tinselfake St, Truckee, CA',    39.3284, -120.1836, 'visible', null),
   ('christmas', 2024, '77 Garlandmock Ave, Truckee, CA',  39.3330, -120.1950, 'visible', null),
   ('christmas', 2024, '79 Garlandmock Ave, Truckee, CA',  39.3334, -120.1956, 'visible', null)
 ) as v(season, year, address, lat, lng, status, reason)
 where r.slug = 'truckee';

-- Local admin (fake credentials, local stack only). Enroll TOTP through /admin/ on first login.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-4000-a000-00000000ad01', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'admin@example.test',
        extensions.crypt('local-admin-password', extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
values ('00000000-0000-4000-a000-00000000ad01', 'email', '00000000-0000-4000-a000-00000000ad01',
        '{"sub":"00000000-0000-4000-a000-00000000ad01","email":"admin@example.test","email_verified":true}',
        now(), now(), now());
insert into public.admins (user_id, region_id, note)
values ('00000000-0000-4000-a000-00000000ad01', null, 'local seed admin');

-- R2: Truckee photo uploads open locally (hosted stays closed: the column defaults to false).
update public.site_settings s set photos_open = true, updated_at = now()
  from public.regions r where r.id = s.region_id and r.slug = 'truckee';

-- R2: storage-test admin (fake credentials, local stack only; used only by tests/storage). Global admin.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-4000-a000-00000000ad02', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'storage-admin@example.test',
        extensions.crypt('local-storage-admin-pw', extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
values ('00000000-0000-4000-a000-00000000ad02', 'email', '00000000-0000-4000-a000-00000000ad02',
        '{"sub":"00000000-0000-4000-a000-00000000ad02","email":"storage-admin@example.test","email_verified":true}',
        now(), now(), now());
insert into public.admins (user_id, region_id, note)
values ('00000000-0000-4000-a000-00000000ad02', null, 'local storage-test admin');

-- Votes: the network cap is ON locally so tests and CI exercise it (hosted ships OFF until the probe passes).
update public.app_settings set vote_network_cap = true;

-- Votes: 2 approved photo rows (no storage objects) so the uncapped meter shows locally on the 150/75 houses.
with v(address) as (values ('101 Fakepine Ln, Truckee, CA'), ('102 Fakepine Ln, Truckee, CA')),
     p as (select h.id as house_id, gen_random_uuid() as id, gen_random_uuid() as pub
             from public.houses h join v on v.address = h.address
            where h.season = 'halloween' and h.year = 2026)
insert into public.photos (id, house_id, upload_path, public_path, status, reserved_until, moderated_at)
select p.id, p.house_id, p.house_id || '/' || p.id || '.jpg', p.house_id || '/' || p.pub || '.jpg', 'approved', now(), now()
  from p;

-- Votes: totals for 6 houses (0, 12, 25, 50, 75, 150) with matching ledger rows under one fake uid, cast two
-- days ago so they never trip today's limits or the 10-minute breakers.
with v(address, n) as (values
       ('101 Fakepine Ln, Truckee, CA', 150), ('102 Fakepine Ln, Truckee, CA', 75),
       ('215 Mockridge Rd, Truckee, CA', 50), ('217 Mockridge Rd, Truckee, CA', 25),
       ('330 Sampleview Dr, Truckee, CA', 12), ('332 Sampleview Dr, Truckee, CA', 0)),
     h as (select h.id, h.region_id, h.season, h.year, v.n, r.timezone
             from public.houses h join v on v.address = h.address join public.regions r on r.id = h.region_id
            where h.season = 'halloween' and h.year = 2026),
     ev as (insert into private.vote_events (house_id, region_id, season, year, uid, vote_day, created_at)
            select h.id, h.region_id, h.season, h.year, '00000000-0000-4000-8000-0000000000aa',
                   (now() at time zone h.timezone)::date - 2, now() - interval '2 days'
              from h cross join lateral generate_series(1, h.n) g
            returning 1)
insert into public.house_vote_totals (house_id, region_id, votes)
select h.id, h.region_id, h.n from h;
