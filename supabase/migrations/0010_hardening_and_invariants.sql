-- 0010_hardening_and_invariants.sql
-- Milestone M11: Realtime Publication Audit, Final Privilege Lockdown, and Nightly Invariants Job

-- ============================================================================
-- 1. REALTIME PUBLICATION AUDIT
-- ============================================================================
-- Safe tables only: orders, order_items, order_money, order_events
-- NEVER publish: customers, order_contacts, repair_jobs, order_item_prices,
-- order_payments, shop_memory, ai_usage, profiles, audit_log, rate_limits

do $$
declare
  r record;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- Remove any unsafe tables if present
    for r in (
      select tablename from pg_publication_tables
      where pubname = 'supabase_realtime'
        and tablename in (
          'customers', 'order_contacts', 'repair_jobs', 'order_item_prices',
          'order_payments', 'shop_memory', 'ai_usage', 'profiles',
          'audit_log', 'rate_limits', 'order_counters'
        )
    ) loop
      execute format('alter publication supabase_realtime drop table public.%I', r.tablename);
    end loop;

    -- Add safe tables under RLS
    for r in (
      select unnest(array['orders', 'order_items', 'order_money', 'order_events']) as tablename
    ) loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and tablename = r.tablename
      ) then
        execute format('alter publication supabase_realtime add table public.%I', r.tablename);
      end if;
    end loop;
  end if;
end $$;

-- ============================================================================
-- 2. FINAL PRIVILEGE LOCKDOWN
-- ============================================================================

-- A. Revoke all privileges from anon and authenticated on all schema tables
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all routines in schema public from public, anon, authenticated;

-- B. Grant SELECT on safe tables covered by Row Level Security
grant select on table public.profiles to authenticated;
grant select on table public.shops to authenticated;
grant select on table public.shop_members to authenticated;
grant select on table public.catalog_categories to authenticated;
grant select on table public.catalog_items to authenticated;
grant select on table public.customers to authenticated;
grant select on table public.orders to authenticated;
grant select on table public.order_items to authenticated;
grant select on table public.order_item_prices to authenticated;
grant select on table public.order_money to authenticated;
grant select on table public.order_contacts to authenticated;
grant select on table public.order_payments to authenticated;
grant select on table public.order_events to authenticated;
grant select on table public.order_transitions to authenticated;
grant select on table public.repair_jobs to authenticated;
grant select on table public.shop_memory to authenticated;
grant select on table public.ai_usage to authenticated;
grant select on table public.audit_log to authenticated;

-- Grant SELECT on safe kitchen view
grant select on table public.repair_jobs_kitchen to authenticated;

-- C. Column-level write grants where documentation explicitly permits
grant insert (id, full_name, phone, locale) on public.profiles to authenticated;
grant update (full_name, phone, locale) on public.profiles to authenticated;

grant insert (id, shop_id, name, sort) on public.catalog_categories to authenticated;
grant update (name, sort) on public.catalog_categories to authenticated;
grant delete on public.catalog_categories to authenticated;

grant insert (id, shop_id, category_id, name, kind, price, prep_minutes, available) on public.catalog_items to authenticated;
grant update (category_id, name, kind, price, prep_minutes, available, archived_at) on public.catalog_items to authenticated;

grant insert (id, shop_id, name, phone, note) on public.customers to authenticated;
grant update (name, phone, note) on public.customers to authenticated;

grant insert (shop_id, kind, key, value, ref_id) on public.shop_memory to authenticated;
grant update (value, ref_id) on public.shop_memory to authenticated;
grant delete on public.shop_memory to authenticated;

-- D. Grant EXECUTE on trusted RPC functions to authenticated users
grant execute on function public.my_role(uuid) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.has_role(uuid, public.member_role) to authenticated;
grant execute on function public.has_role(uuid, public.member_role[]) to authenticated;
grant execute on function public.create_shop(text, public.business_type, text, text) to authenticated;
grant execute on function public.delete_shop(uuid) to authenticated;
grant execute on function public.create_invite(uuid, public.member_role) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.create_order(uuid, uuid, public.order_type, text, public.order_channel, text, timestamptz, jsonb, jsonb, numeric, uuid, jsonb) to authenticated;
grant execute on function public.edit_order(uuid, uuid, uuid, integer, jsonb, text, timestamptz, jsonb, boolean) to authenticated;
grant execute on function public.advance_order(uuid, uuid, public.order_status, public.order_status, uuid) to authenticated;
grant execute on function public.assign_order(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.cancel_order(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.record_payment(uuid, uuid, uuid, public.payment_kind, numeric, public.pay_method, text) to authenticated;
grant execute on function public.approve_estimate(uuid, uuid, uuid, numeric) to authenticated;
grant execute on function public.handover_order(uuid, uuid, text, boolean, uuid) to authenticated;
grant execute on function public.dashboard_summary(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.top_items(uuid, timestamptz, timestamptz, integer) to authenticated;
grant execute on function public.orders_by_hour(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.late_orders(uuid, timestamptz, timestamptz, integer) to authenticated;
grant execute on function public.repair_turnaround(uuid) to authenticated;
grant execute on function public.repair_turnaround(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.orders_for_export(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.set_waiting_reason(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.set_settle_later(uuid, uuid, boolean, uuid) to authenticated;
grant execute on function public.propose_order(uuid, public.order_type, jsonb, text, public.order_channel, text, int, uuid) to authenticated;

-- Public tracking helper: service role only
-- anon has zero execute privileges on track_order_lookup directly; edge function calls with service role.

-- ============================================================================
-- 3. NIGHTLY INVARIANTS JOB (docs/05-backend-schema.md section 10)
-- ============================================================================

create table if not exists public.invariant_checks (
  id uuid primary key default gen_random_uuid(),
  checked_at timestamptz not null default now(),
  passed boolean not null,
  total_invariants int not null default 9,
  violations_count int not null default 0,
  details jsonb not null default '[]'::jsonb
);

alter table public.invariant_checks enable row level security;
-- Owner of any shop or superuser can view invariant logs
create policy invariant_checks_owner_select on public.invariant_checks
  for select to authenticated
  using (exists (select 1 from public.shop_members where user_id = (select auth.uid()) and role = 'owner'));

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
      (select sum(i.qty * i.unit_price) from public.order_items i where i.order_id = m.order_id),
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

-- Nightly execution function that logs result and raises an alert if any invariant fails
create or replace function public.run_nightly_invariants_job()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rec record;
  v_total_violations int := 0;
  v_results jsonb := '[]'::jsonb;
  v_passed boolean := true;
begin
  for v_rec in select * from public.check_invariants() loop
    if v_rec.violations > 0 then
      v_total_violations := v_total_violations + v_rec.violations;
      v_passed := false;
    end if;
    v_results := v_results || jsonb_build_object(
      'invariant_no', v_rec.invariant_no,
      'description', v_rec.description,
      'status', v_rec.status,
      'violations', v_rec.violations
    );
  end loop;

  insert into public.invariant_checks (passed, total_invariants, violations_count, details)
  values (v_passed, 9, v_total_violations, v_results);

  if not v_passed then
    raise warning 'INVARIANTS_BREACH: % violations detected in nightly check', v_total_violations;
  end if;

  return jsonb_build_object(
    'passed', v_passed,
    'total_violations', v_total_violations,
    'details', v_results
  );
end $$;
