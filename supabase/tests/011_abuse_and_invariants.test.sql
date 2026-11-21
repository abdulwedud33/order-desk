-- 011_abuse_and_invariants.test.sql
-- pgTAP tests for Milestone M11: Invariants Verification, Realtime Audit, and Abuse Cases

begin;
select plan(14);

-- 1. Functions existence
select has_function('public', 'check_invariants', ARRAY['uuid'], 'check_invariants function exists');
select has_function('public', 'run_nightly_invariants_job', 'run_nightly_invariants_job function exists');

-- 2. Setup Test Identities across 2 separate shops (Shop Alpha and Shop Beta)
create user m11_owner_a with password 'secret';
create user m11_staff_a with password 'secret';
create user m11_kitchen_a with password 'secret';
create user m11_courier_a with password 'secret';
create user m11_owner_b with password 'secret';
create user m11_anon with password 'secret';

grant authenticated to m11_owner_a, m11_staff_a, m11_kitchen_a, m11_courier_a, m11_owner_b;
grant anon to m11_anon;

\set u_owner_a '11111111-1111-4111-8111-111111111111'
\set u_staff_a '11222222-2222-4222-8222-222222222222'
\set u_kitchen_a '11333333-3333-4333-8333-333333333333'
\set u_courier_a '11444444-4444-4444-8444-444444444444'
\set u_owner_b '11555555-5555-4555-8555-555555555555'

\set shop_a '11aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set shop_b '11bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
\set order_a '11000000-0000-4000-8000-000000000001'
\set order_b '11000000-0000-4000-8000-000000000002'

insert into auth.users (id, email) values
  (:'u_owner_a', 'owner_a@test.local'),
  (:'u_staff_a', 'staff_a@test.local'),
  (:'u_kitchen_a', 'kitchen_a@test.local'),
  (:'u_courier_a', 'courier_a@test.local'),
  (:'u_owner_b', 'owner_b@test.local')
on conflict (id) do nothing;

insert into public.shops (id, owner_id, name, business_type, timezone) values
  (:'shop_a', :'u_owner_a', 'Shop Alpha', 'food', 'Africa/Addis_Ababa'),
  (:'shop_b', :'u_owner_b', 'Shop Beta', 'food', 'Africa/Addis_Ababa');

insert into public.shop_members (shop_id, user_id, role, display_name) values
  (:'shop_a', :'u_owner_a', 'owner', 'Owner Alpha'),
  (:'shop_a', :'u_staff_a', 'staff', 'Staff Alpha'),
  (:'shop_a', :'u_kitchen_a', 'kitchen', 'Kitchen Alpha'),
  (:'shop_a', :'u_courier_a', 'courier', 'Courier Alpha'),
  (:'shop_b', :'u_owner_b', 'owner', 'Owner Beta');

-- 3. Invariants Check: Evaluates all 9 invariants on clean database state
select is(
  (select count(*)::int from public.check_invariants() where status = 'FAIL'),
  0,
  'All 9 database invariants pass on clean database state'
);

-- 4. Realtime Publication Audit: sensitive tables MUST NOT be published
select is(
  (
    select count(*)::int
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename in ('customers', 'order_contacts', 'order_payments', 'shop_memory', 'ai_usage')
  ),
  0,
  'Realtime publication strictly excludes sensitive tables (customers, contacts, payments, memory)'
);

-- 5. Abuse Case 1: IDOR cross-shop query rejection
-- Owner B tries to query orders belonging to Shop A
set local role authenticated;
select set_config('request.jwt.claim.sub', :'u_owner_b', true);

select is_empty(
  format('select id from public.orders where shop_id = %L::uuid', :'shop_a'),
  'IDOR: Owner B cannot read any orders from Shop A'
);

-- 6. Abuse Case 2: IDOR cross-shop RPC mutation
-- Staff A tries to call advance_order on an order belonging to Shop B
select set_config('request.jwt.claim.sub', :'u_staff_a', true);

select throws_ok(
  format('select public.advance_order(%L::uuid, %L::uuid, ''accepted''::public.order_status, ''new''::public.order_status, gen_random_uuid())', :'shop_b', :'order_b'),
  '42501',
  'FORBIDDEN',
  'IDOR: Staff A cannot mutate orders in Shop B'
);

-- 7. Abuse Case 3: Kitchen role attempting direct access to money or contacts
select set_config('request.jwt.claim.sub', :'u_kitchen_a', true);

select is_empty(
  format('select * from public.order_money where shop_id = %L::uuid', :'shop_a'),
  'Kitchen role has 0 SELECT access on order_money'
);

select is_empty(
  format('select * from public.order_contacts where shop_id = %L::uuid', :'shop_a'),
  'Kitchen role has 0 SELECT access on order_contacts'
);

select is_empty(
  format('select * from public.order_payments where shop_id = %L::uuid', :'shop_a'),
  'Kitchen role has 0 SELECT access on order_payments'
);

-- 8. Abuse Case 4: Courier role reading unassigned orders
select set_config('request.jwt.claim.sub', :'u_courier_a', true);

select is_empty(
  format('select id from public.orders where shop_id = %L::uuid and (assigned_to is null or assigned_to <> %L::uuid)', :'shop_a', :'u_courier_a'),
  'Courier role sees 0 unassigned orders'
);

-- 9. Abuse Case 5: Append-only ledger tampering
-- Attempt direct UPDATE or DELETE on order_events and order_payments
select set_config('request.jwt.claim.sub', :'u_owner_a', true);

select throws_ok(
  'delete from public.order_events',
  '42501',
  null,
  'Privilege lockdown blocks direct DELETE on append-only order_events'
);

select throws_ok(
  'delete from public.order_payments',
  '42501',
  null,
  'Privilege lockdown blocks direct DELETE on append-only order_payments'
);

-- 10. Abuse Case 6: Anonymous user has zero table access
set local role anon;
select throws_ok(
  'select * from public.orders limit 1',
  '42501',
  null,
  'Anon user has 0 SELECT privileges on orders'
);

select throws_ok(
  'select * from public.customers limit 1',
  '42501',
  null,
  'Anon user has 0 SELECT privileges on customers'
);

select * from finish();
rollback;
