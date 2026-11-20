-- ============================================================================
-- MORGGY — 0003 storefront views and admin analytics
--
-- Views are `security_invoker`, so they inherit the caller's RLS: the storefront
-- sees published catalogue rows, staff see everything, and cost columns stay
-- visible only to staff.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Storefront product view: everything a product page needs in one row.
-- `availability` falls back to 'unknown' because inventory is staff-only.
-- ---------------------------------------------------------------------------
create view public.v_product_public with (security_invoker = true) as
select
  p.id,
  p.slug,
  p.name,
  p.sku,
  p.category_id,
  c.slug as category_slug,
  c.name as category_name,
  p.short_description,
  p.description,
  p.features,
  p.images,
  p.price_usd,
  p.compare_at_usd,
  p.weight_kg,
  p.length_cm,
  p.width_cm,
  p.height_cm,
  p.destinations,
  p.status,
  p.is_verified,
  p.created_at,
  coalesce(i.availability::text, 'unknown') as availability,
  (
    select coalesce(
      jsonb_agg(jsonb_build_object('name', v.name, 'options', v.options) order by v.position),
      '[]'::jsonb
    )
    from public.product_variants v
    where v.product_id = p.id
  ) as variants,
  (
    select coalesce(
      jsonb_object_agg(sm.market, jsonb_build_array(sm.min_days, sm.max_days)),
      '{}'::jsonb
    )
    from public.shipping_methods sm
    where sm.is_active and sm.market = any (p.destinations)
  ) as delivery_days
from public.products p
left join public.categories c on c.id = p.category_id
left join public.inventory i on i.product_id = p.id and i.variant_id is null;

grant select on public.v_product_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Per-line profit. Unit cost is the lowest mapped supplier cost for the
-- product; rows with no mapped supplier show a null cost rather than zero.
-- ---------------------------------------------------------------------------
create view public.v_order_profit with (security_invoker = true) as
select
  oi.order_id,
  oi.product_id,
  oi.name_snapshot,
  oi.quantity,
  oi.line_total_usd,
  sc.unit_cost_usd,
  case when sc.unit_cost_usd is null then null
       else oi.line_total_usd - (sc.unit_cost_usd * oi.quantity)
  end as gross_profit_usd,
  o.status,
  o.market,
  o.placed_at,
  o.paid_at
from public.order_items oi
join public.orders o on o.id = oi.order_id
left join lateral (
  select min(sp.cost_usd) as unit_cost_usd
  from public.supplier_products sp
  where sp.product_id = oi.product_id and sp.mapping_status = 'mapped'
) sc on true;

grant select on public.v_order_profit to authenticated;

-- ---------------------------------------------------------------------------
-- Product margin table for the dashboard product list.
-- ---------------------------------------------------------------------------
create view public.v_product_profit with (security_invoker = true) as
select
  p.id,
  p.slug,
  p.name,
  p.sku,
  p.price_usd,
  sc.unit_cost_usd,
  case
    when sc.unit_cost_usd is null or p.price_usd = 0 then null
    else round(((p.price_usd - sc.unit_cost_usd) / p.price_usd) * 100, 1)
  end as margin_pct,
  p.status,
  p.is_verified,
  coalesce(i.availability::text, 'unknown') as availability,
  i.quantity as on_hand,
  i.supplier_stock
from public.products p
left join lateral (
  select min(sp.cost_usd) as unit_cost_usd
  from public.supplier_products sp
  where sp.product_id = p.id and sp.mapping_status = 'mapped'
) sc on true
left join public.inventory i on i.product_id = p.id and i.variant_id is null;

grant select on public.v_product_profit to authenticated;

-- ---------------------------------------------------------------------------
-- Sales and profit summary for the dashboard overview.
-- ---------------------------------------------------------------------------
create function public.admin_sales_summary(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer := greatest(coalesce(p_days, 30), 1);
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  v_orders bigint := 0;
  v_paid bigint := 0;
  v_pending bigint := 0;
  v_revenue numeric := 0;
  v_shipping numeric := 0;
  v_profit numeric := 0;
  v_refunded numeric := 0;
begin
  if not public.is_staff() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  select count(*) into v_orders from public.orders o where o.placed_at >= v_since;

  select count(*), coalesce(sum(o.total_usd), 0), coalesce(sum(o.shipping_usd), 0)
    into v_paid, v_revenue, v_shipping
  from public.orders o
  where o.placed_at >= v_since
    and o.status not in ('pending_payment', 'cancelled');

  select count(*) into v_pending from public.orders o where o.status = 'pending_payment';

  select coalesce(sum(op.gross_profit_usd), 0)
    into v_profit
  from public.v_order_profit op
  join public.orders o on o.id = op.order_id
  where o.placed_at >= v_since
    and o.status not in ('pending_payment', 'cancelled');

  select coalesce(sum(r.amount_usd), 0)
    into v_refunded
  from public.refunds r
  where r.status = 'completed' and r.created_at >= v_since;

  return jsonb_build_object(
    'windowDays', v_days,
    'ordersTotal', v_orders,
    'paidOrders', v_paid,
    'pendingPayment', v_pending,
    'revenueUsd', v_revenue,
    'shippingRevenueUsd', v_shipping,
    'grossProfitUsd', v_profit,
    'refundedUsd', v_refunded,
    'averageOrderUsd', case when v_paid = 0 then 0 else round(v_revenue / v_paid, 2) end
  );
end;
$$;

create function public.admin_top_products(p_days integer default 30, p_limit integer default 8)
returns table (
  product_id uuid,
  name text,
  units bigint,
  revenue_usd numeric,
  gross_profit_usd numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_staff() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  return query
  select
    op.product_id,
    op.name_snapshot,
    sum(op.quantity)::bigint,
    sum(op.line_total_usd),
    sum(coalesce(op.gross_profit_usd, 0))
  from public.v_order_profit op
  join public.orders o on o.id = op.order_id
  where o.placed_at >= now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
    and o.status not in ('pending_payment', 'cancelled')
  group by op.product_id, op.name_snapshot
  order by sum(op.line_total_usd) desc
  limit greatest(coalesce(p_limit, 8), 1);
end;
$$;

revoke execute on function public.admin_sales_summary(integer) from public;
revoke execute on function public.admin_top_products(integer, integer) from public;
grant execute on function public.admin_sales_summary(integer) to authenticated;
grant execute on function public.admin_top_products(integer, integer) to authenticated;

commit;
