'use client';

import { useState } from 'react';
import { useApp } from '../lib/session';
import type { LocalOrder, LocalOrderItem, LocalOrderMoney } from '../lib/db';
import { getAgeTimerInfo } from '../domain/timer';
import { queueAdvanceOrder } from '../lib/sync';
import type { OrderStatus } from '../domain/status';
import type { MessageKey } from '../i18n/en';
import { BalanceChip } from './BalanceChip';
import { PaymentSheet } from './PaymentSheet';

interface OrderTicketProps {
  order: LocalOrder;
  items: LocalOrderItem[];
  money?: LocalOrderMoney;
  isKitchen?: boolean;
}

export function OrderTicket({ order, items, money, isKitchen = false }: OrderTicketProps) {
  const { t, shop, role, showToast, errorText } = useApp();
  const [advancing, setAdvancing] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isSettleLater, setIsSettleLater] = useState(order.settle_later ?? false);

  const timerInfo = getAgeTimerInfo(order.created_at, order.due_at, new Date());
  const isPending = order.sync_status === 'pending';
  const displayCode = order.order_code || order.temp_ref;

  // Determine single next step action button
  let nextStatus: OrderStatus | null = null;
  let actionKey: MessageKey | null = null;

  if (order.status === 'new') {
    nextStatus = 'accepted';
    actionKey = 'board.accept';
  } else if (order.status === 'accepted') {
    nextStatus = 'in_progress';
    actionKey = 'board.start';
  } else if (order.status === 'in_progress') {
    nextStatus = 'ready';
    actionKey = 'board.ready';
  } else if (order.status === 'ready') {
    if (order.type === 'delivery') {
      nextStatus = 'out_for_delivery';
      actionKey = 'board.outForDelivery';
    } else {
      nextStatus = 'completed';
      actionKey = 'board.complete';
    }
  } else if (order.status === 'out_for_delivery') {
    nextStatus = 'completed';
    actionKey = 'board.delivered';
  }

  // Kitchen cannot complete orders
  if (isKitchen && nextStatus === 'completed') {
    nextStatus = null;
    actionKey = null;
  }

  const handleNextStep = async () => {
    if (!nextStatus || advancing) return;

    // Settle-later rule on completion
    if (nextStatus === 'completed' && !isKitchen) {
      const total = money?.total ?? 0;
      const paid = money?.paid_amount ?? 0;
      const hasUnpaid = total - paid > 0;
      const effectiveSettleLater = isSettleLater || order.settle_later;
      if (hasUnpaid && !effectiveSettleLater) {
        showToast(t('pay.unpaidCompletionWarning'));
        setIsPaymentOpen(true);
        return;
      }
    }

    const shopId = shop?.id || '00000000-0000-0000-0000-000000000001';

    setAdvancing(true);
    try {
      await queueAdvanceOrder(shopId, order.id, nextStatus, order.status);
    } catch (err) {
      showToast(errorText(err));
    } finally {
      setAdvancing(false);
    }
  };

  // Border accent color by status
  const statusBorderClass =
    order.status === 'new'
      ? 'border-l-st-new'
      : order.status === 'in_progress'
      ? 'border-l-st-progress'
      : order.status === 'ready'
      ? 'border-l-st-ready'
      : 'border-l-line';

  // Age timer color: Neutral, Amber near due, Red ONLY for late (Von Restorff)
  const timerBadgeClass = timerInfo.isLate
    ? 'bg-late text-white font-bold'
    : timerInfo.severity === 'amber'
    ? 'bg-amber/20 text-amber font-semibold'
    : 'bg-line/60 text-slate font-medium';

  return (
    <>
      <article
        className={`bg-surface border border-line rounded-ticket shadow-sm mb-3 border-l-4 ${statusBorderClass} overflow-hidden transition-all`}
        aria-label={`Order ${displayCode}`}
      >
        {/* Late Banner (only red allowed on ticket) */}
        {timerInfo.isLate && (
          <div className="bg-late text-white px-3 py-1 text-xs font-semibold flex justify-between items-center">
            <span>⚠️ {t('board.late')}</span>
            <span className="num">+{timerInfo.minutesLate}m</span>
          </div>
        )}

        <div className="p-3.5 space-y-2.5">
          {/* Header: Number, Age Timer, Status Chip */}
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="font-heading text-2xl font-bold text-ink num tracking-tight">
                #{displayCode}
              </span>
              {isPending && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber/15 text-amber border border-amber/30">
                  {t('orders.savedOnPhone')}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {/* Age Timer Chip */}
              <span
                className={`px-2 py-0.5 rounded text-xs num flex items-center gap-1 ${timerBadgeClass}`}
                title={`Arrived ${timerInfo.ageMinutes}m ago`}
              >
                ⏱️ {timerInfo.displayTimer}
              </span>

              {/* Status Chip */}
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-line text-ink">
                {t(`status.${order.status}` as MessageKey) || order.status}
              </span>
            </div>
          </div>

          {/* Sub-header: Type & Table / Label & Balance Chip */}
          <div className="flex items-center justify-between text-xs text-slate">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-ink">
                {t(`order.${order.type}` as MessageKey) || order.type}
              </span>
              {order.label && (
                <>
                  <span>•</span>
                  <span className="font-bold text-ink bg-line/50 px-1.5 py-0.5 rounded">
                    {order.label}
                  </span>
                </>
              )}
              {!isKitchen && order.customer_phone && (
                <>
                  <span>•</span>
                  <span className="num text-slate">{order.customer_phone}</span>
                </>
              )}
            </div>

            {/* Balance Chip (hidden in kitchen mode) */}
            {!isKitchen && money && (
              <BalanceChip
                total={money.total}
                paidAmount={money.paid_amount}
                settleLater={isSettleLater || order.settle_later}
                currency={shop?.currency || 'ETB'}
                onClick={() => setIsPaymentOpen(true)}
              />
            )}
          </div>

          {/* Items List (Glanceable lines with bold quantities) */}
          <div className="border-t border-line/60 pt-2 space-y-1">
            {items.map((item) => (
              <div key={item.id} className="flex justify-between items-baseline text-xs">
                <span className="text-ink font-medium">
                  <span className="font-bold text-ink num text-sm mr-1.5">{item.qty}x</span>
                  {item.name}
                  {item.note && <span className="text-slate italic ml-1">({item.note})</span>}
                </span>
                {!isKitchen && (
                  <span className="num text-slate text-[11px]">
                    {(item.qty * item.unit_price).toFixed(2)}
                  </span>
                )}
              </div>
            ))}

            {order.note && (
              <p className="text-xs bg-paper p-1.5 rounded text-slate italic mt-1 border border-line/40">
                Note: {order.note}
              </p>
            )}
          </div>

          {/* Footer: Money (Hidden in kitchen mode) & Next Action Button */}
          <div className="pt-2 border-t border-line/60 flex items-center justify-between gap-2">
            {!isKitchen ? (
              <div className="cursor-pointer" onClick={() => setIsPaymentOpen(true)} title={t('pay.title')}>
                <span className="text-[10px] text-slate block">{t('orders.total')}</span>
                <span className="font-heading font-bold text-base text-ink num">
                  {money ? money.total.toFixed(2) : '0.00'} ETB
                </span>
              </div>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              {!isKitchen && money && (money.total - money.paid_amount > 0) && (
                <button
                  type="button"
                  onClick={() => setIsPaymentOpen(true)}
                  className="h-11 px-3 rounded-control border border-line bg-surface text-xs font-semibold text-ink hover:bg-paper active:scale-95 transition-transform"
                >
                  💳 {t('pay.submit')}
                </button>
              )}

              {actionKey && nextStatus && (
                <button
                  type="button"
                  disabled={advancing}
                  onClick={handleNextStep}
                  className={`h-11 px-5 rounded-control font-semibold text-sm transition-transform active:scale-95 disabled:opacity-50 shadow-sm ${
                    order.status === 'new'
                      ? 'bg-ember text-on-ember'
                      : 'bg-ink text-surface hover:bg-slate'
                  }`}
                >
                  {advancing ? t('orders.syncing') : t(actionKey)}
                </button>
              )}
            </div>
          </div>
        </div>
      </article>

      {/* Payment Sheet */}
      {!isKitchen && (
        <PaymentSheet
          order={order}
          money={money}
          isOpen={isPaymentOpen}
          onClose={() => setIsPaymentOpen(false)}
          userRole={role || 'staff'}
          currency={shop?.currency || 'ETB'}
          onSettleLaterChange={(val) => setIsSettleLater(val)}
          onPaymentRecorded={() => {
            showToast(t('pay.success'));
          }}
        />
      )}
    </>
  );
}

