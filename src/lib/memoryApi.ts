// src/lib/memoryApi.ts
// Shop memory CRUD with safety checks, RLS, and Dexie local cache

import { supabase } from './supabase';
import { db } from './db';
import { isMemorySafe } from '../domain/aiGuardrails';

export interface ShopMemoryRow {
  id: string;
  shop_id: string;
  kind: 'alias' | 'preference' | 'fact';
  key: string;
  value: string;
  ref_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaveMemoryInput {
  kind: 'alias' | 'preference' | 'fact';
  key: string;
  value: string;
  ref_id?: string | null;
}

async function getLocalMemory(shopId: string): Promise<ShopMemoryRow[]> {
  if (!db) return [];
  try {
    const row = await db.meta.get(`memory_${shopId}`);
    return Array.isArray(row?.value) ? (row.value as ShopMemoryRow[]) : [];
  } catch {
    return [];
  }
}

async function setLocalMemory(shopId: string, items: ShopMemoryRow[]): Promise<void> {
  if (!db) return;
  try {
    await db.meta.put({ key: `memory_${shopId}`, value: items });
  } catch {}
}

/**
 * Fetch all memory items for the current shop (owner only).
 */
export async function fetchShopMemory(shopId: string): Promise<ShopMemoryRow[]> {
  const localItems = await getLocalMemory(shopId);

  try {
    const fetchPromise = supabase
      .from('shop_memory')
      .select('id, shop_id, kind, key, value, ref_id, created_at, updated_at')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), 800)
    );

    const { data, error } = (await Promise.race([fetchPromise, timeoutPromise])) as {
      data: ShopMemoryRow[] | null;
      error: unknown;
    };

    if (!error && Array.isArray(data)) {
      await setLocalMemory(shopId, data as ShopMemoryRow[]);
      return data as ShopMemoryRow[];
    }
  } catch {
    // Fall back to local items
  }

  return localItems;
}

/**
 * Save or update a memory item.
 * Validates key and value safety client-side before calling the database.
 */
export async function saveShopMemory(shopId: string, item: SaveMemoryInput): Promise<ShopMemoryRow> {
  const validation = isMemorySafe(item.key, item.value);
  if (!validation.safe) {
    throw new Error(`UNSAFE_MEMORY: ${validation.reason}`);
  }

  const normalizedKey = item.key.trim().toLowerCase();
  const normalizedVal = item.value.trim();

  // Optimistic local update
  const localItems = await getLocalMemory(shopId);
  const existingIdx = localItems.findIndex(
    (i) => i.kind === item.kind && i.key === normalizedKey
  );

  const newRow: ShopMemoryRow = {
    id: existingIdx >= 0 ? localItems[existingIdx]!.id : crypto.randomUUID(),
    shop_id: shopId,
    kind: item.kind,
    key: normalizedKey,
    value: normalizedVal,
    ref_id: item.ref_id || null,
    created_at: existingIdx >= 0 ? localItems[existingIdx]!.created_at : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const updatedItems =
    existingIdx >= 0
      ? localItems.map((it, idx) => (idx === existingIdx ? newRow : it))
      : [newRow, ...localItems];

  await setLocalMemory(shopId, updatedItems);

  try {
    const upsertPromise = supabase
      .from('shop_memory')
      .upsert(
        {
          id: newRow.id,
          shop_id: shopId,
          kind: item.kind,
          key: normalizedKey,
          value: normalizedVal,
          ref_id: item.ref_id || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'shop_id,kind,key' }
      )
      .select()
      .single();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), 800)
    );

    const { data, error } = (await Promise.race([upsertPromise, timeoutPromise])) as {
      data: ShopMemoryRow | null;
      error: unknown;
    };
    if (!error && data) {
      return data as ShopMemoryRow;
    }
  } catch {
    // Optimistic item already persisted locally
  }

  return newRow;
}

/**
 * Delete a specific memory item by ID.
 */
export async function deleteShopMemory(id: string): Promise<void> {
  if (db) {
    try {
      const keys = await db.meta.where('key').startsWith('memory_').toArray();
      for (const row of keys) {
        if (Array.isArray(row.value)) {
          const filtered = (row.value as ShopMemoryRow[]).filter((i) => i.id !== id);
          await db.meta.put({ key: row.key, value: filtered });
        }
      }
    } catch {}
  }

  try {
    const deletePromise = supabase.from('shop_memory').delete().eq('id', id);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), 800)
    );
    await Promise.race([deletePromise, timeoutPromise]);
  } catch {
    // Local deletion already done
  }
}

/**
 * Clear all memory items for a shop (owner action).
 */
export async function clearShopMemory(shopId: string): Promise<void> {
  await setLocalMemory(shopId, []);

  try {
    const clearPromise = supabase.from('shop_memory').delete().eq('shop_id', shopId);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), 800)
    );
    await Promise.race([clearPromise, timeoutPromise]);
  } catch {
    // Local clear already done
  }
}
