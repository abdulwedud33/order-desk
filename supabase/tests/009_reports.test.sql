-- 009_reports.test.sql
-- pgTAP tests for Milestone M9: Reports, Owner Access Enforcement, and Ledger Reconciliation

begin;
select plan(18);

-- 1. Function existence checks
select has_function('public', 'dashboard_summary', ARRAY['uuid', 'timestamptz', 'timestamptz'], 'dashboard_summary function exists');
select has_function('public', 'top_items', ARRAY['uuid', 'timestamptz', 'timestamptz', 'integer'], 'top_items function exists');
select has_function('public', 'orders_by_hour', ARRAY['uuid', 'timestamptz', 'timestamptz'], 'orders_by_hour function exists');
select has_function('public', 'late_orders', ARRAY['uuid', 'timestamptz', 'timestamptz', 'integer'], 'late_orders function exists');
select has_function('public', 'repair_turnaround', ARRAY['uuid', 'timestamptz', 'timestamptz'], 'repair_turnaround function exists');
select has_function('public', 'orders_for_export', ARRAY['uuid', 'timestamptz', 'timestamptz'], 'orders_for_export function exists');

-- 2. Setup Test Identities and Shop
create user m9_owner with password 'secret';
create user m9_staff with password 'secret';
create user m9_kitchen with password 'secret';
create user m9_courier with password 'secret';
create user m9_anon with password 'secret';

grant authenticated to m9_owner, m9_staff, m9_kitchen, m9_courier;
grant anon to m9_anon;

\set u_owner 'a1111111-1111-4111-8111-111111111111'
\set u_staff 'b2222222-2222-4222-8222-222222222222'
\set u_kitchen 'c3333333-3333-4333-8333-333333333333'
\set u_courier 'd4444444-4444-4444-8444-444444444444'
\set shop_id 'e5555555-5555-4555-8555-555555555555'
\set order_completed 'f6666666-6666-4666-8666-666666666666'
\set order_active 'f7777777-7777-4777-8777-777777777777'

insert into auth.users (id, email) values
  (:'u_owner', 'm9_owner@test.local'),
  (:'u_staff', 'm9_staff@test.local'),
  (:'u_kitchen', 'm9_kitchen@test.local'),
  (:'u_courier', 'm9_courier@test.local')
on conflict (id) do nothing;

insert into public.shops (id, owner_id, name, business_type, timezone)
values (:'shop_id', :'u_owner', 'M9 Reports Cafe', 'food', 'Africa/Addis_Ababa');

insert into public.shop_members (shop_id, user_id, role, display_name) values
  (:'shop_id', :'u_owner', 'owner', 'Owner Alice'),
  (:'shop_id', :'u_staff', 'staff', 'Staff Bob'),
  (:'shop_id', :'u_kitchen', 'kitchen', 'Chef Charlie'),
  (:'shop_id', :'u_courier', 'courier', 'Courier Dave');

-- 3. Access Control Tests: Non-owner roles are strictly blocked with 42501 FORBIDDEN
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_staff', true);
select throws_ok(
  format('select public.dashboard_summary(%L::uuid, now() - interval ''1 day'', now() + interval ''1 day'')', :'shop_id'),
  '42501',
  'FORBIDDEN',
  'Staff role cannot call dashboard_summary'
);

select set_config('request.jwt.claim.sub', :'u_kitchen', true);
select throws_ok(
  format('select public.dashboard_summary(%L::uuid, now() - interval ''1 day'', now() + interval ''1 day'')', :'shop_id'),
  '42501',
  'FORBIDDEN',
  'Kitchen role cannot call dashboard_summary'
);

select set_config('request.jwt.claim.sub', :'u_courier', true);
select throws_ok(
  format('select public.dashboard_summary(%L::uuid, now() - interval ''1 day'', now() + interval ''1 day'')', :'shop_id'),
  '42501',
  'FORBIDDEN',
  'Courier role cannot call dashboard_summary'
);

set local role anon;
select throws_ok(
  format('select public.dashboard_summary(%L::uuid, now() - interval ''1 day'', now() + interval ''1 day'')', :'shop_id'),
  '42501',
  NULL,
  'Anon cannot call dashboard_summary'
);

-- 4. Validation Checks: Invalid time ranges
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner', true);

select throws_ok(
  format('select public.dashboard_summary(%L::uuid, now(), now() - interval ''1 hour'')', :'shop_id'),
  '22023',
  'VALIDATION',
  'Backwards interval p_to <= p_from raises VALIDATION error'
);

select throws_ok(
  format('select public.dashboard_summary(%L::uuid, now() - interval ''400 days'', now())', :'shop_id'),
  '22023',
  'VALIDATION',
  'Interval greater than 366 days raises VALIDATION error'
);

-- 5. Seed Test Orders & Immutable Payments Ledger
-- Order 1: Completed dine-in order (Total: 400 ETB, fully paid)
select public.create_order(
  :'shop_id'::uuid,
  :'order_completed'::uuid,
  'dine_in'::public.order_type,
  'Table 1',
  'walk_in'::public.order_channel,
  'No spicy',
  now() + interval '30 minutes',
  jsonb_build_array(
    jsonb_build_object('name', 'Special Tibs', 'qty', 1, 'price', 350.00),
    jsonb_build_object('name', 'Mineral Water', 'qty', 1, 'price', 50.00)
  ),
  null,
  0,
  null,
  null
);

-- Record payment of 400 ETB
select public.record_payment(
  :'shop_id'::uuid,
  :'order_completed'::uuid,
  'payment'::public.payment_kind,
  400.00,
  'cash'::public.pay_method,
  'Paid in full cash',
  gen_random_uuid()
);

-- Advance to completed
select public.advance_order(:'shop_id'::uuid, :'order_completed'::uuid, 'accepted'::public.order_status, 'new'::public.order_status);
select public.advance_order(:'shop_id'::uuid, :'order_completed'::uuid, 'in_progress'::public.order_status, 'accepted'::public.order_status);
select public.advance_order(:'shop_id'::uuid, :'order_completed'::uuid, 'ready'::public.order_status, 'in_progress'::public.order_status);
select public.advance_order(:'shop_id'::uuid, :'order_completed'::uuid, 'completed'::public.order_status, 'ready'::public.order_status);

-- Order 2: Active takeaway order (Total: 200 ETB, deposit 50 ETB, unpaid balance: 150 ETB)
select public.create_order(
  :'shop_id'::uuid,
  :'order_active'::uuid,
  'takeaway'::public.order_type,
  'Customer Dawit',
  'phone'::public.order_channel,
  'Pack separately',
  now() - interval '10 minutes', -- Past due (Late order test)
  jsonb_build_array(
    jsonb_build_object('name', 'Burger Combo', 'qty', 1, 'price', 200.00)
  ),
  null,
  0,
  null,
  null
);

select public.record_payment(
  :'shop_id'::uuid,
  :'order_active'::uuid,
  'deposit'::public.payment_kind,
  50.00,
  'mobile_money'::public.pay_method,
  'Telebirr deposit',
  gen_random_uuid()
);

-- 6. Reconcile Report Calculations with Database Ledgers
-- A. Cash in: 400 (payment) + 50 (deposit) = 450 ETB
select is(
  (public.dashboard_summary(:'shop_id'::uuid, now() - interval '1 day', now() + interval '1 day') ->> 'cash_in')::numeric,
  450.00::numeric,
  'dashboard_summary cash_in strictly matches net sum of order_payments ledger'
);

-- B. Completed sales total: 400 ETB
select is(
  (public.dashboard_summary(:'shop_id'::uuid, now() - interval '1 day', now() + interval '1 day') ->> 'sales_total')::numeric,
  400.00::numeric,
  'dashboard_summary sales_total matches completed orders total'
);

-- C. Unpaid balance: 150 ETB (from order_active: 200 - 50)
select is(
  (public.dashboard_summary(:'shop_id'::uuid, now() - interval '1 day', now() + interval '1 day') ->> 'unpaid_balance')::numeric,
  150.00::numeric,
  'dashboard_summary unpaid_balance matches uncollected balances'
);

-- D. Total orders: 2 orders
select is(
  (public.dashboard_summary(:'shop_id'::uuid, now() - interval '1 day', now() + interval '1 day') ->> 'orders_count')::int,
  2,
  'dashboard_summary orders_count matches 2 created orders'
);

-- E. Late orders: 1 order (order_active due_at is 10 mins in past)
select is(
  (public.dashboard_summary(:'shop_id'::uuid, now() - interval '1 day', now() + interval '1 day') ->> 'late_count')::int,
  1,
  'dashboard_summary identifies late active order'
);

-- F. Top items: Special Tibs has highest revenue (350 ETB)
select is(
  (select item_name from public.top_items(:'shop_id'::uuid, now() - interval '1 day', now() + interval '1 day', 1)),
  'Special Tibs',
  'top_items correctly ranks Special Tibs by revenue'
);

rollback;
