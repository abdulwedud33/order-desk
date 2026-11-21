/**
 * CSV export with spreadsheet formula-injection protection (docs/security.md section 6).
 * Any cell value starting with '=', '+', '-', '@', '\t', or '\r' is prefixed with a single quote (')
 * so spreadsheet applications never evaluate it as an executable formula.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export interface ExportOrderRecord {
  order_code: string;
  order_date: string;
  type: string;
  status: string;
  channel: string;
  total: number;
  paid_amount: number;
  balance: number;
  items_count: number;
  created_at: string;
  due_at?: string | null;
  completed_at?: string | null;
}

export function formatOrdersToCsv(orders: readonly ExportOrderRecord[]): string {
  const header = [
    'Order Code',
    'Date',
    'Type',
    'Status',
    'Channel',
    'Items Count',
    'Total (ETB)',
    'Paid (ETB)',
    'Balance (ETB)',
    'Created At',
    'Due At',
    'Completed At',
  ];

  const rows = orders.map((o) => [
    o.order_code,
    o.order_date,
    o.type,
    o.status,
    o.channel,
    o.items_count,
    Number(o.total || 0).toFixed(2),
    Number(o.paid_amount || 0).toFixed(2),
    Number(o.balance || 0).toFixed(2),
    o.created_at,
    o.due_at || '',
    o.completed_at || '',
  ]);

  return toCsv([header, ...rows]);
}
