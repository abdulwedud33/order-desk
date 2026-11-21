// tests/domain/status.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, getAllowedNextStatuses, ORDER_TRANSITIONS } from '../../src/domain/status';

import { readFileSync } from 'node:fs';
import path from 'node:path';

test('status transitions table equals SQL seed in migration 0004 exactly', () => {
  const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/0004_orders_core.sql');
  const sql = readFileSync(sqlPath, 'utf8');

  // Match: ('dine_in', 'new', 'accepted', array['owner', 'staff', 'kitchen']...
  const regex = /\('([a-z_]+)',\s*'([a-z_]+)',\s*'([a-z_]+)',\s*array\[([^\]]+)\]/g;
  let match;
  let sqlTransitionCount = 0;

  while ((match = regex.exec(sql)) !== null) {
    const [, orderType, fromStatus, toStatus, rolesStr] = match;
    sqlTransitionCount++;

    const rule = ORDER_TRANSITIONS.find(
      (r) => r.orderType === orderType && r.fromStatus === fromStatus && r.toStatus === toStatus
    );
    assert.ok(rule, `Transition ${orderType} ${fromStatus} -> ${toStatus} missing in domain status machine`);

    const expectedRoles = rolesStr?.replace(/['\s]/g, '').split(',') || [];
    assert.equal(rule.roles.length, expectedRoles.length);
    for (const role of expectedRoles) {
      assert.ok(rule.roles.includes(role as any), `Role ${role} missing for transition ${orderType} ${fromStatus} -> ${toStatus}`);
    }
  }

  assert.equal(sqlTransitionCount, 47, 'SQL seed must contain exactly 47 transitions');
  assert.equal(ORDER_TRANSITIONS.length, sqlTransitionCount, 'Domain must contain exact same count as SQL seed');
});

test('transitions for dine_in enforce role permissions', () => {
  // Kitchen can accept new orders and mark in_progress
  assert.equal(canTransition('dine_in', 'new', 'accepted', 'kitchen'), true);
  assert.equal(canTransition('dine_in', 'accepted', 'in_progress', 'kitchen'), true);
  assert.equal(canTransition('dine_in', 'in_progress', 'ready', 'kitchen'), true);

  // Kitchen CANNOT cancel orders
  assert.equal(canTransition('dine_in', 'new', 'cancelled', 'kitchen'), false);
  assert.equal(canTransition('dine_in', 'accepted', 'cancelled', 'kitchen'), false);

  // Staff and Owner CAN cancel
  assert.equal(canTransition('dine_in', 'new', 'cancelled', 'staff'), true);
  assert.equal(canTransition('dine_in', 'new', 'cancelled', 'owner'), true);
});

test('courier transitions are restricted to delivery out_for_delivery and completed', () => {
  // Courier cannot accept orders
  assert.equal(canTransition('delivery', 'new', 'accepted', 'courier'), false);

  // Courier CAN advance ready -> out_for_delivery and out_for_delivery -> completed
  assert.equal(canTransition('delivery', 'ready', 'out_for_delivery', 'courier'), true);
  assert.equal(canTransition('delivery', 'out_for_delivery', 'completed', 'courier'), true);

  // Courier CANNOT do this for dine_in
  assert.equal(canTransition('dine_in', 'ready', 'completed', 'courier'), false);
});

test('getAllowedNextStatuses returns valid forward options', () => {
  const nextForKitchen = getAllowedNextStatuses('dine_in', 'new', 'kitchen');
  assert.deepEqual(nextForKitchen, ['accepted']);

  const nextForStaff = getAllowedNextStatuses('dine_in', 'new', 'staff');
  assert.deepEqual(nextForStaff, ['accepted', 'cancelled']);
});
