-- 0007_repair_jobs.sql
-- Repair jobs table, pickup code hash, approve_estimate, handover_order, repair_jobs_kitchen view,
-- waiting reasons, estimate exceeded threshold rule, and repair turnaround.
-- Rules: docs/05-backend-schema.md, docs/01-prd.md, docs/security.md.

-- 1. Table: repair_jobs
create table if not exists public.repair_jobs (
  order_id uuid primary key references public.orders(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  device text not null check (char_length(device) between 1 and 120),
  problem text not null check (char_length(problem) between 1 and 500),
  serial text check (char_length(serial) <= 100),
  approved_total numeric(14,2) check (approved_total >= 0),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  diagnosis text check (char_length(diagnosis) <= 500),
  pickup_code_hash bytea not null,
  handed_over_at timestamptz,
  handover_override boolean not null default false,
  waiting_reason text check (char_length(waiting_reason) <= 100),
  created_at timestamptz not null default now()
);

create index if not exists repair_jobs_shop_idx on public.repair_jobs (shop_id);

-- 2. Row Level Security on repair_jobs
alter table public.repair_jobs enable row level security;

-- Only owner, staff, or assigned courier can read sensitive repair job info (including pickup_code_hash)
-- Kitchen role CANNOT read repair_jobs directly (can_see_sensitive returns false for kitchen).
create policy repair_jobs_select on public.repair_jobs
  for select to authenticated
  using (
    public.can_see_sensitive(shop_id, (select assigned_to from public.orders where id = repair_jobs.order_id))
  );

-- No direct client writes allowed
revoke all on public.repair_jobs from public, anon, authenticated;
grant select on public.repair_jobs to authenticated;

-- 3. View: repair_jobs_kitchen
-- Kitchen role (and other authorized roles) can query this view to see device, problem, diagnosis, waiting_reason.
-- Crucially omits pickup_code_hash, approved_total, approved_by, handover_override, handed_over_at.
create or replace view public.repair_jobs_kitchen as
  select
    r.order_id,
    r.shop_id,
    r.device,
    r.problem,
    r.diagnosis,
    r.waiting_reason,
    r.created_at
  from public.repair_jobs r
  join public.orders o on o.id = r.order_id
  where public.can_see_order(r.shop_id, o.assigned_to);

grant select on public.repair_jobs_kitchen to authenticated;

-- 4. Re-implement create_order with repair_jobs support
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
  -- Repair variables
  v_device text;
  v_problem text;
  v_serial text;
  v_pickup_code text;
  v_code_hash bytea;
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
    raise exception 'VALIDATION: At least one item is required';
  end if;

  -- 5. Validate repair fields if repair order
  if p_type = 'repair' then
    if p_repair is null then
      raise exception 'VALIDATION: Repair details are required for repair orders';
    end if;

    v_device := btrim(coalesce(p_repair->>'device', ''));
    v_problem := btrim(coalesce(p_repair->>'problem', ''));
    v_serial := btrim(coalesce(p_repair->>'serial', ''));
    v_pickup_code := upper(btrim(coalesce(p_repair->>'pickup_code', '')));

    if char_length(v_device) not between 1 and 120 then
      raise exception 'VALIDATION: Device name is required (1-120 chars)';
    end if;
    if char_length(v_problem) not between 1 and 500 then
      raise exception 'VALIDATION: Problem description is required (1-500 chars)';
    end if;

    -- Generate a 4-digit numeric pickup code if none provided
    if v_pickup_code is null or v_pickup_code = '' then
      v_pickup_code := lpad((floor(random() * 9000 + 1000)::int)::text, 4, '0');
    end if;

    v_code_hash := sha256(convert_to(v_pickup_code, 'UTF8'));
  end if;

  -- 6. Determine shop date from shop timezone
  select timezone into v_tz from public.shops where id = p_shop;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  v_date := (now() at time zone coalesce(v_tz, 'Africa/Addis_Ababa'))::date;

  -- 7. Allocate order number atomically
  select order_no, order_code into v_order_no, v_order_code
  from public.next_order_no(p_shop, v_date);

  -- 8. Insert order record
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

  -- 9. Insert repair job if repair type
  if p_type = 'repair' then
    insert into public.repair_jobs (
      order_id, shop_id, device, problem, serial, pickup_code_hash
    )
    values (
      p_id, p_shop, v_device, v_problem, nullif(v_serial, ''), v_code_hash
    );
  end if;

  -- 10. Loop through items, calculate prices, insert lines
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_name := trim(v_item->>'name');
    if v_item_name is null or char_length(v_item_name) = 0 then
      raise exception 'VALIDATION: Item name is required';
    end if;

    v_item_qty := coalesce((v_item->>'qty')::numeric, 1);
    if v_item_qty <= 0 or v_item_qty > 10000 then
      raise exception 'VALIDATION: Invalid item quantity';
    end if;

    v_item_note := v_item->>'note';
    v_item_id := case when (v_item->>'item_id') is not null and (v_item->>'item_id') <> ''
                       then (v_item->>'item_id')::uuid else null end;

    if v_item_id is not null then
      select price into v_cat_price
      from public.catalog_items
      where id = v_item_id and shop_id = p_shop and archived_at is null;

      if not found then
        raise exception 'NOT_FOUND: Catalog item not found';
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
      raise exception 'VALIDATION: Price cannot be negative';
    end if;

    v_order_item_id := gen_random_uuid();

    insert into public.order_items (id, order_id, shop_id, item_id, name, qty, note)
    values (v_order_item_id, p_id, p_shop, v_item_id, v_item_name, v_item_qty, v_item_note);

    insert into public.order_item_prices (order_item_id, shop_id, order_id, unit_price)
    values (v_order_item_id, p_shop, p_id, v_item_price);

    v_subtotal := v_subtotal + round(v_item_qty * v_item_price, 2);
  end loop;

  -- 11. Calculate total and insert money row
  v_total := v_subtotal + coalesce(p_delivery_fee, 0);

  insert into public.order_money (order_id, shop_id, subtotal, delivery_fee, total, paid_amount)
  values (p_id, p_shop, v_subtotal, coalesce(p_delivery_fee, 0), v_total, 0);

  -- 12. Create contact record with 128-bit random base64url tracking token
  v_tracking_token := encode(extensions.gen_random_bytes(16), 'base64');
  v_tracking_token := replace(replace(replace(v_tracking_token, '+', '-'), '/', '_'), '=', '');

  v_phone := p_contact->>'phone';
  v_address := p_contact->>'address';
  v_address_note := p_contact->>'address_note';

  insert into public.order_contacts (order_id, shop_id, phone, address, address_note, tracking_token)
  values (p_id, p_shop, v_phone, v_address, v_address_note, v_tracking_token);

  -- 13. Timeline event
  insert into public.order_events (order_id, shop_id, type, to_status, actor, client_id, meta)
  values (
    p_id, p_shop, 'created', 'new', v_uid, p_id,
    jsonb_build_object(
      'order_no', v_order_no,
      'order_code', v_order_code,
      'total', v_total,
      'type', p_type,
      'repair', case when p_type = 'repair' then jsonb_build_object('device', v_device, 'pickup_code', v_pickup_code) else null end
    )
  );

  return v_order;
end $$;

-- 5. Re-implement edit_order with estimate threshold rule for repairs
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
  -- Repair check
  v_approved_total numeric;
  v_new_status public.order_status;
  v_estimate_exceeded boolean := false;
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

  -- 6. Edit gate: allowed only until ready
  if v_order.status in ('ready', 'out_for_delivery', 'completed', 'cancelled') then
    raise exception 'INVALID_TRANSITION: Orders can only be edited before ready';
  end if;

  -- 7. Snapshot previous state
  select total, paid_amount, delivery_fee into v_prev_total, v_paid, v_delivery_fee
  from public.order_money where order_id = p_order;

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty)), '[]'::jsonb)
  into v_prev_items from public.order_items where order_id = p_order;

  -- 8. If new items provided, replace lines
  if p_items is not null and jsonb_array_length(p_items) > 0 then
    delete from public.order_items where order_id = p_order;

    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_name := trim(v_item->>'name');
      if v_item_name is null or char_length(v_item_name) = 0 then
        raise exception 'VALIDATION: Item name is required';
      end if;

      v_item_qty := coalesce((v_item->>'qty')::numeric, 1);
      if v_item_qty <= 0 or v_item_qty > 10000 then
        raise exception 'VALIDATION: Invalid item quantity';
      end if;

      v_item_note := v_item->>'note';
      v_item_id := case when (v_item->>'item_id') is not null and (v_item->>'item_id') <> ''
                         then (v_item->>'item_id')::uuid else null end;

      if v_item_id is not null then
        select price into v_cat_price
        from public.catalog_items
        where id = v_item_id and shop_id = p_shop and archived_at is null;

        if not found then
          raise exception 'NOT_FOUND: Catalog item not found';
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
        raise exception 'VALIDATION: Price cannot be negative';
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
      raise exception 'OVERPAYMENT: Paid amount exceeds new total';
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

  -- 10. Repair estimate rule:
  -- "Rule: total above approved estimate moves the order to waiting"
  v_new_status := v_order.status;
  if v_order.type = 'repair' then
    select approved_total into v_approved_total
    from public.repair_jobs where order_id = p_order;

    if v_approved_total is not null and v_total > v_approved_total then
      v_new_status := 'waiting';
      v_estimate_exceeded := true;

      update public.repair_jobs
      set waiting_reason = 'estimate_exceeded'
      where order_id = p_order;
    end if;
  end if;

  -- 11. Update order fields and increment version
  update public.orders
  set status = v_new_status,
      note = coalesce(p_note, note),
      due_at = coalesce(p_due_at, due_at),
      settle_later = coalesce(p_settle_later, settle_later),
      version = version + 1,
      updated_at = now()
  where id = p_order
  returning * into v_order;

  -- 12. Append edited event
  insert into public.order_events (order_id, shop_id, type, actor, client_id, meta)
  values (
    p_order, p_shop, 'edited', v_uid, p_client_id,
    jsonb_build_object(
      'prev_version', p_expected_version,
      'prev_total', v_prev_total,
      'new_total', v_total,
      'prev_items', v_prev_items,
      'estimate_exceeded', v_estimate_exceeded,
      'approved_total', v_approved_total
    )
  );

  return v_order;
end $$;

-- 6. RPC: approve_estimate
-- Sets approved_total, approved_at, approved_by on repair_jobs and records estimate_approved event.
create or replace function public.approve_estimate(
  p_shop uuid,
  p_order uuid,
  p_client_id uuid,
  p_total numeric
)
returns public.repair_jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.member_role := public.my_role(p_shop);
  v_uid uuid := (select auth.uid());
  v_repair public.repair_jobs;
  v_order public.orders;
  v_current_total numeric;
begin
  -- 1. Role validation: owner and staff only
  if v_role is null or v_role not in ('owner', 'staff') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- 2. Rate limit
  perform public.rate_limit_hit('rpc:' || v_uid, 240, 60);

  -- 3. Idempotent check on client_id
  if exists (select 1 from public.order_events where shop_id = p_shop and client_id = p_client_id) then
    select * into v_repair from public.repair_jobs where order_id = p_order and shop_id = p_shop;
    return v_repair;
  end if;

  -- 4. Validate order and lock repair job
  select * into v_order from public.orders where id = p_order and shop_id = p_shop;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_order.type <> 'repair' then
    raise exception 'VALIDATION: Estimate approval is only valid for repair orders';
  end if;

  if p_total is null or p_total < 0 then
    raise exception 'VALIDATION: Approved total cannot be negative';
  end if;

  -- 5. Update repair_jobs
  update public.repair_jobs
  set approved_total = p_total,
      approved_at = now(),
      approved_by = v_uid,
      waiting_reason = case when waiting_reason = 'estimate_exceeded' then null else waiting_reason end
  where order_id = p_order and shop_id = p_shop
  returning * into v_repair;

  if not found then
    raise exception 'NOT_FOUND: Repair job not found';
  end if;

  -- 6. If order was waiting due to estimate exceeded, and new approved total covers current total, clear waiting
  select total into v_current_total from public.order_money where order_id = p_order;
  if v_order.status = 'waiting' and v_current_total <= p_total then
    update public.orders
    set status = 'in_progress', version = version + 1, updated_at = now()
    where id = p_order;
  end if;

  -- 7. Append estimate_approved event
  insert into public.order_events (order_id, shop_id, type, actor, client_id, meta)
  values (
    p_order, p_shop, 'estimate_approved', v_uid, p_client_id,
    jsonb_build_object(
      'approved_total', p_total,
      'approved_by', v_uid
    )
  );

  return v_repair;
end $$;

-- 7. RPC: handover_order
-- Completes a repair order after verifying the pickup code (or recorded owner override).
-- Balance must be zero or settle_later must be true.
create or replace function public.handover_order(
  p_shop uuid,
  p_order uuid,
  p_code text default null,
  p_override boolean default false,
  p_client_id uuid default null
)
returns public.orders
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.member_role := public.my_role(p_shop);
  v_uid uuid := (select auth.uid());
  v_order public.orders;
  v_repair public.repair_jobs;
  v_total numeric;
  v_paid numeric;
  v_settle_later boolean;
  v_input_hash bytea;
  v_client_id uuid := coalesce(p_client_id, gen_random_uuid());
begin
  -- 1. Role validation: owner and staff only
  if v_role is null or v_role not in ('owner', 'staff') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- 2. Owner override check: ONLY owner can override pickup code
  if coalesce(p_override, false) and v_role <> 'owner' then
    raise exception 'FORBIDDEN';
  end if;

  -- 3. Rate limit
  perform public.rate_limit_hit('rpc:' || v_uid, 240, 60);

  -- 4. Idempotency on client_id
  if exists (select 1 from public.order_events where shop_id = p_shop and client_id = v_client_id) then
    select * into v_order from public.orders where id = p_order and shop_id = p_shop;
    return v_order;
  end if;

  -- 5. Lock order
  select * into v_order from public.orders where id = p_order and shop_id = p_shop for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_order.type <> 'repair' then
    raise exception 'VALIDATION';
  end if;

  if v_order.status = 'completed' then
    return v_order; -- already completed
  end if;

  if v_order.status <> 'ready' then
    raise exception 'INVALID_TRANSITION';
  end if;

  -- 6. Lock and check repair job
  select * into v_repair from public.repair_jobs where order_id = p_order and shop_id = p_shop for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  -- 7. Pickup code verification
  if not coalesce(p_override, false) then
    if p_code is null or btrim(p_code) = '' then
      raise exception 'INVALID_CODE';
    end if;

    v_input_hash := sha256(convert_to(upper(btrim(p_code)), 'UTF8'));
    if v_input_hash <> v_repair.pickup_code_hash then
      raise exception 'INVALID_CODE';
    end if;
  end if;

  -- 8. Balance check: must be zero OR settle_later = true
  select total, paid_amount, settle_later into v_total, v_paid, v_settle_later
  from public.order_money m
  join public.orders o on o.id = m.order_id
  where m.order_id = p_order;

  if (v_total - v_paid > 0) and not coalesce(v_settle_later, false) then
    raise exception 'VALIDATION';
  end if;

  -- 9. Update repair job record
  update public.repair_jobs
  set handed_over_at = now(),
      handover_override = coalesce(p_override, false)
  where order_id = p_order;

  -- 10. Complete order
  update public.orders
  set status = 'completed',
      completed_at = now(),
      version = version + 1,
      updated_at = now()
  where id = p_order
  returning * into v_order;

  -- 11. Timeline event
  insert into public.order_events (order_id, shop_id, type, from_status, to_status, actor, client_id, meta)
  values (
    p_order, p_shop, 'status_changed', 'ready', 'completed', v_uid, v_client_id,
    jsonb_build_object(
      'handover', true,
      'override', coalesce(p_override, false),
      'actor', v_uid
    )
  );

  return v_order;
end $$;

-- 8. RPC: set_waiting_reason
create or replace function public.set_waiting_reason(
  p_shop uuid,
  p_order uuid,
  p_reason text,
  p_client_id uuid default null
)
returns public.repair_jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.member_role := public.my_role(p_shop);
  v_uid uuid := (select auth.uid());
  v_repair public.repair_jobs;
  v_client_id uuid := coalesce(p_client_id, gen_random_uuid());
begin
  if v_role is null or v_role not in ('owner', 'staff') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  perform public.rate_limit_hit('rpc:' || v_uid, 240, 60);

  update public.repair_jobs
  set waiting_reason = nullif(btrim(p_reason), '')
  where order_id = p_order and shop_id = p_shop
  returning * into v_repair;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.order_events (order_id, shop_id, type, actor, client_id, meta)
  values (
    p_order, p_shop, 'note', v_uid, v_client_id,
    jsonb_build_object('waiting_reason', p_reason)
  );

  return v_repair;
end $$;

-- 9. RPC: repair_turnaround
-- Calculates turnaround statistics for repair jobs
create or replace function public.repair_turnaround(p_shop uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.member_role := public.my_role(p_shop);
  v_avg_hours numeric;
  v_completed_count int;
  v_active_count int;
  v_waiting_count int;
begin
  if v_role is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- Average turnaround hours for completed repairs (from created_at to completed_at)
  select
    coalesce(round(avg(extract(epoch from (o.completed_at - o.created_at)) / 3600)::numeric, 1), 0),
    count(*)
  into v_avg_hours, v_completed_count
  from public.orders o
  where o.shop_id = p_shop
    and o.type = 'repair'
    and o.status = 'completed'
    and o.completed_at is not null;

  -- Active repairs count
  select count(*) into v_active_count
  from public.orders o
  where o.shop_id = p_shop
    and o.type = 'repair'
    and o.status in ('new', 'accepted', 'in_progress', 'ready');

  -- Waiting repairs count
  select count(*) into v_waiting_count
  from public.orders o
  where o.shop_id = p_shop
    and o.type = 'repair'
    and o.status = 'waiting';

  return jsonb_build_object(
    'avg_turnaround_hours', v_avg_hours,
    'completed_count', v_completed_count,
    'active_count', v_active_count,
    'waiting_count', v_waiting_count
  );
end $$;

-- Permissions
grant execute on function public.approve_estimate(uuid, uuid, uuid, numeric) to authenticated;
grant execute on function public.handover_order(uuid, uuid, text, boolean, uuid) to authenticated;
grant execute on function public.set_waiting_reason(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.repair_turnaround(uuid) to authenticated;
