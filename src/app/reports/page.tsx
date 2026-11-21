'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useApp } from '../../lib/session';
import { rangeFor, type Period } from '../../domain/dates';
import {
  type FullReportData,
  formatMinutesHuman,
} from '../../domain/reports';
import { formatOrdersToCsv } from '../../domain/csv';
import { fetchFullReport, fetchOrdersExport } from '../../lib/reportsApi';
import { getAiInsights } from '../../lib/aiApi';
import { BottomNav } from '../../components/Navigation';
import type { MessageKey } from '../../i18n/en';

export default function ReportsPage() {
  const { t, shop, role, online, showToast, errorText } = useApp();
  const [period, setPeriod] = useState<Period>('today');
  const [report, setReport] = useState<FullReportData | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [insights, setInsights] = useState<string[]>([]);
  const [loadingInsights, setLoadingInsights] = useState(false);

  const formatMoney = useCallback(
    (amount: number) => {
      const cur = shop?.currency || 'ETB';
      return `${cur} ${Number(amount || 0).toFixed(2)}`;
    },
    [shop?.currency]
  );

  const range = useMemo(
    () => rangeFor(period, shop?.timezone || 'Africa/Addis_Ababa'),
    [period, shop?.timezone]
  );

  const loadReport = useCallback(async () => {
    if (!shop) return;
    setLoading(true);
    try {
      const res = await fetchFullReport(
        shop.id,
        range.from,
        range.to,
        period,
        shop.business_type
      );
      setReport(res.data);
      setIsCached(res.isCached);
    } catch (e) {
      showToast(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [shop, range.from, range.to, period, showToast, errorText]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleGenerateInsights = async () => {
    if (!shop) return;
    setLoadingInsights(true);
    try {
      const res = await getAiInsights({
        period,
        shopId: shop.id,
      });
      setInsights(res.insights);
    } catch {
      showToast('Failed to generate insights');
    } finally {
      setLoadingInsights(false);
    }
  };

  const handleExportCsv = async () => {
    if (!shop) return;
    setExporting(true);
    try {
      const records = await fetchOrdersExport(shop.id, range.from, range.to);
      const csvString = formatOrdersToCsv(records);
      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `orders-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(t('rep.exportSuccess'));
    } catch (e) {
      showToast(errorText(e));
    } finally {
      setExporting(false);
    }
  };

  if (!shop) return null;

  // Access control: Reports are restricted to owner role
  if (role !== 'owner') {
    return (
      <main className="min-h-screen bg-paper pb-24 p-4 max-w-lg mx-auto flex flex-col justify-center items-center text-center">
        <div className="p-6 bg-surface border border-line rounded-card shadow-sm space-y-3">
          <div className="text-4xl">🔒</div>
          <h1 className="text-base font-bold text-ink">{t('rep.title')}</h1>
          <p className="text-xs text-slate">{t('rep.ownerOnly')}</p>
        </div>
        <BottomNav />
      </main>
    );
  }

  const summary = report?.summary;
  const topItems = report?.topItems || [];
  const byHour = report?.byHour || [];
  const lateOrders = report?.lateOrders || [];
  const repair = report?.repairTurnaround;

  // Find max hourly orders for scaling the chart
  const maxHourOrders = Math.max(1, ...byHour.map((h) => h.order_count));

  return (
    <main className="min-h-screen bg-paper pb-24 text-ink antialiased">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-surface border-b border-line px-4 py-3 max-w-lg mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">📊</span>
          <h1 className="text-base font-bold font-heading text-ink">{t('rep.title')}</h1>
        </div>

        {/* CSV Export Button */}
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={exporting || loading}
          className="min-h-control px-3 py-1.5 rounded-control border border-line bg-surface text-ink text-xs font-semibold hover:bg-paper transition-colors flex items-center gap-1.5 disabled:opacity-50"
          aria-label={t('rep.exportCsv')}
        >
          <span>📥</span>
          <span>{exporting ? t('rep.exporting') : t('rep.exportCsv')}</span>
        </button>
      </header>

      <div className="max-w-lg mx-auto p-4 space-y-5">
        {/* Period Selector Tabs */}
        <div className="flex bg-surface p-1 rounded-control border border-line text-xs font-semibold shadow-sm" role="tablist">
          {(['today', 'week', 'month'] as Period[]).map((p) => {
            const labelKey: MessageKey = p === 'today' ? 'rep.today' : p === 'week' ? 'rep.week' : 'rep.month';
            const isActive = period === p;
            return (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setPeriod(p)}
                className={`flex-1 py-2 text-center rounded transition-colors ${
                  isActive ? 'bg-ink text-surface font-bold shadow-xs' : 'text-slate hover:text-ink'
                }`}
              >
                {t(labelKey)}
              </button>
            );
          })}
        </div>

        {/* Offline / Cached Data Banner */}
        {(!online || isCached) && (
          <div className="p-3 rounded-control bg-amber/15 border border-amber/30 text-xs font-semibold text-amber flex items-center gap-2">
            <span>📡</span>
            <span>{t('rep.offlineCached')}</span>
          </div>
        )}

        {/* Content Body: Skeleton Loader vs Live Data */}
        {loading && !report ? (
          /* Layout-Matched Skeletons (Zero Spinners) */
          <div className="space-y-5" aria-label="Loading reports">
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="p-4 bg-surface border border-line rounded-card space-y-2 shadow-sm animate-pulse">
                  <div className="h-3 bg-line/60 rounded w-1/2" />
                  <div className="h-6 bg-line/80 rounded w-3/4" />
                </div>
              ))}
            </div>
            <div className="p-4 bg-surface border border-line rounded-card space-y-3 shadow-sm animate-pulse">
              <div className="h-4 bg-line/70 rounded w-1/3" />
              <div className="h-20 bg-line/40 rounded w-full" />
            </div>
          </div>
        ) : !summary ? (
          /* Empty State if completely unavailable */
          <div className="text-center py-16 px-4 bg-surface border border-line rounded-card space-y-3 shadow-sm">
            <div className="text-3xl">📭</div>
            <h2 className="text-sm font-bold text-ink">{t('rep.noOrders')}</h2>
          </div>
        ) : (
          <>
            {/* Stat Cards Grid (Reconciles with Ledgers) */}
            <div className="grid grid-cols-2 gap-3">
              {/* Sales Total */}
              <div className="p-4 bg-surface border border-line rounded-card shadow-sm space-y-1">
                <span className="text-xs font-semibold text-slate">{t('rep.sales')}</span>
                <p className="text-xl font-bold font-heading text-ink font-tabular">
                  {formatMoney(summary.sales_total)}
                </p>
              </div>

              {/* Cash In / Collected */}
              <div className="p-4 bg-surface border border-line rounded-card shadow-sm space-y-1">
                <span className="text-xs font-semibold text-slate">{t('rep.cashIn')}</span>
                <p className="text-xl font-bold font-heading text-st-ready font-tabular">
                  {formatMoney(summary.cash_in)}
                </p>
              </div>

              {/* Unpaid Balances */}
              <div className="p-4 bg-surface border border-line rounded-card shadow-sm space-y-1">
                <span className="text-xs font-semibold text-slate">{t('rep.unpaid')}</span>
                <p className="text-xl font-bold font-heading text-amber font-tabular">
                  {formatMoney(summary.unpaid_balance)}
                </p>
              </div>

              {/* Total Orders */}
              <div className="p-4 bg-surface border border-line rounded-card shadow-sm space-y-1">
                <span className="text-xs font-semibold text-slate">{t('rep.ordersCount')}</span>
                <p className="text-xl font-bold font-heading text-ink font-tabular">
                  {summary.orders_count}
                </p>
              </div>

              {/* Late Orders */}
              <div className="p-4 bg-surface border border-line rounded-card shadow-sm space-y-1">
                <span className="text-xs font-semibold text-slate">{t('rep.lateOrders')}</span>
                <p className={`text-xl font-bold font-heading font-tabular ${summary.late_count > 0 ? 'text-late' : 'text-ink'}`}>
                  {summary.late_count}
                </p>
              </div>

              {/* Average Completion Time */}
              <div className="p-4 bg-surface border border-line rounded-card shadow-sm space-y-1">
                <span className="text-xs font-semibold text-slate">{t('rep.avgTime')}</span>
                <p className="text-xl font-bold font-heading text-ink font-tabular">
                  {summary.avg_completion_minutes > 0 ? formatMinutesHuman(summary.avg_completion_minutes) : '—'}
                </p>
              </div>
            </div>

            {/* Assistant Insights (M10) */}
            <section className="p-4 bg-surface border border-line rounded-card shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-slate uppercase tracking-wider flex items-center gap-1.5">
                  <span>✨</span> {t('ai.insightsTitle')}
                </h2>
                <button
                  type="button"
                  onClick={handleGenerateInsights}
                  disabled={loadingInsights}
                  className="px-2.5 py-1 text-xs bg-ember text-on-ember font-semibold rounded-lg hover:bg-ember-rich disabled:opacity-50 transition-colors"
                >
                  {loadingInsights ? t('ai.analyzing') : t('ai.generateInsights')}
                </button>
              </div>

              {insights.length > 0 ? (
                <div className="space-y-2">
                  <ul className="space-y-1.5 text-xs text-ink list-disc list-inside">
                    {insights.map((insight, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {insight}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-slate border-t border-line/60 pt-2 flex items-center gap-1">
                    <span>🔒</span> {t('ai.groundedNotice')}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate">{t('ai.noInsights')}</p>
              )}
            </section>

            {summary.orders_count === 0 && (
              <div className="text-center py-8 px-4 bg-surface border border-line rounded-card space-y-1 shadow-sm">
                <p className="text-xs font-semibold text-slate">{t('rep.noOrders')}</p>
              </div>
            )}

            {/* Busiest Hours Chart */}
            {byHour.some((h) => h.order_count > 0) && (
              <section className="p-4 bg-surface border border-line rounded-card shadow-sm space-y-3">
                <h2 className="text-xs font-bold text-slate uppercase tracking-wider">
                  {t('rep.busiestHours')}
                </h2>
                <div className="pt-2 flex items-end gap-1.5 h-32 overflow-x-auto pb-1" aria-label="Hourly order distribution">
                  {byHour.map((h) => {
                    const heightPercent = Math.max(4, Math.round((h.order_count / maxHourOrders) * 100));
                    return (
                      <div key={h.hour} className="flex-1 min-w-[14px] flex flex-col items-center gap-1 group relative">
                        {/* Tooltip on hover */}
                        <div className="absolute -top-7 hidden group-hover:block bg-ink text-surface text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap z-20">
                          {h.hour}:00 - {h.order_count} {t('rep.orders')}
                        </div>
                        <div
                          className={`w-full rounded-t transition-all ${
                            h.order_count > 0 ? 'bg-ember' : 'bg-line/40'
                          }`}
                          style={{ height: `${heightPercent}%` }}
                        />
                        <span className="text-[10px] text-slate font-tabular">
                          {h.hour % 3 === 0 ? `${h.hour}h` : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Top Items & Services */}
            <section className="p-4 bg-surface border border-line rounded-card shadow-sm space-y-3">
              <h2 className="text-xs font-bold text-slate uppercase tracking-wider">
                {t('rep.topItems')}
              </h2>
              {topItems.length === 0 ? (
                <p className="text-xs text-slate py-2">{t('rep.noOrders')}</p>
              ) : (
                <ul className="divide-y divide-line text-xs">
                  {topItems.map((item, idx) => (
                    <li key={item.item_name} className="py-2.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-paper flex items-center justify-center font-bold text-slate text-[11px]">
                          {idx + 1}
                        </span>
                        <div>
                          <p className="font-semibold text-ink">{item.item_name}</p>
                          <p className="text-[11px] text-slate font-tabular">
                            {item.qty} {t('rep.qty')} • {item.order_count} {t('rep.orders')}
                          </p>
                        </div>
                      </div>
                      <span className="font-bold font-tabular text-ink">
                        {formatMoney(item.revenue)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Late Orders Breakdown */}
            {lateOrders.length > 0 && (
              <section className="p-4 bg-surface border border-line rounded-card shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold text-slate uppercase tracking-wider">
                    {t('rep.lateList')}
                  </h2>
                  <span className="text-xs font-bold text-late font-tabular">
                    {lateOrders.length}
                  </span>
                </div>
                <div className="divide-y divide-line text-xs">
                  {lateOrders.map((lo) => (
                    <div key={lo.order_id} className="py-2.5 flex items-center justify-between">
                      <div className="space-y-0.5">
                        <span className="font-bold text-ink font-tabular">
                          {lo.order_code}
                        </span>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate">
                          <span className="capitalize">{lo.type}</span>
                          <span>•</span>
                          <span>{t(`status.${lo.status}` as MessageKey) || lo.status}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-late font-bold font-tabular">
                          +{formatMinutesHuman(lo.delay_minutes)}
                        </span>
                        <p className="text-[10px] text-slate">
                          {t('rep.delay')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Repair Turnaround Section (If repair shop or repairs present) */}
            {repair && repair.total_repairs > 0 && (
              <section className="p-4 bg-surface border border-line rounded-card shadow-sm space-y-3">
                <h2 className="text-xs font-bold text-slate uppercase tracking-wider">
                  {t('rep.repairTurnaround')}
                </h2>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="p-3 bg-paper rounded-control space-y-0.5">
                    <span className="text-[11px] text-slate">{t('rep.avgTurnaround')}</span>
                    <p className="text-base font-bold font-tabular text-ink">
                      {repair.avg_turnaround_hours > 0 ? `${repair.avg_turnaround_hours}h` : '—'}
                    </p>
                  </div>
                  <div className="p-3 bg-paper rounded-control space-y-0.5">
                    <span className="text-[11px] text-slate">{t('rep.avgApproval')}</span>
                    <p className="text-base font-bold font-tabular text-ink">
                      {repair.avg_approval_hours > 0 ? `${repair.avg_approval_hours}h` : '—'}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-slate">
                  {t('rep.repairsSummary', {
                    total: repair.total_repairs,
                    completed: repair.completed_repairs,
                    waiting: repair.waiting_repairs,
                  })}
                </p>
              </section>
            )}
          </>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
