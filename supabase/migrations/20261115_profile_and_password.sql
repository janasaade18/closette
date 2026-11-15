-- Profile fields and a forced password change flag.
-- Does not delete rows or change existing roles.

alter table public.users
  add column if not exists must_change_password boolean not null default false;

alter table public.brands
  add column if not exists cover_url text,
  add column if not exists website text,
  add column if not exists instagram text,
  add column if not exists contact_email text,
  add column if not exists phone text,
  add column if not exists city text,
  add column if not exists country text,
  add column if not exists category text;

alter table public.brands
  drop constraint if exists brands_category_check;

alter table public.brands
  add constraint brands_category_check
  check (category is null or category in ('Clothing', 'Shoes', 'Accessories', 'Mixed'));

create or replace function public.prevent_user_role_change()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'authenticated' then
    if new.role is distinct from old.role then
      raise exception 'You cannot change your role';
    end if;
    if new.disabled_at is distinct from old.disabled_at then
      raise exception 'You cannot change your account status';
    end if;
    if new.must_change_password is distinct from old.must_change_password then
      raise exception 'You cannot change your account status';
    end if;
  end if;
  return new;
end;
$$;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read
on storage.objects
for select
to public
using (bucket_id = 'avatars');

drop policy if exists avatars_owner_write on storage.objects;
create policy avatars_owner_write
on storage.objects
for all
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
