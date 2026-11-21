import { supabase } from './supabase';
import { db, type LocalCatalogItem, type LocalCategory, type LocalCustomer } from './db';

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
