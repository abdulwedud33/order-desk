-- pgTAP test: Milestone M2 Catalog and Customers RLS Matrix
-- Run with: supabase test db

begin;
select plan(38);

-- Insert test users
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'owner-a@test.dev'),
  ('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'staff-a@test.dev'),
  ('00000000-0000-0000-0000-0000000000a3', 'authenticated', 'authenticated', 'kitchen-a@test.dev'),
  ('00000000-0000-0000-0000-0000000000a4', 'authenticated', 'authenticated', 'courier-a@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'owner-b@test.dev'),
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'outsider@test.dev');

-- Insert shops
insert into public.shops (id, owner_id, name, business_type) values
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'Shop A', 'food'),
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'Shop B', 'repair');

-- Insert memberships
insert into public.shop_members (shop_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'staff'),
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3', 'kitchen'),
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a4', 'courier'),
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'owner');

-- Insert categories and items for Shop A
insert into public.catalog_categories (id, shop_id, name, sort) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'Mains', 1);

insert into public.catalog_items (id, shop_id, category_id, name, price, available) values
  ('30000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1', 'Shiro', 150.00, true),
  ('30000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1', 'Tibs (86ed)', 320.00, false);

-- Insert customer for Shop A
insert into public.customers (id, shop_id, name, phone, note) values
  ('40000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'Abebe Regular', '0911223344', 'Spicy lover');

reset role;

-- 1. Structural RLS checks
select is((select count(*)::int from pg_tables where schemaname = 'public' and tablename in ('catalog_categories', 'catalog_items', 'customers') and not rowsecurity), 0, 'Catalog and customer tables have RLS enabled');

-- 2. Anonymous access
do $$ begin perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('request.jwt.claim.sub', '', true); end $$;
set local role anon;
select throws_ok($$select 1 from public.catalog_categories$$, '42501', null, 'anon cannot read catalog_categories');
select throws_ok($$select 1 from public.catalog_items$$, '42501', null, 'anon cannot read catalog_items');
select throws_ok($$select 1 from public.customers$$, '42501', null, 'anon cannot read customers');

-- 3. Outsider access
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true); perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true); end $$;
set local role authenticated;
select is((select count(*)::int from public.catalog_categories), 0, 'outsider sees 0 categories');
select is((select count(*)::int from public.catalog_items), 0, 'outsider sees 0 items');
select is((select count(*)::int from public.customers), 0, 'outsider sees 0 customers');
select throws_ok($$insert into public.catalog_items (shop_id, name, price) values ('10000000-0000-0000-0000-0000000000a1', 'Hack', 10)$$, '42501', null, 'outsider cannot insert items');
select throws_ok($$insert into public.customers (shop_id, name, phone) values ('10000000-0000-0000-0000-0000000000a1', 'Hack', '0900000000')$$, '42501', null, 'outsider cannot insert customers');

-- 4. Kitchen Role Permissions
-- Kitchen can see available items, CANNOT see unavailable (86'd) items, and CANNOT see customers!
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true); perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true); end $$;
set local role authenticated;
select is((select count(*)::int from public.catalog_items), 1, 'kitchen sees only available items');
select is((select name from public.catalog_items), 'Shiro', 'kitchen sees Shiro (available)');
select is((select count(*)::int from public.customers), 0, 'kitchen role NEVER sees customers or phones');
select throws_ok($$insert into public.catalog_items (shop_id, name, price) values ('10000000-0000-0000-0000-0000000000a1', 'Burger', 100)$$, '42501', null, 'kitchen cannot insert items');

-- 5. Courier Role Permissions
-- Courier can see catalog, CANNOT see customers table directly
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true); perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true); end $$;
set local role authenticated;
select is((select count(*)::int from public.catalog_items), 2, 'courier can read catalog items');
select is((select count(*)::int from public.customers), 0, 'courier cannot read customers table');

-- 6. Staff Role Permissions
-- Staff can read all items, read & write customers, CANNOT write catalog (owner only)
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true); perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true); end $$;
set local role authenticated;
select is((select count(*)::int from public.catalog_items), 2, 'staff sees all items (including unavailable)');
select throws_ok($$insert into public.catalog_items (shop_id, name, price) values ('10000000-0000-0000-0000-0000000000a1', 'Tea', 20)$$, '42501', null, 'staff cannot insert items (owner only)');
select is((select count(*)::int from public.customers), 1, 'staff can read customers');
select lives_ok($$insert into public.customers (shop_id, name, phone) values ('10000000-0000-0000-0000-0000000000a1', 'Staff Added', '0922334455')$$, 'staff can insert customers');

-- 7. Owner Role Permissions
-- Owner can do full CRUD on catalog and customers
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true); perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true); end $$;
set local role authenticated;
select lives_ok($$insert into public.catalog_items (shop_id, name, price) values ('10000000-0000-0000-0000-0000000000a1', 'Owner Added', 250)$$, 'owner can insert items');
select lives_ok($$update public.catalog_items set available = false where name = 'Owner Added'$$, 'owner can toggle availability');
select is((select available from public.catalog_items where name = 'Owner Added'), false, 'availability toggled to false');
select lives_ok($$insert into public.customers (shop_id, name, phone) values ('10000000-0000-0000-0000-0000000000a1', 'Owner Customer', '0933445566')$$, 'owner can insert customers');

-- Unique phone per shop constraint
select throws_ok($$insert into public.customers (shop_id, name, phone) values ('10000000-0000-0000-0000-0000000000a1', 'Duplicate Phone', '0911223344')$$, '23505', null, 'Duplicate customer phone in same shop is rejected');

select * from finish();
rollback;
