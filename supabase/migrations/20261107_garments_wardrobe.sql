-- Closette wardrobe garments: cutout PNG in storage + classification fields.
-- Apply after 20261007_foot_model.sql (needs public.profiles).
-- Create the wardrobe-images bucket in the Supabase dashboard (public read is fine for demos).

create table if not exists public.garments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  category text,
  subcategory text,
  confidence double precision,
  color jsonb,
  pattern jsonb,
  texture jsonb,
  bbox jsonb,
  cutout_path text not null,
  cutout_url text,
  lighting jsonb,
  model_version text,
  type_model_version text,
  created_at timestamptz not null default now()
);

create index if not exists garments_profile_id_idx on public.garments (profile_id);
create index if not exists garments_subcategory_idx on public.garments (subcategory);

alter table public.garments enable row level security;
