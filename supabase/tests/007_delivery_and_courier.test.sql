-- 007_delivery_and_courier.test.sql
-- pgTAP tests for Milestone M7: Delivery and Courier View, Assignment, and RLS Isolation

begin;
select plan(26);

-- 1. Helper function checks
select has_function('assign_order', 'assign_order RPC exists');
select has_function('advance_order', 'advance_order RPC exists');
select has_function('record_payment', 'record_payment RPC exists');

-- 2. Test Setup: Users, Shop, Members
create user m7_owner with password 'secret';
create user m7_staff with password 'secret';
create user m7_kitchen with password 'secret';
create user m7_courier1 with password 'secret';
create user m7_courier2 with password 'secret';

grant authenticated to m7_owner, m7_staff, m7_kitchen, m7_courier1, m7_courier2;

\set u_owner '11111111-1111-4111-8111-111111111111'
\set u_staff '22222222-2222-4222-8222-222222222222'
\set u_kitchen '33333333-3333-4333-8333-333333333333'
\set u_courier1 '44444444-4444-4444-8444-444444444444'
\set u_courier2 '66666666-6666-4666-8666-666666666666'

\set shop_id '55555555-5555-4555-8555-555555555555'
\set order1_id '77777777-7777-4777-8777-777777777771'
\set order2_id '77777777-7777-4777-8777-777777777772'
\set order3_id '77777777-7777-4777-8777-777777777773'
\set order4_id '77777777-7777-4777-8777-777777777774'

insert into auth.users (id, email) values
  (:'u_owner', 'm7_owner@test.local'),
  (:'u_staff', 'm7_staff@test.local'),
  (:'u_kitchen', 'm7_kitchen@test.local'),
  (:'u_courier1', 'm7_courier1@test.local'),
  (:'u_courier2', 'm7_courier2@test.local')
on conflict (id) do nothing;

insert into public.shops (id, owner_id, name, business_type)
values (:'shop_id', :'u_owner', 'M7 Delivery Express', 'food');

insert into public.shop_members (shop_id, user_id, role, display_name) values
  (:'shop_id', :'u_owner', 'owner', 'Owner Alice'),
  (:'shop_id', :'u_staff', 'staff', 'Staff Bob'),
  (:'shop_id', :'u_kitchen', 'kitchen', 'Chef Charlie'),
  (:'shop_id', :'u_courier1', 'courier', 'Courier Dave'),
  (:'shop_id', :'u_courier2', 'courier', 'Courier Eve');

-- Seed test orders as staff
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_staff', true);

-- Order 1: Delivery assigned to Dave
select public.create_order(
  :'shop_id'::uuid,
  :'order1_id'::uuid,
  'delivery'::public.order_type,
  'Order 1',
  'phone'::public.order_channel,
  'Deliver to doorstep',
  now() + interval '30 minutes',
  jsonb_build_array(jsonb_build_object('name', 'Burger', 'qty', 1, 'price', 250)),
  '{"phone": "+251911111111", "address": "Bole Medhanialem"}'::jsonb
);

-- Order 2: Delivery assigned to Eve
select public.create_order(
  :'shop_id'::uuid,
  :'order2_id'::uuid,
  'delivery'::public.order_type,
  'Order 2',
  'telegram'::public.order_channel,
  'Call upon arrival',
  now() + interval '40 minutes',
  jsonb_build_array(jsonb_build_object('name', 'Pizza', 'qty', 1, 'price', 400)),
  '{"phone": "+251922222222", "address": "Sarbet Gabriel"}'::jsonb
);

-- Order 3: Unassigned delivery
select public.create_order(
  :'shop_id'::uuid,
  :'order3_id'::uuid,
  'delivery'::public.order_type,
  'Order 3',
  'walk_in'::public.order_channel,
  null,
  now() + interval '25 minutes',
  jsonb_build_array(jsonb_build_object('name', 'Salad', 'qty', 1, 'price', 180)),
  '{"phone": "+251933333333", "address": "Kazanchis"}'::jsonb
);

-- Order 4: Dine in order
select public.create_order(
  :'shop_id'::uuid,
  :'order4_id'::uuid,
  'dine_in'::public.order_type,
  'Table 5',
  'walk_in'::public.order_channel,
  null,
  now() + interval '15 minutes',
  jsonb_build_array(jsonb_build_object('name', 'Coffee', 'qty', 2, 'price', 40))
);

-- 3. Assign Order RPC rules
-- Staff assigns Order 1 to Courier Dave
select lives_ok(
  $$ select public.assign_order('55555555-5555-4555-8555-555555555555'::uuid, '77777777-7777-4777-8777-777777777771'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, gen_random_uuid()) $$,
  'Staff assigns Order 1 to Courier Dave'
);

-- Staff assigns Order 2 to Courier Eve
select lives_ok(
  $$ select public.assign_order('55555555-5555-4555-8555-555555555555'::uuid, '77777777-7777-4777-8777-777777777772'::uuid, '66666666-6666-4666-8666-666666666666'::uuid, gen_random_uuid()) $$,
  'Staff assigns Order 2 to Courier Eve'
);

-- Assigning non-courier role to delivery fails with VALIDATION
select throws_ok(
  $$ select public.assign_order('55555555-5555-4555-8555-555555555555'::uuid, '77777777-7777-4777-8777-777777777773'::uuid, '33333333-3333-4333-8333-333333333333'::uuid, gen_random_uuid()) $$,
  'VALIDATION',
  'Delivery assignee must be a courier'
);

-- Advance Order 1 to accepted -> in_progress -> ready
select public.advance_order(:'shop_id'::uuid, :'order1_id'::uuid, 'accepted'::public.order_status, 'new'::public.order_status, gen_random_uuid());
select public.advance_order(:'shop_id'::uuid, :'order1_id'::uuid, 'in_progress'::public.order_status, 'accepted'::public.order_status, gen_random_uuid());
select public.advance_order(:'shop_id'::uuid, :'order1_id'::uuid, 'ready'::public.order_status, 'in_progress'::public.order_status, gen_random_uuid());

-- 4. RLS Isolation for Courier Dave
select set_config('request.jwt.claim.sub', :'u_courier1', true);

-- Courier Dave cannot call assign_order
select throws_ok(
  $$ select public.assign_order('55555555-5555-4555-8555-555555555555'::uuid, '77777777-7777-4777-8777-777777777773'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, gen_random_uuid()) $$,
  '42501',
  'Courier cannot call assign_order (FORBIDDEN)'
);

-- Dave SELECT orders: sees ONLY Order 1
select results_eq(
  $$ select id from public.orders where shop_id = '55555555-5555-4555-8555-555555555555'::uuid $$,
  $$ values ('77777777-7777-4777-8777-777777777771'::uuid) $$,
  'Courier Dave can only select assigned Order 1'
);

-- Dave cannot see Eve's Order 2
select is_empty(
  $$ select id from public.orders where id = '77777777-7777-4777-8777-777777777772'::uuid $$,
  'Courier Dave cannot see Courier Eve Order 2'
);

-- Dave cannot see unassigned Order 3
select is_empty(
  $$ select id from public.orders where id = '77777777-7777-4777-8777-777777777773'::uuid $$,
  'Courier Dave cannot see unassigned Order 3'
);

-- Dave cannot see dine-in Order 4
select is_empty(
  $$ select id from public.orders where id = '77777777-7777-4777-8777-777777777774'::uuid $$,
  'Courier Dave cannot see dine-in Order 4'
);

-- Dave SELECT order_contacts: sees ONLY Order 1 contact
select results_eq(
  $$ select phone, address from public.order_contacts where shop_id = '55555555-5555-4555-8555-555555555555'::uuid $$,
  $$ values ('+251911111111'::text, 'Bole Medhanialem'::text) $$,
  'Courier Dave can only select contact for assigned Order 1'
);

-- Dave SELECT order_money: sees ONLY Order 1 money
select results_eq(
  $$ select total from public.order_money where shop_id = '55555555-5555-4555-8555-555555555555'::uuid $$,
  $$ values (250.00::numeric(14,2)) $$,
  'Courier Dave can only select money for assigned Order 1'
);

-- Dave SELECT order_items: sees items for Order 1
select results_eq(
  $$ select name, qty from public.order_items where shop_id = '55555555-5555-4555-8555-555555555555'::uuid $$,
  $$ values ('Burger'::text, 1::int) $$,
  'Courier Dave can select items for assigned Order 1'
);

-- Dave SELECT order_item_prices: 0 rows (prices table is owner/staff only)
select is_empty(
  $$ select * from public.order_item_prices where shop_id = '55555555-5555-4555-8555-555555555555'::uuid $$,
  'Courier Dave has zero access to order_item_prices'
);

-- 5. RLS Isolation for Courier Eve
select set_config('request.jwt.claim.sub', :'u_courier2', true);

-- Eve SELECT orders: sees ONLY Order 2
select results_eq(
  $$ select id from public.orders where shop_id = '55555555-5555-4555-8555-555555555555'::uuid $$,
  $$ values ('77777777-7777-4777-8777-777777777772'::uuid) $$,
  'Courier Eve can only select assigned Order 2'
);

-- Eve cannot see Dave's Order 1
select is_empty(
  $$ select id from public.orders where id = '77777777-7777-4777-8777-777777777771'::uuid $$,
  'Courier Eve cannot see Courier Dave Order 1'
);

-- 6. Courier Status Transitions
-- Switch back to Courier Dave
select set_config('request.jwt.claim.sub', :'u_courier1', true);

-- Dave cannot advance Eve's Order 2
select throws_ok(
  $$ select public.advance_order('55555555-5555-4555-8555-555555555555'::uuid, '77777777-7777-4777-8777-777777777772'::uuid, 'out_for_delivery'::public.order_status, 'ready'::public.order_status, gen_random_uuid()) $$,
  '42501',
  'Courier cannot advance another courier order (FORBIDDEN)'
);

-- Dave advances assigned Order 1: ready -> out_for_delivery ("Picked up")
select lives_ok(
  $$ select public.advance_order('55555555-5555-4555-8555-555555555555'::uuid, '77777777-7777-4777-8777-777777777771'::uuid, 'out_for_delivery'::public.order_status, 'ready'::public.order_status, gen_random_uuid()) $$,
  'Courier Dave advances assigned Order 1 to out_for_delivery'
);

-- Dave cannot complete Order 1 while unpaid without settle_later
select throws_ok(
  $$ select public.advance_order('55555555-5555-4555-8555-555555555555'::uuid, '77777777-7777-4777-8777-777777777771'::uuid, 'completed'::public.order_status, 'out_for_delivery'::public.order_status, gen_random_uuid()) $$,
  'VALIDATION',
  'Completing unpaid delivery without settle_later fails with VALIDATION'
);

-- 7. Courier Cash Payments & Delivery Completion
-- Dave cannot record payment on Eve's Order 2
select throws_ok(
  $$
    select public.record_payment(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '77777777-7777-4777-8777-777777777772'::uuid,
      gen_random_uuid(),
      'payment'::public.payment_kind,
      400.00,
      'cash'::public.pay_method,
      null
    );
  $$,
  'FORBIDDEN',
  'Courier cannot record payment on another courier order'
);

-- Dave cannot record non-cash payment (e.g. mobile_money)
select throws_ok(
  $$
    select public.record_payment(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '77777777-7777-4777-8777-777777777771'::uuid,
      gen_random_uuid(),
      'payment'::public.payment_kind,
      250.00,
      'mobile_money'::public.pay_method,
      null
    );
  $$,
  'FORBIDDEN',
  'Courier cannot record mobile_money (cash only)'
);

-- Dave cannot record refund
select throws_ok(
  $$
    select public.record_payment(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '77777777-7777-4777-8777-777777777771'::uuid,
      gen_random_uuid(),
      'refund'::public.payment_kind,
      50.00,
      'cash'::public.pay_method,
      'Test refund'
    );
  $$,
  'FORBIDDEN',
  'Courier cannot record refund'
);

-- Dave records cash payment of 250 ETB on assigned delivery Order 1
select lives_ok(
  $$
    select public.record_payment(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '77777777-7777-4777-8777-777777777771'::uuid,
      gen_random_uuid(),
      'payment'::public.payment_kind,
      250.00,
      'cash'::public.pay_method,
      'Doorstep cash payment'
    );
  $$,
  'Courier Dave records cash payment on assigned delivery'
);

-- Check paid_amount updated to 250
select results_eq(
  $$ select paid_amount from public.order_money where order_id = '77777777-7777-4777-8777-777777777771'::uuid $$,
  $$ values (250.00::numeric(14,2)) $$,
  'paid_amount equals 250 after cash collection'
);

-- Dave advances paid Order 1: out_for_delivery -> completed ("Delivered")
select lives_ok(
  $$ select public.advance_order('55555555-5555-4555-8555-555555555555'::uuid, '77777777-7777-4777-8777-777777777771'::uuid, 'completed'::public.order_status, 'out_for_delivery'::public.order_status, gen_random_uuid()) $$,
  'Courier Dave marks Order 1 as completed'
);

-- Verify Order 1 is completed
select results_eq(
  $$ select status from public.orders where id = '77777777-7777-4777-8777-777777777771'::uuid $$,
  $$ values ('completed'::public.order_status) $$,
  'Order 1 status is completed'
);

select * from finish();
rollback;
