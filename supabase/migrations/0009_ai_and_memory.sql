-- 0009_ai_and_memory.sql
-- Milestone M10: Shop Memory, AI Usage Tracking, Propose Order RPC, and Tracking Helper
-- Rules: docs/05-backend-schema.md, docs/memory.md, docs/guardrails.md, docs/prompts.md.

-- 1. Table: shop_memory
create table if not exists public.shop_memory (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops on delete cascade,
  kind text not null check (kind in ('alias', 'preference', 'fact')),
  key text not null check (char_length(key) between 1 and 80),
  value text not null check (char_length(value) between 1 and 300),
  ref_id uuid,
  created_by uuid references auth.users,
  created_at timestamptz not null default now(),
  unique (shop_id, kind, key)
);

create index if not exists shop_memory_shop_idx on public.shop_memory (shop_id);

-- 2. Table: ai_usage
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops on delete cascade,
  user_id uuid references auth.users,
  agent text not null check (agent in ('order_intake', 'status_writer', 'insights_analyst')),
  input_tokens int check (input_tokens >= 0),
  output_tokens int check (output_tokens >= 0),
  ok boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_shop_idx on public.ai_usage (shop_id, created_at desc);

-- 3. Row Level Security
alter table public.shop_memory enable row level security;
alter table public.ai_usage enable row level security;

-- shop_memory: all shop members can read; owners can insert, update, delete
create policy memory_select on public.shop_memory
  for select to authenticated
  using (public.is_member(shop_id));

create policy memory_insert on public.shop_memory
  for insert to authenticated
  with check (public.has_role(shop_id, 'owner'));

create policy memory_update on public.shop_memory
  for update to authenticated
  using (public.has_role(shop_id, 'owner'))
  with check (public.has_role(shop_id, 'owner'));

create policy memory_delete on public.shop_memory
  for delete to authenticated
  using (public.has_role(shop_id, 'owner'));

-- ai_usage: owners can read their shop's usage; service role inserts
create policy ai_usage_select on public.ai_usage
  for select to authenticated
  using (public.has_role(shop_id, 'owner'));

-- Column privileges
revoke all on public.shop_memory from public, anon, authenticated;
grant select on public.shop_memory to authenticated;
grant insert (shop_id, kind, key, value, ref_id) on public.shop_memory to authenticated;
grant update (value, ref_id) on public.shop_memory to authenticated;
grant delete on public.shop_memory to authenticated;

revoke all on public.ai_usage from public, anon, authenticated;
grant select on public.ai_usage to authenticated;

-- 4. Trigger: Shop Memory Guard (200 item cap & content safety check)
create or replace function public.shop_memory_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_phone_pattern text := '((\+251|0)[97]\d{8})';
  v_injection_pattern text := '(?i)(ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|your)|system\s+prompt|reveal\s+(your\s+)?prompt)';
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.shop_memory where shop_id = new.shop_id) >= 200 then
      raise exception 'LIMIT_EXCEEDED' using message = 'Shop memory limit of 200 items reached';
    end if;

    -- Content safety: memory must never contain raw phone numbers (docs/memory.md section 3)
    if new.value ~ v_phone_pattern or new.key ~ v_phone_pattern then
      raise exception 'VALIDATION' using message = 'Memory items must not contain phone numbers';
    end if;

    -- Content safety: reject instruction-like phrases
    if new.value ~ v_injection_pattern or new.key ~ v_injection_pattern then
      raise exception 'VALIDATION' using message = 'Memory items must not contain system instructions';
    end if;

    new.created_by := (select auth.uid());
    perform public.write_audit(new.shop_id, 'memory_created', 'shop_memory', new.id, jsonb_build_object('kind', new.kind, 'key', new.key));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.value ~ v_phone_pattern or new.value ~ v_injection_pattern then
      raise exception 'VALIDATION' using message = 'Memory items must not contain phone numbers or system instructions';
    end if;
    perform public.write_audit(new.shop_id, 'memory_edited', 'shop_memory', new.id, jsonb_build_object('kind', new.kind, 'key', new.key));
    return new;
  elsif tg_op = 'DELETE' then
    if current_setting('app.shop_deletion', true) = 'on' then
      return old;
    end if;
    perform public.write_audit(old.shop_id, 'memory_deleted', 'shop_memory', old.id, jsonb_build_object('kind', old.kind, 'key', old.key));
    return old;
  end if;
  return new;
end $$;

drop trigger if exists shop_memory_guard_ins on public.shop_memory;
create trigger shop_memory_guard_ins
  before insert or update on public.shop_memory
  for each row execute function public.shop_memory_guard();

drop trigger if exists shop_memory_guard_del on public.shop_memory;
create trigger shop_memory_guard_del
  after delete on public.shop_memory
  for each row execute function public.shop_memory_guard();

-- 5. Helper RPC: track_order_lookup (Clean encapsulation for public tracking)
create or replace function public.track_order_lookup(
  p_token text
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rec record;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 64 then
    return jsonb_build_object('found', false);
  end if;

  select
    s.name as shop_name,
    s.business_type,
    o.order_code,
    o.type as order_type,
    o.status,
    o.due_at,
    o.updated_at,
    o.completed_at,
    o.cancelled_at
  into v_rec
  from public.order_contacts c
  join public.orders o on o.id = c.order_id
  join public.shops s on s.id = o.shop_id
  where c.tracking_token = p_token;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'shop_name', v_rec.shop_name,
    'business_type', v_rec.business_type,
    'order_code', v_rec.order_code,
    'order_type', v_rec.order_type,
    'status', v_rec.status,
    'due_at', v_rec.due_at,
    'updated_at', v_rec.updated_at,
    'completed_at', v_rec.completed_at,
    'cancelled_at', v_rec.cancelled_at
  );
end $$;

-- 6. Helper RPC: propose_order (Server-side price and catalog recompute for AI Intake)
create or replace function public.propose_order(
  p_shop uuid,
  p_type public.order_type,
  p_items jsonb,
  p_label text default null,
  p_channel public.order_channel default 'walk_in',
  p_note text default null,
  p_due_in_minutes int default null,
  p_customer_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_item record;
  v_catalog record;
  v_computed_lines jsonb := '[]'::jsonb;
  v_subtotal numeric(14,2) := 0;
  v_delivery_fee numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_max_prep int := 15;
  v_due_at timestamptz;
  v_qty numeric(10,2);
  v_unit_price numeric(14,2);
  v_line_subtotal numeric(14,2);
  v_is_free_text boolean;
begin
  if not public.is_member(p_shop) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_ITEMS' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 20 then
    raise exception 'LIMIT_EXCEEDED' using message = 'At most 20 order items allowed';
  end if;

  -- Recompute every line from database catalog (ignore client/model-supplied prices)
  for v_item in select * from jsonb_to_recordset(p_items) as x(
    item_id uuid,
    name text,
    qty numeric,
    note text,
    is_free_text boolean
  )
  loop
    v_qty := coalesce(v_item.qty, 1);
    if v_qty <= 0 or v_qty > 10000 then
      raise exception 'BAD_QUANTITY' using errcode = '22023';
    end if;

    if v_item.item_id is not null then
      select id, name, price, prep_minutes
        into v_catalog
        from public.catalog_items
       where id = v_item.item_id and shop_id = p_shop and archived_at is null;

      if not found then
        raise exception 'UNKNOWN_ITEM' using errcode = '22023';
      end if;

      v_unit_price := v_catalog.price;
      v_is_free_text := false;
      if v_catalog.prep_minutes > v_max_prep then
        v_max_prep := v_catalog.prep_minutes;
      end if;
    else
      -- Free-text line (allowed for special requests or repairs)
      v_unit_price := 0.00;
      v_is_free_text := true;
    end if;

    v_line_subtotal := round(v_qty * v_unit_price, 2);
    v_subtotal := v_subtotal + v_line_subtotal;

    v_computed_lines := v_computed_lines || jsonb_build_object(
      'item_id', v_item.item_id,
      'name', coalesce(v_catalog.name, v_item.name, 'Custom Item'),
      'qty', v_qty,
      'unit_price', v_unit_price,
      'subtotal', v_line_subtotal,
      'note', v_item.note,
      'is_free_text', v_is_free_text
    );
  end loop;

  -- Compute delivery fee
  if p_type = 'delivery' then
    select coalesce(default_delivery_fee, 0) into v_delivery_fee from public.shops where id = p_shop;
  end if;

  v_total := v_subtotal + v_delivery_fee;

  -- Calculate due time
  if p_due_in_minutes is not null and p_due_in_minutes > 0 then
    v_due_at := now() + (p_due_in_minutes || ' minutes')::interval;
  else
    v_due_at := now() + (v_max_prep || ' minutes')::interval;
  end if;

  return jsonb_build_object(
    'draft_status', 'ready',
    'type', p_type,
    'label', p_label,
    'channel', p_channel,
    'note', p_note,
    'customer_id', p_customer_id,
    'items', v_computed_lines,
    'subtotal', v_subtotal,
    'delivery_fee', v_delivery_fee,
    'total', v_total,
    'due_at', v_due_at
  );
end $$;

-- 7. Privileges
revoke all on function public.track_order_lookup(text),
                       public.propose_order(uuid, public.order_type, jsonb, text, public.order_channel, text, int, uuid) from public, anon;

grant execute on function public.track_order_lookup(text) to anon, authenticated;
grant execute on function public.propose_order(uuid, public.order_type, jsonb, text, public.order_channel, text, int, uuid) to authenticated;
