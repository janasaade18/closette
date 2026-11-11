-- Sync auth users → profiles (garments.profile_id FK) + closet RLS.

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

  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    'member'
  )
  on conflict (id) do update
    set display_name = coalesce(excluded.display_name, public.profiles.display_name);

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

insert into public.profiles (id, display_name, role)
select u.id, coalesce(u.display_name, split_part(u.email, '@', 1)), 'member'
from public.users u
on conflict (id) do nothing;

alter table public.garments enable row level security;

drop policy if exists garments_select_own on public.garments;
create policy garments_select_own
  on public.garments for select
  using (auth.uid() = profile_id);

drop policy if exists garments_insert_own on public.garments;
create policy garments_insert_own
  on public.garments for insert
  with check (auth.uid() = profile_id);

drop policy if exists garments_update_own on public.garments;
create policy garments_update_own
  on public.garments for update
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

drop policy if exists garments_delete_own on public.garments;
create policy garments_delete_own
  on public.garments for delete
  using (auth.uid() = profile_id);

update storage.buckets
set public = true
where id = 'wardrobe-images';
