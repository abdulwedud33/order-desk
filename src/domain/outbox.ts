// src/domain/outbox.ts
// Offline outbox pure state machine with jittered backoff and stuck recovery

import { isTransient, type ErrorCode } from './errors';

export type OutboxKind =
  | 'create_order'
  | 'edit_order'
  | 'advance_order'
  | 'record_payment'
  | 'assign_order'
  | 'cancel_order'
  | 'create_customer'
  | 'catalog_item'
  | 'set_settle_later'
  | 'approve_estimate'
  | 'handover_order'
  | 'set_waiting_reason';

export type OutboxStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface OutboxItem {
  id: string; // client UUID (idempotency key)
  shopId: string;
  kind: OutboxKind;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  createdAt: number; // ms timestamp
  nextAttemptAt: number; // ms timestamp
  startedAt?: number; // ms timestamp
  lastErrorCode?: ErrorCode;
}

export const MAX_ATTEMPTS = 8;
export const STUCK_AFTER_MS = 60_000;

export function newOutboxItem(
  input: { id: string; shopId: string; kind: OutboxKind; payload: unknown },
  now: number = Date.now()
): OutboxItem {
  return {
    ...input,
    status: 'pending',
    attempts: 0,
    createdAt: now,
    nextAttemptAt: now,
  };
}

/** Exponential backoff with jitter: ~1s, 2s, 4s ... capped at 60s */
export function backoffMs(attempts: number, rand: () => number = Math.random): number {
  const base = Math.min(60_000, 1000 * Math.pow(2, Math.max(0, attempts - 1)));
  return Math.round(base * (0.5 + rand() * 0.5));
}

/** Picks next pending item whose nextAttemptAt <= now */
export function pickNext(items: readonly OutboxItem[], now: number = Date.now()): OutboxItem | null {
  const ordered = [...items].sort((a, b) => a.createdAt - b.createdAt);
  for (const item of ordered) {
    if (item.status === 'synced' || item.status === 'failed') continue;
    if (item.status === 'syncing') return null; // process one at a time to preserve order
    if (item.nextAttemptAt <= now) return item;
    return null; // earlier item is waiting backoff; do not bypass
  }
  return null;
}

export function markSyncing(item: OutboxItem, now: number = Date.now()): OutboxItem {
  return { ...item, status: 'syncing', startedAt: now };
}

export type OutboxSendResult = { ok: true } | { ok: false; code: ErrorCode };

export function applyResult(
  item: OutboxItem,
  result: OutboxSendResult,
  now: number = Date.now(),
  rand: () => number = Math.random
): OutboxItem {
  const { startedAt: _, ...rest } = item;
  if (result.ok || result.code === 'CONFLICT') {
    // If conflict on idempotent replay or success, mark synced
    return {
      ...rest,
      status: 'synced',
      attempts: item.attempts + 1,
      lastErrorCode: undefined,
    };
  }

  const attempts = item.attempts + 1;
  if (isTransient(result.code) && attempts < MAX_ATTEMPTS) {
    return {
      ...rest,
      status: 'pending',
      attempts,
      nextAttemptAt: now + backoffMs(attempts, rand),
      lastErrorCode: result.code,
    };
  }

  return {
    ...rest,
    status: 'failed',
    attempts,
    lastErrorCode: result.code,
  };
}

/** Recovers items stuck in syncing across page reloads/crashes */
export function recoverStuck(items: readonly OutboxItem[], now: number = Date.now()): OutboxItem[] {
  return items.map((i) => {
    if (i.status !== 'syncing') return i;
    if (i.startedAt !== undefined && now - i.startedAt < STUCK_AFTER_MS) return i;
    const { startedAt: _, ...rest } = i;
    return { ...rest, status: 'pending' as const, nextAttemptAt: now };
  });
}

export interface OutboxSummary {
  pending: number;
  syncing: number;
  failed: number;
  allSynced: boolean;
}

export function summarize(items: readonly OutboxItem[]): OutboxSummary {
  const pending = items.filter((i) => i.status === 'pending').length;
  const syncing = items.filter((i) => i.status === 'syncing').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  return { pending, syncing, failed, allSynced: pending + syncing + failed === 0 };
}

export function purgeable(items: readonly OutboxItem[], now: number = Date.now(), keepMs = 7 * 86_400_000): OutboxItem[] {
  return items.filter((i) => i.status === 'synced' && now - i.createdAt > keepMs);
}
