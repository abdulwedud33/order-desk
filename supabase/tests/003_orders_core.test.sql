-- 003_orders_core.test.sql
-- pgTAP tests for Milestone M3: Orders Core, Numbers, Transitions, and RLS Matrix

begin;
select plan(33);

-- 1. Helper extension check
select has_table('orders', 'orders table exists');
select has_table('order_items', 'order_items table exists');
select has_table('order_item_prices', 'order_item_prices table exists');
select has_table('order_money', 'order_money table exists');
select has_table('order_contacts', 'order_contacts table exists');
select has_table('order_counters', 'order_counters table exists');
select has_table('order_events', 'order_events table exists');
select has_table('order_transitions', 'order_transitions table exists');

-- 2. Check RLS is enabled on all tables
select row_eq(
  $$ select relrowsecurity from pg_class where relname = 'orders' $$,
  row(true),
  'RLS is enabled on orders'
);

select row_eq(
  $$ select relrowsecurity from pg_class where relname = 'order_money' $$,
  row(true),
  'RLS is enabled on order_money'
);

select row_eq(
  $$ select relrowsecurity from pg_class where relname = 'order_contacts' $$,
  row(true),
  'RLS is enabled on order_contacts'
);

select row_eq(
  $$ select relrowsecurity from pg_class where relname = 'order_item_prices' $$,
  row(true),
  'RLS is enabled on order_item_prices'
);

-- 3. Check transitions seed count
select is(
  (select count(*)::int from public.order_transitions),
  47,
  'order_transitions seeded with exact transition matrix'
);

-- 4. Test setup: Users, Shop, Members, Catalog
create user m3_owner with password 'secret';
create user m3_staff with password 'secret';
create user m3_kitchen with password 'secret';
create user m3_outsider with password 'secret';

grant authenticated to m3_owner, m3_staff, m3_kitchen, m3_outsider;

\set u_owner '11111111-1111-4111-8111-111111111111'
\set u_staff '22222222-2222-4222-8222-222222222222'
\set u_kitchen '33333333-3333-4333-8333-333333333333'
\set u_outsider '44444444-4444-4444-8444-444444444444'

\set shop_id '55555555-5555-4555-8555-555555555555'
\set item_id '66666666-6666-4666-8666-666666666666'
\set order_id '77777777-7777-4777-8777-777777777777'

insert into auth.users (id, email) values
  (:'u_owner', 'm3_owner@test.local'),
  (:'u_staff', 'm3_staff@test.local'),
  (:'u_kitchen', 'm3_kitchen@test.local'),
  (:'u_outsider', 'm3_outsider@test.local')
on conflict (id) do nothing;

insert into public.shops (id, owner_id, name, business_type)
values (:'shop_id', :'u_owner', 'M3 Test Cafe', 'food');

insert into public.shop_members (shop_id, user_id, role, display_name) values
  (:'shop_id', :'u_owner', 'owner', 'Owner Alice'),
  (:'shop_id', :'u_staff', 'staff', 'Staff Bob'),
  (:'shop_id', :'u_kitchen', 'kitchen', 'Chef Charlie');

insert into public.catalog_items (id, shop_id, name, price, available)
values (:'item_id', :'shop_id', 'Special Tibs', 250.00, true);

-- 5. Test next_order_no atomic increment & formatting
select row_eq(
  $$ select * from public.next_order_no('55555555-5555-4555-8555-555555555555'::uuid, '2026-11-21'::date) $$,
  row(1, 'M-001'::text),
  'next_order_no initializes at 1 with day-letter code'
);

select row_eq(
  $$ select * from public.next_order_no('55555555-5555-4555-8555-555555555555'::uuid, '2026-11-21'::date) $$,
  row(2, 'M-002'::text),
  'next_order_no increments atomically to 2'
);

-- 6. Test create_order as Staff: server enforces catalog price (ignores client discount/tampering)
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_staff', true);

select lives_ok(
  $$
    select public.create_order(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '77777777-7777-4777-8777-777777777777'::uuid,
      'dine_in'::public.order_type,
      'Table 4',
      'walk_in'::public.order_channel,
      'Extra spicy',
      now() + interval '30 minutes',
      jsonb_build_array(
        jsonb_build_object(
          'item_id', '66666666-6666-4666-8666-666666666666',
          'name', 'Special Tibs',
          'qty', 2,
          'price', 10.00 -- Staff attempts to override price to 10.00 (catalog is 250.00)
        )
      ),
      jsonb_build_object('phone', '0911223344'),
      0,
      null,
      null
    );
  $$,
  'Staff successfully creates order via RPC'
);

-- Check that server price from catalog (250 * 2 = 500) was enforced, ignoring client price (10)
select is(
  (select subtotal from public.order_money where order_id = :'order_id'),
  500.00::numeric,
  'Server strictly ignores client price for non-owner and computes total from catalog'
);

-- 7. Test Idempotent replay: calling create_order with identical UUID returns order without duplicate
select lives_ok(
  $$
    select public.create_order(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '77777777-7777-4777-8777-777777777777'::uuid,
      'dine_in'::public.order_type,
      'Table 4',
      'walk_in'::public.order_channel,
      'Extra spicy',
      now() + interval '30 minutes',
      jsonb_build_array(
        jsonb_build_object('item_id', '66666666-6666-4666-8666-666666666666', 'name', 'Special Tibs', 'qty', 2)
      )
    );
  $$,
  'create_order replay with same ID succeeds idempotently'
);

select is(
  (select count(*)::int from public.orders where id = :'order_id'),
  1,
  'Replay creates exactly one order in database'
);

-- 8. Test RLS Isolation: Kitchen role cannot read sensitive tables
select set_config('request.jwt.claim.sub', :'u_kitchen', true);

select is(
  (select count(*)::int from public.orders where id = :'order_id'),
  1,
  'Kitchen CAN view orders'
);

select is(
  (select count(*)::int from public.order_items where order_id = :'order_id'),
  1,
  'Kitchen CAN view order_items'
);

select is(
  (select count(*)::int from public.order_item_prices where order_id = :'order_id'),
  0,
  'Kitchen CANNOT view order_item_prices (0 rows returned)'
);

select is(
  (select count(*)::int from public.order_money where order_id = :'order_id'),
  0,
  'Kitchen CANNOT view order_money (0 rows returned)'
);

select is(
  (select count(*)::int from public.order_contacts where order_id = :'order_id'),
  0,
  'Kitchen CANNOT view order_contacts (0 rows returned)'
);

-- Kitchen cannot call create_order RPC
select throws_ok(
  $$
    select public.create_order(
      '55555555-5555-4555-8555-555555555555'::uuid,
      gen_random_uuid(),
      'dine_in'::public.order_type,
      'Table 1',
      'walk_in'::public.order_channel,
      null,
      null,
      jsonb_build_array(jsonb_build_object('name', 'Water', 'qty', 1))
    );
  $$,
  '42501',
  'FORBIDDEN',
  'Kitchen role is forbidden from calling create_order'
);

-- 9. Test Outsider has zero access
select set_config('request.jwt.claim.sub', :'u_outsider', true);

select is(
  (select count(*)::int from public.orders where shop_id = :'shop_id'),
  0,
  'Outsider sees 0 orders'
);

select is(
  (select count(*)::int from public.order_items where shop_id = :'shop_id'),
  0,
  'Outsider sees 0 order_items'
);

select is(
  (select count(*)::int from public.order_money where shop_id = :'shop_id'),
  0,
  'Outsider sees 0 order_money'
);

-- 10. Test edit_order RPC as Staff
select set_config('request.jwt.claim.sub', :'u_staff', true);

-- edit with wrong version raises CONFLICT
select throws_ok(
  $$
    select public.edit_order(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '77777777-7777-4777-8777-777777777777'::uuid,
      gen_random_uuid(),
      99, -- Wrong version (current version is 1)
      jsonb_build_array(jsonb_build_object('name', 'Custom Soup', 'qty', 1, 'price', 120))
    );
  $$,
  'CONFLICT',
  'edit_order with mismatched version raises CONFLICT'
);

-- edit with matching version succeeds and bumps version
\set edit_client_id '88888888-8888-4888-8888-888888888888'

select lives_ok(
  $$
    select public.edit_order(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '77777777-7777-4777-8777-777777777777'::uuid,
      '88888888-8888-4888-8888-888888888888'::uuid,
      1,
      jsonb_build_array(
        jsonb_build_object('item_id', '66666666-6666-4666-8666-666666666666', 'name', 'Special Tibs', 'qty', 3)
      ),
      'Updated to 3 portions'
    );
  $$,
  'edit_order succeeds with valid version'
);

select is(
  (select version from public.orders where id = :'order_id'),
  2,
  'Order version incremented to 2 after edit'
);

select is(
  (select subtotal from public.order_money where order_id = :'order_id'),
  750.00::numeric,
  'Subtotal updated to 750 (250 * 3)'
);

-- 11. Direct writes to orders table are blocked
select throws_ok(
  $$
    insert into public.orders (
      id, shop_id, order_date, order_no, order_code, type, status, created_by
    ) values (
      gen_random_uuid(),
      '55555555-5555-4555-8555-555555555555'::uuid,
      '2026-11-21'::date,
      99,
      'X-099',
      'takeaway'::public.order_type,
      'new'::public.order_status,
      '22222222-2222-4222-8222-222222222222'::uuid
    );
  $$,
  '42501',
  null,
  'Direct insert into orders is blocked by privileges'
);

select * from finish();
rollback;
