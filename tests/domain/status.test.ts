// tests/domain/status.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, getAllowedNextStatuses, ORDER_TRANSITIONS } from '../../src/domain/status';

test('status transitions table contains all 47 expected rules', () => {
  assert.equal(ORDER_TRANSITIONS.length, 47);
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
