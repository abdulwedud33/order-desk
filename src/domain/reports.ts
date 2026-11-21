/**
 * Reporting and Dashboard domain types, reconciliation rules, and cache keys.
 * Rules: docs/01-prd.md section 8 (FR-X1..FR-X3), docs/05-backend-schema.md migration 0008.
 */
import type { Period } from './dates';

export interface DashboardSummary {
  orders_count: number;
  sales_total: number;
  cash_in: number;
  unpaid_balance: number;
  late_count: number;
  avg_completion_minutes: number;
  by_status: Record<string, number>;
}

export interface TopItemRow {
  item_name: string;
  qty: number;
  revenue: number;
  order_count: number;
}

export interface OrderByHourRow {
  hour: number;
  order_count: number;
  sales_total: number;
}

export interface LateOrderRow {
  order_id: string;
  order_code: string;
  type: string;
  status: string;
  created_at: string;
  due_at: string;
  completed_at?: string | null;
  delay_minutes: number;
}

export interface RepairTurnaroundSummary {
  total_repairs: number;
  completed_repairs: number;
  waiting_repairs: number;
  avg_turnaround_hours: number;
  avg_approval_hours: number;
  waiting_reasons: Record<string, number>;
}

export interface FullReportData {
  summary: DashboardSummary;
  topItems: TopItemRow[];
  byHour: OrderByHourRow[];
  lateOrders: LateOrderRow[];
  repairTurnaround?: RepairTurnaroundSummary | null;
  period: Period;
  cachedAt: string;
}

/**
 * Cache storage key generator for local Dexie meta store
 */
export function getReportCacheKey(shopId: string, period: Period): string {
  return `report_cache_${shopId}_${period}`;
}

/**
 * Reconciles report summary figures against raw ledger payments and order money rows.
 * Throws an Error if any disparity is detected.
 */
export function reconcileReportWithLedgers(
  summary: DashboardSummary,
  ledgerPayments: readonly { kind: string; amount: number }[],
  orderMoneyList: readonly { status: string; total: number; paid_amount: number }[]
): {
  reconciled: boolean;
  computedCashIn: number;
  computedSales: number;
  computedUnpaid: number;
} {
  // 1. Compute cash_in strictly from immutable payments: payments + deposits - refunds
  const computedCashIn = ledgerPayments.reduce((acc, p) => {
    if (p.kind === 'payment' || p.kind === 'deposit') return acc + Number(p.amount);
    if (p.kind === 'refund') return acc - Number(p.amount);
    return acc;
  }, 0);

  // 2. Compute sales_total strictly from completed orders
  const computedSales = orderMoneyList
    .filter((o) => o.status === 'completed')
    .reduce((acc, o) => acc + Number(o.total), 0);

  // 3. Compute unpaid_balance from non-cancelled orders
  const computedUnpaid = orderMoneyList
    .filter((o) => o.status !== 'cancelled')
    .reduce((acc, o) => acc + Math.max(0, Number(o.total) - Number(o.paid_amount)), 0);

  // Compare with 2-santim tolerance for numeric representation
  const cashInDiff = Math.abs(Number(summary.cash_in) - computedCashIn);
  const salesDiff = Math.abs(Number(summary.sales_total) - computedSales);
  const unpaidDiff = Math.abs(Number(summary.unpaid_balance) - computedUnpaid);

  if (cashInDiff > 0.02 || salesDiff > 0.02 || unpaidDiff > 0.02) {
    throw new Error(
      `Ledger reconciliation mismatch: summary(cash_in=${summary.cash_in}, sales=${summary.sales_total}, unpaid=${summary.unpaid_balance}) vs ledgers(cash_in=${computedCashIn}, sales=${computedSales}, unpaid=${computedUnpaid})`
    );
  }

  return {
    reconciled: true,
    computedCashIn,
    computedSales,
    computedUnpaid,
  };
}

/** Formats delay or turnaround minutes/hours cleanly */
export function formatMinutesHuman(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rem = Math.round(minutes % 60);
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}
