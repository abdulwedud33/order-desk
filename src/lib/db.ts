import Dexie, { type Table } from 'dexie';
import type { OutboxItem } from '../domain/outbox';

export interface LocalCategory {
  id: string;
  shop_id: string;
  name: string;
  sort: number;
}

export interface LocalCatalogItem {
  id: string;
  shop_id: string;
  category_id?: string | null;
  name: string;
  kind: 'item' | 'service';
  price: number;
  prep_minutes: number;
  available: boolean;
  archived_at?: string | null;
  updated_at: string;
}

export interface LocalCustomer {
  id: string;
  shop_id: string;
  name: string;
  phone?: string | null;
  note?: string | null;
  updated_at: string;
}

export interface LocalOrder {
  id: string; // client UUID
  shop_id: string;
  order_date?: string;
  order_no?: number | null;
  order_code?: string | null;
  temp_ref: string; // e.g. ~PEND-A1B2
  type: 'dine_in' | 'takeaway' | 'delivery' | 'repair';
  status: 'new' | 'accepted' | 'in_progress' | 'waiting' | 'ready' | 'out_for_delivery' | 'completed' | 'cancelled';
  label?: string | null;
  channel: 'walk_in' | 'phone' | 'telegram' | 'whatsapp' | 'instagram' | 'other';
  note?: string | null;
  customer_id?: string | null;
  customer_phone?: string | null;
  assigned_to?: string | null;
  due_at?: string | null;
  accepted_at?: string | null;
  ready_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  settle_later?: boolean;
  version: number;
  sync_status: 'pending' | 'syncing' | 'synced';
  created_at: string;
  updated_at: string;
}

export interface LocalOrderItem {
  id: string;
  order_id: string;
  shop_id: string;
  item_id?: string | null;
  name: string;
  qty: number;
  unit_price: number;
  note?: string | null;
}

export interface LocalOrderMoney {
  order_id: string;
  shop_id: string;
  subtotal: number;
  delivery_fee: number;
  total: number;
  paid_amount: number;
}

export interface LocalOrderContact {
  order_id: string;
  shop_id: string;
  phone?: string | null;
  address?: string | null;
  address_note?: string | null;
  tracking_token?: string | null;
}

export interface LocalOrderPayment {
  id: string;
  order_id: string;
  shop_id: string;
  kind: 'payment' | 'deposit' | 'refund';
  amount: number;
  method: 'cash' | 'mobile_money' | 'bank' | 'other';
  note?: string | null;
  client_id?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface LocalRepairJob {
  order_id: string;
  shop_id: string;
  device: string;
  problem: string;
  serial?: string | null;
  approved_total?: number | null;
  approved_at?: string | null;
  approved_by?: string | null;
  diagnosis?: string | null;
  pickup_code?: string | null;
  pickup_code_hash?: string | null;
  handed_over_at?: string | null;
  handover_override?: boolean;
  waiting_reason?: string | null;
  created_at: string;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export class OrderDeskDB extends Dexie {
  categories!: Table<LocalCategory, string>;
  items!: Table<LocalCatalogItem, string>;
  customers!: Table<LocalCustomer, string>;
  orders!: Table<LocalOrder, string>;
  order_items!: Table<LocalOrderItem, string>;
  order_money!: Table<LocalOrderMoney, string>;
  order_contacts!: Table<LocalOrderContact, string>;
  order_payments!: Table<LocalOrderPayment, string>;
  repair_jobs!: Table<LocalRepairJob, string>;
  outbox!: Table<OutboxItem, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('order-desk');
    this.version(1).stores({
      categories: 'id, shop_id, sort, name',
      items: 'id, shop_id, category_id, name, available, updated_at',
      customers: 'id, shop_id, name, phone, updated_at',
      meta: 'key',
    });
    this.version(2).stores({
      categories: 'id, shop_id, sort, name',
      items: 'id, shop_id, category_id, name, available, updated_at',
      customers: 'id, shop_id, name, phone, updated_at',
      orders: 'id, shop_id, order_no, order_code, type, status, sync_status, created_at',
      order_items: 'id, order_id, shop_id, item_id',
      order_money: 'order_id, shop_id',
      order_contacts: 'order_id, shop_id, phone',
      outbox: 'id, shopId, kind, status, nextAttemptAt, createdAt',
      meta: 'key',
    });
    this.version(3).stores({
      categories: 'id, shop_id, sort, name',
      items: 'id, shop_id, category_id, name, available, updated_at',
      customers: 'id, shop_id, name, phone, updated_at',
      orders: 'id, shop_id, order_no, order_code, type, status, sync_status, created_at',
      order_items: 'id, order_id, shop_id, item_id',
      order_money: 'order_id, shop_id',
      order_contacts: 'order_id, shop_id, phone',
      order_payments: 'id, order_id, shop_id, kind, created_at',
      outbox: 'id, shopId, kind, status, nextAttemptAt, createdAt',
      meta: 'key',
    });
    this.version(4).stores({
      categories: 'id, shop_id, sort, name',
      items: 'id, shop_id, category_id, name, available, updated_at',
      customers: 'id, shop_id, name, phone, updated_at',
      orders: 'id, shop_id, order_no, order_code, type, status, sync_status, created_at',
      order_items: 'id, order_id, shop_id, item_id',
      order_money: 'order_id, shop_id',
      order_contacts: 'order_id, shop_id, phone',
      order_payments: 'id, order_id, shop_id, kind, created_at',
      repair_jobs: 'order_id, shop_id, device, waiting_reason',
      outbox: 'id, shopId, kind, status, nextAttemptAt, createdAt',
      meta: 'key',
    });
  }
}

export const db: OrderDeskDB =
  typeof window === 'undefined' && typeof indexedDB === 'undefined'
    ? (null as unknown as OrderDeskDB)
    : new OrderDeskDB();

export async function wipeLocalData(): Promise<void> {
  if (!db) return;
  await Promise.all([
    db.categories.clear(),
    db.items.clear(),
    db.customers.clear(),
    db.orders.clear(),
    db.order_items.clear(),
    db.order_money.clear(),
    db.order_contacts.clear(),
    db.order_payments.clear(),
    db.repair_jobs.clear(),
    db.outbox.clear(),
    db.meta.clear(),
  ]);
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
}
