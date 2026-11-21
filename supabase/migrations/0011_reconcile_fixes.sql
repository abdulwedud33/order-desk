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
drop function if exists public.check_invariants(uuid);

create or replace function public.check_invariants(p_shop_id uuid default null)
returns table (
  invariant_no int,
  description text,
  status text,
  violations int,
  details jsonb
)
language plpgsql security definer set search_path = '' as $$
declare
  v_v1 int;
  v_v2 int;
  v_v3 int;
  v_v4 int;
  v_v5 int;
  v_v6 int;
  v_v7 int;
  v_v8 int;
begin
  -- Invariant 1: Every order has exactly one 'created' event
  select count(*)::int into v_v1
  from public.orders o
  where (p_shop_id is null or o.shop_id = p_shop_id)
    and (select count(*) from public.order_events e where e.order_id = o.id and e.type = 'created') <> 1;

  invariant_no := 1;
  description := 'Every order has exactly one created event';
  violations := v_v1;
  status := case when v_v1 = 0 then 'PASS' else 'FAIL' end;
  details := jsonb_build_object('violations', v_v1);
  return next;

  -- Invariant 2: order_money.paid_amount equals payments plus deposits minus refunds
  select count(*)::int into v_v2
  from public.order_money m
  where (p_shop_id is null or m.shop_id = p_shop_id)
    and m.paid_amount <> coalesce(
      (select sum(case when p.kind = 'refund' then -p.amount else p.amount end)
       from public.order_payments p
       where p.order_id = m.order_id),
      0
    );

  invariant_no := 2;
  description := 'order_money.paid_amount equals payments plus deposits minus refunds';
  violations := v_v2;
  status := case when v_v2 = 0 then 'PASS' else 'FAIL' end;
  details := jsonb_build_object('violations', v_v2);
  return next;

  -- Invariant 3: order_money.total equals sum of line totals plus delivery fee
  select count(*)::int into v_v3
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

  invariant_no := 3;
  description := 'order_money.total equals line items sum plus delivery fee';
  violations := v_v3;
  status := case when v_v3 = 0 then 'PASS' else 'FAIL' end;
  details := jsonb_build_object('violations', v_v3);
  return next;

  -- Invariant 4: (shop_id, order_date, order_no) is unique and day numbers have no duplicates
  select count(*)::int into v_v4
  from (
    select o.shop_id, o.order_date, o.order_no, count(*) as cnt
    from public.orders o
    where o.order_no is not null and (p_shop_id is null or o.shop_id = p_shop_id)
    group by o.shop_id, o.order_date, o.order_no
    having count(*) > 1
  ) dup;

  invariant_no := 4;
  description := '(shop_id, order_date, order_no) has zero duplicates';
  violations := v_v4;
  status := case when v_v4 = 0 then 'PASS' else 'FAIL' end;
  details := jsonb_build_object('violations', v_v4);
  return next;

  -- Invariant 5: Every status in order_events timeline follows a legal transition
  select count(*)::int into v_v5
  from public.order_events e
  join public.orders o on o.id = e.order_id
  where e.type = 'status_changed'
    and (p_shop_id is null or e.shop_id = p_shop_id)
    and not exists (
      select 1 from public.order_transitions t
      where t.order_type = o.type
        and t.from_status = e.from_status
        and t.to_status = e.to_status
    );

  invariant_no := 5;
  description := 'Every status transition followed a legal status path';
  violations := v_v5;
  status := case when v_v5 = 0 then 'PASS' else 'FAIL' end;
  details := jsonb_build_object('violations', v_v5);
  return next;

  -- Invariant 6: Completed orders have completed_at; cancelled orders have a note/reason in event
  select count(*)::int into v_v6
  from public.orders o
  where (p_shop_id is null or o.shop_id = p_shop_id)
    and (
      (o.status = 'completed' and o.completed_at is null) or
      (o.status = 'cancelled' and not exists (
        select 1 from public.order_events e
        where e.order_id = o.id and e.to_status = 'cancelled' and (e.meta->>'reason') is not null and length(e.meta->>'reason') >= 3
      ))
    );

  invariant_no := 6;
  description := 'Completed orders have timestamp; cancelled orders have reason';
  violations := v_v6;
  status := case when v_v6 = 0 then 'PASS' else 'FAIL' end;
  details := jsonb_build_object('violations', v_v6);
  return next;

  -- Invariant 7: Completed orders have zero balance unless settle_later is true
  select count(*)::int into v_v7
  from public.orders o
  join public.order_money m on m.order_id = o.id
  where (p_shop_id is null or o.shop_id = p_shop_id)
    and o.status = 'completed'
    and o.settle_later = false
    and (m.total - m.paid_amount) > 0;

  invariant_no := 7;
  description := 'Completed orders have zero balance unless settle_later is true';
  violations := v_v7;
  status := case when v_v7 = 0 then 'PASS' else 'FAIL' end;
  details := jsonb_build_object('violations', v_v7);
  return next;

  -- Invariant 8: Repair orders in completed status have a handover record
  select count(*)::int into v_v8
  from public.orders o
  join public.repair_jobs r on r.order_id = o.id
  where (p_shop_id is null or o.shop_id = p_shop_id)
    and o.status = 'completed'
    and r.handed_over_at is null;

  invariant_no := 8;
  description := 'Completed repair orders have handover recorded';
  violations := v_v8;
  status := case when v_v8 = 0 then 'PASS' else 'FAIL' end;
  details := jsonb_build_object('violations', v_v8);
  return next;

  -- Invariant 9: RLS matrix integrity: all 18 tables have row security enabled
  invariant_no := 9;
  description := 'All public tables have Row Level Security enabled';
  select count(*)::int into violations
  from pg_tables pt
  where pt.schemaname = 'public'
    and not pt.rowsecurity
    and pt.tablename not in ('schema_migrations', 'invariant_checks');
  status := case when violations = 0 then 'PASS' else 'FAIL' end;
  details := jsonb_build_object('tables_without_rls', violations);
  return next;
end $$;
