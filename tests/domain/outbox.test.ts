// tests/domain/outbox.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newOutboxItem,
  pickNext,
  markSyncing,
  applyResult,
  recoverStuck,
  backoffMs,
  type OutboxItem,
} from '../../src/domain/outbox';

test('pickNext selects oldest pending item whose time has arrived', () => {
  const now = 1000;
  const item1 = newOutboxItem({ id: '1', shopId: 's1', kind: 'create_order', payload: {} }, 500);
  const item2 = newOutboxItem({ id: '2', shopId: 's1', kind: 'create_order', payload: {} }, 600);

  const next = pickNext([item2, item1], now);
  assert.equal(next?.id, '1');
});

test('pickNext halts when a syncing item exists', () => {
  const item1: OutboxItem = {
    ...newOutboxItem({ id: '1', shopId: 's1', kind: 'create_order', payload: {} }, 500),
    status: 'syncing',
  };
  const item2 = newOutboxItem({ id: '2', shopId: 's1', kind: 'create_order', payload: {} }, 600);

  const next = pickNext([item1, item2], 1000);
  assert.equal(next, null);
});

test('applyResult sets status to synced on success or conflict', () => {
  const item = newOutboxItem({ id: '1', shopId: 's1', kind: 'create_order', payload: {} }, 500);

  const success = applyResult(item, { ok: true }, 600);
  assert.equal(success.status, 'synced');

  const conflict = applyResult(item, { ok: false, code: 'CONFLICT' }, 600);
  assert.equal(conflict.status, 'synced'); // idempotent recovery
});

test('applyResult applies backoff on transient errors', () => {
  const item = newOutboxItem({ id: '1', shopId: 's1', kind: 'create_order', payload: {} }, 500);
  const fixedRand = () => 0.5;

  const retry = applyResult(item, { ok: false, code: 'OFFLINE' }, 600, fixedRand);
  assert.equal(retry.status, 'pending');
  assert.equal(retry.attempts, 1);
  assert.ok(retry.nextAttemptAt > 600);
});

test('recoverStuck resets syncing items older than STUCK_AFTER_MS to pending', () => {
  const now = 100_000;
  const stuckItem: OutboxItem = {
    ...newOutboxItem({ id: '1', shopId: 's1', kind: 'create_order', payload: {} }, 10_000),
    status: 'syncing',
    startedAt: 10_000, // 90s ago (> 60s)
  };

  const freshItem: OutboxItem = {
    ...newOutboxItem({ id: '2', shopId: 's1', kind: 'create_order', payload: {} }, 80_000),
    status: 'syncing',
    startedAt: 95_000, // 5s ago
  };

  const recovered = recoverStuck([stuckItem, freshItem], now);
  assert.equal(recovered[0]?.status, 'pending');
  assert.equal(recovered[1]?.status, 'syncing');
});
