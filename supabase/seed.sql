-- ============================================================================
-- MORGGY — demo seed
--
-- EVERY PRODUCT HERE IS DEMO DATA.
--   * SKUs are prefixed DEMO- so they cannot be mistaken for live records.
--   * is_verified = false: no supplier mapping or stock has been confirmed.
--   * supplier_products rows are deliberately 'unmapped'.
--   * no orders, payments, reviews or sales figures are invented.
--
-- Run with:  supabase db reset      (migrations + seed)
--        or: psql "$DATABASE_URL" -f supabase/seed.sql
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
insert into public.categories (slug, name, blurb, image_url, position) values
  ('home-living', 'Home & Living',
   'Quiet upgrades for the desk, kitchen and everyday routines.', 'assets/img/p-002.jpg', 1),
  ('electronics-accessories', 'Electronics Accessories',
   'Charging, cables and the small things that keep devices alive.', 'assets/img/p-003.jpg', 2),
  ('travel-accessories', 'Travel Accessories',
   'Packing, weighing and carrying — built for short-haul trips.', 'assets/img/p-005.jpg', 3),
  ('lifestyle', 'Lifestyle',
   'Carry pieces and small daily objects with a clean, quiet look.', 'assets/img/p-007.jpg', 4),
  ('automotive-accessories', 'Automotive Accessories',
   'Mounts and practical add-ons for cars, bikes and scooters.', 'assets/img/p-008.jpg', 5),
  ('pet-accessories', 'Pet Accessories',
   'Grooming and care basics for small households with pets.', 'assets/img/p-009.jpg', 6)
on conflict (slug) do update
  set name = excluded.name,
      blurb = excluded.blurb,
      image_url = excluded.image_url,
      position = excluded.position;

-- ---------------------------------------------------------------------------
-- Supplier record (no credentials — the Edge Function holds those)
-- ---------------------------------------------------------------------------
insert into public.suppliers (name, code, is_active, notes) values
  ('CJdropshipping', 'cj', true, 'Demo record. No CJ API credentials are configured.')
on conflict (code) do update set name = excluded.name;

-- ---------------------------------------------------------------------------
-- Shipping rates charged to the customer
-- ---------------------------------------------------------------------------
insert into public.shipping_methods
  (market, name, carrier, flat_usd, per_additional_usd, min_days, max_days, is_active)
values
  ('SG', 'International tracked parcel', 'International tracked parcel', 3.90, 1.20, 5, 9, true),
  ('MY', 'International tracked parcel', 'International tracked parcel', 4.90, 1.50, 6, 10, true)
on conflict (market, name) do update
  set flat_usd = excluded.flat_usd,
      per_additional_usd = excluded.per_additional_usd,
      min_days = excluded.min_days,
      max_days = excluded.max_days,
      is_active = excluded.is_active;

-- ---------------------------------------------------------------------------
-- Display exchange rates (USD base)
-- ---------------------------------------------------------------------------
insert into public.exchange_rates (base_currency, quote_currency, rate, source, effective_at)
select 'USD', quote, rate, 'seed-demo', timestamptz '2026-11-01 00:00:00+00'
from (values ('SGD', 1.35000000), ('MYR', 4.70000000), ('VND', 26300.00000000))
  as t(quote, rate)
where not exists (
  select 1 from public.exchange_rates er
  where er.quote_currency = t.quote and er.source = 'seed-demo'
);

-- ---------------------------------------------------------------------------
-- Products — DEMO ONLY
-- ---------------------------------------------------------------------------
with demo (slug, name, sku, category_slug, short_description, description, features, images, price_usd, weight_kg, length_cm, width_cm, height_cm, created_at) as (
  values
  ('insulated-travel-tumbler', 'Insulated Travel Tumbler, 500 ml', 'DEMO-HL-001', 'home-living',
   'Double-wall stainless steel tumbler with a leak-resistant lid. Keeps drinks cold for a full working day.',
   'A 500 ml vacuum-insulated tumbler in matte powder-coated stainless steel. The double wall holds cold drinks for up to 24 hours and hot drinks for up to 8, and the screw lid seals shut for a commute or a desk session. Sized to fit standard car cup holders.',
   '["18/8 stainless steel, double-wall vacuum insulation","Leak-resistant screw lid with a silicone gasket","Fits standard car cup holders","Hand wash recommended"]'::jsonb,
   '["assets/img/p-001.jpg"]'::jsonb, 18.90, 0.340, 8.0, 8.0, 22.0, timestamptz '2026-11-10'),

  ('bamboo-desk-organiser', 'Bamboo Desk Organiser', 'DEMO-HL-002', 'home-living',
   'Solid bamboo tray with a phone slot and compartments for pens and cables.',
   'A compact organiser cut from solid bamboo with a phone slot, a pen well and two open compartments for cables and small tools. The natural finish warms up a desk without adding clutter.',
   '["Solid bamboo with a water-based finish","Phone slot angled for reading","Felt pads to protect desk surfaces","Assembly-free"]'::jsonb,
   '["assets/img/p-002.jpg"]'::jsonb, 24.50, 0.780, 28.0, 14.0, 9.0, timestamptz '2026-11-10'),

  ('65w-gan-fast-charger', '65W GaN Fast Charger, 2 Ports', 'DEMO-EL-001', 'electronics-accessories',
   'Two USB-C ports, 65W shared. Small enough for a pocket, strong enough for a laptop.',
   'A gallium nitride charger that replaces a laptop brick and a phone plug with one unit. Delivers up to 65W across two USB-C ports with automatic power sharing, and the folded pins keep it flat in a bag.',
   '["USB-C PD 3.0, up to 65W total","GaN construction for a smaller footprint","Foldable plug pins","Over-current and over-heat protection"]'::jsonb,
   '["assets/img/p-003.jpg"]'::jsonb, 26.00, 0.140, 6.5, 6.5, 3.2, timestamptz '2026-11-12'),

  ('braided-usb-c-cable-set', 'Braided USB-C Cable Set (3)', 'DEMO-EL-002', 'electronics-accessories',
   'Three nylon-braided USB-C cables in 0.3 m, 1 m and 1.8 m lengths.',
   'A set of three USB-C to USB-C cables with braided nylon jackets and reinforced connectors. Rated for 60W charging and 480 Mbps data, with a velcro tie on each cable.',
   '["60W charging, 480 Mbps data","Braided nylon jacket, aluminium connectors","0.3 m, 1 m and 1.8 m lengths","Velcro cable ties included"]'::jsonb,
   '["assets/img/p-004.jpg"]'::jsonb, 12.90, 0.120, 18.0, 12.0, 3.0, timestamptz '2026-11-12'),

  ('compression-packing-cubes', 'Compression Packing Cube Set (4)', 'DEMO-TR-001', 'travel-accessories',
   'Four zip-compression cubes that flatten a week of clothes into a carry-on.',
   'A four-piece set — two medium, one small, one shoe bag — in ripstop nylon. A second zip compresses each cube so packed clothes take up noticeably less space in a cabin bag.',
   '["Ripstop nylon with mesh tops","Two-way compression zips","Two medium, one small, one shoe bag","Weighs 380 g for the set"]'::jsonb,
   '["assets/img/p-005.jpg"]'::jsonb, 22.00, 0.380, 30.0, 22.0, 8.0, timestamptz '2026-11-14'),

  ('digital-luggage-scale', 'Digital Luggage Scale', 'DEMO-TR-002', 'travel-accessories',
   'Handheld scale to 50 kg with a strap hook and a hold display.',
   'A compact luggage scale that weighs up to 50 kg in 50 g steps. The display holds the reading after the bag is set down, and the strap hook works with soft and hard cases.',
   '["Up to 50 kg, 50 g resolution","Hold function for easy reading","Kilogram and pound modes","Runs on one CR2032 cell (included)"]'::jsonb,
   '["assets/img/p-006.jpg"]'::jsonb, 14.50, 0.110, 14.0, 8.0, 3.0, timestamptz '2026-11-14'),

  ('slim-rfid-card-holder', 'Slim RFID Card Holder', 'DEMO-LS-001', 'lifestyle',
   'Six-card holder in vegetable-tanned leather with RFID shielding.',
   'A slim card holder in vegetable-tanned leather that takes six cards and a folded note. The inner lining blocks contactless skimming, and the leather darkens with use.',
   '["Vegetable-tanned leather, edge-painted","Holds six cards plus folded notes","RFID-blocking lining","7 mm thick when empty"]'::jsonb,
   '["assets/img/p-007.jpg"]'::jsonb, 16.00, 0.060, 10.5, 7.5, 1.0, timestamptz '2026-11-16'),

  ('waterproof-motorbike-phone-mount', 'Waterproof Motorbike Phone Mount', 'DEMO-AU-001', 'automotive-accessories',
   'Handlebar clamp with a rain cover and a touch-sensitive window.',
   'A handlebar mount with a 360° ball joint and a sealed rain cover that still passes touch input. Fits bars from 22 to 32 mm and takes phones up to 6.8 inches — built for daily riding in heavy rain.',
   '["Fits 22–32 mm handlebars","Sealed rain cover, touch-sensitive window","360° rotation with a locking collar","Tool-free install"]'::jsonb,
   '["assets/img/p-008.jpg"]'::jsonb, 15.50, 0.210, 12.0, 9.0, 6.0, timestamptz '2026-11-16'),

  ('silicone-pet-grooming-glove', 'Silicone Pet Grooming Glove', 'DEMO-PT-001', 'pet-accessories',
   'Soft-tip grooming glove for short and medium coats.',
   'A silicone glove with 255 soft rubber tips that lifts loose hair while petting. The mesh back keeps the hand cool and the hair peels off the glove in one piece.',
   '["255 soft silicone tips","Breathable mesh back","Fits left or right hand","Hair lifts off in a single sheet"]'::jsonb,
   '["assets/img/p-009.jpg"]'::jsonb, 13.90, 0.090, 24.0, 15.0, 2.0, timestamptz '2026-11-18')
)
insert into public.products
  (slug, name, sku, category_id, short_description, description, features, images,
   price_usd, weight_kg, length_cm, width_cm, height_cm, destinations, status, is_verified, created_at)
select
  d.slug, d.name, d.sku,
  (select c.id from public.categories c where c.slug = d.category_slug),
  d.short_description, d.description, d.features, d.images,
  d.price_usd, d.weight_kg, d.length_cm, d.width_cm, d.height_cm,
  array['SG', 'MY']::text[], 'published'::public.product_status, false, d.created_at
from demo d
on conflict (slug) do nothing;

-- Variants (demo)
insert into public.product_variants (product_id, name, options, position)
select p.id, v.name, v.options::jsonb, v.position
from (values
  ('insulated-travel-tumbler', 'Colour', '["Sand","Forest","Cream"]', 1),
  ('compression-packing-cubes', 'Colour', '["Cream","Sage"]', 1),
  ('slim-rfid-card-holder', 'Colour', '["Forest","Black","Tan"]', 1),
  ('silicone-pet-grooming-glove', 'Colour', '["Sage","Charcoal"]', 1)
) as v(slug, name, options, position)
join public.products p on p.slug = v.slug
on conflict (product_id, name) do nothing;

-- Inventory rows: unknown until a supplier check has actually run.
insert into public.inventory (product_id, variant_id, quantity, availability, checked_at)
select p.id, null, 0, 'unknown'::public.availability_status, null
from public.products p
where p.sku like 'DEMO-%'
  and not exists (
    select 1 from public.inventory i where i.product_id = p.id and i.variant_id is null
  );

-- Supplier mapping rows exist but are unmapped: no CJ product id is invented.
insert into public.supplier_products (product_id, supplier_id, mapping_status)
select p.id, s.id, 'unmapped'::public.mapping_status
from public.products p
cross join public.suppliers s
where p.sku like 'DEMO-%' and s.code = 'cj'
  and not exists (
    select 1 from public.supplier_products sp where sp.product_id = p.id and sp.supplier_id = s.id
  );

commit;

-- ---------------------------------------------------------------------------
-- After creating your own account, promote it to admin:
--
--   update public.profiles set role = 'admin' where email = 'you@example.com';
--
-- Do that from the SQL editor (or the service role), never from the browser.
-- ---------------------------------------------------------------------------
