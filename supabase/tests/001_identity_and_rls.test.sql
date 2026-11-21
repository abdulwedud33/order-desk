-- pgTAP test: Milestone M1 Identity, Roles, and RLS Matrix
-- Run with: supabase test db

begin;
select plan(42);

-- Insert test authentication users
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

-- Insert invites
insert into public.shop_invites (id, shop_id, code_hash, role, expires_at, created_by) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', sha256(convert_to('INVITECODE123456', 'UTF8')), 'staff', now() + interval '48 hours', '00000000-0000-0000-0000-0000000000a1'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a1', sha256(convert_to('EXPIREDCODE12345', 'UTF8')), 'kitchen', now() - interval '1 hour', '00000000-0000-0000-0000-0000000000a1');

-- Insert audit log
insert into public.audit_log (shop_id, actor, action) values
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'shop_created');

reset role;

-- 1. Structural checks
select is((select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity), 0, 'Every public table has RLS enabled');
select is((select array_agg(t.tablename::text order by t.tablename) from pg_tables t where t.schemaname = 'public' and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename)), array['rate_limits'], 'Only rate_limits has no policy');

-- 2. Anonymous access tests (all must throw 42501)
do $$ begin perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('request.jwt.claim.sub', '', true); end $$;
set local role anon;
select throws_ok($$select 1 from public.profiles$$, '42501', null, 'anon cannot read profiles');
select throws_ok($$select 1 from public.shops$$, '42501', null, 'anon cannot read shops');
select throws_ok($$select 1 from public.shop_members$$, '42501', null, 'anon cannot read shop_members');
select throws_ok($$select 1 from public.shop_invites$$, '42501', null, 'anon cannot read shop_invites');
select throws_ok($$select 1 from public.audit_log$$, '42501', null, 'anon cannot read audit_log');
select throws_ok($$select 1 from public.rate_limits$$, '42501', null, 'anon cannot read rate_limits');

-- 3. Outsider access tests (sees 0 rows across tables)
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true); perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true); end $$;
set local role authenticated;
select is((select count(*)::int from public.shops), 0, 'outsider sees no shops');
select is((select count(*)::int from public.shop_members), 0, 'outsider sees no members');
select is((select count(*)::int from public.shop_invites), 0, 'outsider sees no invites');
select is((select count(*)::int from public.audit_log), 0, 'outsider sees no audit logs');
select throws_ok($$select 1 from public.rate_limits$$, '42501', null, 'authenticated cannot read rate_limits');
select is((select public.is_member('10000000-0000-0000-0000-0000000000a1')), false, 'outsider is_member is false');
select is((select public.is_owner('10000000-0000-0000-0000-0000000000a1')), false, 'outsider is_owner is false');

-- 4. Cross-shop isolation (Owner B sees only Shop B)
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true); perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true); end $$;
set local role authenticated;
select is((select count(*)::int from public.shops), 1, 'Owner B sees exactly 1 shop');
select is((select name from public.shops), 'Shop B', 'Owner B sees Shop B');
select is((select count(*)::int from public.shop_members where shop_id = '10000000-0000-0000-0000-0000000000a1'), 0, 'Owner B sees no members of Shop A');

-- 5. Role permissions inside Shop A
-- 5a. Staff inside Shop A: can read shop & members, cannot read invites or audit_log, cannot update shop
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true); perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true); end $$;
set local role authenticated;
select is((select count(*)::int from public.shops), 1, 'Staff A can read Shop A');
select is((select public.my_role('10000000-0000-0000-0000-0000000000a1')), 'staff'::public.member_role, 'my_role returns staff for Staff A');
select is((select count(*)::int from public.shop_invites), 0, 'Staff A cannot read shop_invites');
select is((select count(*)::int from public.audit_log), 0, 'Staff A cannot read audit_log');
select throws_ok($$update public.shops set name = 'Hacked' where id = '10000000-0000-0000-0000-0000000000a1'$$, null, null, 'Staff cannot update shop');

-- 5b. Owner inside Shop A: can read invites and audit_log, can update shop
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true); perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true); end $$;
set local role authenticated;
select is((select count(*)::int from public.shop_invites), 2, 'Owner A sees Shop A invites');
select is((select count(*)::int from public.audit_log), 1, 'Owner A sees Shop A audit logs');
select lives_ok($$update public.shops set default_delivery_fee = 50.00 where id = '10000000-0000-0000-0000-0000000000a1'$$, 'Owner A can update shop settings');

-- 6. RPC tests
-- 6a. create_invite: staff cannot create invite
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true); perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true); end $$;
set local role authenticated;
select throws_ok($$select public.create_invite('10000000-0000-0000-0000-0000000000a1', 'staff')$$, 'FORBIDDEN', null, 'Staff cannot create invite');

-- 6b. create_invite: owner cannot invite an owner
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true); perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true); end $$;
set local role authenticated;
select throws_ok($$select public.create_invite('10000000-0000-0000-0000-0000000000a1', 'owner')$$, 'VALIDATION', null, 'Owner cannot create owner invite');

-- 6c. create_invite: owner creates courier invite
select matches(public.create_invite('10000000-0000-0000-0000-0000000000a1', 'courier'), '^[0-9A-F]{16}$', 'create_invite returns 16-hex code');

-- 6d. accept_invite: outsider accepts valid code
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true); perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true); end $$;
set local role authenticated;
select is(public.accept_invite('INVITECODE123456'), '10000000-0000-0000-0000-0000000000a1'::uuid, 'accept_invite returns shop_id');
select is((select role from public.shop_members where shop_id = '10000000-0000-0000-0000-0000000000a1' and user_id = '00000000-0000-0000-0000-0000000000c1'), 'staff'::public.member_role, 'outsider joined as staff');

-- 6e. accept_invite: cannot reuse code (single-use)
select throws_ok($$select public.accept_invite('INVITECODE123456')$$, 'NOT_FOUND', null, 'Used code is rejected as NOT_FOUND');

-- 6f. accept_invite: cannot use expired code
select throws_ok($$select public.accept_invite('EXPIREDCODE12345')$$, 'NOT_FOUND', null, 'Expired code is rejected as NOT_FOUND');

-- 7. create_shop RPC
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true); perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true); end $$;
set local role authenticated;
select throws_ok($$select public.create_shop('','food','en')$$, 'VALIDATION', null, 'Empty shop name is rejected');
select throws_ok($$select public.create_shop('Valid Name','food','fr')$$, 'VALIDATION', null, 'Invalid locale is rejected');

-- 8. delete_shop RPC
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true); perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true); end $$;
set local role authenticated;
select lives_ok($$select public.delete_shop('10000000-0000-0000-0000-0000000000b1')$$, 'Owner B can delete Shop B');
select is((select count(*)::int from public.shops where id = '10000000-0000-0000-0000-0000000000b1'), 0, 'Shop B was removed');
select is((select count(*)::int from public.shop_members where shop_id = '10000000-0000-0000-0000-0000000000b1'), 0, 'Shop B members were cascade removed');

-- 9. Rate limiting verification
reset role;
select lives_ok($$select public.rate_limit_hit('test:key', 2, 60)$$, '1st hit passes');
select lives_ok($$select public.rate_limit_hit('test:key', 2, 60)$$, '2nd hit passes');
select throws_ok($$select public.rate_limit_hit('test:key', 2, 60)$$, 'RATE_LIMITED', null, '3rd hit raises RATE_LIMITED');

finish();
rollback;
