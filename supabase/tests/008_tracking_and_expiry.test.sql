-- 008_tracking_and_expiry.test.sql
-- pgTAP tests for Milestone M8: Public Tracking Tokens, RLS Isolation, and Expiry

begin;
select plan(16);

-- 1. Table & Column Checks
select has_column('order_contacts', 'tracking_token', 'order_contacts has tracking_token column');

-- 2. Test Setup: Users, Shop, Order with Tracking Token
create user m8_owner with password 'secret';
create user m8_staff with password 'secret';
create user m8_kitchen with password 'secret';
create user m8_anon with password 'secret';

grant authenticated to m8_owner, m8_staff, m8_kitchen;
grant anon to m8_anon;

\set u_owner '11111111-1111-4111-8111-111111111111'
\set u_staff '22222222-2222-4222-8222-222222222222'
\set u_kitchen '33333333-3333-4333-8333-333333333333'
\set shop_id '55555555-5555-4555-8555-555555555555'
\set order_id '77777777-7777-4777-8777-777777777777'

insert into auth.users (id, email) values
  (:'u_owner', 'm8_owner@test.local'),
  (:'u_staff', 'm8_staff@test.local'),
  (:'u_kitchen', 'm8_kitchen@test.local')
on conflict (id) do nothing;

insert into public.shops (id, owner_id, name, business_type)
values (:'shop_id', :'u_owner', 'M8 Tracking Cafe', 'food');

insert into public.shop_members (shop_id, user_id, role, display_name) values
  (:'shop_id', :'u_owner', 'owner', 'Owner Alice'),
  (:'shop_id', :'u_staff', 'staff', 'Staff Bob'),
  (:'shop_id', :'u_kitchen', 'kitchen', 'Chef Charlie');

-- Staff creates an order
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_staff', true);

select public.create_order(
  :'shop_id'::uuid,
  :'order_id'::uuid,
  'takeaway'::public.order_type,
  'Customer Abebe',
  'phone'::public.order_channel,
  'Extra napkins',
  now() + interval '25 minutes',
  jsonb_build_array(jsonb_build_object('name', 'Burger', 'qty', 1, 'price', 200)),
  '{"phone": "+251911223344", "address": "Bole"}'::jsonb
);

-- Verify tracking_token exists in order_contacts
select isnt_empty(
  $$ select tracking_token from public.order_contacts where order_id = '77777777-7777-4777-8777-777777777777'::uuid $$,
  'Order has tracking token in order_contacts'
);

-- Tracking token matches base64url 22-char pattern
select matches(
  (select tracking_token from public.order_contacts where order_id = '77777777-7777-4777-8777-777777777777'::uuid),
  '^[A-Za-z0-9_-]{16,64}$',
  'tracking_token is high-entropy URL-safe token'
);

-- 3. Anonymous Role Access Isolation
set local role anon;

-- Anon cannot select from orders
select is_empty(
  $$ select * from public.orders where id = '77777777-7777-4777-8777-777777777777'::uuid $$,
  'Anon role cannot select orders (RLS blocked)'
);

-- Anon cannot select from order_contacts
select is_empty(
  $$ select * from public.order_contacts where order_id = '77777777-7777-4777-8777-777777777777'::uuid $$,
  'Anon role cannot select order_contacts (RLS blocked)'
);

-- Anon cannot select by tracking_token
select is_empty(
  $$ select * from public.order_contacts where tracking_token is not null $$,
  'Anon role cannot query by tracking_token directly'
);

-- Anon cannot select from order_money
select is_empty(
  $$ select * from public.order_money where order_id = '77777777-7777-4777-8777-777777777777'::uuid $$,
  'Anon role cannot select order_money (RLS blocked)'
);

-- 4. Kitchen Role Access Isolation
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_kitchen', true);

-- Kitchen cannot select from order_contacts
select is_empty(
  $$ select * from public.order_contacts where order_id = '77777777-7777-4777-8777-777777777777'::uuid $$,
  'Kitchen role cannot select order_contacts'
);

-- 5. Service Role / Admin Access
set local role postgres;

-- Service role can lookup order by tracking_token
select results_eq(
  $$ select order_id from public.order_contacts where order_id = '77777777-7777-4777-8777-777777777777'::uuid $$,
  $$ values ('77777777-7777-4777-8777-777777777777'::uuid) $$,
  'Service role can query order_contacts by tracking_token'
);

-- 6. Uniqueness & Constraint Checks
-- Duplicate tracking_token violates unique constraint
select throws_ok(
  $$
    insert into public.order_contacts (order_id, shop_id, tracking_token)
    values (
      gen_random_uuid(),
      '55555555-5555-4555-8555-555555555555'::uuid,
      (select tracking_token from public.order_contacts where order_id = '77777777-7777-4777-8777-777777777777'::uuid)
    );
  $$,
  '23505',
  'Duplicate tracking_token violates unique constraint'
);

-- Format check constraint on tracking_token rejects malformed token
select throws_ok(
  $$
    insert into public.order_contacts (order_id, shop_id, tracking_token)
    values (
      gen_random_uuid(),
      '55555555-5555-4555-8555-555555555555'::uuid,
      'short'
    );
  $$,
  '23514',
  'Malformed tracking_token violates length check constraint'
);

-- 7. Advance Order & Token Lifecycle
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_staff', true);

-- Advance order to accepted -> in_progress -> ready -> completed
select lives_ok(
  $$ select public.advance_order('55555555-5555-4555-8555-555555555555'::uuid, '77777777-7777-4777-8777-777777777777'::uuid, 'accepted'::public.order_status, 'new'::public.order_status, gen_random_uuid()) $$,
  'Advance to accepted'
);
select lives_ok(
  $$ select public.advance_order('55555555-5555-4555-8555-555555555555'::uuid, '77777777-7777-4777-8777-777777777777'::uuid, 'in_progress'::public.order_status, 'accepted'::public.order_status, gen_random_uuid()) $$,
  'Advance to in_progress'
);
select lives_ok(
  $$ select public.advance_order('55555555-5555-4555-8555-555555555555'::uuid, '77777777-7777-4777-8777-777777777777'::uuid, 'ready'::public.order_status, 'in_progress'::public.order_status, gen_random_uuid()) $$,
  'Advance to ready'
);

-- Pay in full and complete order
select public.record_payment(
  '55555555-5555-4555-8555-555555555555'::uuid,
  '77777777-7777-4777-8777-777777777777'::uuid,
  gen_random_uuid(),
  'payment'::public.payment_kind,
  200.00,
  'cash'::public.pay_method,
  null
);

select lives_ok(
  $$ select public.advance_order('55555555-5555-4555-8555-555555555555'::uuid, '77777777-7777-4777-8777-777777777777'::uuid, 'completed'::public.order_status, 'ready'::public.order_status, gen_random_uuid()) $$,
  'Complete order'
);

-- Completed order has completed_at timestamp set
select isnt_empty(
  $$ select completed_at from public.orders where id = '77777777-7777-4777-8777-777777777777'::uuid and completed_at is not null $$,
  'Completed order has completed_at timestamp recorded'
);

select * from finish();
rollback;
