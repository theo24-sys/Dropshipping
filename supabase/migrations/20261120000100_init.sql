-- ============================================================================
-- MORGGY — 0001 core schema
-- Money is stored in USD (numeric(10,2)). Local currencies are display only.
-- Every timestamp is timestamptz. Destructive changes are avoided on purpose:
-- orders keep snapshots of what was sold.
-- ============================================================================
begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('customer', 'staff', 'admin');
create type public.product_status as enum ('draft', 'published', 'archived');
create type public.mapping_status as enum ('unmapped', 'mapped', 'needs_review');
create type public.availability_status as enum ('unknown', 'in_stock', 'out_of_stock', 'preorder');
create type public.order_status as enum (
  'pending_payment', 'paid', 'processing', 'submitted', 'shipped',
  'delivered', 'cancelled', 'refunded'
);
create type public.payment_provider as enum ('paystack', 'flutterwave');
create type public.payment_status as enum (
  'initialised', 'pending', 'succeeded', 'failed', 'abandoned',
  'refunded', 'partially_refunded'
);
create type public.shipment_status as enum ('pending', 'label_created', 'in_transit', 'delivered', 'exception', 'returned');
create type public.refund_status as enum ('requested', 'approved', 'processing', 'completed', 'rejected', 'failed');

-- ---------------------------------------------------------------------------
-- updated_at helper (used by triggers below)
-- ---------------------------------------------------------------------------
create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user, created by a trigger on auth.users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text check (full_name is null or char_length(full_name) between 1 and 120),
  phone text check (phone is null or phone ~ '^\+?[0-9 ()-]{7,20}$'),
  role public.user_role not null default 'customer',
  market text check (market in ('SG', 'MY', 'VN')),
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_lower_key on public.profiles (lower(email));
create index profiles_role_idx on public.profiles (role);

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 80),
  blurb text,
  image_url text,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index categories_position_idx on public.categories (position, name);

-- ---------------------------------------------------------------------------
-- suppliers — the platforms we buy from. No credentials are stored here.
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique check (code ~ '^[a-z0-9_-]{2,40}$'),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 3 and 160),
  category_id uuid references public.categories (id) on delete restrict,
  sku text not null unique check (char_length(sku) between 3 and 40),
  short_description text,
  description text,
  features jsonb not null default '[]'::jsonb check (jsonb_typeof(features) = 'array'),
  images jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  price_usd numeric(10, 2) not null check (price_usd > 0),
  compare_at_usd numeric(10, 2) check (compare_at_usd is null or compare_at_usd > price_usd),
  weight_kg numeric(6, 3) check (weight_kg is null or weight_kg > 0),
  length_cm numeric(6, 1) check (length_cm is null or length_cm > 0),
  width_cm numeric(6, 1) check (width_cm is null or width_cm > 0),
  height_cm numeric(6, 1) check (height_cm is null or height_cm > 0),
  destinations text[] not null default array['SG', 'MY']::text[]
    check (destinations <@ array['SG', 'MY', 'VN']::text[] and array_length(destinations, 1) > 0),
  status public.product_status not null default 'draft',
  is_verified boolean not null default false,
  verified_at timestamptz,
  verified_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_verified_has_timestamp
    check (not is_verified or verified_at is not null)
);

create index products_status_created_idx on public.products (status, created_at desc);
create index products_category_idx on public.products (category_id);
create index products_verified_idx on public.products (is_verified) where status = 'published';

-- ---------------------------------------------------------------------------
-- product_variants
-- ---------------------------------------------------------------------------
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, name)
);

create index product_variants_product_idx on public.product_variants (product_id, position);

-- ---------------------------------------------------------------------------
-- supplier_products — the mapping between a MORGGY product and a supplier item
-- ---------------------------------------------------------------------------
create table public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  supplier_product_id text,
  supplier_url text check (supplier_url is null or supplier_url ~* '^https?://'),
  cost_usd numeric(10, 2) check (cost_usd is null or cost_usd >= 0),
  shipping_cost_usd numeric(10, 2) check (shipping_cost_usd is null or shipping_cost_usd >= 0),
  mapping_status public.mapping_status not null default 'unmapped',
  last_synced_at timestamptz,
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_products_mapped_needs_id
    check (mapping_status <> 'mapped' or supplier_product_id is not null)
);

create unique index supplier_products_supplier_item_key
  on public.supplier_products (supplier_id, supplier_product_id)
  where supplier_product_id is not null;
create index supplier_products_product_idx on public.supplier_products (product_id);
create index supplier_products_mapping_idx on public.supplier_products (mapping_status);

-- ---------------------------------------------------------------------------
-- inventory — one row per product (variant_id null) and per variant
-- ---------------------------------------------------------------------------
create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  supplier_stock integer check (supplier_stock is null or supplier_stock >= 0),
  availability public.availability_status not null default 'unknown',
  checked_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint inventory_reserved_lte_quantity check (reserved <= quantity)
);

create unique index inventory_product_variant_key
  on public.inventory (product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index inventory_product_idx on public.inventory (product_id);

-- ---------------------------------------------------------------------------
-- shipping_methods — the rate we charge the customer per destination
-- ---------------------------------------------------------------------------
create table public.shipping_methods (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market in ('SG', 'MY', 'VN')),
  name text not null,
  carrier text,
  flat_usd numeric(10, 2) not null check (flat_usd >= 0),
  per_additional_usd numeric(10, 2) not null default 0 check (per_additional_usd >= 0),
  min_days integer not null check (min_days > 0),
  max_days integer not null check (max_days >= min_days),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market, name)
);

create index shipping_methods_market_idx on public.shipping_methods (market) where is_active;

-- ---------------------------------------------------------------------------
-- addresses — saved customer addresses
-- ---------------------------------------------------------------------------
create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text,
  full_name text not null,
  phone text not null,
  line1 text not null,
  line2 text,
  city text,
  postcode text,
  state text,
  market text not null check (market in ('SG', 'MY', 'VN')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index addresses_user_idx on public.addresses (user_id, created_at desc);
create unique index addresses_one_default_per_user
  on public.addresses (user_id) where is_default;

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create sequence public.order_number_seq start 1000;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid references public.profiles (id) on delete set null,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text not null,
  phone text,
  market text not null check (market in ('SG', 'MY')),
  currency_display text not null,
  subtotal_usd numeric(10, 2) not null check (subtotal_usd >= 0),
  shipping_usd numeric(10, 2) not null check (shipping_usd >= 0),
  total_usd numeric(10, 2) not null check (total_usd > 0),
  status public.order_status not null default 'pending_payment',
  shipping_address jsonb not null,
  customer_note text,
  idempotency_key text unique,
  placed_at timestamptz not null default now(),
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_is_sum check (total_usd = subtotal_usd + shipping_usd),
  constraint orders_paid_has_timestamp
    check (status in ('pending_payment', 'cancelled') or paid_at is not null)
);

create index orders_user_idx on public.orders (user_id, placed_at desc);
create index orders_email_idx on public.orders (lower(email));
create index orders_status_idx on public.orders (status, placed_at desc);

create function public.set_order_number() returns trigger
language plpgsql as $$
begin
  if new.order_number is null or btrim(new.order_number) = '' then
    new.order_number :=
      'MOR-' || to_char(coalesce(new.placed_at, now()), 'YYYY') || '-' ||
      lpad(nextval('public.order_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger orders_set_number
  before insert on public.orders
  for each row execute function public.set_order_number();

-- ---------------------------------------------------------------------------
-- order_items — snapshot of what was sold, priced at the time of sale
-- ---------------------------------------------------------------------------
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete restrict,
  variant_id uuid references public.product_variants (id) on delete set null,
  name_snapshot text not null,
  sku_snapshot text not null,
  variant_label text,
  supplier_sku_snapshot text,
  quantity integer not null check (quantity between 1 and 20),
  unit_price_usd numeric(10, 2) not null check (unit_price_usd > 0),
  line_total_usd numeric(10, 2) not null check (line_total_usd > 0),
  created_at timestamptz not null default now(),
  constraint order_items_line_total check (line_total_usd = unit_price_usd * quantity)
);

create unique index order_items_unique_line
  on public.order_items (order_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index order_items_order_idx on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_id);

-- ---------------------------------------------------------------------------
-- payments — written only by the payment Edge Functions (service role)
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  provider public.payment_provider not null,
  provider_reference text,
  amount_usd numeric(10, 2) not null check (amount_usd > 0),
  provider_amount numeric(14, 2),
  provider_currency text,
  status public.payment_status not null default 'initialised',
  authorization_url text,
  failure_reason text,
  raw_payload jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index payments_provider_reference_key
  on public.payments (provider, provider_reference)
  where provider_reference is not null;
create index payments_order_idx on public.payments (order_id, created_at desc);
create index payments_status_idx on public.payments (status);

-- ---------------------------------------------------------------------------
-- shipments
-- ---------------------------------------------------------------------------
create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  supplier_id uuid references public.suppliers (id) on delete set null,
  carrier text,
  tracking_number text,
  tracking_url text check (tracking_url is null or tracking_url ~* '^https?://'),
  status public.shipment_status not null default 'pending',
  supplier_order_reference text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index shipments_carrier_tracking_key
  on public.shipments (carrier, tracking_number)
  where tracking_number is not null;
create index shipments_order_idx on public.shipments (order_id);

-- ---------------------------------------------------------------------------
-- refunds
-- ---------------------------------------------------------------------------
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  payment_id uuid references public.payments (id) on delete set null,
  amount_usd numeric(10, 2) not null check (amount_usd > 0),
  reason text,
  status public.refund_status not null default 'requested',
  provider_refund_reference text,
  processed_by uuid references public.profiles (id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index refunds_order_idx on public.refunds (order_id);
create index refunds_status_idx on public.refunds (status);

-- ---------------------------------------------------------------------------
-- exchange_rates — append-only history; the newest row per quote wins
-- ---------------------------------------------------------------------------
create table public.exchange_rates (
  id bigserial primary key,
  base_currency char(3) not null default 'USD' check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency char(3) not null check (quote_currency ~ '^[A-Z]{3}$'),
  rate numeric(18, 8) not null check (rate > 0),
  source text not null default 'manual',
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (base_currency, quote_currency, effective_at)
);

create index exchange_rates_quote_idx on public.exchange_rates (quote_currency, effective_at desc);

-- ---------------------------------------------------------------------------
-- audit_logs — administrative and system actions
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigserial primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_email text,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  ip inet,
  created_at timestamptz not null default now()
);

create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id);

-- ---------------------------------------------------------------------------
-- webhook_events — idempotency guard for provider webhooks
-- ---------------------------------------------------------------------------
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider public.payment_provider not null,
  provider_event_id text not null,
  event_type text,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger profiles_touch before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger categories_touch before update on public.categories
  for each row execute function public.set_updated_at();
create trigger suppliers_touch before update on public.suppliers
  for each row execute function public.set_updated_at();
create trigger products_touch before update on public.products
  for each row execute function public.set_updated_at();
create trigger product_variants_touch before update on public.product_variants
  for each row execute function public.set_updated_at();
create trigger supplier_products_touch before update on public.supplier_products
  for each row execute function public.set_updated_at();
create trigger inventory_touch before update on public.inventory
  for each row execute function public.set_updated_at();
create trigger shipping_methods_touch before update on public.shipping_methods
  for each row execute function public.set_updated_at();
create trigger addresses_touch before update on public.addresses
  for each row execute function public.set_updated_at();
create trigger orders_touch before update on public.orders
  for each row execute function public.set_updated_at();
create trigger payments_touch before update on public.payments
  for each row execute function public.set_updated_at();
create trigger shipments_touch before update on public.shipments
  for each row execute function public.set_updated_at();
create trigger refunds_touch before update on public.refunds
  for each row execute function public.set_updated_at();

commit;
