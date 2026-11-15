-- Brand collaborations: roles, brands, product catalogs, and storage.

alter table public.users
  add column if not exists role text;

update public.users
set role = 'user'
where role is null;

alter table public.users
  alter column role set default 'user';

alter table public.users
  alter column role set not null;

alter table public.users
  drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check check (role in ('admin', 'user'));

create or replace function public.prevent_user_role_change()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role and auth.role() = 'authenticated' then
    raise exception 'You cannot change your role';
  end if;
  return new;
end;
$$;

drop trigger if exists users_prevent_role_change on public.users;

create trigger users_prevent_role_change
before update on public.users
for each row
execute function public.prevent_user_role_change();

create or replace function public.force_user_role_on_insert()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'authenticated' then
    new.role := 'user';
  end if;
  if new.role is null then
    new.role := 'user';
  end if;
  return new;
end;
$$;

drop trigger if exists users_force_role_on_insert on public.users;

create trigger users_force_role_on_insert
before insert on public.users
for each row
execute function public.force_user_role_on_insert();

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text,
  logo_url text,
  owner_user_id uuid not null unique references public.users (id) on delete cascade,
  created_by uuid references public.users (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.brand_products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text,
  price numeric(10, 2) check (price is null or price >= 0),
  category text,
  image_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brand_products_brand_id_idx
  on public.brand_products (brand_id);

create or replace function public.set_brand_product_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists brand_products_set_updated_at on public.brand_products;

create trigger brand_products_set_updated_at
before update on public.brand_products
for each row
execute function public.set_brand_product_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.current_brand_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.brands
  where owner_user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.current_brand_id() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_brand_id() to authenticated;

alter table public.brands enable row level security;
alter table public.brand_products enable row level security;

create or replace function public.protect_brand_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'authenticated' and not public.is_admin() then
    new.id := old.id;
    new.owner_user_id := old.owner_user_id;
    new.created_by := old.created_by;
    new.is_active := old.is_active;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists brands_protect_columns on public.brands;

create trigger brands_protect_columns
before update on public.brands
for each row
execute function public.protect_brand_columns();

drop policy if exists brands_admin_all on public.brands;
create policy brands_admin_all
on public.brands
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists brands_owner_select on public.brands;
create policy brands_owner_select
on public.brands
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists brands_owner_update on public.brands;
create policy brands_owner_update
on public.brands
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists brands_public_select on public.brands;
create policy brands_public_select
on public.brands
for select
to authenticated
using (is_active = true);

drop policy if exists brand_products_admin_select on public.brand_products;
create policy brand_products_admin_select
on public.brand_products
for select
to authenticated
using (public.is_admin());

drop policy if exists brand_products_owner_all on public.brand_products;
create policy brand_products_owner_all
on public.brand_products
for all
to authenticated
using (brand_id = public.current_brand_id())
with check (brand_id = public.current_brand_id());

drop policy if exists brand_products_public_select on public.brand_products;
create policy brand_products_public_select
on public.brand_products
for select
to authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.brands
    where brands.id = brand_products.brand_id
      and brands.is_active = true
  )
);

insert into storage.buckets (id, name, public)
values ('brand-product-images', 'brand-product-images', true)
on conflict (id) do update set public = true;

drop policy if exists brand_images_public_read on storage.objects;
create policy brand_images_public_read
on storage.objects
for select
to public
using (bucket_id = 'brand-product-images');

drop policy if exists brand_images_owner_insert on storage.objects;
create policy brand_images_owner_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'brand-product-images'
  and (storage.foldername(name))[1] = public.current_brand_id()::text
);

drop policy if exists brand_images_owner_update on storage.objects;
create policy brand_images_owner_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'brand-product-images'
  and (storage.foldername(name))[1] = public.current_brand_id()::text
)
with check (
  bucket_id = 'brand-product-images'
  and (storage.foldername(name))[1] = public.current_brand_id()::text
);

drop policy if exists brand_images_owner_delete on storage.objects;
create policy brand_images_owner_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'brand-product-images'
  and (storage.foldername(name))[1] = public.current_brand_id()::text
);

drop policy if exists brand_images_admin_write on storage.objects;
create policy brand_images_admin_write
on storage.objects
for all
to authenticated
using (bucket_id = 'brand-product-images' and public.is_admin())
with check (bucket_id = 'brand-product-images' and public.is_admin());
