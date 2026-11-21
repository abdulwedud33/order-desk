import Dexie, { type Table } from 'dexie';

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

export interface MetaRow {
  key: string;
  value: unknown;
}

export class OrderDeskDB extends Dexie {
  categories!: Table<LocalCategory, string>;
  items!: Table<LocalCatalogItem, string>;
  customers!: Table<LocalCustomer, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('order-desk');
    this.version(1).stores({
      categories: 'id, shop_id, sort, name',
      items: 'id, shop_id, category_id, name, available, updated_at',
      customers: 'id, shop_id, name, phone, updated_at',
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
    db.meta.clear(),
  ]);
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
}
