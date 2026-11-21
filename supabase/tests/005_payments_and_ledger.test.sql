-- 005_payments_and_ledger.test.sql
-- pgTAP test suite for Milestone M5: Payments ledger, overpayment, refund limits, triggers, and RLS

begin;
select plan(28);

-- Setup test users & shop
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'owner_m5@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'staff_m5@test.com'),
  ('33333333-3333-3333-3333-333333333333', 'kitchen_m5@test.com'),
  ('44444444-4444-4444-4444-444444444444', 'courier_m5@test.com')
on conflict (id) do nothing;

insert into public.shops (id, owner_id, name, business_type)
values ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'M5 Test Cafe', 'food')
on conflict (id) do nothing;

insert into public.shop_members (shop_id, user_id, role, display_name)
values
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'owner', 'Owner Alice'),
  ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'staff', 'Staff Bob'),
  ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', 'kitchen', 'Kitchen Ken'),
  ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', 'courier', 'Courier Carl')
on conflict (shop_id, user_id) do nothing;

-- 1. Structural Checks
select has_table('public', 'order_payments', 'Table order_payments exists');
select has_index('public', 'order_payments', 'order_payments_order_idx', 'Index on order_id exists');

-- Create a test order
-- Owner context
set local role authenticated;
set local "request.jwt.claim.sub" to '11111111-1111-1111-1111-111111111111';

select lives_ok(
  $$
    select public.create_order(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '66666666-6666-6666-6666-666666666666'::uuid,
      'dine_in'::public.order_type,
      'Table 5',
      'walk_in'::public.order_channel,
      'Test order',
      now() + interval '30 minutes',
      '[{"name": "Burger", "qty": 2, "price": 100}]'::jsonb,
      '{"phone": "+251911223344"}'::jsonb
    );
  $$,
  'create_order succeeds (Total = 200, paid = 0)'
);

-- 2. Guard: direct update on order_money.paid_amount is blocked
select throws_ok(
  $$
    update public.order_money set paid_amount = 50 where order_id = '66666666-6666-6666-6666-666666666666'::uuid;
  $$,
  'FORBIDDEN',
  'Direct update to order_money.paid_amount is blocked by order_money_guard'
);

-- 3. Overpayment check on record_payment
select throws_ok(
  $$
    select public.record_payment(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '66666666-6666-6666-6666-666666666666'::uuid,
      gen_random_uuid(),
      'payment'::public.payment_kind,
      250.00,
      'cash'::public.pay_method,
      null
    );
  $$,
  'OVERPAYMENT',
  'Payment exceeding total balance raises OVERPAYMENT'
);

-- 4. Valid partial payment: 120 ETB
select lives_ok(
  $$
    select public.record_payment(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '66666666-6666-6666-6666-666666666666'::uuid,
      '77777777-7777-7777-7777-777777777777'::uuid,
      'payment'::public.payment_kind,
      120.00,
      'cash'::public.pay_method,
      'Cash partial'
    );
  $$,
  'Partial payment of 120 succeeds'
);

-- Check paid_amount updated via trigger to 120
select results_eq(
  $$ select paid_amount from public.order_money where order_id = '66666666-6666-6666-6666-666666666666'::uuid $$,
  $$ values (120.00::numeric(14,2)) $$,
  'paid_amount was updated to 120 by trigger'
);

-- 5. Idempotent replay: calling record_payment with same client_id returns without double-counting
select lives_ok(
  $$
    select public.record_payment(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '66666666-6666-6666-6666-666666666666'::uuid,
      '77777777-7777-7777-7777-777777777777'::uuid,
      'payment'::public.payment_kind,
      120.00,
      'cash'::public.pay_method,
      'Cash partial'
    );
  $$,
  'Idempotent replay succeeds without error'
);

select results_eq(
  $$ select paid_amount from public.order_money where order_id = '66666666-6666-6666-6666-666666666666'::uuid $$,
  $$ values (120.00::numeric(14,2)) $$,
  'paid_amount is still 120 after replay (not double counted)'
);

-- 6. Refund limits
-- Staff attempt at refund should be FORBIDDEN
set local "request.jwt.claim.sub" to '22222222-2222-2222-2222-222222222222'; -- Staff Bob
select throws_ok(
  $$
    select public.record_payment(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '66666666-6666-6666-6666-666666666666'::uuid,
      gen_random_uuid(),
      'refund'::public.payment_kind,
      20.00,
      'cash'::public.pay_method,
      'Customer returned drink'
    );
  $$,
  'FORBIDDEN',
  'Staff cannot record refund (owner only)'
);

-- Switch back to owner
set local "request.jwt.claim.sub" to '11111111-1111-1111-1111-111111111111'; -- Owner Alice

-- Refund without note should fail with VALIDATION
select throws_ok(
  $$
    select public.record_payment(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '66666666-6666-6666-6666-666666666666'::uuid,
      gen_random_uuid(),
      'refund'::public.payment_kind,
      20.00,
      'cash'::public.pay_method,
      ''
    );
  $$,
  'VALIDATION',
  'Refund without note fails with VALIDATION'
);

-- Refund exceeding paid_amount (120) should fail with OVERPAYMENT
select throws_ok(
  $$
    select public.record_payment(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '66666666-6666-6666-6666-666666666666'::uuid,
      gen_random_uuid(),
      'refund'::public.payment_kind,
      130.00,
      'cash'::public.pay_method,
      'Accidental overcharge'
    );
  $$,
  'OVERPAYMENT',
  'Refund exceeding paid amount fails with OVERPAYMENT'
);

-- Valid partial refund: 20 ETB
select lives_ok(
  $$
    select public.record_payment(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '66666666-6666-6666-6666-666666666666'::uuid,
      gen_random_uuid(),
      'refund'::public.payment_kind,
      20.00,
      'cash'::public.pay_method,
      'Returned one item'
    );
  $$,
  'Owner records valid refund of 20 ETB'
);

-- Check paid_amount reduced from 120 to 100
select results_eq(
  $$ select paid_amount from public.order_money where order_id = '66666666-6666-6666-6666-666666666666'::uuid $$,
  $$ values (100.00::numeric(14,2)) $$,
  'paid_amount was updated to 100 by refund trigger'
);

-- Ledger immutability test: direct update and delete on order_payments blocked
select throws_ok(
  $$ update public.order_payments set amount = 999 where order_id = '66666666-6666-6666-6666-666666666666'::uuid $$,
  '42501',
  'Direct update on order_payments is blocked by check_ledger_immutable'
);

select throws_ok(
  $$ delete from public.order_payments where order_id = '66666666-6666-6666-6666-666666666666'::uuid $$,
  '42501',
  'Direct delete on order_payments is blocked by check_ledger_immutable'
);

-- 7. Settle later rule on order completion
-- Advance order to accepted -> in_progress -> ready
select lives_ok(
  $$ select public.advance_order('55555555-5555-5555-5555-555555555555'::uuid, '66666666-6666-6666-6666-666666666666'::uuid, 'accepted'::public.order_status, 'new'::public.order_status, gen_random_uuid()) $$,
  'Advance to accepted'
);
select lives_ok(
  $$ select public.advance_order('55555555-5555-5555-5555-555555555555'::uuid, '66666666-6666-6666-6666-666666666666'::uuid, 'in_progress'::public.order_status, 'accepted'::public.order_status, gen_random_uuid()) $$,
  'Advance to in_progress'
);
select lives_ok(
  $$ select public.advance_order('55555555-5555-5555-5555-555555555555'::uuid, '66666666-6666-6666-6666-666666666666'::uuid, 'ready'::public.order_status, 'in_progress'::public.order_status, gen_random_uuid()) $$,
  'Advance to ready'
);

-- Attempt to complete with unpaid balance (total 200, paid 100) and settle_later = false should fail
select throws_ok(
  $$ select public.advance_order('55555555-5555-5555-5555-555555555555'::uuid, '66666666-6666-6666-6666-666666666666'::uuid, 'completed'::public.order_status, 'ready'::public.order_status, gen_random_uuid()) $$,
  'VALIDATION',
  'Completing an order with unpaid balance and settle_later=false fails with VALIDATION'
);

-- Set settle_later to true
select lives_ok(
  $$ select public.set_settle_later('55555555-5555-5555-5555-555555555555'::uuid, '66666666-6666-6666-6666-666666666666'::uuid, true, gen_random_uuid()) $$,
  'set_settle_later to true succeeds'
);

-- Now completing with settle_later = true succeeds
select lives_ok(
  $$ select public.advance_order('55555555-5555-5555-5555-555555555555'::uuid, '66666666-6666-6666-6666-666666666666'::uuid, 'completed'::public.order_status, 'ready'::public.order_status, gen_random_uuid()) $$,
  'Completing with settle_later=true succeeds'
);

-- 8. Courier cash on assigned deliveries
-- Create a delivery order assigned to Courier Carl
select lives_ok(
  $$
    select public.create_order(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '88888888-8888-8888-8888-888888888888'::uuid,
      'delivery'::public.order_type,
      'Delivery 1',
      'phone'::public.order_channel,
      'Courier cash test',
      now() + interval '30 minutes',
      '[{"name": "Pizza", "qty": 1, "price": 300}]'::jsonb,
      '{"phone": "+251911998877", "address": "Bole Medhanialem"}'::jsonb
    );
  $$,
  'create delivery order'
);

-- Assign to Courier Carl
select lives_ok(
  $$ select public.assign_order('55555555-5555-5555-5555-555555555555'::uuid, '88888888-8888-8888-8888-888888888888'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, gen_random_uuid()) $$,
  'Assign order to Courier Carl'
);

-- Switch to Courier Carl
set local "request.jwt.claim.sub" to '44444444-4444-4444-4444-444444444444';

-- Courier recording cash payment on assigned delivery succeeds
select lives_ok(
  $$
    select public.record_payment(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '88888888-8888-8888-8888-888888888888'::uuid,
      gen_random_uuid(),
      'payment'::public.payment_kind,
      300.00,
      'cash'::public.pay_method,
      'Collected at doorstep'
    );
  $$,
  'Courier recording cash on assigned delivery succeeds'
);

-- Courier recording non-cash (e.g. mobile_money) is blocked
select throws_ok(
  $$
    select public.record_payment(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '88888888-8888-8888-8888-888888888888'::uuid,
      gen_random_uuid(),
      'payment'::public.payment_kind,
      50.00,
      'mobile_money'::public.pay_method,
      null
    );
  $$,
  'FORBIDDEN',
  'Courier cannot record mobile_money (cash only)'
);

-- 9. RLS Matrix Checks for Kitchen
set local "request.jwt.claim.sub" to '33333333-3333-3333-3333-333333333333'; -- Kitchen Ken

-- Kitchen sees 0 rows from order_payments
select is_empty(
  $$ select * from public.order_payments where shop_id = '55555555-5555-5555-5555-555555555555'::uuid $$,
  'Kitchen role cannot select any order_payments'
);

-- Kitchen sees 0 rows from order_money
select is_empty(
  $$ select * from public.order_money where shop_id = '55555555-5555-5555-5555-555555555555'::uuid $$,
  'Kitchen role cannot select any order_money'
);

select * from finish();
rollback;
