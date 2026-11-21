-- 004_status_machine_and_realtime.test.sql
-- pgTAP tests for Milestone M4: Status Machine, Transitions, Guards, and Realtime

begin;
select plan(24);

-- 1. Helper function checks
select has_function('advance_order', 'advance_order RPC exists');
select has_function('assign_order', 'assign_order RPC exists');
select has_function('cancel_order', 'cancel_order RPC exists');
select has_trigger('orders', 'orders_guard', 'orders_guard trigger exists');

-- 2. Test Setup: Users, Shop, Members, Order
create user m4_owner with password 'secret';
create user m4_staff with password 'secret';
create user m4_kitchen with password 'secret';
create user m4_courier with password 'secret';

grant authenticated to m4_owner, m4_staff, m4_kitchen, m4_courier;

\set u_owner '11111111-1111-4111-8111-111111111111'
\set u_staff '22222222-2222-4222-8222-222222222222'
\set u_kitchen '33333333-3333-4333-8333-333333333333'
\set u_courier '44444444-4444-4444-8444-444444444444'

\set shop_id '55555555-5555-4555-8555-555555555555'
\set order_id '77777777-7777-4777-8777-777777777777'

insert into auth.users (id, email) values
  (:'u_owner', 'm4_owner@test.local'),
  (:'u_staff', 'm4_staff@test.local'),
  (:'u_kitchen', 'm4_kitchen@test.local'),
  (:'u_courier', 'm4_courier@test.local')
on conflict (id) do nothing;

insert into public.shops (id, owner_id, name, business_type)
values (:'shop_id', :'u_owner', 'M4 Status Cafe', 'food');

insert into public.shop_members (shop_id, user_id, role, display_name) values
  (:'shop_id', :'u_owner', 'owner', 'Owner Alice'),
  (:'shop_id', :'u_staff', 'staff', 'Staff Bob'),
  (:'shop_id', :'u_kitchen', 'kitchen', 'Chef Charlie'),
  (:'shop_id', :'u_courier', 'courier', 'Rider Dave');

-- Create test order via create_order RPC
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_staff', true);

select lives_ok(
  $$
    select public.create_order(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '77777777-7777-4777-8777-777777777777'::uuid,
      'dine_in'::public.order_type,
      'Table 1',
      'walk_in'::public.order_channel,
      null,
      now() + interval '20 minutes',
      jsonb_build_array(jsonb_build_object('name', 'Pasta', 'qty', 1, 'price', 150))
    );
  $$,
  'Staff creates test order'
);

-- 3. Test orders_guard blocks direct SQL update of status
select throws_ok(
  $$
    update public.orders
    set status = 'accepted'
    where id = '77777777-7777-4777-8777-777777777777'::uuid;
  $$,
  'FORBIDDEN',
  'Status changes must go through advance_order or cancel_order RPCs',
  'orders_guard trigger successfully blocks direct status update'
);

-- 4. Test advance_order: Kitchen role advances new -> accepted
select set_config('request.jwt.claim.sub', :'u_kitchen', true);

select lives_ok(
  $$
    select public.advance_order(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '77777777-7777-4777-8777-777777777777'::uuid,
      'accepted'::public.order_status,
      'new'::public.order_status,
      gen_random_uuid()
    );
  $$,
  'Kitchen advances order from new to accepted'
);

select is(
  (select status from public.orders where id = :'order_id'),
  'accepted'::public.order_status,
  'Order status is now accepted'
);

select is(
  (select accepted_at is not null from public.orders where id = :'order_id'),
  true,
  'accepted_at timestamp was set'
);

-- 5. Test Concurrency Conflict: passing outdated expected_from raises CONFLICT
select set_config('request.jwt.claim.sub', :'u_staff', true);

select throws_ok(
  $$
    select public.advance_order(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '77777777-7777-4777-8777-777777777777'::uuid,
      'in_progress'::public.order_status,
      'new'::public.order_status, -- Outdated! Expected status is accepted
      gen_random_uuid()
    );
  $$,
  'CONFLICT',
  null,
  'advance_order with mismatched expected_from raises CONFLICT'
);

-- 6. Advance to in_progress with correct expected_from
select lives_ok(
  $$
    select public.advance_order(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '77777777-7777-4777-8777-777777777777'::uuid,
      'in_progress'::public.order_status,
      'accepted'::public.order_status,
      gen_random_uuid()
    );
  $$,
  'Advance accepted to in_progress succeeds'
);

-- 7. Test Kitchen Role Boundaries: Kitchen CANNOT complete or cancel orders
select set_config('request.jwt.claim.sub', :'u_kitchen', true);

select throws_ok(
  $$
    select public.advance_order(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '77777777-7777-4777-8777-777777777777'::uuid,
      'completed'::public.order_status,
      'in_progress'::public.order_status,
      gen_random_uuid()
    );
  $$,
  'INVALID_TRANSITION',
  null,
  'Kitchen cannot advance order to completed'
);

select throws_ok(
  $$
    select public.cancel_order(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '77777777-7777-4777-8777-777777777777'::uuid,
      'Ran out of pasta',
      gen_random_uuid()
    );
  $$,
  '42501',
  'FORBIDDEN',
  'Kitchen role is forbidden from cancelling orders'
);

-- 8. Test Courier Role Boundaries: Courier CANNOT advance dine_in orders
select set_config('request.jwt.claim.sub', :'u_courier', true);

select throws_ok(
  $$
    select public.advance_order(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '77777777-7777-4777-8777-777777777777'::uuid,
      'ready'::public.order_status,
      'in_progress'::public.order_status,
      gen_random_uuid()
    );
  $$,
  'INVALID_TRANSITION',
  null,
  'Courier cannot advance dine_in orders'
);

-- 9. Test Staff advances in_progress -> ready
select set_config('request.jwt.claim.sub', :'u_staff', true);

select lives_ok(
  $$
    select public.advance_order(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '77777777-7777-4777-8777-777777777777'::uuid,
      'ready'::public.order_status,
      'in_progress'::public.order_status,
      gen_random_uuid()
    );
  $$,
  'Staff marks order ready'
);

-- 10. Test cancel_order with valid reason
\set cancel_order_id '88888888-8888-4888-8888-888888888888'

select public.create_order(
  '55555555-5555-4555-8555-555555555555'::uuid,
  :'cancel_order_id',
  'takeaway'::public.order_type,
  null,
  'phone'::public.order_channel,
  null,
  null,
  jsonb_build_array(jsonb_build_object('name', 'Burger', 'qty', 1, 'price', 100))
);

select lives_ok(
  $$
    select public.cancel_order(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '88888888-8888-4888-8888-888888888888'::uuid,
      'Customer called to cancel',
      gen_random_uuid()
    );
  $$,
  'Staff cancels order with valid reason'
);

select is(
  (select status from public.orders where id = :'cancel_order_id'),
  'cancelled'::public.order_status,
  'Cancelled order status updated to cancelled'
);

select is(
  (select cancel_reason from public.orders where id = :'cancel_order_id'),
  'Customer called to cancel',
  'Cancel reason recorded'
);

select * from finish();
rollback;
