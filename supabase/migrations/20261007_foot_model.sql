-- Foot model from the Closette ER diagram.
-- Run this in the Supabase SQL editor (or `supabase db push`) before starting the API.
-- Partners, products, and AR try-on tables are intentionally not included yet.
--
-- An older prototype already created public.scans / public.scan_frames
-- (column scan_id, not foot_scan_id). Move those aside so this script can
-- create the new scan_frames table. Existing rows stay in *_legacy.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'scan_frames'
      and column_name = 'scan_id'
  ) then
    alter table public.scan_frames rename to scan_frames_legacy;
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'scans'
  ) and not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'scans_legacy'
  ) then
    alter table public.scans rename to scans_legacy;
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  role text not null default 'guest',
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.foot_scans (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  foot_side text not null check (foot_side in ('left', 'right')),
  status text not null default 'capturing'
    check (status in ('capturing', 'processing', 'ready', 'failed')),
  device_data jsonb,
  camera_intrinsics jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.scan_frames (
  id uuid primary key default gen_random_uuid(),
  foot_scan_id uuid not null references public.foot_scans (id) on delete cascade,
  capture_view text not null
    check (capture_view in ('top', 'front', 'left', 'right', 'heel')),
  storage_path text not null,
  pose_data jsonb,
  sharpness double precision,
  accepted boolean not null default true,
  captured_at timestamptz
);

create table if not exists public.scale_observations (
  id uuid primary key default gen_random_uuid(),
  foot_scan_id uuid not null references public.foot_scans (id) on delete cascade,
  scan_frame_id uuid not null references public.scan_frames (id) on delete cascade,
  scale_method text not null,
  pixels_per_mm double precision,
  confidence double precision,
  uncertainty_mm double precision,
  arcore_data jsonb
);

create table if not exists public.segmentation_results (
  id uuid primary key default gen_random_uuid(),
  scan_frame_id uuid not null references public.scan_frames (id) on delete cascade,
  mask_storage_path text,
  confidence double precision,
  model_name text,
  model_version text,
  created_at timestamptz not null default now()
);

create table if not exists public.foot_measurements (
  id uuid primary key default gen_random_uuid(),
  foot_scan_id uuid not null references public.foot_scans (id) on delete cascade,
  measurement_stage text not null,
  length_mm double precision,
  forefoot_width_mm double precision,
  heel_width_mm double precision,
  arch_height_mm double precision,
  confidence double precision,
  uncertainty_mm double precision,
  scale_method text,
  algorithm_version text
);

create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  foot_scan_id uuid not null references public.foot_scans (id) on delete cascade,
  job_type text not null,
  status text not null,
  retry_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.reconstruction_assets (
  id uuid primary key default gen_random_uuid(),
  foot_scan_id uuid not null references public.foot_scans (id) on delete cascade,
  asset_type text not null,
  storage_path text,
  file_format text,
  status text not null,
  created_at timestamptz not null default now()
);

create index if not exists foot_scans_profile_id_idx on public.foot_scans (profile_id);
create index if not exists scan_frames_foot_scan_id_idx on public.scan_frames (foot_scan_id);
create index if not exists scale_observations_foot_scan_id_idx on public.scale_observations (foot_scan_id);
create index if not exists segmentation_results_scan_frame_id_idx on public.segmentation_results (scan_frame_id);
create index if not exists foot_measurements_foot_scan_id_idx on public.foot_measurements (foot_scan_id);
create index if not exists processing_jobs_foot_scan_id_idx on public.processing_jobs (foot_scan_id);
create index if not exists reconstruction_assets_foot_scan_id_idx on public.reconstruction_assets (foot_scan_id);

alter table public.profiles enable row level security;
alter table public.foot_scans enable row level security;
alter table public.scan_frames enable row level security;
alter table public.scale_observations enable row level security;
alter table public.segmentation_results enable row level security;
alter table public.foot_measurements enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.reconstruction_assets enable row level security;
