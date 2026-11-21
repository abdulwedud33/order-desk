import { supabase } from './supabase';
import {
  db,
  type LocalCatalogItem,
  type LocalCategory,
  type LocalCustomer,
  type LocalOrder,
  type LocalOrderItem,
  type LocalOrderMoney,
  type LocalOrderContact,
} from './db';
import {
  newOutboxItem,
  pickNext,
  markSyncing,
  applyResult,
  recoverStuck,
  type OutboxItem,
  type OutboxSendResult,
} from '../domain/outbox';
import { formatTemporaryReference, type CreateOrderInput } from '../domain/orders';
import type { ErrorCode } from '../domain/errors';

const PAGE_SIZE = 50; // security.md s7 & speed rule: capped at 50

export async function pullCatalog(shopId: string): Promise<void> {
  if (!db) return;

  // 1. Pull Categories
  const { data: categories } = await supabase
    .from('catalog_categories')
    .select('id, shop_id, name, sort')
    .eq('shop_id', shopId)
    .order('sort', { ascending: true })
    .limit(PAGE_SIZE);

  if (categories && categories.length > 0) {
    await db.categories.bulkPut(categories as LocalCategory[]);
  }

  // 2. Pull Items (paged)
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: items, error } = await supabase
      .from('catalog_items')
      .select('id, shop_id, category_id, name, kind, price, prep_minutes, available, archived_at, updated_at')
      .eq('shop_id', shopId)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error || !items || items.length === 0) {
      break;
    }

    await db.items.bulkPut(items as LocalCatalogItem[]);
    if (items.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      from += PAGE_SIZE;
    }
  }
}

export async function pullCustomers(shopId: string): Promise<void> {
  if (!db) return;

  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: customers, error } = await supabase
      .from('customers')
      .select('id, shop_id, name, phone, note, updated_at')
      .eq('shop_id', shopId)
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error || !customers || customers.length === 0) {
      break;
    }

    await db.customers.bulkPut(customers as LocalCustomer[]);
    if (customers.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      from += PAGE_SIZE;
    }
  }
}

export async function pullRecentOrders(shopId: string): Promise<void> {
  if (!db) return;

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, shop_id, order_date, order_no, order_code, type, status, label, channel, note, customer_id, assigned_to, due_at, settle_later, version, created_at, updated_at')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (error || !orders) return;

  for (const o of orders) {
    const localOrd: LocalOrder = {
      id: o.id,
      shop_id: o.shop_id,
      order_date: o.order_date,
      order_no: o.order_no,
      order_code: o.order_code,
      temp_ref: o.order_code || formatTemporaryReference(o.id),
      type: o.type,
      status: o.status,
      label: o.label,
      channel: o.channel,
      note: o.note,
      customer_id: o.customer_id,
      assigned_to: o.assigned_to,
      due_at: o.due_at,
      settle_later: o.settle_later,
      version: o.version,
      sync_status: 'synced',
      created_at: o.created_at,
      updated_at: o.updated_at,
    };
    await db.orders.put(localOrd);
  }
}

// ----------------- Offline Outbox Operations -----------------

export async function queueCreateOrder(input: CreateOrderInput): Promise<LocalOrder> {
  if (!db) throw new Error('Database not initialized');

  const nowIso = new Date().toISOString();
  const tempRef = formatTemporaryReference(input.id);

  // 1. Calculate subtotal and money lines optimistically
  let subtotal = 0;
  const localItems: LocalOrderItem[] = input.items.map((i) => {
    const itemTotal = (i.price ?? 0) * i.qty;
    subtotal += itemTotal;
    return {
      id: crypto.randomUUID(),
      order_id: input.id,
      shop_id: input.shopId,
      item_id: i.itemId ?? null,
      name: i.name,
      qty: i.qty,
      unit_price: i.price ?? 0,
      note: i.note ?? null,
    };
  });

  const deliveryFee = input.deliveryFee ?? 0;
  const total = subtotal + deliveryFee;

  const localOrder: LocalOrder = {
    id: input.id,
    shop_id: input.shopId,
    temp_ref: tempRef,
    type: input.type,
    status: 'new',
    label: input.label ?? null,
    channel: input.channel ?? 'walk_in',
    note: input.note ?? null,
    customer_id: input.customerId ?? null,
    customer_phone: input.contact?.phone ?? null,
    due_at: input.dueAt ?? null,
    version: 1,
    sync_status: 'pending',
    created_at: nowIso,
    updated_at: nowIso,
  };

  const localMoney: LocalOrderMoney = {
    order_id: input.id,
    shop_id: input.shopId,
    subtotal,
    delivery_fee: deliveryFee,
    total,
    paid_amount: 0,
  };

  const localContact: LocalOrderContact = {
    order_id: input.id,
    shop_id: input.shopId,
    phone: input.contact?.phone ?? null,
    address: input.contact?.address ?? null,
    address_note: input.contact?.address_note ?? null,
  };

  const outboxItem = newOutboxItem({
    id: input.id,
    shopId: input.shopId,
    kind: 'create_order',
    payload: {
      p_shop: input.shopId,
      p_id: input.id,
      p_type: input.type,
      p_label: input.label ?? null,
      p_channel: input.channel ?? 'walk_in',
      p_note: input.note ?? null,
      p_due_at: input.dueAt ?? null,
      p_items: input.items.map((i) => ({
        item_id: i.itemId ?? null,
        name: i.name,
        qty: i.qty,
        price: i.price,
        note: i.note ?? null,
      })),
      p_contact: input.contact ?? null,
      p_delivery_fee: deliveryFee,
      p_customer: input.customerId ?? null,
    },
  });

  // Atomic local transaction
  await db.transaction('rw', [db.orders, db.order_items, db.order_money, db.order_contacts, db.outbox], async () => {
    await db.orders.put(localOrder);
    await db.order_items.bulkPut(localItems);
    await db.order_money.put(localMoney);
    await db.order_contacts.put(localContact);
    await db.outbox.put(outboxItem);
  });

  // Trigger sync in background
  kickSync(input.shopId);

  return localOrder;
}

export async function queueEditOrder(
  shopId: string,
  orderId: string,
  expectedVersion: number,
  items: LocalOrderItem[],
  note?: string,
  dueAt?: string
): Promise<void> {
  if (!db) return;

  const clientId = crypto.randomUUID();
  const outboxItem = newOutboxItem({
    id: clientId,
    shopId,
    kind: 'edit_order',
    payload: {
      p_shop: shopId,
      p_order: orderId,
      p_client_id: clientId,
      p_expected_version: expectedVersion,
      p_items: items.map((i) => ({
        item_id: i.item_id ?? null,
        name: i.name,
        qty: i.qty,
        price: i.unit_price,
        note: i.note ?? null,
      })),
      p_note: note ?? null,
      p_due_at: dueAt ?? null,
    },
  });

  await db.transaction('rw', [db.orders, db.order_items, db.outbox], async () => {
    await db.orders.update(orderId, {
      sync_status: 'pending',
      version: expectedVersion + 1,
      note: note ?? undefined,
      due_at: dueAt ?? undefined,
      updated_at: new Date().toISOString(),
    });
    await db.outbox.put(outboxItem);
  });

  kickSync(shopId);
}

export async function queueAdvanceOrder(
  shopId: string,
  orderId: string,
  toStatus: LocalOrder['status'],
  expectedFrom: LocalOrder['status']
): Promise<void> {
  if (!db) return;

  const clientId = crypto.randomUUID();
  const outboxItem = newOutboxItem({
    id: clientId,
    shopId,
    kind: 'advance_order',
    payload: {
      p_shop: shopId,
      p_order: orderId,
      p_to: toStatus,
      p_expected_from: expectedFrom,
      p_client_id: clientId,
    },
  });

  await db.transaction('rw', [db.orders, db.outbox], async () => {
    await db.orders.update(orderId, {
      status: toStatus,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });
    await db.outbox.put(outboxItem);
  });

  kickSync(shopId);
}

// ----------------- Realtime Subscription & 10s Polling Fallback -----------------

export function subscribeToOrders(
  shopId: string,
  onNewOrder?: () => void
): () => void {
  if (!db || typeof window === 'undefined') {
    return () => {};
  }

  // 1. Supabase Realtime channel
  const channel = supabase
    .channel(`shop-orders-${shopId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `shop_id=eq.${shopId}`,
      },
      async (payload) => {
        if (!db) return;
        if (payload.eventType === 'INSERT') {
          const o = payload.new as Record<string, unknown>;
          const localOrd: LocalOrder = {
            id: o.id as string,
            shop_id: o.shop_id as string,
            order_date: o.order_date as string,
            order_no: o.order_no as number,
            order_code: o.order_code as string,
            temp_ref: (o.order_code as string) || formatTemporaryReference(o.id as string),
            type: o.type as LocalOrder['type'],
            status: o.status as LocalOrder['status'],
            label: o.label as string | null,
            channel: o.channel as LocalOrder['channel'],
            note: o.note as string | null,
            customer_id: o.customer_id as string | null,
            due_at: o.due_at as string | null,
            version: o.version as number,
            sync_status: 'synced',
            created_at: o.created_at as string,
            updated_at: o.updated_at as string,
          };
          await db.orders.put(localOrd);
          if (onNewOrder) onNewOrder();
        } else if (payload.eventType === 'UPDATE') {
          const o = payload.new as Record<string, unknown>;
          await db.orders.update(o.id as string, {
            status: o.status as LocalOrder['status'],
            version: o.version as number,
            order_no: o.order_no as number,
            order_code: o.order_code as string,
            updated_at: o.updated_at as string,
            sync_status: 'synced',
          });
        }
      }
    )
    .subscribe();

  // 2. 10-second polling fallback per technical requirements
  const intervalId = setInterval(() => {
    pullRecentOrders(shopId).catch(() => {});
  }, 10_000);

  return () => {
    channel.unsubscribe();
    clearInterval(intervalId);
  };
}

// ----------------- Sync Processor -----------------

let isProcessing = false;

export function kickSync(shopId: string): void {
  if (typeof window === 'undefined') return;
  if (!navigator.onLine) return; // offline
  setTimeout(() => {
    processOutbox(shopId).catch(() => {});
  }, 10);
}

export async function processOutbox(shopId: string): Promise<void> {
  if (!db || isProcessing) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  isProcessing = true;
  try {
    const allItems = await db.outbox.where('shopId').equals(shopId).toArray();
    const recovered = recoverStuck(allItems, Date.now());

    // Update any recovered items in DB
    for (const r of recovered) {
      if (r.status === 'pending' && allItems.find((i) => i.id === r.id)?.status === 'syncing') {
        await db.outbox.put(r);
      }
    }

    const nextItem = pickNext(recovered, Date.now());
    if (!nextItem) return;

    // Mark syncing
    const syncingItem = markSyncing(nextItem, Date.now());
    await db.outbox.put(syncingItem);

    const result = await sendItem(syncingItem);
    const updated = applyResult(syncingItem, result, Date.now());
    await db.outbox.put(updated);

    // If more pending items, process next
    if (result.ok) {
      processOutbox(shopId).catch(() => {});
    }
  } finally {
    isProcessing = false;
  }
}

async function sendItem(item: OutboxItem): Promise<OutboxSendResult> {
  try {
    if (item.kind === 'create_order') {
      const payload = item.payload as Record<string, unknown>;
      const { data, error } = await supabase.rpc('create_order', payload);

      if (error) {
        return { ok: false, code: mapError(error) };
      }

      if (data && db) {
        // Update local order with assigned order number & code
        await db.orders.update(item.id, {
          order_no: data.order_no,
          order_code: data.order_code,
          version: data.version,
          sync_status: 'synced',
          updated_at: data.updated_at,
        });
      }
      return { ok: true };
    }

    if (item.kind === 'edit_order') {
      const payload = item.payload as Record<string, unknown>;
      const { data, error } = await supabase.rpc('edit_order', payload);

      if (error) {
        return { ok: false, code: mapError(error) };
      }

      if (data && db) {
        await db.orders.update(data.id, {
          version: data.version,
          sync_status: 'synced',
          updated_at: data.updated_at,
        });
      }
      return { ok: true };
    }

    if (item.kind === 'advance_order') {
      const payload = item.payload as Record<string, unknown>;
      const { data, error } = await supabase.rpc('advance_order', payload);

      if (error) {
        const code = mapError(error);
        if (code === 'CONFLICT' && db) {
          // Reconcile on conflict: fetch latest order state from server
          const { data: latest } = await supabase
            .from('orders')
            .select('*')
            .eq('id', payload.p_order as string)
            .single();
          if (latest) {
            await db.orders.update(latest.id, {
              status: latest.status,
              version: latest.version,
              updated_at: latest.updated_at,
              sync_status: 'synced',
            });
          }
        }
        return { ok: false, code };
      }

      if (data && db) {
        await db.orders.update(data.id, {
          status: data.status,
          version: data.version,
          sync_status: 'synced',
          updated_at: data.updated_at,
          accepted_at: data.accepted_at,
          ready_at: data.ready_at,
          completed_at: data.completed_at,
        });
      }
      return { ok: true };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, code: mapError(err) };
  }
}

function mapError(err: unknown): ErrorCode {
  if (!err) return 'UNKNOWN';
  if (typeof err === 'object' && 'message' in err) {
    const msg = String((err as { message: string }).message);
    if (msg.includes('FORBIDDEN')) return 'FORBIDDEN';
    if (msg.includes('CONFLICT')) return 'CONFLICT';
    if (msg.includes('NOT_FOUND')) return 'NOT_FOUND';
    if (msg.includes('VALIDATION')) return 'VALIDATION';
    if (msg.includes('OVERPAYMENT')) return 'OVERPAYMENT';
    if (msg.includes('INVALID_TRANSITION')) return 'INVALID_TRANSITION';
    if (msg.includes('RATE_LIMITED')) return 'RATE_LIMITED';
  }
  return 'OFFLINE';
}
