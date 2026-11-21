-- 0004_orders_core.sql
-- Orders core tables, order counters, transitions seed, next_order_no, create_order, edit_order

-- 1. Tables

create table if not exists public.orders (
  id uuid primary key,
  shop_id uuid not null references public.shops on delete cascade,
  order_date date not null,
  order_no int not null,
  order_code text not null,
  type public.order_type not null,
  status public.order_status not null default 'new',
  label text check (char_length(label) <= 40),
  channel public.order_channel not null default 'walk_in',
  note text check (char_length(note) <= 500),
  customer_id uuid references public.customers,
  assigned_to uuid references auth.users,
  due_at timestamptz,
  settle_later boolean not null default false,
  version int not null default 1,
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 200),
  unique (shop_id, order_date, order_no),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check ((status = 'completed') = (completed_at is not null))
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders on delete cascade,
  shop_id uuid not null references public.shops on delete cascade,
  item_id uuid references public.catalog_items,
  name text not null check (char_length(name) between 1 and 120),
  qty numeric(10,2) not null check (qty > 0 and qty <= 10000),
  note text check (char_length(note) <= 200)
);

create table if not exists public.order_item_prices (
  order_item_id uuid primary key references public.order_items on delete cascade,
  shop_id uuid not null references public.shops on delete cascade,
  order_id uuid not null references public.orders on delete cascade,
  unit_price numeric(14,2) not null check (unit_price >= 0)
);

create table if not exists public.order_money (
  order_id uuid primary key references public.orders on delete cascade,
  shop_id uuid not null references public.shops on delete cascade,
  subtotal numeric(14,2) not null check (subtotal >= 0),
  delivery_fee numeric(14,2) not null default 0 check (delivery_fee >= 0),
  total numeric(14,2) not null check (total >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  check (total = subtotal + delivery_fee)
);

create table if not exists public.order_contacts (
  order_id uuid primary key references public.orders on delete cascade,
  shop_id uuid not null references public.shops on delete cascade,
  phone text check (char_length(phone) <= 30),
  address text check (char_length(address) <= 300),
  address_note text check (char_length(address_note) <= 200),
  tracking_token text unique not null check (char_length(tracking_token) between 16 and 64)
);

create table if not exists public.order_counters (
  shop_id uuid not null references public.shops on delete cascade,
  order_date date not null,
  last_no int not null check (last_no >= 1),
  primary key (shop_id, order_date)
);

create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders on delete cascade,
  shop_id uuid not null references public.shops on delete cascade,
  type public.event_type not null,
  from_status public.order_status,
  to_status public.order_status,
  actor uuid not null references auth.users,
  client_id uuid,
  meta jsonb,
  created_at timestamptz not null default now(),
  unique (shop_id, client_id)
);

create table if not exists public.order_transitions (
  order_type public.order_type not null,
  from_status public.order_status not null,
  to_status public.order_status not null,
  roles public.member_role[] not null,
  primary key (order_type, from_status, to_status)
);

-- Trigger: order_events is append-only
create or replace function public.check_ledger_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('app.shop_deletion', true) = 'on' then
    return old;
  end if;
  raise exception 'LEDGER_IMMUTABLE' using errcode = '42501';
end $$;

drop trigger if exists order_events_immutable on public.order_events;
create trigger order_events_immutable
  before update or delete on public.order_events
  for each row execute function public.check_ledger_immutable();

-- 2. Indexes

create index if not exists orders_open_idx on public.orders (shop_id, status, due_at) where status not in ('completed','cancelled');
create index if not exists orders_recent_idx on public.orders (shop_id, created_at desc);
create index if not exists orders_courier_idx on public.orders (shop_id, assigned_to, status) where assigned_to is not null;
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_item_prices_order_idx on public.order_item_prices (order_id);
create index if not exists order_events_order_idx on public.order_events (order_id, created_at);

-- 3. Seed transitions from docs/02-technical-requirements.md section 5

insert into public.order_transitions (order_type, from_status, to_status, roles)
values
  -- dine_in
  ('dine_in', 'new', 'accepted', array['owner', 'staff', 'kitchen']::public.member_role[]),
  ('dine_in', 'new', 'cancelled', array['owner', 'staff']::public.member_role[]),
  ('dine_in', 'accepted', 'in_progress', array['owner', 'staff', 'kitchen']::public.member_role[]),
  ('dine_in', 'accepted', 'waiting', array['owner', 'staff']::public.member_role[]),
  ('dine_in', 'accepted', 'cancelled', array['owner', 'staff']::public.member_role[]),
  ('dine_in', 'in_progress', 'ready', array['owner', 'staff', 'kitchen']::public.member_role[]),
  ('dine_in', 'in_progress', 'waiting', array['owner', 'staff']::public.member_role[]),
  ('dine_in', 'waiting', 'in_progress', array['owner', 'staff']::public.member_role[]),
  ('dine_in', 'waiting', 'cancelled', array['owner', 'staff']::public.member_role[]),
  ('dine_in', 'ready', 'completed', array['owner', 'staff']::public.member_role[]),
  ('dine_in', 'ready', 'cancelled', array['owner', 'staff']::public.member_role[]),

  -- takeaway
  ('takeaway', 'new', 'accepted', array['owner', 'staff', 'kitchen']::public.member_role[]),
  ('takeaway', 'new', 'cancelled', array['owner', 'staff']::public.member_role[]),
  ('takeaway', 'accepted', 'in_progress', array['owner', 'staff', 'kitchen']::public.member_role[]),
  ('takeaway', 'accepted', 'waiting', array['owner', 'staff']::public.member_role[]),
  ('takeaway', 'accepted', 'cancelled', array['owner', 'staff']::public.member_role[]),
  ('takeaway', 'in_progress', 'ready', array['owner', 'staff', 'kitchen']::public.member_role[]),
  ('takeaway', 'in_progress', 'waiting', array['owner', 'staff']::public.member_role[]),
  ('takeaway', 'waiting', 'in_progress', array['owner', 'staff']::public.member_role[]),
  ('takeaway', 'waiting', 'cancelled', array['owner', 'staff']::public.member_role[]),
  ('takeaway', 'ready', 'completed', array['owner', 'staff']::public.member_role[]),
  ('takeaway', 'ready', 'cancelled', array['owner', 'staff']::public.member_role[]),

  -- delivery (includes out_for_delivery)
  ('delivery', 'new', 'accepted', array['owner', 'staff', 'kitchen']::public.member_role[]),
  ('delivery', 'new', 'cancelled', array['owner', 'staff']::public.member_role[]),
  ('delivery', 'accepted', 'in_progress', array['owner', 'staff', 'kitchen']::public.member_role[]),
  ('delivery', 'accepted', 'waiting', array['owner', 'staff']::public.member_role[]),
  ('delivery', 'accepted', 'cancelled', array['owner', 'staff']::public.member_role[]),
  ('delivery', 'in_progress', 'ready', array['owner', 'staff', 'kitchen']::public.member_role[]),
  ('delivery', 'in_progress', 'waiting', array['owner', 'staff']::public.member_role[]),
  ('delivery', 'waiting', 'in_progress', array['owner', 'staff']::public.member_role[]),
  ('delivery', 'waiting', 'cancelled', array['owner', 'staff']::public.member_role[]),
  ('delivery', 'ready', 'out_for_delivery', array['owner', 'staff', 'courier']::public.member_role[]),
  ('delivery', 'ready', 'completed', array['owner', 'staff']::public.member_role[]),
  ('delivery', 'ready', 'cancelled', array['owner', 'staff']::public.member_role[]),
  ('delivery', 'out_for_delivery', 'completed', array['owner', 'staff', 'courier']::public.member_role[]),
  ('delivery', 'out_for_delivery', 'cancelled', array['owner', 'staff']::public.member_role[]),

  -- repair
  ('repair', 'new', 'accepted', array['owner', 'staff', 'kitchen']::public.member_role[]),
  ('repair', 'new', 'cancelled', array['owner', 'staff']::public.member_role[]),
  ('repair', 'accepted', 'in_progress', array['owner', 'staff', 'kitchen']::public.member_role[]),
  ('repair', 'accepted', 'waiting', array['owner', 'staff']::public.member_role[]),
  ('repair', 'accepted', 'cancelled', array['owner', 'staff']::public.member_role[]),
  ('repair', 'in_progress', 'ready', array['owner', 'staff', 'kitchen']::public.member_role[]),
  ('repair', 'in_progress', 'waiting', array['owner', 'staff']::public.member_role[]),
  ('repair', 'waiting', 'in_progress', array['owner', 'staff']::public.member_role[]),
  ('repair', 'waiting', 'cancelled', array['owner', 'staff']::public.member_role[]),
  ('repair', 'ready', 'completed', array['owner', 'staff']::public.member_role[]),
  ('repair', 'ready', 'cancelled', array['owner', 'staff']::public.member_role[])
on conflict (order_type, from_status, to_status) do nothing;

-- 4. Row Level Security

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_prices enable row level security;
alter table public.order_money enable row level security;
alter table public.order_contacts enable row level security;
alter table public.order_counters enable row level security;
alter table public.order_events enable row level security;
alter table public.order_transitions enable row level security;

-- Default deny on all tables
revoke all on public.orders, public.order_items, public.order_item_prices,
              public.order_money, public.order_contacts, public.order_counters,
              public.order_events, public.order_transitions from public, anon, authenticated;

-- Policies

-- orders: owner, staff, kitchen, and assigned courier
create policy orders_select on public.orders
  for select to authenticated
  using (public.can_see_order(shop_id, assigned_to));

-- order_items: follows order visibility
create policy order_items_select on public.order_items
  for select to authenticated
  using (public.can_see_order(shop_id, (select assigned_to from public.orders where id = order_items.order_id)));

-- order_item_prices: owner and staff only (kitchen and courier have ZERO access)
create policy order_item_prices_select on public.order_item_prices
  for select to authenticated
  using (public.has_role(shop_id, array['owner', 'staff']::public.member_role[]));

-- order_money: sensitive (kitchen: none, courier: assigned only)
create policy order_money_select on public.order_money
  for select to authenticated
  using (public.can_see_sensitive(shop_id, (select assigned_to from public.orders where id = order_money.order_id)));

-- order_contacts: sensitive (kitchen: none, courier: assigned only)
create policy order_contacts_select on public.order_contacts
  for select to authenticated
  using (public.can_see_sensitive(shop_id, (select assigned_to from public.orders where id = order_contacts.order_id)));

-- order_events: sensitive (kitchen: none, courier: assigned only)
create policy order_events_select on public.order_events
  for select to authenticated
  using (public.can_see_sensitive(shop_id, (select assigned_to from public.orders where id = order_events.order_id)));

-- order_transitions: readable by all authenticated members
create policy order_transitions_select on public.order_transitions
  for select to authenticated
  using (true);

-- Read grants (writes are strictly through RPCs)
grant select on public.orders, public.order_items, public.order_item_prices,
              public.order_money, public.order_contacts,
              public.order_events, public.order_transitions to authenticated;

-- 5. Helper function: next_order_no (internal atomic upsert)

create or replace function public.next_order_no(p_shop uuid, p_date date)
returns table(order_no int, order_code text)
language plpgsql security definer set search_path = '' as $$
declare
  v_no int;
  v_letter char;
  v_code text;
begin
  insert into public.order_counters (shop_id, order_date, last_no)
  values (p_shop, p_date, 1)
  on conflict (shop_id, order_date)
  do update set last_no = public.order_counters.last_no + 1
  returning last_no into v_no;

  -- day letter cycles A..Z daily: (day of year - 1) % 26
  v_letter := chr(65 + ((extract(doy from p_date)::int - 1) % 26));
  v_code := v_letter || '-' || lpad(v_no::text, 3, '0');

  return query select v_no, v_code;
end $$;

-- 6. RPC: create_order

create or replace function public.create_order(
  p_shop uuid,
  p_id uuid,
  p_type public.order_type,
  p_label text default null,
  p_channel public.order_channel default 'walk_in',
  p_note text default null,
  p_due_at timestamptz default null,
  p_items jsonb default '[]'::jsonb,
  p_contact jsonb default null,
  p_delivery_fee numeric default 0,
  p_customer uuid default null,
  p_repair jsonb default null
)
returns public.orders
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.member_role := public.my_role(p_shop);
  v_uid uuid := (select auth.uid());
  v_order public.orders;
  v_date date;
  v_tz text;
  v_order_no int;
  v_order_code text;
  v_item jsonb;
  v_item_id uuid;
  v_item_name text;
  v_item_qty numeric;
  v_item_price numeric;
  v_item_note text;
  v_cat_price numeric;
  v_order_item_id uuid;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_tracking_token text;
  v_phone text;
  v_address text;
  v_address_note text;
begin
  -- 1. Role validation: owner and staff only
  if v_role is null or v_role not in ('owner', 'staff') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- 2. Rate limit
  perform public.rate_limit_hit('rpc:' || v_uid, 240, 60);

  -- 3. Idempotent check
  select * into v_order from public.orders where id = p_id and shop_id = p_shop;
  if found then
    return v_order;
  end if;

  -- 4. Validate items array
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'VALIDATION' using message = 'At least one item is required';
  end if;

  -- 5. Determine shop date from shop timezone
  select timezone into v_tz from public.shops where id = p_shop;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  v_date := (now() at time zone coalesce(v_tz, 'Africa/Addis_Ababa'))::date;

  -- 6. Allocate order number atomically
  select order_no, order_code into v_order_no, v_order_code
  from public.next_order_no(p_shop, v_date);

  -- 7. Insert the order record
  insert into public.orders (
    id, shop_id, order_date, order_no, order_code, type, status,
    label, channel, note, customer_id, due_at, created_by,
    created_at, updated_at, version
  )
  values (
    p_id, p_shop, v_date, v_order_no, v_order_code, p_type, 'new',
    p_label, coalesce(p_channel, 'walk_in'), p_note, p_customer, p_due_at, v_uid,
    now(), now(), 1
  )
  returning * into v_order;

  -- 8. Loop through items, calculate prices, insert lines
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_name := trim(v_item->>'name');
    if v_item_name is null or char_length(v_item_name) = 0 then
      raise exception 'VALIDATION' using message = 'Item name is required';
    end if;

    v_item_qty := coalesce((v_item->>'qty')::numeric, 1);
    if v_item_qty <= 0 or v_item_qty > 10000 then
      raise exception 'VALIDATION' using message = 'Invalid item quantity';
    end if;

    v_item_note := v_item->>'note';
    v_item_id := case when (v_item->>'item_id') is not null and (v_item->>'item_id') <> ''
                       then (v_item->>'item_id')::uuid else null end;

    if v_item_id is not null then
      select price into v_cat_price
      from public.catalog_items
      where id = v_item_id and shop_id = p_shop and archived_at is null;

      if not found then
        raise exception 'NOT_FOUND' using message = 'Catalog item not found';
      end if;

      -- Pricing rule: only owner may override catalog price. Staff/clients cannot override.
      if v_role = 'owner' and (v_item->>'price') is not null then
        v_item_price := (v_item->>'price')::numeric;
      else
        v_item_price := v_cat_price;
      end if;
    else
      -- Free-text item: owner or staff may enter price
      v_item_price := coalesce((v_item->>'price')::numeric, 0);
    end if;

    if v_item_price < 0 then
      raise exception 'VALIDATION' using message = 'Price cannot be negative';
    end if;

    v_order_item_id := gen_random_uuid();

    insert into public.order_items (id, order_id, shop_id, item_id, name, qty, note)
    values (v_order_item_id, p_id, p_shop, v_item_id, v_item_name, v_item_qty, v_item_note);

    insert into public.order_item_prices (order_item_id, shop_id, order_id, unit_price)
    values (v_order_item_id, p_shop, p_id, v_item_price);

    v_subtotal := v_subtotal + round(v_item_qty * v_item_price, 2);
  end loop;

  -- 9. Delivery fee and total calculation
  v_total := v_subtotal + coalesce(p_delivery_fee, 0);

  insert into public.order_money (order_id, shop_id, subtotal, delivery_fee, total, paid_amount)
  values (p_id, p_shop, v_subtotal, coalesce(p_delivery_fee, 0), v_total, 0);

  -- 10. Contact and unguessable tracking token (128-bit random base64url)
  v_tracking_token := translate(encode(gen_random_bytes(16), 'base64'), '+/=', '-_');
  v_phone := p_contact->>'phone';
  v_address := p_contact->>'address';
  v_address_note := p_contact->>'address_note';

  insert into public.order_contacts (order_id, shop_id, phone, address, address_note, tracking_token)
  values (p_id, p_shop, v_phone, v_address, v_address_note, v_tracking_token);

  -- 11. Timeline event
  insert into public.order_events (order_id, shop_id, type, to_status, actor, client_id, meta)
  values (
    p_id, p_shop, 'created', 'new', v_uid, p_id,
    jsonb_build_object(
      'order_no', v_order_no,
      'order_code', v_order_code,
      'total', v_total,
      'type', p_type
    )
  );

  return v_order;
end $$;

-- 7. RPC: edit_order

create or replace function public.edit_order(
  p_shop uuid,
  p_order uuid,
  p_client_id uuid,
  p_expected_version int,
  p_items jsonb,
  p_note text default null,
  p_due_at timestamptz default null,
  p_contact jsonb default null,
  p_settle_later boolean default null
)
returns public.orders
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.member_role := public.my_role(p_shop);
  v_uid uuid := (select auth.uid());
  v_order public.orders;
  v_item jsonb;
  v_item_id uuid;
  v_item_name text;
  v_item_qty numeric;
  v_item_price numeric;
  v_item_note text;
  v_cat_price numeric;
  v_order_item_id uuid;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_prev_total numeric;
  v_prev_items jsonb;
  v_delivery_fee numeric := 0;
begin
  -- 1. Role validation: owner and staff only
  if v_role is null or v_role not in ('owner', 'staff') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- 2. Rate limit
  perform public.rate_limit_hit('rpc:' || v_uid, 240, 60);

  -- 3. Idempotent check on client_id
  if exists (select 1 from public.order_events where shop_id = p_shop and client_id = p_client_id) then
    select * into v_order from public.orders where id = p_order and shop_id = p_shop;
    return v_order;
  end if;

  -- 4. Lock order row
  select * into v_order from public.orders where id = p_order and shop_id = p_shop for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  -- 5. Version conflict check
  if v_order.version <> p_expected_version then
    raise exception 'CONFLICT';
  end if;

  -- 6. Status check: Allowed until ready (cannot edit if ready, out_for_delivery, completed, cancelled)
  if v_order.status in ('ready', 'out_for_delivery', 'completed', 'cancelled') then
    raise exception 'INVALID_TRANSITION' using message = 'Cannot edit order in status ' || v_order.status;
  end if;

  -- 7. Snapshot previous state for event meta
  select total, delivery_fee, paid_amount into v_prev_total, v_delivery_fee, v_paid
  from public.order_money where order_id = p_order;

  select jsonb_agg(jsonb_build_object(
    'name', oi.name,
    'qty', oi.qty,
    'unit_price', op.unit_price,
    'note', oi.note
  )) into v_prev_items
  from public.order_items oi
  left join public.order_item_prices op on op.order_item_id = oi.id
  where oi.order_id = p_order;

  -- 8. If new items provided, replace lines
  if p_items is not null and jsonb_array_length(p_items) > 0 then
    -- Remove existing items and prices (cascade)
    delete from public.order_items where order_id = p_order;

    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_name := trim(v_item->>'name');
      if v_item_name is null or char_length(v_item_name) = 0 then
        raise exception 'VALIDATION' using message = 'Item name is required';
      end if;

      v_item_qty := coalesce((v_item->>'qty')::numeric, 1);
      if v_item_qty <= 0 or v_item_qty > 10000 then
        raise exception 'VALIDATION' using message = 'Invalid item quantity';
      end if;

      v_item_note := v_item->>'note';
      v_item_id := case when (v_item->>'item_id') is not null and (v_item->>'item_id') <> ''
                         then (v_item->>'item_id')::uuid else null end;

      if v_item_id is not null then
        select price into v_cat_price
        from public.catalog_items
        where id = v_item_id and shop_id = p_shop and archived_at is null;

        if not found then
          raise exception 'NOT_FOUND' using message = 'Catalog item not found';
        end if;

        if v_role = 'owner' and (v_item->>'price') is not null then
          v_item_price := (v_item->>'price')::numeric;
        else
          v_item_price := v_cat_price;
        end if;
      else
        v_item_price := coalesce((v_item->>'price')::numeric, 0);
      end if;

      if v_item_price < 0 then
        raise exception 'VALIDATION' using message = 'Price cannot be negative';
      end if;

      v_order_item_id := gen_random_uuid();

      insert into public.order_items (id, order_id, shop_id, item_id, name, qty, note)
      values (v_order_item_id, p_order, p_shop, v_item_id, v_item_name, v_item_qty, v_item_note);

      insert into public.order_item_prices (order_item_id, shop_id, order_id, unit_price)
      values (v_order_item_id, p_shop, p_order, v_item_price);

      v_subtotal := v_subtotal + round(v_item_qty * v_item_price, 2);
    end loop;

    v_total := v_subtotal + coalesce(v_delivery_fee, 0);

    -- Check overpayment
    if v_paid > v_total then
      raise exception 'OVERPAYMENT' using message = 'Paid amount exceeds new total';
    end if;

    update public.order_money
    set subtotal = v_subtotal, total = v_total
    where order_id = p_order;
  else
    v_total := v_prev_total;
  end if;

  -- 9. Update contact if provided
  if p_contact is not null then
    update public.order_contacts
    set phone = coalesce(p_contact->>'phone', phone),
        address = coalesce(p_contact->>'address', address),
        address_note = coalesce(p_contact->>'address_note', address_note)
    where order_id = p_order;
  end if;

  -- 10. Update order fields and increment version
  update public.orders
  set note = coalesce(p_note, note),
      due_at = coalesce(p_due_at, due_at),
      settle_later = coalesce(p_settle_later, settle_later),
      version = version + 1,
      updated_at = now()
  where id = p_order
  returning * into v_order;

  -- 11. Append edited event
  insert into public.order_events (order_id, shop_id, type, actor, client_id, meta)
  values (
    p_order, p_shop, 'edited', v_uid, p_client_id,
    jsonb_build_object(
      'prev_version', p_expected_version,
      'prev_total', v_prev_total,
      'new_total', v_total,
      'prev_items', v_prev_items
    )
  );

  return v_order;
end $$;

-- Revoke execute from public/anon, grant to authenticated
revoke all on function public.next_order_no(uuid, date) from public, anon, authenticated;

revoke all on function public.create_order(uuid, uuid, public.order_type, text, public.order_channel, text, timestamptz, jsonb, jsonb, numeric, uuid, jsonb) from public, anon;
grant execute on function public.create_order(uuid, uuid, public.order_type, text, public.order_channel, text, timestamptz, jsonb, jsonb, numeric, uuid, jsonb) to authenticated;

revoke all on function public.edit_order(uuid, uuid, uuid, int, jsonb, text, timestamptz, jsonb, boolean) from public, anon;
grant execute on function public.edit_order(uuid, uuid, uuid, int, jsonb, text, timestamptz, jsonb, boolean) to authenticated;
