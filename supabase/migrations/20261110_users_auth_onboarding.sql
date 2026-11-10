-- Auth signup → public.users row + Closette onboarding preference columns.
-- Applied to project ntrfbndjtdlghnbbxxtz via MCP; keep this file for team/history.

alter table public.users
  add column if not exists preferred_styles text[] not null default '{}',
  add column if not exists preferred_colors text[] not null default '{}',
  add column if not exists preferred_clothing text[] not null default '{}',
  add column if not exists common_occasions text[] not null default '{}';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(excluded.display_name, public.users.display_name),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_users_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.touch_users_updated_at();

-- Trigger-only: do not expose handle_new_user over PostgREST RPC.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

alter table public.users enable row level security;

drop policy if exists users_select_own on public.users;
create policy users_select_own
  on public.users for select
  using (auth.uid() = id);

drop policy if exists users_update_own on public.users;
create policy users_update_own
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists users_insert_own on public.users;
create policy users_insert_own
  on public.users for insert
  with check (auth.uid() = id);
