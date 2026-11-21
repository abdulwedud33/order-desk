-- 0005_status_machine.sql
-- Status machine RPCs: advance_order, assign_order, cancel_order, orders_guard trigger, realtime publication

-- 1. Guard trigger on orders

create or replace function public.orders_guard_fn()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Disallow modifying immutable identifiers
  if NEW.id <> OLD.id or NEW.shop_id <> OLD.shop_id or NEW.order_no <> OLD.order_no or NEW.order_date <> OLD.order_date or NEW.created_by <> OLD.created_by then
    raise exception 'FORBIDDEN' using message = 'Cannot modify immutable order fields (id, shop_id, order_no, order_date, created_by)';
  end if;

  -- Disallow direct status changes outside RPCs setting transaction flag
  if NEW.status is distinct from OLD.status then
    if current_setting('order_desk.allow_status_change', true) is distinct from 'on' then
      raise exception 'FORBIDDEN' using message = 'Status changes must go through advance_order or cancel_order RPCs';
    end if;
  end if;

  return NEW;
end $$;

drop trigger if exists orders_guard on public.orders;
create trigger orders_guard
  before update on public.orders
  for each row execute function public.orders_guard_fn();

-- 2. RPC: advance_order

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

  -- Replay check
  if exists (select 1 from public.order_events where shop_id = p_shop and client_id = p_client_id) then
    select * into v_o from public.orders where id = p_order and shop_id = p_shop;
    return v_o;
  end if;

  -- Lock row
  select * into v_o from public.orders where id = p_order and shop_id = p_shop for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  -- Concurrency check on status
  if v_o.status <> p_expected_from then
    raise exception 'CONFLICT' using message = 'Order status changed from expected ' || p_expected_from || ' to ' || v_o.status;
  end if;

  -- Transition check
  if not exists (
    select 1 from public.order_transitions t
    where t.order_type = v_o.type
      and t.from_status = v_o.status
      and t.to_status = p_to
      and v_role = any (t.roles)
  ) then
    raise exception 'INVALID_TRANSITION' using message = 'Transition from ' || v_o.status || ' to ' || p_to || ' not allowed for role ' || v_role;
  end if;

  -- Role boundary check: courier only on assigned orders
  if v_role = 'courier' and v_o.assigned_to is distinct from v_uid then
    raise exception 'FORBIDDEN' using message = 'Couriers can only advance orders assigned to them';
  end if;

  -- Role boundary check: kitchen only accepts/starts/readies/waits
  if v_role = 'kitchen' and p_to not in ('accepted', 'in_progress', 'ready', 'waiting') then
    raise exception 'FORBIDDEN' using message = 'Kitchen role cannot advance order to ' || p_to;
  end if;

  -- Delivery checks
  if v_o.type = 'delivery' and p_to = 'out_for_delivery' and v_o.assigned_to is null then
    raise exception 'VALIDATION' using message = 'Delivery order must be assigned to a courier before out_for_delivery';
  end if;

  -- Completed checks: balance zero or settle_later
  if p_to = 'completed' and not v_o.settle_later then
    select coalesce(total - paid_amount, 0) into v_balance from public.order_money where order_id = p_order;
    if v_balance > 0 then
      raise exception 'VALIDATION' using message = 'Order has outstanding balance; settle payment or flag settle_later';
    end if;
  end if;

  -- Set transaction flag so orders_guard allows status change
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

-- 3. RPC: assign_order

create or replace function public.assign_order(
  p_shop uuid,
  p_order uuid,
  p_user uuid,
  p_client_id uuid
)
returns public.orders
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.member_role := public.my_role(p_shop);
  v_uid uuid := (select auth.uid());
  v_o public.orders;
  v_target_role public.member_role;
begin
  if v_role is null or v_role not in ('owner', 'staff') then
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

  select role into v_target_role from public.shop_members where shop_id = p_shop and user_id = p_user;
  if not found then
    raise exception 'NOT_FOUND' using message = 'Assignee not found in shop members';
  end if;

  if v_o.type = 'delivery' and v_target_role <> 'courier' then
    raise exception 'VALIDATION' using message = 'Delivery assignee must be a courier';
  end if;

  update public.orders
  set assigned_to = p_user,
      version = version + 1,
      updated_at = now()
  where id = p_order
  returning * into v_o;

  insert into public.order_events (order_id, shop_id, type, actor, client_id, meta)
  values (p_order, p_shop, 'assigned', v_uid, p_client_id, jsonb_build_object('assigned_to', p_user, 'assigned_role', v_target_role));

  return v_o;
end $$;

-- 4. RPC: cancel_order

create or replace function public.cancel_order(
  p_shop uuid,
  p_order uuid,
  p_reason text,
  p_client_id uuid
)
returns public.orders
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.member_role := public.my_role(p_shop);
  v_uid uuid := (select auth.uid());
  v_o public.orders;
  v_paid numeric := 0;
begin
  if v_role is null or v_role not in ('owner', 'staff') then
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

  if v_o.status in ('completed', 'cancelled') then
    raise exception 'INVALID_TRANSITION' using message = 'Cannot cancel order in status ' || v_o.status;
  end if;

  if p_reason is null or char_length(trim(p_reason)) < 3 or char_length(trim(p_reason)) > 200 then
    raise exception 'VALIDATION' using message = 'Cancel reason must be between 3 and 200 characters';
  end if;

  select coalesce(paid_amount, 0) into v_paid from public.order_money where order_id = p_order;

  perform set_config('order_desk.allow_status_change', 'on', true);

  update public.orders
  set status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = trim(p_reason),
      version = version + 1,
      updated_at = now()
  where id = p_order
  returning * into v_o;

  insert into public.order_events (order_id, shop_id, type, from_status, to_status, actor, client_id, meta)
  values (p_order, p_shop, 'cancelled', v_o.status, 'cancelled', v_uid, p_client_id, jsonb_build_object('reason', trim(p_reason), 'paid_amount', v_paid));

  return v_o;
end $$;

-- 5. Revoke/Grant execution

revoke all on function public.advance_order(uuid, uuid, public.order_status, public.order_status, uuid) from public, anon;
grant execute on function public.advance_order(uuid, uuid, public.order_status, public.order_status, uuid) to authenticated;

revoke all on function public.assign_order(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.assign_order(uuid, uuid, uuid, uuid) to authenticated;

revoke all on function public.cancel_order(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.cancel_order(uuid, uuid, text, uuid) to authenticated;

-- 6. Realtime publication setup
do $$
begin
  alter publication supabase_realtime add table public.orders, public.order_items, public.order_money, public.order_events;
exception when others then null;
end $$;
