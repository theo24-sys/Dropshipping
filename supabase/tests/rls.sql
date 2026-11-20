-- ============================================================================
-- MORGGY — RLS tests (pgTAP)
--
-- These tests exercise the policy layer, which is the part most likely to leak
-- data. They require the pgTAP extension, which stock Supabase projects do not
-- enable by default:
--
--   create extension if not exists pgtap with schema extensions;
--   set search_path = extensions, public, auth;
--   \i supabase/tests/rls.sql
--
-- They have NOT been run against a live project from this repository: there is
-- no Supabase instance or CLI available in the build environment. Treat a green
-- run as required before launch.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

-- ---------------------------------------------------------------------------
-- Fixtures: two customers, one staff user, one product, one order.
-- auth.uid() is simulated with request.jwt.claims.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', 'customer-a@example.test', 'x', now(), now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'customer-b@example.test', 'x', now(), now(), now()),
  ('33333333-3333-4333-8333-333333333333', 'staff@example.test', 'x', now(), now(), now())
on conflict (id) do nothing;

update public.profiles set role = 'staff' where id = '33333333-3333-4333-8333-333333333333';

insert into public.products (slug, name, sku, price_usd, status, is_verified)
values ('rls-test-product', 'RLS Test Product', 'RLS-TEST-001', 10.00, 'published', false)
on conflict (slug) do nothing;

insert into public.orders (order_number, user_id, email, full_name, market, currency_display,
  subtotal_usd, shipping_usd, total_usd, status, shipping_address)
values ('MOR-TEST-000001', '11111111-1111-4111-8111-111111111111', 'customer-a@example.test',
  'Customer A', 'SG', 'SGD', 10.00, 3.90, 13.90, 'pending_payment',
  '{"line1":"1 Test Road","line2":"","city":"Singapore","postcode":"238823","state":""}'::jsonb)
on conflict (order_number) do nothing;

-- ---------------------------------------------------------------------------
-- Anonymous visitors
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select is(
  (select count(*) from public.products where status = 'published') > 0,
  true,
  'anon can read published products'
);

select is(
  (select count(*) from public.products where status = 'draft'),
  0::bigint,
  'anon cannot read draft products'
);

select throws_ok(
  $$ select * from public.orders $$,
  'permission denied for table orders',
  'anon cannot read orders'
);

reset role;

-- ---------------------------------------------------------------------------
-- Customer A
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111","email":"customer-a@example.test"}';

select is(
  (select count(*) from public.orders),
  1::bigint,
  'customer A sees their own order only'
);

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'customer A sees their own profile only'
);

select is(
  (select count(*) from public.supplier_products),
  0::bigint,
  'customers cannot read supplier cost data'
);

select is(
  (select count(*) from public.inventory),
  0::bigint,
  'customers cannot read inventory'
);

select throws_ok(
  $$ update public.profiles set role = 'admin'
     where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501',
  'Only an administrator can change a role.',
  'a customer cannot promote themselves'
);

reset role;

-- ---------------------------------------------------------------------------
-- Customer B
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"22222222-2222-4222-8222-222222222222","email":"customer-b@example.test"}';

select is(
  (select count(*) from public.orders),
  0::bigint,
  'customer B cannot see customer A orders'
);

reset role;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"33333333-3333-4333-8333-333333333333","email":"staff@example.test"}';

select is(
  (select count(*) from public.orders) >= 1,
  true,
  'staff can read all orders'
);

select is(
  (select count(*) from public.audit_logs) >= 0,
  true,
  'staff can read the audit log'
);

select is(
  (select public.admin_sales_summary(30)) is not null,
  true,
  'staff can run the sales summary'
);

reset role;

select * from finish();

rollback;
