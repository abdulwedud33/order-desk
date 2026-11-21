import test from 'node:test';
import assert from 'node:assert/strict';

test('Milestone M0 Sanity: Environment & Statuses verification', () => {
  assert.equal(1 + 1, 2);
  const statusValues = [
    'new',
    'accepted',
    'in_progress',
    'waiting',
    'ready',
    'out_for_delivery',
    'completed',
    'cancelled',
  ];
  assert.equal(statusValues.length, 8);
});
