-- ============================================================================
-- MORGGY — 0002 authentication, roles, row level security and audit logging
--
-- Rules:
--   * catalogue rows that are published are readable by anyone;
--   * customers read and edit only their own profile, addresses and orders;
--   * cost, supplier and inventory data is staff-only;
--   * orders, payments, refunds and webhook events are written only by the
--     service role inside Edge Functions — never by a browser.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Role helpers. SECURITY DEFINER so the policy check does not recurse through
-- profiles' own RLS.
-- ---------------------------------------------------------------------------
create function public.current_user_role() returns public.user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid();
$$;

create function public.is_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select p.role in ('staff', 'admin') from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select p.role = 'admin' from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- True when the caller owns the order: by user id, or by the verified email on
-- the JWT (this is what makes guest order lookup work).
create function public.owns_order(p_order_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and (
        (auth.uid() is not null and o.user_id = auth.uid())
        or (auth.uid() is not null
            and lower(o.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
      )
  );
$$;

revoke execute on function public.owns_order(uuid) from public;
grant execute on function public.owns_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Profile lifecycle
-- ---------------------------------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name, market)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    case
      when new.raw_user_meta_data ->> 'market' in ('SG', 'MY', 'VN')
        then new.raw_user_meta_data ->> 'market'
      else null
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep the profile email in step when the address changes in GoTrue.
create function public.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- A customer may edit their own profile but never their own role.
-- auth.uid() is null for the service role, which is allowed through.
create function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only an administrator can change a role.' using errcode = '42501';
    end if;
    if new.id is distinct from old.id then
      raise exception 'A profile id cannot be changed.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_products enable row level security;
alter table public.inventory enable row level security;
alter table public.shipping_methods enable row level security;
alter table public.addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.shipments enable row level security;
alter table public.refunds enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.audit_logs enable row level security;
alter table public.webhook_events enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create policy categories_read on public.categories
  for select to anon, authenticated
  using (is_active or public.is_staff());

create policy categories_write on public.categories
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create policy products_read on public.products
  for select to anon, authenticated
  using (status = 'published' or public.is_staff());

create policy products_write on public.products
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- product_variants — visible with their product
-- ---------------------------------------------------------------------------
create policy variants_read on public.product_variants
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_id and (p.status = 'published' or public.is_staff())
    )
  );

create policy variants_write on public.product_variants
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- suppliers, supplier_products, inventory — staff only (cost data)
-- ---------------------------------------------------------------------------
create policy suppliers_staff_all on public.suppliers
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy supplier_products_staff_all on public.supplier_products
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy inventory_staff_all on public.inventory
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- shipping_methods — readable so the storefront can quote delivery
-- ---------------------------------------------------------------------------
create policy shipping_methods_read on public.shipping_methods
  for select to anon, authenticated
  using (is_active or public.is_staff());

create policy shipping_methods_write on public.shipping_methods
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- addresses — a customer's own addresses only
-- ---------------------------------------------------------------------------
create policy addresses_select_own on public.addresses
  for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

create policy addresses_insert_own on public.addresses
  for insert to authenticated
  with check (user_id = auth.uid());

create policy addresses_update_own on public.addresses
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy addresses_delete_own on public.addresses
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- orders — read own, written only by Edge Functions (service role)
-- ---------------------------------------------------------------------------
create policy orders_read_own on public.orders
  for select to authenticated
  using (
    (user_id is not null and user_id = auth.uid())
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or public.is_staff()
  );

create policy orders_staff_update on public.orders
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy order_items_read_own on public.order_items
  for select to authenticated
  using (public.owns_order(order_id) or public.is_staff());

create policy payments_read_own on public.payments
  for select to authenticated
  using (public.owns_order(order_id) or public.is_staff());

create policy shipments_read_own on public.shipments
  for select to authenticated
  using (public.owns_order(order_id) or public.is_staff());

create policy refunds_read_own on public.refunds
  for select to authenticated
  using (public.owns_order(order_id) or public.is_staff());

-- Staff may move refunds through their lifecycle. Amounts and orders are
-- immutable here; a refund is created by staff and processed server-side.
create policy refunds_staff_write on public.refunds
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy payments_staff_update on public.payments
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy shipments_staff_write on public.shipments
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- exchange_rates / audit_logs
-- ---------------------------------------------------------------------------
create policy exchange_rates_read on public.exchange_rates
  for select to anon, authenticated
  using (true);

create policy exchange_rates_write on public.exchange_rates
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy audit_logs_read_staff on public.audit_logs
  for select to authenticated
  using (public.is_staff());

-- webhook_events has RLS enabled and no policy: only the service role
-- (which bypasses RLS) can read or write it.

-- ---------------------------------------------------------------------------
-- Audit logging for administrative writes
-- ---------------------------------------------------------------------------
create function public.log_audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_id text;
begin
  select email into v_email from public.profiles where id = v_actor;

  if tg_op = 'DELETE' then
    v_id := old.id::text;
  else
    v_id := new.id::text;
  end if;

  insert into public.audit_logs (actor_id, actor_email, action, entity, entity_id, before, after)
  values (
    v_actor,
    v_email,
    lower(tg_op),
    tg_table_name,
    v_id,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger products_audit after insert or update or delete on public.products
  for each row execute function public.log_audit_row();
create trigger supplier_products_audit after insert or update or delete on public.supplier_products
  for each row execute function public.log_audit_row();
create trigger inventory_audit after insert or update or delete on public.inventory
  for each row execute function public.log_audit_row();
create trigger shipping_methods_audit after insert or update or delete on public.shipping_methods
  for each row execute function public.log_audit_row();
create trigger orders_audit after update on public.orders
  for each row execute function public.log_audit_row();
create trigger payments_audit after update on public.payments
  for each row execute function public.log_audit_row();
create trigger refunds_audit after insert or update or delete on public.refunds
  for each row execute function public.log_audit_row();

commit;
