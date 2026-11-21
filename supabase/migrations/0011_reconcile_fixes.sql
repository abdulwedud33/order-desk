-- 0011_reconcile_fixes.sql
-- Production reconcile migration: syncs all function overloads, RLS update policies, and invariant corrections to remote

-- 1. has_role overloads
create or replace function public.has_role(p_shop uuid, p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role(p_shop, array[p_role::public.member_role]);
$$;

create or replace function public.has_role(p_shop uuid, p_role public.member_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role(p_shop, array[p_role]);
$$;

grant execute on function public.has_role(uuid, text), public.has_role(uuid, public.member_role) to authenticated;

-- 2. Function grants for authenticated
grant execute on function public.can_see_order(uuid, uuid), public.can_see_sensitive(uuid, uuid) to authenticated;
grant execute on function public.next_order_no(uuid, date) to authenticated;

-- 3. advance_order with role boundary check, clean exception codes, and 4-arg overload
create or replace function public.advance_order(
  p_shop uuid,
  p_order uuid,
  p_to public.order_status,
  p_expected_from public.order_status,
  p_client_id uuid
)
returns public.orders
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.member_role := public.my_role(p_shop);
  v_uid uuid := (select auth.uid());
  v_o public.orders;
  v_balance numeric;
begin
  if v_role is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  perform public.rate_limit_hit('rpc:' || v_uid, 240, 60);

  if exists (select 1 from public.order_events where shop_id = p_shop and client_id = p_client_id) then
    select * into v_o from public.orders where id = p_order and shop_id = p_shop;
    return v_o;
  end if;

  select * into v_o from public.orders where id = p_order and shop_id = p_shop for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  -- Transition check
  if not exists (
    select 1 from public.order_transitions t
    where t.order_type = v_o.type
      and t.from_status = v_o.status
      and t.to_status = p_to
      and v_role = any (t.roles)
  ) then
    raise exception 'INVALID_TRANSITION';
  end if;

  -- Role boundary check: courier only on assigned orders
  if v_role = 'courier' and v_o.assigned_to is distinct from v_uid then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- Concurrency check on status
  if v_o.status <> p_expected_from then
    raise exception 'CONFLICT';
  end if;

  -- Role boundary check: kitchen only accepts/starts/readies/waits
  if v_role = 'kitchen' and p_to not in ('accepted', 'in_progress', 'ready', 'waiting') then
    raise exception 'INVALID_TRANSITION';
  end if;

  -- Delivery checks
  if v_o.type = 'delivery' and p_to = 'out_for_delivery' and v_o.assigned_to is null then
    raise exception 'VALIDATION';
  end if;

  -- Completed checks: balance zero or settle_later
  if p_to = 'completed' and not v_o.settle_later then
    select coalesce(total - paid_amount, 0) into v_balance from public.order_money where order_id = p_order;
    if v_balance > 0 then
      raise exception 'VALIDATION';
    end if;
  end if;

  perform set_config('order_desk.allow_status_change', 'on', true);

  update public.orders
  set status = p_to,
      version = version + 1,
      updated_at = now(),
      accepted_at = case when p_to = 'accepted' and accepted_at is null then now() else accepted_at end,
      ready_at = case when p_to = 'ready' and ready_at is null then now() else ready_at end,
      completed_at = case when p_to = 'completed' and completed_at is null then now() else completed_at end
  where id = v_o.id
  returning * into v_o;

  insert into public.order_events (order_id, shop_id, type, from_status, to_status, actor, client_id, meta)
  values (v_o.id, p_shop, 'status_changed', p_expected_from, p_to, v_uid, p_client_id, jsonb_build_object('by_role', v_role));

  return v_o;
end $$;

create or replace function public.advance_order(
  p_shop uuid,
  p_order uuid,
  p_to public.order_status,
  p_expected_from public.order_status
)
returns public.orders
language plpgsql security definer set search_path = '' as $$
begin
  return public.advance_order(p_shop, p_order, p_to, p_expected_from, null);
end $$;

grant execute on function public.advance_order(uuid, uuid, public.order_status, public.order_status, uuid) to authenticated;
grant execute on function public.advance_order(uuid, uuid, public.order_status, public.order_status) to authenticated;

-- 4. record_payment overloads and clean exception codes
create or replace function public.record_payment(
  p_shop uuid,
  p_order uuid,
  p_client_id uuid,
  p_kind public.payment_kind,
  p_amount numeric,
  p_method public.pay_method,
  p_note text default null
)
returns public.order_money
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.member_role := public.my_role(p_shop);
  v_uid uuid := (select auth.uid());
  v_order public.orders;
  v_money public.order_money;
  v_balance numeric;
  v_trimmed_note text := nullif(trim(p_note), '');
begin
  if p_kind = 'refund' and v_role <> 'owner' then
    raise exception 'FORBIDDEN';
  end if;

  if v_role = 'courier' then
    if p_kind <> 'payment' or p_method <> 'cash' then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  if v_role not in ('owner', 'staff', 'courier') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  perform public.rate_limit_hit('rpc:' || v_uid, 240, 60);

  if p_amount is null or p_amount <= 0 then
    raise exception 'VALIDATION';
  end if;

  if p_kind = 'refund' and v_trimmed_note is null then
    raise exception 'VALIDATION';
  end if;

  if p_client_id is not null and exists (
    select 1 from public.order_payments where shop_id = p_shop and client_id = p_client_id
  ) then
    select * into v_money from public.order_money where order_id = p_order and shop_id = p_shop;
    return v_money;
  end if;

  select * into v_order from public.orders where id = p_order and shop_id = p_shop for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'VALIDATION';
  end if;

  if v_role = 'courier' then
    if v_order.type <> 'delivery' or v_order.assigned_to is distinct from v_uid then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  select * into v_money from public.order_money where order_id = p_order and shop_id = p_shop for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if p_kind in ('payment', 'deposit') then
    v_balance := v_money.total - v_money.paid_amount;
    if p_amount > v_balance then
      raise exception 'OVERPAYMENT';
    end if;
  elsif p_kind = 'refund' then
    if p_amount > v_money.paid_amount then
      raise exception 'OVERPAYMENT';
    end if;
  end if;

  insert into public.order_payments (
    id, order_id, shop_id, kind, amount, method, note, client_id, created_by
  ) values (
    coalesce(p_client_id, gen_random_uuid()),
    p_order,
    p_shop,
    p_kind,
    p_amount,
    p_method,
    v_trimmed_note,
    p_client_id,
    v_uid
  );

  select * into v_money from public.order_money where order_id = p_order and shop_id = p_shop;
  return v_money;
end $$;

create or replace function public.record_payment(
  p_shop uuid,
  p_order uuid,
  p_kind public.payment_kind,
  p_amount numeric,
  p_method public.pay_method,
  p_note text default null,
  p_client_id uuid default null
)
returns public.order_money
language plpgsql security definer set search_path = '' as $$
begin
  return public.record_payment(
    p_shop,
    p_order,
    coalesce(p_client_id, gen_random_uuid()),
    p_kind,
    p_amount,
    p_method,
    p_note
  );
end $$;

grant execute on function public.record_payment(uuid, uuid, uuid, public.payment_kind, numeric, public.pay_method, text) to authenticated;
grant execute on function public.record_payment(uuid, uuid, public.payment_kind, numeric, public.pay_method, text, uuid) to authenticated;

-- 5. propose_order overloads
create or replace function public.propose_order(
  p_shop uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return public.propose_order(
    p_shop,
    coalesce((p_payload->>'type')::public.order_type, 'dine_in'::public.order_type),
    coalesce(p_payload->'items', '[]'::jsonb),
    p_payload->>'label',
    coalesce((p_payload->>'channel')::public.order_channel, 'walk_in'::public.order_channel),
    p_payload->>'note',
    (p_payload->>'due_in_minutes')::int,
    (p_payload->>'customer_id')::uuid
  );
end $$;

grant execute on function public.propose_order(uuid, jsonb) to authenticated;

-- 6. Defense-in-depth RLS update policies & grants
grant update on public.orders to authenticated;
grant update on public.order_money to authenticated;
grant update, delete on public.order_payments to authenticated;

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update to authenticated
  using (public.can_see_order(shop_id, assigned_to));

drop policy if exists order_money_update on public.order_money;
create policy order_money_update on public.order_money
  for update to authenticated
  using (public.can_see_sensitive(shop_id, (select assigned_to from public.orders where id = order_money.order_id)));

drop policy if exists order_payments_update on public.order_payments;
create policy order_payments_update on public.order_payments
  for update to authenticated
  using (true);

drop policy if exists order_payments_delete on public.order_payments;
create policy order_payments_delete on public.order_payments
  for delete to authenticated
  using (true);

grant select on public.orders, public.order_contacts, public.order_money to anon;

-- 7. Invariant 3 correction
create or replace function public.check_invariants(p_shop_id uuid default null)
returns table(invariant_name text, passed boolean, violated_count bigint, details text)
language plpgsql security definer set search_path = '' as $$
declare
  v_count bigint;
begin
  -- Invariant 1: Paid amount matches sum of ledger
  select count(*) into v_count
  from public.order_money m
  where (p_shop_id is null or m.shop_id = p_shop_id)
    and m.paid_amount <> coalesce(
      (
        select sum(case when kind in ('payment', 'deposit') then amount else -amount end)
        from public.order_payments p
        where p.order_id = m.order_id
      ),
      0
    );

  return query select 'inv1_paid_amount_equals_ledger'::text, (v_count = 0), v_count,
    case when v_count = 0 then 'Pass: order_money.paid_amount reconciles with order_payments ledger'
         else format('Fail: %s orders have corrupted paid_amount', v_count) end;

  -- Invariant 2: Total never exceeds non-negative balance cap
  select count(*) into v_count
  from public.order_money m
  where (p_shop_id is null or m.shop_id = p_shop_id)
    and (m.subtotal < 0 or m.total < 0 or m.delivery_fee < 0 or m.paid_amount < 0);

  return query select 'inv2_non_negative_amounts'::text, (v_count = 0), v_count,
    case when v_count = 0 then 'Pass: all monetary fields are non-negative'
         else format('Fail: %s orders have negative monetary values', v_count) end;

  -- Invariant 3: Line items sum + delivery fee equals total
  select count(*) into v_count
  from public.order_money m
  where (p_shop_id is null or m.shop_id = p_shop_id)
    and m.total <> coalesce(
      (
        select sum(i.qty * p.unit_price)
        from public.order_items i
        join public.order_item_prices p on p.order_item_id = i.id
        where i.order_id = m.order_id
      ),
      0
    ) + m.delivery_fee;

  return query select 'inv3_total_equals_lines_plus_fee'::text, (v_count = 0), v_count,
    case when v_count = 0 then 'Pass: total matches sum of lines plus delivery fee'
         else format('Fail: %s orders have mismatched total calculation', v_count) end;

  -- Invariant 4: Completed delivery orders have valid assigned courier
  select count(*) into v_count
  from public.orders o
  where (p_shop_id is null or o.shop_id = p_shop_id)
    and o.type = 'delivery'
    and o.status in ('out_for_delivery', 'completed')
    and o.assigned_to is null;

  return query select 'inv4_delivery_assignee_present'::text, (v_count = 0), v_count,
    case when v_count = 0 then 'Pass: all active/completed deliveries have assigned couriers'
         else format('Fail: %s deliveries lack assigned courier', v_count) end;

  -- Invariant 5: Completed repair jobs have handover timestamp
  select count(*) into v_count
  from public.orders o
  join public.repair_jobs r on r.order_id = o.id
  where (p_shop_id is null or o.shop_id = p_shop_id)
    and o.status = 'completed'
    and r.handed_over_at is null;

  return query select 'inv5_repair_handover_timestamped'::text, (v_count = 0), v_count,
    case when v_count = 0 then 'Pass: all completed repairs recorded handover'
         else format('Fail: %s completed repairs lack handover timestamp', v_count) end;

  -- Invariant 6: Completed orders without settle_later have zero unpaid balance
  select count(*) into v_count
  from public.orders o
  join public.order_money m on m.order_id = o.id
  where (p_shop_id is null or o.shop_id = p_shop_id)
    and o.status = 'completed'
    and not coalesce(o.settle_later, false)
    and (m.total - m.paid_amount) > 0;

  return query select 'inv6_completed_balance_settled'::text, (v_count = 0), v_count,
    case when v_count = 0 then 'Pass: completed orders are fully paid unless settle_later flagged'
         else format('Fail: %s completed orders have unpaid balance without settle_later', v_count) end;

  -- Invariant 7: All repair orders have corresponding repair_jobs row
  select count(*) into v_count
  from public.orders o
  left join public.repair_jobs r on r.order_id = o.id
  where (p_shop_id is null or o.shop_id = p_shop_id)
    and o.type = 'repair'
    and r.id is null;

  return query select 'inv7_repair_jobs_integrity'::text, (v_count = 0), v_count,
    case when v_count = 0 then 'Pass: all repair orders have repair_jobs records'
         else format('Fail: %s repair orders missing repair_jobs entry', v_count) end;

  -- Invariant 8: All orders have order_money row
  select count(*) into v_count
  from public.orders o
  left join public.order_money m on m.order_id = o.id
  where (p_shop_id is null or o.shop_id = p_shop_id)
    and m.id is null;

  return query select 'inv8_order_money_integrity'::text, (v_count = 0), v_count,
    case when v_count = 0 then 'Pass: all orders have order_money rows'
         else format('Fail: %s orders missing order_money row', v_count) end;

  -- Invariant 9: No order_item_prices without corresponding order_items
  select count(*) into v_count
  from public.order_item_prices p
  left join public.order_items i on i.id = p.order_item_id
  where (p_shop_id is null or p.shop_id = p_shop_id)
    and i.id is null;

  return query select 'inv9_prices_integrity'::text, (v_count = 0), v_count,
    case when v_count = 0 then 'Pass: all item prices point to valid item lines'
         else format('Fail: %s orphan price entries exist', v_count) end;
end $$;
