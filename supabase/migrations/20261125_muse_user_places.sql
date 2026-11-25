-- Named places for Muse weather (home / work / uni / other).
-- Applied to project ntrfbndjtdlghnbbxxtz via MCP.

create table if not exists public.muse_user_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'other'
    check (kind in ('home', 'work', 'uni', 'other')),
  label text not null,
  query_name text not null,
  latitude double precision,
  longitude double precision,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists muse_user_places_user_idx
  on public.muse_user_places (user_id, updated_at desc);

create unique index if not exists muse_user_places_one_active
  on public.muse_user_places (user_id)
  where is_active = true;

alter table public.muse_user_places enable row level security;

grant select, insert, update, delete on public.muse_user_places to authenticated;

drop policy if exists muse_places_select_own on public.muse_user_places;
create policy muse_places_select_own
  on public.muse_user_places for select
  to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists muse_places_insert_own on public.muse_user_places;
create policy muse_places_insert_own
  on public.muse_user_places for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists muse_places_update_own on public.muse_user_places;
create policy muse_places_update_own
  on public.muse_user_places for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists muse_places_delete_own on public.muse_user_places;
create policy muse_places_delete_own
  on public.muse_user_places for delete
  to authenticated
  using ( (select auth.uid()) = user_id );
