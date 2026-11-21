-- 006_repair_jobs.test.sql
-- pgTAP test suite for Milestone M6: repair jobs, pickup code verification,
-- owner override, settle-later check, kitchen view RLS, approve_estimate,
-- estimate threshold rule, and idempotent replay.
-- Reference: docs/evals.md section 6.1, docs/05-backend-schema.md.

begin;
select plan(30);

-- 1. Setup test users & shop
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'owner_m6@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'staff_m6@test.com'),
  ('33333333-3333-3333-3333-333333333333', 'kitchen_m6@test.com'),
  ('44444444-4444-4444-4444-444444444444', 'courier_m6@test.com')
on conflict (id) do nothing;

insert into public.shops (id, owner_id, name, business_type)
values ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'FixIt Repair Lab', 'repair')
on conflict (id) do nothing;

insert into public.shop_members (shop_id, user_id, role, display_name)
values
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'owner', 'Owner Alice'),
  ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'staff', 'Tech Bob'),
  ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', 'kitchen', 'Bench Ken'),
  ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', 'courier', 'Rider Dan')
on conflict (shop_id, user_id) do nothing;

-- 2. Schema Structure Verification
select has_table('public', 'repair_jobs', 'Table repair_jobs exists');
select has_view('public', 'repair_jobs_kitchen', 'View repair_jobs_kitchen exists');
select has_index('public', 'repair_jobs', 'repair_jobs_shop_idx', 'Index repair_jobs_shop_idx exists');

-- 3. Create a Repair Order via create_order
set local role authenticated;
set local "request.jwt.claim.sub" to '11111111-1111-1111-1111-111111111111'; -- Owner

select lives_ok(
  $$
    select public.create_order(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '77777777-7777-7777-7777-777777777777'::uuid,
      'repair'::public.order_type,
      'Samsung Repair',
      'walk_in'::public.order_channel,
      'Customer dropped phone',
      now() + interval '2 hours',
      '[{"name": "Screen Glass Replacement", "qty": 1, "price": 1200}]'::jsonb,
      '{"phone": "+251911887766"}'::jsonb,
      0,
      null,
      '{"device": "Samsung Galaxy S22", "problem": "Cracked OLED display", "serial": "SM-S901B-9988", "pickup_code": "4821"}'::jsonb
    );
  $$,
  'create_order creates a repair order with device, problem and pickup code'
);

-- Verify repair_jobs row created and pickup_code_hash matches SHA-256('4821')
select results_eq(
  $$
    select device, problem, serial, (pickup_code_hash = sha256(convert_to('4821', 'UTF8')))
    from public.repair_jobs
    where order_id = '77777777-7777-7777-7777-777777777777'::uuid;
  $$,
  $$
    values ('Samsung Galaxy S22'::text, 'Cracked OLED display'::text, 'SM-S901B-9988'::text, true);
  $$,
  'repair_jobs record has expected device, problem, and correctly hashed pickup code'
);

-- 4. RLS Matrix Verification
-- Owner can read repair_jobs
select isnt_empty(
  $$ select * from public.repair_jobs where order_id = '77777777-7777-7777-7777-777777777777'::uuid $$,
  'Owner can select from repair_jobs'
);

-- Kitchen role cannot read repair_jobs table directly (sensitive info like pickup_code_hash is protected)
set local "request.jwt.claim.sub" to '33333333-3333-3333-3333-333333333333'; -- Kitchen
select is_empty(
  $$ select * from public.repair_jobs where order_id = '77777777-7777-7777-7777-777777777777'::uuid $$,
  'Kitchen role receives 0 rows when attempting direct select on repair_jobs table'
);

-- Kitchen role CAN read repair_jobs_kitchen view
select results_eq(
  $$
    select device, problem
    from public.repair_jobs_kitchen
    where order_id = '77777777-7777-7777-7777-777777777777'::uuid;
  $$,
  $$
    values ('Samsung Galaxy S22'::text, 'Cracked OLED display'::text);
  $$,
  'Kitchen role can query repair_jobs_kitchen view (sees device and problem only)'
);

-- 5. Estimate Approval (approve_estimate)
-- Staff context
set local "request.jwt.claim.sub" to '22222222-2222-2222-2222-222222222222'; -- Staff

select lives_ok(
  $$
    select public.approve_estimate(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '77777777-7777-7777-7777-777777777777'::uuid,
      '88888888-8888-8888-8888-888888888881'::uuid,
      1500.00
    );
  $$,
  'Staff can approve repair estimate'
);

select results_eq(
  $$
    select approved_total, (approved_by = '22222222-2222-2222-2222-222222222222'::uuid)
    from public.repair_jobs
    where order_id = '77777777-7777-7777-7777-777777777777'::uuid;
  $$,
  $$
    values (1500.00::numeric, true);
  $$,
  'approved_total is set to 1500.00 and approved_by is recorded'
);

-- Verify estimate_approved event was inserted
select isnt_empty(
  $$
    select 1 from public.order_events
    where order_id = '77777777-7777-7777-7777-777777777777'::uuid
      and type = 'estimate_approved'
  $$,
  'order_events records estimate_approved audit event'
);

-- Idempotent replay of approve_estimate
select lives_ok(
  $$
    select public.approve_estimate(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '77777777-7777-7777-7777-777777777777'::uuid,
      '88888888-8888-8888-8888-888888888881'::uuid,
      1500.00
    );
  $$,
  'approve_estimate replay with identical client_id is idempotent'
);

-- 6. Estimate Exceeded Rule: "total above approved estimate moves the order to waiting"
-- Advance order to in_progress first
select public.advance_order(
  '55555555-5555-5555-5555-555555555555'::uuid,
  '77777777-7777-7777-7777-777777777777'::uuid,
  'accepted'::public.order_status,
  'new'::public.order_status,
  '88888888-8888-8888-8888-888888888882'::uuid
);
select public.advance_order(
  '55555555-5555-5555-5555-555555555555'::uuid,
  '77777777-7777-7777-7777-777777777777'::uuid,
  'in_progress'::public.order_status,
  'accepted'::public.order_status,
  '88888888-8888-8888-8888-888888888883'::uuid
);

-- Edit order to add extra parts bringing total to 1800 (above approved estimate 1500)
select lives_ok(
  $$
    select public.edit_order(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '77777777-7777-7777-7777-777777777777'::uuid,
      '88888888-8888-8888-8888-888888888884'::uuid,
      3, -- current version
      '[{"name": "Screen Replacement", "qty": 1, "price": 1200}, {"name": "Frame & Battery", "qty": 1, "price": 600}]'::jsonb
    );
  $$,
  'edit_order succeeds with new total 1800.00'
);

-- Verify status automatically moved to 'waiting' and waiting_reason set to 'estimate_exceeded'
select results_eq(
  $$
    select o.status, r.waiting_reason
    from public.orders o
    join public.repair_jobs r on r.order_id = o.id
    where o.id = '77777777-7777-7777-7777-777777777777'::uuid;
  $$,
  $$
    values ('waiting'::public.order_status, 'estimate_exceeded'::text);
  $$,
  'Order status automatically transitions to waiting when total exceeds approved estimate'
);

-- Re-approve estimate with 2000 to cover total
select public.approve_estimate(
  '55555555-5555-5555-5555-555555555555'::uuid,
  '77777777-7777-7777-7777-777777777777'::uuid,
  '88888888-8888-8888-8888-888888888885'::uuid,
  2000.00
);

-- Status clears back to in_progress
select results_eq(
  $$ select status from public.orders where id = '77777777-7777-7777-7777-777777777777'::uuid $$,
  $$ values ('in_progress'::public.order_status) $$,
  'Approving estimate covering total restores order to in_progress'
);

-- Advance order to ready
select public.advance_order(
  '55555555-5555-5555-5555-555555555555'::uuid,
  '77777777-7777-7777-7777-777777777777'::uuid,
  'ready'::public.order_status,
  'in_progress'::public.order_status,
  '88888888-8888-8888-8888-888888888886'::uuid
);

-- 7. Handover Verification: Pickup Code & Settle-Later Checks
-- Attempt handover with INCORRECT pickup code -> throws INVALID_CODE
select throws_ok(
  $$
    select public.handover_order(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '77777777-7777-7777-7777-777777777777'::uuid,
      '9999', -- wrong code
      false,
      '88888888-8888-8888-8888-888888888887'::uuid
    );
  $$,
  'INVALID_CODE',
  'Handover with incorrect pickup code is blocked with INVALID_CODE'
);

-- Attempt handover with CORRECT code but UNPAID balance (1800 due, 0 paid) -> throws VALIDATION
select throws_ok(
  $$
    select public.handover_order(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '77777777-7777-7777-7777-777777777777'::uuid,
      '4821', -- correct code
      false,
      '88888888-8888-8888-8888-888888888888'::uuid
    );
  $$,
  'VALIDATION',
  'Handover of unpaid order without settle_later is blocked with VALIDATION'
);

-- Staff attempts owner override -> throws FORBIDDEN
select throws_ok(
  $$
    select public.handover_order(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '77777777-7777-7777-7777-777777777777'::uuid,
      null,
      true, -- override
      '88888888-8888-8888-8888-888888888889'::uuid
    );
  $$,
  'FORBIDDEN',
  'Staff cannot perform owner override during handover'
);

-- Set settle_later to true
select public.set_settle_later(
  '55555555-5555-5555-5555-555555555555'::uuid,
  '77777777-7777-7777-7777-777777777777'::uuid,
  true
);

-- Now handover with CORRECT pickup code succeeds!
select lives_ok(
  $$
    select public.handover_order(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '77777777-7777-7777-7777-777777777777'::uuid,
      '4821',
      false,
      '88888888-8888-8888-8888-888888888890'::uuid
    );
  $$,
  'Handover with correct pickup code succeeds when settle_later is enabled'
);

-- Order status is now 'completed' and handed_over_at is set
select results_eq(
  $$
    select o.status, (r.handed_over_at is not null), r.handover_override
    from public.orders o
    join public.repair_jobs r on r.order_id = o.id
    where o.id = '77777777-7777-7777-7777-777777777777'::uuid;
  $$,
  $$
    values ('completed'::public.order_status, true, false);
  $$,
  'Order is marked completed with handed_over_at timestamp and handover_override=false'
);

-- Idempotent replay of handover_order
select lives_ok(
  $$
    select public.handover_order(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '77777777-7777-7777-7777-777777777777'::uuid,
      '4821',
      false,
      '88888888-8888-8888-8888-888888888890'::uuid
    );
  $$,
  'handover_order replay is idempotent'
);

-- 8. Owner Override Verification on a second test order
set local "request.jwt.claim.sub" to '11111111-1111-1111-1111-111111111111'; -- Owner

select public.create_order(
  '55555555-5555-5555-5555-555555555555'::uuid,
  '77777777-7777-7777-7777-777777777778'::uuid,
  'repair'::public.order_type,
  'Laptop Repair',
  'walk_in'::public.order_channel,
  'Water damage',
  now() + interval '4 hours',
  '[{"name": "Motherboard Clean", "qty": 1, "price": 500}]'::jsonb,
  '{"phone": "+251922334455"}'::jsonb,
  0,
  null,
  '{"device": "MacBook Air M1", "problem": "Liquid spill", "pickup_code": "1234"}'::jsonb
);

-- Settle payment in full (500)
select public.record_payment(
  '55555555-5555-5555-5555-555555555555'::uuid,
  '77777777-7777-7777-7777-777777777778'::uuid,
  '88888888-8888-8888-8888-888888888891'::uuid,
  'payment'::public.payment_kind,
  500.00,
  'cash'::public.pay_method,
  'Full payment at intake'
);

-- Advance to ready
select public.advance_order(
  '55555555-5555-5555-5555-555555555555'::uuid,
  '77777777-7777-7777-7777-777777777778'::uuid,
  'accepted'::public.order_status,
  'new'::public.order_status,
  '88888888-8888-8888-8888-888888888892'::uuid
);
select public.advance_order(
  '55555555-5555-5555-5555-555555555555'::uuid,
  '77777777-7777-7777-7777-777777777778'::uuid,
  'in_progress'::public.order_status,
  'accepted'::public.order_status,
  '88888888-8888-8888-8888-888888888893'::uuid
);
select public.advance_order(
  '55555555-5555-5555-5555-555555555555'::uuid,
  '77777777-7777-7777-7777-777777777778'::uuid,
  'ready'::public.order_status,
  'in_progress'::public.order_status,
  '88888888-8888-8888-8888-888888888894'::uuid
);

-- Owner performs override handover without code
select lives_ok(
  $$
    select public.handover_order(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '77777777-7777-7777-7777-777777777778'::uuid,
      null, -- no code
      true, -- override = true
      '88888888-8888-8888-8888-888888888895'::uuid
    );
  $$,
  'Owner override handover succeeds without pickup code'
);

-- Verify handover_override recorded as true in database
select results_eq(
  $$
    select status, handover_override
    from public.orders o
    join public.repair_jobs r on r.order_id = o.id
    where o.id = '77777777-7777-7777-7777-777777777778'::uuid;
  $$,
  $$
    values ('completed'::public.order_status, true);
  $$,
  'Order is completed with handover_override=true'
);

-- 9. Turnaround Analytics RPC
select isnt_empty(
  $$
    select public.repair_turnaround('55555555-5555-5555-5555-555555555555'::uuid);
  $$,
  'repair_turnaround returns turnaround analytics JSON'
);

finish();
rollback;
