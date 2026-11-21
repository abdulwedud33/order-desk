-- 0008_reports.sql
-- Milestone M9: Reporting RPCs, Ledger Reconciliation, and Aggregates
-- All calculations are strictly read-only, derived from immutable ledgers and order tables.
-- Access: Owner only (enforces docs/03-app-flow.md section 4 line 127).
-- Rate limiting: 30 calls/minute per user.

-- 1. Dashboard Summary
create or replace function public.dashboard_summary(
  p_shop uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := (select auth.uid());
  v_orders    int;
  v_sales     numeric(14,2);
  v_cash_in   numeric(14,2);
  v_unpaid    numeric(14,2);
  v_late      int;
  v_avg_mins  numeric(10,1);
  v_by_status jsonb;
begin
  -- Access: Owner only
  if not public.has_role(p_shop, 'owner') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- Rate limit: 30 per min per user
  perform public.rate_limit_hit('report:' || v_uid, 30, 60);

  -- Input window validation
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '366 days' then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  -- 1. Orders count in window
  select count(*) into v_orders
    from public.orders
   where shop_id = p_shop and created_at >= p_from and created_at < p_to;

  -- 2. Sales total: sum of total for completed orders in window
  select coalesce(sum(m.total), 0) into v_sales
    from public.orders o
    join public.order_money m on m.order_id = o.id
   where o.shop_id = p_shop and o.status = 'completed' and o.created_at >= p_from and o.created_at < p_to;

  -- 3. Cash in: ledger-based sum of payments and deposits minus refunds in window
  select coalesce(sum(
    case
      when p.kind in ('payment', 'deposit') then p.amount
      when p.kind = 'refund' then -p.amount
      else 0
    end
  ), 0) into v_cash_in
    from public.order_payments p
   where p.shop_id = p_shop and p.created_at >= p_from and p.created_at < p_to;

  -- 4. Unpaid balance for active/completed non-cancelled orders in window
  select coalesce(sum(greatest(m.total - m.paid_amount, 0)), 0) into v_unpaid
    from public.orders o
    join public.order_money m on m.order_id = o.id
   where o.shop_id = p_shop and o.status != 'cancelled' and o.created_at >= p_from and o.created_at < p_to;

  -- 5. Late orders count in window
  select count(*) into v_late
    from public.orders o
   where o.shop_id = p_shop
     and o.status != 'cancelled'
     and o.due_at is not null
     and ((o.completed_at is not null and o.completed_at > o.due_at) or (o.completed_at is null and now() > o.due_at))
     and o.created_at >= p_from
     and o.created_at < p_to;

  -- 6. Average completion time in minutes for completed orders in window
  select coalesce(round(avg(extract(epoch from (o.completed_at - o.created_at)) / 60)::numeric, 1), 0) into v_avg_mins
    from public.orders o
   where o.shop_id = p_shop
     and o.status = 'completed'
     and o.completed_at is not null
     and o.created_at >= p_from
     and o.created_at < p_to;

  -- 7. Orders count grouped by status
  select coalesce(jsonb_object_agg(st.status, st.cnt), '{}'::jsonb) into v_by_status
    from (
      select o.status::text as status, count(*)::int as cnt
        from public.orders o
       where o.shop_id = p_shop and o.created_at >= p_from and o.created_at < p_to
       group by o.status
    ) st;

  return jsonb_build_object(
    'orders_count', v_orders,
    'sales_total', v_sales,
    'cash_in', v_cash_in,
    'unpaid_balance', v_unpaid,
    'late_count', v_late,
    'avg_completion_minutes', v_avg_mins,
    'by_status', v_by_status
  );
end $$;

-- 2. Top Items / Services
create or replace function public.top_items(
  p_shop uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit int default 5
)
returns table (
  item_name text,
  qty numeric,
  revenue numeric,
  order_count int
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.has_role(p_shop, 'owner') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  perform public.rate_limit_hit('report:' || (select auth.uid()), 30, 60);

  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '366 days'
     or p_limit not between 1 and 50 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  return query
  select
    i.name,
    sum(i.qty)::numeric,
    sum(round(i.qty * coalesce(ip.unit_price, 0), 2))::numeric,
    count(distinct o.id)::int
  from public.orders o
  join public.order_items i on i.order_id = o.id
  left join public.order_item_prices ip on ip.order_item_id = i.id
  where o.shop_id = p_shop
    and o.status != 'cancelled'
    and o.created_at >= p_from
    and o.created_at < p_to
  group by i.name
  order by sum(round(i.qty * coalesce(ip.unit_price, 0), 2)) desc
  limit p_limit;
end $$;

-- 3. Orders by Hour (Busiest Hours)
create or replace function public.orders_by_hour(
  p_shop uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  hour int,
  order_count int,
  sales_total numeric
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_tz text;
begin
  if not public.has_role(p_shop, 'owner') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  perform public.rate_limit_hit('report:' || (select auth.uid()), 30, 60);

  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '92 days' then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  select coalesce(s.timezone, 'Africa/Addis_Ababa') into v_tz
    from public.shops s
   where s.id = p_shop;

  return query
  select
    extract(hour from (o.created_at at time zone v_tz))::int as hour,
    count(*)::int as order_count,
    coalesce(sum(m.total), 0)::numeric as sales_total
  from public.orders o
  left join public.order_money m on m.order_id = o.id
  where o.shop_id = p_shop
    and o.status != 'cancelled'
    and o.created_at >= p_from
    and o.created_at < p_to
  group by 1
  order by 1 asc;
end $$;

-- 4. Late Orders List
create or replace function public.late_orders(
  p_shop uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit int default 10
)
returns table (
  order_id uuid,
  order_code text,
  type public.order_type,
  status public.order_status,
  created_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  delay_minutes int
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.has_role(p_shop, 'owner') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  perform public.rate_limit_hit('report:' || (select auth.uid()), 30, 60);

  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '366 days'
     or p_limit not between 1 and 100 then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  return query
  select
    o.id,
    o.order_code,
    o.type,
    o.status,
    o.created_at,
    o.due_at,
    o.completed_at,
    (extract(epoch from (coalesce(o.completed_at, now()) - o.due_at)) / 60)::int as delay_minutes
  from public.orders o
  where o.shop_id = p_shop
    and o.status != 'cancelled'
    and o.due_at is not null
    and ((o.completed_at is not null and o.completed_at > o.due_at) or (o.completed_at is null and now() > o.due_at))
    and o.created_at >= p_from
    and o.created_at < p_to
  order by delay_minutes desc
  limit p_limit;
end $$;

-- 5. Repair Turnaround Metrics
create or replace function public.repair_turnaround(
  p_shop uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_total      int;
  v_completed  int;
  v_waiting    int;
  v_avg_turn   numeric(10,1);
  v_avg_appr   numeric(10,1);
  v_reasons    jsonb;
begin
  if not public.has_role(p_shop, 'owner') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  perform public.rate_limit_hit('report:' || (select auth.uid()), 30, 60);

  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '366 days' then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  -- Total repair orders
  select count(*) into v_total
    from public.orders o
   where o.shop_id = p_shop and o.type = 'repair' and o.created_at >= p_from and o.created_at < p_to;

  -- Completed repairs
  select count(*) into v_completed
    from public.orders o
   where o.shop_id = p_shop and o.type = 'repair' and o.status = 'completed' and o.created_at >= p_from and o.created_at < p_to;

  -- Waiting repairs
  select count(*) into v_waiting
    from public.orders o
   where o.shop_id = p_shop and o.type = 'repair' and o.status = 'waiting' and o.created_at >= p_from and o.created_at < p_to;

  -- Average turnaround hours (from created_at to handed_over_at or completed_at)
  select coalesce(round(avg(extract(epoch from (coalesce(r.handed_over_at, o.completed_at) - o.created_at)) / 3600)::numeric, 1), 0)
    into v_avg_turn
    from public.orders o
    join public.repair_jobs r on r.order_id = o.id
   where o.shop_id = p_shop
     and o.status = 'completed'
     and (r.handed_over_at is not null or o.completed_at is not null)
     and o.created_at >= p_from
     and o.created_at < p_to;

  -- Average approval hours (from created_at to approved_at)
  select coalesce(round(avg(extract(epoch from (r.approved_at - o.created_at)) / 3600)::numeric, 1), 0)
    into v_avg_appr
    from public.orders o
    join public.repair_jobs r on r.order_id = o.id
   where o.shop_id = p_shop
     and r.approved_at is not null
     and o.created_at >= p_from
     and o.created_at < p_to;

  -- Breakdown of waiting reasons
  select coalesce(jsonb_object_agg(wr.reason, wr.cnt), '{}'::jsonb)
    into v_reasons
    from (
      select coalesce(r.waiting_reason, 'other') as reason, count(*)::int as cnt
        from public.orders o
        join public.repair_jobs r on r.order_id = o.id
       where o.shop_id = p_shop and o.status = 'waiting' and o.created_at >= p_from and o.created_at < p_to
       group by 1
    ) wr;

  return jsonb_build_object(
    'total_repairs', v_total,
    'completed_repairs', v_completed,
    'waiting_repairs', v_waiting,
    'avg_turnaround_hours', v_avg_turn,
    'avg_approval_hours', v_avg_appr,
    'waiting_reasons', v_reasons
  );
end $$;

-- 6. Orders Export Query (for CSV Export)
create or replace function public.orders_for_export(
  p_shop uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  order_code text,
  order_date date,
  type public.order_type,
  status public.order_status,
  channel public.order_channel,
  total numeric,
  paid_amount numeric,
  balance numeric,
  items_count int,
  created_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.has_role(p_shop, 'owner') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  perform public.rate_limit_hit('report:' || (select auth.uid()), 30, 60);

  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '366 days' then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  return query
  select
    o.order_code,
    o.order_date,
    o.type,
    o.status,
    o.channel,
    coalesce(m.total, 0)::numeric,
    coalesce(m.paid_amount, 0)::numeric,
    greatest(coalesce(m.total, 0) - coalesce(m.paid_amount, 0), 0)::numeric,
    coalesce(ic.cnt, 0)::int,
    o.created_at,
    o.due_at,
    o.completed_at
  from public.orders o
  left join public.order_money m on m.order_id = o.id
  left join (
    select order_id, count(*)::int as cnt
      from public.order_items
     group by order_id
  ) ic on ic.order_id = o.id
  where o.shop_id = p_shop
    and o.created_at >= p_from
    and o.created_at < p_to
  order by o.created_at desc;
end $$;

-- 7. Privileges
revoke all on function public.dashboard_summary(uuid, timestamptz, timestamptz),
                       public.top_items(uuid, timestamptz, timestamptz, int),
                       public.orders_by_hour(uuid, timestamptz, timestamptz),
                       public.late_orders(uuid, timestamptz, timestamptz, int),
                       public.repair_turnaround(uuid, timestamptz, timestamptz),
                       public.orders_for_export(uuid, timestamptz, timestamptz) from public, anon;

grant execute on function public.dashboard_summary(uuid, timestamptz, timestamptz),
                          public.top_items(uuid, timestamptz, timestamptz, int),
                          public.orders_by_hour(uuid, timestamptz, timestamptz),
                          public.late_orders(uuid, timestamptz, timestamptz, int),
                          public.repair_turnaround(uuid, timestamptz, timestamptz),
                          public.orders_for_export(uuid, timestamptz, timestamptz) to authenticated;
