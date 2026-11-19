-- Muse-ready brand product attributes for marketplace taste / weather testing.
-- External image_url lets demo seeds use real Unsplash photos without storage uploads.

alter table public.brand_products
  add column if not exists image_url text,
  add column if not exists subcategory text,
  add column if not exists primary_color text,
  add column if not exists secondary_colors text[] not null default '{}',
  add column if not exists formality text,
  add column if not exists gender text,
  add column if not exists style_tags text[] not null default '{}',
  add column if not exists pattern text,
  add column if not exists temperature_min_c double precision,
  add column if not exists temperature_max_c double precision;

comment on column public.brand_products.image_url is
  'Optional absolute product image URL (e.g. Unsplash). Preferred over storage image_path when set.';
comment on column public.brand_products.subcategory is
  'Muse taxonomy subcategory (jeans, blazer, raincoat, …).';
