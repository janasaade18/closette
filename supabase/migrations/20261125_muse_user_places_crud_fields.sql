-- Expand places for full CRUD + trip/day scenarios (like saved delivery addresses).
alter table public.muse_user_places
  drop constraint if exists muse_user_places_kind_check;

alter table public.muse_user_places
  add column if not exists nickname text,
  add column if not exists notes text,
  add column if not exists for_date date;

alter table public.muse_user_places
  add constraint muse_user_places_kind_check
  check (kind in ('home', 'work', 'uni', 'trip', 'other'));
