-- Idempotent Muse marketplace seed for taste / weather / suit structure testing.
-- Products are tagged with description prefix [muse-seed] and fixed UUIDs.

delete from public.brand_products
where description like '[muse-seed]%';

with
zara as (
  select id from public.brands where name = 'Zara' limit 1
),
bershka as (
  select id from public.brands where name = 'Bershka' limit 1
),
tami as (
  select id from public.brands where name = 'Tamisknits' limit 1
),
seed(id, brand_key, name, shop_category, subcategory, primary_color, formality, gender, pattern, style_tags, price, min_c, max_c, image_url, blurb) as (
  values
  -- Zara: formal / smart separates + one-piece suit (no pants pairing)
  ('a1000000-0000-4000-8000-000000000001'::uuid, 'zara', 'Navy Suit Jumpsuit', 'Dresses', 'jumpsuit', 'navy', 'formal', 'unisex', 'solid', array['classic','tailored'], 220.00, 8::float8, 28::float8,
   'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?auto=format&fit=crop&w=900&q=80',
   'One-piece tailored suit — Muse must not add pants.'),
  ('a1000000-0000-4000-8000-000000000002'::uuid, 'zara', 'Navy Soft Blazer', 'Outerwear', 'blazer', 'navy', 'formal', 'unisex', 'solid', array['classic','tailored'], 160.00, 5::float8, 24::float8,
   'https://images.unsplash.com/photo-1592878904946-b3cd8ae243d0?auto=format&fit=crop&w=900&q=80',
   'Pair with matching navy trousers, not jeans.'),
  ('a1000000-0000-4000-8000-000000000003'::uuid, 'zara', 'Navy Tailored Trousers', 'Bottoms', 'trousers', 'navy', 'formal', 'unisex', 'solid', array['classic','tailored'], 110.00, 0::float8, 26::float8,
   'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=900&q=80',
   'Matching suit bottom for the navy blazer.'),
  ('a1000000-0000-4000-8000-000000000004'::uuid, 'zara', 'Charcoal Suit Blazer', 'Outerwear', 'blazer', 'charcoal', 'formal', 'male', 'solid', array['classic'], 175.00, 5::float8, 22::float8,
   'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=900&q=80',
   'Formal charcoal jacket.'),
  ('a1000000-0000-4000-8000-000000000005'::uuid, 'zara', 'Charcoal Dress Trousers', 'Bottoms', 'trousers', 'charcoal', 'formal', 'male', 'solid', array['classic'], 120.00, 0::float8, 24::float8,
   'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=900&q=80',
   'Formal charcoal pants.'),
  ('a1000000-0000-4000-8000-000000000006'::uuid, 'zara', 'Crisp White Dress Shirt', 'Tops', 'shirt', 'white', 'formal', 'unisex', 'solid', array['classic'], 75.00, 10::float8, 30::float8,
   'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=900&q=80',
   'Formal shirt for suit looks.'),
  ('a1000000-0000-4000-8000-000000000007'::uuid, 'zara', 'Black Oxford Shoes', 'Shoes', 'formal-shoes', 'black', 'formal', 'male', 'solid', array['classic'], 140.00, -5::float8, 30::float8,
   'https://images.unsplash.com/photo-1614252231320-4577d49d9a39?auto=format&fit=crop&w=900&q=80',
   'Formal footwear.'),
  ('a1000000-0000-4000-8000-000000000008'::uuid, 'zara', 'Black Stiletto Heels', 'Shoes', 'heels', 'black', 'formal', 'female', 'solid', array['elegant'], 125.00, 5::float8, 32::float8,
   'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=900&q=80',
   'Formal heels — skip in rain/snow.'),
  ('a1000000-0000-4000-8000-000000000009'::uuid, 'zara', 'Ivory Silk Blouse', 'Tops', 'blouse', 'off-white', 'smart-casual', 'female', 'solid', array['elegant'], 88.00, 12::float8, 30::float8,
   'https://images.unsplash.com/photo-1564257631407-4deb1f99d992?auto=format&fit=crop&w=900&q=80',
   'Smart blouse.'),
  ('a1000000-0000-4000-8000-00000000000a'::uuid, 'zara', 'Black Pencil Skirt', 'Bottoms', 'skirt', 'black', 'formal', 'female', 'solid', array['classic'], 95.00, 8::float8, 28::float8,
   'https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=900&q=80',
   'Formal skirt.'),
  ('a1000000-0000-4000-8000-00000000000b'::uuid, 'zara', 'Emerald Wrap Dress', 'Dresses', 'dress', 'green', 'smart-casual', 'female', 'solid', array['elegant'], 130.00, 12::float8, 30::float8,
   'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=900&q=80',
   'One-piece dress — no bottoms.'),
  ('a1000000-0000-4000-8000-00000000000c'::uuid, 'zara', 'Camel Wool Overcoat', 'Outerwear', 'coat', 'beige', 'formal', 'unisex', 'solid', array['classic','layered'], 240.00, -5::float8, 14::float8,
   'https://images.unsplash.com/photo-1539533018447-63fcce2678e3?auto=format&fit=crop&w=900&q=80',
   'Cold-weather coat.'),

  -- Bershka: casual street + clash bait
  ('b1000000-0000-4000-8000-000000000001'::uuid, 'bershka', 'Indigo Straight Jeans', 'Bottoms', 'jeans', 'blue', 'casual', 'unisex', 'solid', array['street','denim'], 68.00, 5::float8, 30::float8,
   'https://images.unsplash.com/photo-1542272454315-7f6b6f66bf8f?auto=format&fit=crop&w=900&q=80',
   'Everyday denim.'),
  ('b1000000-0000-4000-8000-000000000002'::uuid, 'bershka', 'Black Slim Jeans', 'Bottoms', 'jeans', 'black', 'casual', 'unisex', 'solid', array['street','denim'], 72.00, 5::float8, 30::float8,
   'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=900&q=80',
   'Black denim.'),
  ('b1000000-0000-4000-8000-000000000003'::uuid, 'bershka', 'White Essential Tee', 'Tops', 't-shirt', 'white', 'casual', 'unisex', 'solid', array['minimal'], 28.00, 14::float8, 34::float8,
   'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80',
   'Bare tee — weak alone under 18°.'),
  ('b1000000-0000-4000-8000-000000000004'::uuid, 'bershka', 'Black Graphic Tee', 'Tops', 't-shirt', 'black', 'casual', 'unisex', 'print', array['street'], 32.00, 14::float8, 34::float8,
   'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&fit=crop&w=900&q=80',
   'Casual tee.'),
  ('b1000000-0000-4000-8000-000000000005'::uuid, 'bershka', 'Cloud Runner Sneakers', 'Shoes', 'sneakers', 'white', 'casual', 'unisex', 'solid', array['street'], 89.00, 0::float8, 35::float8,
   'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80',
   'Everyday sneakers.'),
  ('b1000000-0000-4000-8000-000000000006'::uuid, 'bershka', 'Charcoal Hoodie', 'Tops', 'hoodie', 'charcoal', 'casual', 'unisex', 'solid', array['street','layered'], 65.00, 4::float8, 22::float8,
   'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=900&q=80',
   'Cool-day layer.'),
  ('b1000000-0000-4000-8000-000000000007'::uuid, 'bershka', 'Linen Summer Shorts', 'Bottoms', 'shorts', 'beige', 'casual', 'unisex', 'solid', array['summer'], 48.00, 20::float8, 38::float8,
   'https://images.unsplash.com/photo-1591195853828-11db59a44f6b?auto=format&fit=crop&w=900&q=80',
   'Hot weather only.'),
  ('b1000000-0000-4000-8000-000000000008'::uuid, 'bershka', 'Neon Clash Track Pants', 'Bottoms', 'trousers', 'green', 'athletic', 'unisex', 'solid', array['sport'], 55.00, 8::float8, 28::float8,
   'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80',
   'Color/formality clash bait vs formal blazer.'),
  ('b1000000-0000-4000-8000-000000000009'::uuid, 'bershka', 'Red Statement Puffer', 'Outerwear', 'jacket', 'red', 'casual', 'unisex', 'solid', array['street'], 150.00, -8::float8, 12::float8,
   'https://images.unsplash.com/photo-1544923246-77307dd25855?auto=format&fit=crop&w=900&q=80',
   'Loud color cold jacket.'),
  ('b1000000-0000-4000-8000-00000000000a'::uuid, 'bershka', 'Striped Polo', 'Tops', 'polo', 'navy', 'smart-casual', 'male', 'striped', array['classic'], 45.00, 12::float8, 30::float8,
   'https://images.unsplash.com/photo-1586790170083-2f9ceadc732d?auto=format&fit=crop&w=900&q=80',
   'Patterned smart-casual top.'),
  ('b1000000-0000-4000-8000-00000000000b'::uuid, 'bershka', 'Tan Leather Belt', 'Accessories', 'belt', 'brown', 'smart-casual', 'unisex', 'solid', array['classic'], 35.00, -10::float8, 40::float8,
   'https://images.unsplash.com/photo-1624222247344-550fb60583fd?auto=format&fit=crop&w=900&q=80',
   'Accessory finish.'),
  ('b1000000-0000-4000-8000-00000000000c'::uuid, 'bershka', 'Canvas Tote Bag', 'Bags', 'bag', 'beige', 'casual', 'unisex', 'solid', array['minimal'], 40.00, -10::float8, 40::float8,
   'https://images.unsplash.com/photo-1590874103328-eac38a67437f?auto=format&fit=crop&w=900&q=80',
   'Casual bag.'),

  -- Tamisknits: weather / layers
  ('c1000000-0000-4000-8000-000000000001'::uuid, 'tami', 'Storm Shell Raincoat', 'Outerwear', 'raincoat', 'olive', 'smart-casual', 'unisex', 'solid', array['layered','weather'], 185.00, 2::float8, 20::float8,
   'https://images.unsplash.com/photo-1544923246-77307dd65459?auto=format&fit=crop&w=900&q=80',
   'Rain layer — prefer in wet weather.'),
  ('c1000000-0000-4000-8000-000000000002'::uuid, 'tami', 'Utility Field Jacket', 'Outerwear', 'jacket', 'olive', 'casual', 'unisex', 'solid', array['layered','street'], 145.00, 0::float8, 18::float8,
   'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=900&q=80',
   'Cool-day jacket.'),
  ('c1000000-0000-4000-8000-000000000003'::uuid, 'tami', 'Merino Crew Sweater', 'Tops', 'sweater', 'grey', 'smart-casual', 'unisex', 'solid', array['layered','knit'], 98.00, 0::float8, 18::float8,
   'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=900&q=80',
   'Knit layer for cold.'),
  ('c1000000-0000-4000-8000-000000000004'::uuid, 'tami', 'Cashmere Scarf', 'Accessories', 'scarf', 'beige', 'smart-casual', 'unisex', 'solid', array['layered'], 55.00, -10::float8, 15::float8,
   'https://images.unsplash.com/photo-1520903920243-00d872a2d1c9?auto=format&fit=crop&w=900&q=80',
   'Cold accessory.'),
  ('c1000000-0000-4000-8000-000000000005'::uuid, 'tami', 'Leather Chelsea Boots', 'Shoes', 'boots', 'brown', 'smart-casual', 'unisex', 'solid', array['classic'], 160.00, -5::float8, 22::float8,
   'https://images.unsplash.com/photo-1638247025967-b4cc0c7c8f6a?auto=format&fit=crop&w=900&q=80',
   'Cool/wet friendly boots.'),
  ('c1000000-0000-4000-8000-000000000006'::uuid, 'tami', 'Open Toe Sandals', 'Shoes', 'sandals', 'tan', 'casual', 'unisex', 'solid', array['summer'], 45.00, 22::float8, 40::float8,
   'https://images.unsplash.com/photo-1603487742131-4160ec999306?auto=format&fit=crop&w=900&q=80',
   'Hot only — unsuitable in rain/cold.'),
  ('c1000000-0000-4000-8000-000000000007'::uuid, 'tami', 'Black Leather Jacket', 'Outerwear', 'jacket', 'black', 'casual', 'unisex', 'solid', array['street','leather'], 210.00, 2::float8, 20::float8,
   'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=900&q=80',
   'Texture: leather.'),
  ('c1000000-0000-4000-8000-000000000008'::uuid, 'tami', 'Plaid Wool Blazer', 'Outerwear', 'blazer', 'grey', 'smart-casual', 'unisex', 'plaid', array['classic'], 155.00, 4::float8, 20::float8,
   'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?auto=format&fit=crop&w=900&q=80',
   'Patterned blazer for texture taste.'),
  ('c1000000-0000-4000-8000-000000000009'::uuid, 'tami', 'Chino Trousers', 'Bottoms', 'chinos', 'beige', 'smart-casual', 'unisex', 'solid', array['classic'], 80.00, 8::float8, 30::float8,
   'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=900&q=80',
   'Smart-casual bottoms.'),
  ('c1000000-0000-4000-8000-00000000000a'::uuid, 'tami', 'Navy Knit Polo', 'Tops', 'polo', 'navy', 'smart-casual', 'unisex', 'solid', array['classic'], 58.00, 10::float8, 28::float8,
   'https://images.unsplash.com/photo-1618354691373-d851c5c3a990?auto=format&fit=crop&w=900&q=80',
   'Smart casual top.'),
  ('c1000000-0000-4000-8000-00000000000b'::uuid, 'tami', 'Black Structured Tote', 'Bags', 'bag', 'black', 'smart-casual', 'unisex', 'solid', array['minimal'], 95.00, -10::float8, 40::float8,
   'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=900&q=80',
   'Smart bag.'),
  ('c1000000-0000-4000-8000-00000000000c'::uuid, 'tami', 'Wool Beanie', 'Accessories', 'hat', 'charcoal', 'casual', 'unisex', 'solid', array['layered'], 30.00, -15::float8, 10::float8,
   'https://images.unsplash.com/photo-1576871337632-b9aef4c17fa9?auto=format&fit=crop&w=900&q=80',
   'Cold hat.')
)
insert into public.brand_products (
  id, brand_id, name, description, price, category, image_url, is_active,
  subcategory, primary_color, formality, gender, pattern, style_tags,
  temperature_min_c, temperature_max_c
)
select
  s.id,
  case s.brand_key
    when 'zara' then (select id from zara)
    when 'bershka' then (select id from bershka)
    else (select id from tami)
  end,
  s.name,
  '[muse-seed] ' || s.blurb,
  s.price,
  s.shop_category,
  s.image_url,
  true,
  s.subcategory,
  s.primary_color,
  s.formality,
  s.gender,
  s.pattern,
  s.style_tags,
  s.min_c,
  s.max_c
from seed s
where case s.brand_key
  when 'zara' then (select id from zara)
  when 'bershka' then (select id from bershka)
  else (select id from tami)
end is not null
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  price = excluded.price,
  category = excluded.category,
  image_url = excluded.image_url,
  is_active = true,
  subcategory = excluded.subcategory,
  primary_color = excluded.primary_color,
  formality = excluded.formality,
  gender = excluded.gender,
  pattern = excluded.pattern,
  style_tags = excluded.style_tags,
  temperature_min_c = excluded.temperature_min_c,
  temperature_max_c = excluded.temperature_max_c,
  updated_at = now();
