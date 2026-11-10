-- Demo shoe catalog: stand-in brand listings until real partner 3D assets arrive.
-- Inner mm values are invented for fit testing. Meshes come from local isaac/*.usdz
-- (upload to storage and set mesh_url when serving try-on).

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.shoes (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  slug text not null unique,
  name text not null,
  category text not null
    check (category in ('heel', 'sneaker', 'sandal', 'boot', 'bootie', 'flat', 'other')),
  listed boolean not null default true,
  mesh_url text,
  mesh_format text,
  mesh_local_file text,
  thumbnail_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.shoe_sizes (
  id uuid primary key default gen_random_uuid(),
  shoe_id uuid not null references public.shoes (id) on delete cascade,
  label text not null,
  length_mm double precision not null,
  forefoot_width_mm double precision,
  heel_width_mm double precision,
  unique (shoe_id, label)
);

create index if not exists shoes_brand_id_idx on public.shoes (brand_id);
create index if not exists shoes_listed_idx on public.shoes (listed);
create index if not exists shoe_sizes_shoe_id_idx on public.shoe_sizes (shoe_id);

alter table public.brands enable row level security;
alter table public.shoes enable row level security;
alter table public.shoe_sizes enable row level security;

-- Seed demo atelier (idempotent by slug).
insert into public.brands (slug, name, is_demo)
values ('closette-demo-atelier', 'Closette Demo Atelier', true)
on conflict (slug) do update set name = excluded.name, is_demo = true;

do $$
declare
  brand uuid;
  shoe uuid;
begin
  select id into brand from public.brands where slug = 'closette-demo-atelier';

  -- Studio Heel
  insert into public.shoes (brand_id, slug, name, category, listed, mesh_format, mesh_local_file)
  values (brand, 'demo-high-heel', 'Studio Heel', 'heel', true, 'usdz', 'isaac/high_heel.usdz')
  on conflict (slug) do update
    set name = excluded.name,
        category = excluded.category,
        mesh_format = excluded.mesh_format,
        mesh_local_file = excluded.mesh_local_file
  returning id into shoe;
  select id into shoe from public.shoes where slug = 'demo-high-heel';
  delete from public.shoe_sizes where shoe_id = shoe;
  insert into public.shoe_sizes (shoe_id, label, length_mm, forefoot_width_mm, heel_width_mm) values
    (shoe, 'EU 36', 230, 85, 60),
    (shoe, 'EU 37', 237, 87, 61),
    (shoe, 'EU 38', 243, 89, 62),
    (shoe, 'EU 39', 250, 91, 63),
    (shoe, 'EU 40', 257, 93, 64),
    (shoe, 'EU 41', 263, 95, 65);

  -- City Runner
  insert into public.shoes (brand_id, slug, name, category, listed, mesh_format, mesh_local_file)
  values (brand, 'demo-sneaker', 'City Runner', 'sneaker', true, 'usdz', 'isaac/sneaker.usdz')
  on conflict (slug) do update
    set name = excluded.name,
        category = excluded.category,
        mesh_format = excluded.mesh_format,
        mesh_local_file = excluded.mesh_local_file;
  select id into shoe from public.shoes where slug = 'demo-sneaker';
  delete from public.shoe_sizes where shoe_id = shoe;
  insert into public.shoe_sizes (shoe_id, label, length_mm, forefoot_width_mm, heel_width_mm) values
    (shoe, 'EU 38', 245, 94, 68),
    (shoe, 'EU 39', 251, 96, 69),
    (shoe, 'EU 40', 258, 98, 70),
    (shoe, 'EU 41', 264, 100, 71),
    (shoe, 'EU 42', 271, 102, 72),
    (shoe, 'EU 43', 277, 104, 73);

  -- Boardwalk Flip
  insert into public.shoes (brand_id, slug, name, category, listed, mesh_format, mesh_local_file)
  values (brand, 'demo-flip-flop', 'Boardwalk Flip', 'sandal', true, 'usdz', 'isaac/flip_flop.usdz')
  on conflict (slug) do update
    set name = excluded.name,
        category = excluded.category,
        mesh_format = excluded.mesh_format,
        mesh_local_file = excluded.mesh_local_file;
  select id into shoe from public.shoes where slug = 'demo-flip-flop';
  delete from public.shoe_sizes where shoe_id = shoe;
  insert into public.shoe_sizes (shoe_id, label, length_mm, forefoot_width_mm, heel_width_mm) values
    (shoe, 'EU 37', 235, 88, 58),
    (shoe, 'EU 38', 242, 90, 59),
    (shoe, 'EU 39', 248, 92, 60),
    (shoe, 'EU 40', 255, 94, 61),
    (shoe, 'EU 41', 261, 96, 62);

  -- Workshop Boot
  insert into public.shoes (brand_id, slug, name, category, listed, mesh_format, mesh_local_file)
  values (brand, 'demo-work-boot', 'Workshop Boot', 'boot', true, 'usdz', 'isaac/work_boot.usdz')
  on conflict (slug) do update
    set name = excluded.name,
        category = excluded.category,
        mesh_format = excluded.mesh_format,
        mesh_local_file = excluded.mesh_local_file;
  select id into shoe from public.shoes where slug = 'demo-work-boot';
  delete from public.shoe_sizes where shoe_id = shoe;
  insert into public.shoe_sizes (shoe_id, label, length_mm, forefoot_width_mm, heel_width_mm) values
    (shoe, 'EU 40', 260, 100, 74),
    (shoe, 'EU 41', 266, 102, 75),
    (shoe, 'EU 42', 273, 104, 76),
    (shoe, 'EU 43', 279, 106, 77),
    (shoe, 'EU 44', 286, 108, 78);
end $$;
