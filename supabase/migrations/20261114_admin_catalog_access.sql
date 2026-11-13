-- Admin catalog access and soft account blocking.
-- Does not delete rows. Existing roles stay as they are.

alter table public.users
  add column if not exists disabled_at timestamptz;

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
  end if;
  return new;
end;
$$;

drop policy if exists brand_products_admin_select on public.brand_products;
drop policy if exists brand_products_admin_all on public.brand_products;

create policy brand_products_admin_all
on public.brand_products
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists users_admin_select on public.users;

create policy users_admin_select
on public.users
for select
to authenticated
using (public.is_admin());
