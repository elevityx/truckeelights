-- Data the hosted project needs. Submissions start closed.
insert into public.regions (slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng,
                            default_zoom, timezone, country_code, is_active)
values ('truckee', 'Truckee', 39.15, 39.45, -120.42, -119.98, 39.328, -120.183, 12, 'America/Los_Angeles', 'US', true);
insert into public.app_settings (default_region_id) select id from public.regions where slug = 'truckee';
insert into public.region_brands (region_id, season, wordmark)
  select id, 'halloween'::public.season_kind, 'Truckee Frights' from public.regions where slug = 'truckee'
  union all select id, 'christmas'::public.season_kind, 'Truckee Lights' from public.regions where slug = 'truckee';
insert into public.site_settings (region_id, active_season, active_year, submissions_open)
  select id, 'halloween', 2026, false from public.regions where slug = 'truckee';
-- Frozen list, 10 rows (whole-word match on the normalized address). Extend only by migration.
insert into private.blocked_terms (term) values
  ('fuck'), ('shit'), ('cunt'), ('nigger'), ('faggot'), ('retard'), ('nazi'), ('kike'), ('chink'), ('whore');
do $$ begin
  if (select count(*) from private.blocked_terms) <> 10 then raise exception 'blocked_terms count'; end if;
end $$;
