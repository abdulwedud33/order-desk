/**
 * Client API for reports, aggregating Supabase RPCs with Dexie local cache fallback.
 * Follows local-first rules: offline displays last cached numbers with a clear indicator.
 */
import { supabase } from './supabase';
import { db } from './db';
import {
  type DashboardSummary,
  type TopItemRow,
  type OrderByHourRow,
  type LateOrderRow,
  type RepairTurnaroundSummary,
  type FullReportData,
  getReportCacheKey,
} from '../domain/reports';
import type { Period } from '../domain/dates';
import type { ExportOrderRecord } from '../domain/csv';

export async function fetchFullReport(
  shopId: string,
  from: string,
  to: string,
  period: Period,
  businessType?: string
): Promise<{ data: FullReportData; isCached: boolean }> {
  // If offline, directly attempt reading from Dexie cache
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const cached = await getCachedReport(shopId, period);
    if (cached) return { data: cached, isCached: true };
    // Otherwise compute from local IndexedDB orders
    const localData = await computeLocalReportData(shopId, from, to, period);
    return { data: localData, isCached: true };
  }

  try {
    const rpcPromise = Promise.all([
      supabase.rpc('dashboard_summary', { p_shop: shopId, p_from: from, p_to: to }),
      supabase.rpc('top_items', { p_shop: shopId, p_from: from, p_to: to, p_limit: 5 }),
      supabase.rpc('orders_by_hour', { p_shop: shopId, p_from: from, p_to: to }),
      supabase.rpc('late_orders', { p_shop: shopId, p_from: from, p_to: to, p_limit: 10 }),
      businessType === 'repair'
        ? supabase.rpc('repair_turnaround', { p_shop: shopId, p_from: from, p_to: to })
        : Promise.resolve({ data: null, error: null }),
    ]);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('RPC_TIMEOUT')), 1200)
    );

    const [summaryRes, topItemsRes, byHourRes, lateOrdersRes, repairRes] = await Promise.race([
      rpcPromise,
      timeoutPromise,
    ]);

    if (summaryRes.error) throw summaryRes.error;

    const reportData: FullReportData = {
      summary: summaryRes.data as DashboardSummary,
      topItems: (topItemsRes.data as TopItemRow[]) || [],
      byHour: (byHourRes.data as OrderByHourRow[]) || [],
      lateOrders: (lateOrdersRes.data as LateOrderRow[]) || [],
      repairTurnaround: (repairRes.data as RepairTurnaroundSummary) || null,
      period,
      cachedAt: new Date().toISOString(),
    };

    // Save to Dexie cache for offline access
    await saveReportCache(shopId, period, reportData);

    return { data: reportData, isCached: false };
  } catch (_err) {
    // Attempt cache fallback on transient network error
    const cached = await getCachedReport(shopId, period);
    if (cached) return { data: cached, isCached: true };

    // Fall back to computing from local IndexedDB
    const localData = await computeLocalReportData(shopId, from, to, period);
    return { data: localData, isCached: true };
  }
}

export async function fetchOrdersExport(
  shopId: string,
  from: string,
  to: string
): Promise<ExportOrderRecord[]> {
  try {
    const rpcPromise = supabase.rpc('orders_for_export', {
      p_shop: shopId,
      p_from: from,
      p_to: to,
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('RPC_TIMEOUT')), 1200)
    );
    const { data, error } = await Promise.race([rpcPromise, timeoutPromise]);
    if (error) throw error;
    if (data && Array.isArray(data)) return data as ExportOrderRecord[];
  } catch {
    // If backend RPC is unavailable or offline, compile from local Dexie DB
    if (db) {
      const localOrders = await db.orders
        .where('shop_id')
        .equals(shopId)
        .toArray();

      const fromTime = new Date(from).getTime();
      const toTime = new Date(to).getTime();

      const filtered = localOrders.filter((o) => {
        const ct = new Date(o.created_at).getTime();
        return ct >= fromTime && ct < toTime;
      });

      const records: ExportOrderRecord[] = [];
      for (const o of filtered) {
        const money = await db.order_money.get(o.id);
        const items = await db.order_items.where('order_id').equals(o.id).toArray();
        const total = money?.total || 0;
        const paid = money?.paid_amount || 0;
        records.push({
          order_code: o.order_code || o.temp_ref,
          order_date: o.order_date || o.created_at.slice(0, 10),
          type: o.type,
          status: o.status,
          channel: o.channel,
          total,
          paid_amount: paid,
          balance: Math.max(0, total - paid),
          items_count: items.length,
          created_at: o.created_at,
          due_at: o.due_at,
          completed_at: o.completed_at,
        });
      }
      return records;
    }
  }
  return [];
}

async function saveReportCache(shopId: string, period: Period, data: FullReportData): Promise<void> {
  if (!db) return;
  try {
    const key = getReportCacheKey(shopId, period);
    await db.meta.put({ key, value: data });
  } catch {}
}

async function getCachedReport(shopId: string, period: Period): Promise<FullReportData | null> {
  if (!db) return null;
  try {
    const key = getReportCacheKey(shopId, period);
    const row = await db.meta.get(key);
    return (row?.value as FullReportData) || null;
  } catch {
    return null;
  }
}

/**
 * Computes report aggregates from local Dexie tables when completely offline
 */
async function computeLocalReportData(
  shopId: string,
  from: string,
  to: string,
  period: Period
): Promise<FullReportData> {
  const defaultSummary: DashboardSummary = {
    orders_count: 0,
    sales_total: 0,
    cash_in: 0,
    unpaid_balance: 0,
    late_count: 0,
    avg_completion_minutes: 0,
    by_status: {},
  };

  if (!db) {
    return {
      summary: defaultSummary,
      topItems: [],
      byHour: [],
      lateOrders: [],
      repairTurnaround: null,
      period,
      cachedAt: new Date().toISOString(),
    };
  }

  const allOrders = await db.orders.where('shop_id').equals(shopId).toArray();
  const fromTime = new Date(from).getTime();
  const toTime = new Date(to).getTime();

  const periodOrders = allOrders.filter((o) => {
    const t = new Date(o.created_at).getTime();
    return t >= fromTime && t < toTime;
  });

  const byStatus: Record<string, number> = {};
  let totalSales = 0;
  let unpaidTotal = 0;
  let lateCount = 0;
  let completionMinutesSum = 0;
  let completedCount = 0;
  const now = Date.now();

  const lateList: LateOrderRow[] = [];

  for (const o of periodOrders) {
    byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    const money = await db.order_money.get(o.id);
    const total = money?.total || 0;
    const paid = money?.paid_amount || 0;

    if (o.status === 'completed') {
      totalSales += total;
      completedCount++;
      if (o.completed_at) {
        const diffMins = (new Date(o.completed_at).getTime() - new Date(o.created_at).getTime()) / 60000;
        completionMinutesSum += Math.max(0, diffMins);
      }
    }

    if (o.status !== 'cancelled') {
      unpaidTotal += Math.max(0, total - paid);
    }

    if (o.status !== 'cancelled' && o.due_at) {
      const dueTime = new Date(o.due_at).getTime();
      const compTime = o.completed_at ? new Date(o.completed_at).getTime() : now;
      if (compTime > dueTime) {
        lateCount++;
        lateList.push({
          order_id: o.id,
          order_code: o.order_code || o.temp_ref,
          type: o.type,
          status: o.status,
          created_at: o.created_at,
          due_at: o.due_at,
          completed_at: o.completed_at,
          delay_minutes: Math.round((compTime - dueTime) / 60000),
        });
      }
    }
  }

  // Ledger payments in window
  const allPayments = await db.order_payments.where('shop_id').equals(shopId).toArray();
  const cashIn = allPayments
    .filter((p) => {
      const pt = new Date(p.created_at).getTime();
      return pt >= fromTime && pt < toTime;
    })
    .reduce((acc, p) => {
      if (p.kind === 'payment' || p.kind === 'deposit') return acc + p.amount;
      if (p.kind === 'refund') return acc - p.amount;
      return acc;
    }, 0);

  // Top items
  const itemCounts: Record<string, { qty: number; revenue: number; orderCount: Set<string> }> = {};
  for (const o of periodOrders) {
    if (o.status === 'cancelled') continue;
    const items = await db.order_items.where('order_id').equals(o.id).toArray();
    for (const it of items) {
      if (!itemCounts[it.name]) {
        itemCounts[it.name] = { qty: 0, revenue: 0, orderCount: new Set() };
      }
      const entry = itemCounts[it.name]!;
      entry.qty += it.qty;
      entry.revenue += it.qty * (it.unit_price || 0);
      entry.orderCount.add(o.id);
    }
  }

  const topItems: TopItemRow[] = Object.entries(itemCounts)
    .map(([name, data]) => ({
      item_name: name,
      qty: data.qty,
      revenue: data.revenue,
      order_count: data.orderCount.size,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Orders by hour
  const hourMap: Record<number, { count: number; sales: number }> = {};
  for (let h = 0; h < 24; h++) hourMap[h] = { count: 0, sales: 0 };
  for (const o of periodOrders) {
    if (o.status === 'cancelled') continue;
    const hr = new Date(o.created_at).getHours();
    const entry = hourMap[hr]!;
    entry.count++;
    const money = await db.order_money.get(o.id);
    if (money?.total) entry.sales += money.total;
  }

  const byHour: OrderByHourRow[] = Object.entries(hourMap)
    .map(([hr, val]) => ({
      hour: Number(hr),
      order_count: val.count,
      sales_total: val.sales,
    }))
    .sort((a, b) => a.hour - b.hour);

  const summary: DashboardSummary = {
    orders_count: periodOrders.length,
    sales_total: totalSales,
    cash_in: cashIn,
    unpaid_balance: unpaidTotal,
    late_count: lateCount,
    avg_completion_minutes: completedCount > 0 ? Math.round((completionMinutesSum / completedCount) * 10) / 10 : 0,
    by_status: byStatus,
  };

  return {
    summary,
    topItems,
    byHour,
    lateOrders: lateList.sort((a, b) => b.delay_minutes - a.delay_minutes).slice(0, 10),
    repairTurnaround: null,
    period,
    cachedAt: new Date().toISOString(),
  };
}
