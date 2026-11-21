-- 0006_payments_ledger.sql
-- Payments and deposits append-only ledger, triggers, RPCs, and RLS

-- 1. Table: order_payments
create table if not exists public.order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders on delete cascade,
  shop_id uuid not null references public.shops on delete cascade,
  kind public.payment_kind not null,
  amount numeric(14,2) not null check (amount > 0),
  method public.pay_method not null,
  note text check (char_length(note) <= 200),
  client_id uuid,
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  unique (shop_id, client_id)
);

-- Indexes
create index if not exists order_payments_order_idx on public.order_payments (order_id);
create index if not exists order_payments_shop_created_idx on public.order_payments (shop_id, created_at desc);

-- 2. Ledger Immutability Trigger
drop trigger if exists order_payments_immutable on public.order_payments;
create trigger order_payments_immutable
  before update or delete on public.order_payments
  for each row execute function public.check_ledger_immutable();

-- 3. Guard on order_money.paid_amount (only writer is payment trigger)
create or replace function public.order_money_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.paid_amount is distinct from new.paid_amount then
    if current_setting('order_desk.allow_paid_amount_change', true) is distinct from 'on' then
      raise exception 'FORBIDDEN' using message = 'paid_amount can only be modified by the payment ledger trigger';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists order_money_guard_trg on public.order_money;
create trigger order_money_guard_trg
  before update on public.order_money
  for each row execute function public.order_money_guard();

-- 4. Trigger: Apply order payments to order_money.paid_amount
create or replace function public.order_payments_apply()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Set transaction-level flag so order_money_guard allows update
  perform set_config('order_desk.allow_paid_amount_change', 'on', true);

  if new.kind in ('payment', 'deposit') then
    update public.order_money
    set paid_amount = paid_amount + new.amount
    where order_id = new.order_id;
  elsif new.kind = 'refund' then
    update public.order_money
    set paid_amount = paid_amount - new.amount
    where order_id = new.order_id;
  end if;

  return new;
end $$;

drop trigger if exists order_payments_apply_trg on public.order_payments;
create trigger order_payments_apply_trg
  after insert on public.order_payments
  for each row execute function public.order_payments_apply();

-- 5. RPC: record_payment
create or replace function public.record_payment(
  p_shop uuid,
  p_order uuid,
  p_client_id uuid,
  p_kind public.payment_kind,
  p_amount numeric(14,2),
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
  v_balance numeric(14,2);
  v_trimmed_note text := nullif(trim(p_note), '');
begin
  -- 1. Role validation
  if v_role is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- Refunds are strictly owner-only
  if p_kind = 'refund' and v_role <> 'owner' then
    raise exception 'FORBIDDEN' using message = 'Refunds can only be recorded by shop owners';
  end if;

  -- Courier role can only record cash payments on their assigned delivery orders
  if v_role = 'courier' then
    if p_kind <> 'payment' or p_method <> 'cash' then
      raise exception 'FORBIDDEN' using message = 'Couriers can only record cash payments';
    end if;
  end if;

  if v_role not in ('owner', 'staff', 'courier') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- 2. Rate limit
  perform public.rate_limit_hit('rpc:' || v_uid, 240, 60);

  -- 3. Input validation
  if p_amount is null or p_amount <= 0 then
    raise exception 'VALIDATION' using message = 'Payment amount must be greater than zero';
  end if;

  if p_kind = 'refund' and v_trimmed_note is null then
    raise exception 'VALIDATION' using message = 'Refund requires a note explaining the reason';
  end if;

  -- 4. Idempotency replay check
  if p_client_id is not null and exists (
    select 1 from public.order_payments where shop_id = p_shop and client_id = p_client_id
  ) then
    select * into v_money from public.order_money where order_id = p_order and shop_id = p_shop;
    return v_money;
  end if;

  -- 5. Lock order and order_money
  select * into v_order from public.orders where id = p_order and shop_id = p_shop for update;
  if not found then
    raise exception 'NOT_FOUND' using message = 'Order not found';
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'VALIDATION' using message = 'Cannot record payment on cancelled order';
  end if;

  -- If courier, verify assigned delivery order
  if v_role = 'courier' then
    if v_order.type <> 'delivery' or v_order.assigned_to is distinct from v_uid then
      raise exception 'FORBIDDEN' using message = 'Courier can only record payment on assigned delivery order';
    end if;
  end if;

  select * into v_money from public.order_money where order_id = p_order and shop_id = p_shop for update;
  if not found then
    raise exception 'NOT_FOUND' using message = 'Order money record not found';
  end if;

  -- 6. Financial validation: Overpayment and Refund caps
  if p_kind in ('payment', 'deposit') then
    v_balance := v_money.total - v_money.paid_amount;
    if p_amount > v_balance then
      raise exception 'OVERPAYMENT' using message = 'Payment exceeds outstanding balance';
    end if;
  elsif p_kind = 'refund' then
    if p_amount > v_money.paid_amount then
      raise exception 'OVERPAYMENT' using message = 'Refund exceeds paid amount';
    end if;
  end if;

  -- 7. Insert payment into ledger (trigger automatically updates order_money.paid_amount)
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

  -- 8. Record audit log and order events
  insert into public.order_events (
    order_id, shop_id, type, actor, client_id, meta
  ) values (
    p_order,
    p_shop,
    'payment',
    v_uid,
    p_client_id,
    jsonb_build_object('kind', p_kind, 'amount', p_amount, 'method', p_method, 'note', v_trimmed_note)
  );

  if p_kind = 'refund' then
    insert into public.audit_log (
      shop_id, actor, action, entity, entity_id, meta
    ) values (
      p_shop,
      v_uid,
      'refund',
      'order',
      p_order,
      jsonb_build_object('amount', p_amount, 'note', v_trimmed_note)
    );
  end if;

  -- 9. Return latest order_money
  select * into v_money from public.order_money where order_id = p_order;
  return v_money;
end $$;

-- 6. RPC: set_settle_later
create or replace function public.set_settle_later(
  p_shop uuid,
  p_order uuid,
  p_settle_later boolean,
  p_client_id uuid default null
)
returns public.orders
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.member_role := public.my_role(p_shop);
  v_uid uuid := (select auth.uid());
  v_o public.orders;
begin
  if v_role is null or v_role not in ('owner', 'staff') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  perform public.rate_limit_hit('rpc:' || v_uid, 240, 60);

  select * into v_o from public.orders where id = p_order and shop_id = p_shop for update;
  if not found then
    raise exception 'NOT_FOUND' using message = 'Order not found';
  end if;

  update public.orders
  set settle_later = p_settle_later,
      version = version + 1,
      updated_at = now()
  where id = v_o.id
  returning * into v_o;

  insert into public.order_events (
    order_id, shop_id, type, actor, client_id, meta
  ) values (
    v_o.id,
    p_shop,
    'note',
    v_uid,
    p_client_id,
    jsonb_build_object('action', 'set_settle_later', 'settle_later', p_settle_later)
  );

  return v_o;
end $$;

-- 7. Row Level Security on order_payments
alter table public.order_payments enable row level security;

revoke all on public.order_payments from anon, authenticated;
grant select on public.order_payments to authenticated;

-- Owner and Staff can read payments
drop policy if exists order_payments_staff_read on public.order_payments;
create policy order_payments_staff_read on public.order_payments
  for select to authenticated
  using (public.has_role(shop_id, 'staff'));

-- Courier can read payments for assigned deliveries only
drop policy if exists order_payments_courier_read on public.order_payments;
create policy order_payments_courier_read on public.order_payments
  for select to authenticated
  using (
    public.my_role(shop_id) = 'courier' and
    exists (
      select 1 from public.orders o
      where o.id = order_id and o.assigned_to = (select auth.uid())
    )
  );

-- Realtime publication
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'order_payments'
  ) then
    alter publication supabase_realtime add table public.order_payments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'order_money'
  ) then
    alter publication supabase_realtime add table public.order_money;
  end if;
exception when others then
  null;
end $$;
