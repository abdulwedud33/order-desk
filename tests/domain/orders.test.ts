// tests/domain/orders.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestPromisedMinutes,
  calculateSuggestedDueAt,
  findDuplicateOrder,
  formatTemporaryReference,
  type ExistingOrderSnapshot,
} from '../../src/domain/orders';

test('formatTemporaryReference creates compact uppercase ref with prefix', () => {
  const ref = formatTemporaryReference('12345678-abcd-ef01-2345-6789abcdef01');
  assert.equal(ref, '~PEND-1234');
});

test('suggestPromisedMinutes calculates based on max prep time', () => {
  assert.equal(suggestPromisedMinutes([]), 15);
  assert.equal(suggestPromisedMinutes([10]), 10);
  assert.equal(suggestPromisedMinutes([10, 25, 15]), 25);
  assert.equal(suggestPromisedMinutes([5]), 10); // clamped minimum 10
});

test('calculateSuggestedDueAt includes duration chips', () => {
  const now = new Date('2026-11-21T10:00:00Z');
  const due = calculateSuggestedDueAt(now, [20], 10); // 20 min + 10 min chip = 30 min
  assert.equal(due.toISOString(), '2026-11-21T10:30:00.000Z');
});

test('findDuplicateOrder identifies orders with same phone and items within 10 minutes', () => {
  const now = new Date('2026-11-21T10:05:00Z');

  const existing: ExistingOrderSnapshot[] = [
    {
      id: 'ord-1',
      phone: '0911223344',
      items: [{ itemId: 'item-1', name: 'Burger' }],
      createdAt: '2026-11-21T10:00:00Z', // 5 minutes ago -> duplicate!
    },
    {
      id: 'ord-2',
      phone: '0922334455',
      items: [{ itemId: 'item-2', name: 'Pizza' }],
      createdAt: '2026-11-21T10:01:00Z',
    },
    {
      id: 'ord-3',
      phone: '0911223344',
      items: [{ itemId: 'item-1', name: 'Burger' }],
      createdAt: '2026-11-21T09:40:00Z', // 25 minutes ago -> not duplicate
    },
  ];

  // Exact match within 5 minutes
  const dup1 = findDuplicateOrder('0911223344', [{ itemId: 'item-1', name: 'Burger' }], existing, now);
  assert.ok(dup1);
  assert.equal(dup1?.id, 'ord-1');

  // Different items -> no duplicate
  const dup2 = findDuplicateOrder('0911223344', [{ itemId: 'item-2', name: 'Pizza' }], existing, now);
  assert.equal(dup2, null);

  // Different phone -> no duplicate
  const dup3 = findDuplicateOrder('0999999999', [{ itemId: 'item-1', name: 'Burger' }], existing, now);
  assert.equal(dup3, null);

  // Same phone & item but 25 minutes later -> no duplicate
  const laterTime = new Date('2026-11-21T10:30:00Z');
  const dup4 = findDuplicateOrder('0911223344', [{ itemId: 'item-1', name: 'Burger' }], existing, laterTime);
  assert.equal(dup4, null);
});
