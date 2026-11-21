'use client';

import { useState } from 'react';
import { useApp } from '../lib/session';
import { formatTelUri, formatMapUri, calculateAmountToCollect } from '../domain/delivery';
import { getAgeTimerInfo } from '../domain/timer';
import type { LocalOrder, LocalOrderItem, LocalOrderMoney, LocalOrderContact } from '../lib/db';
import type { MessageKey } from '../i18n/en';

interface DeliveryCardProps {
  order: LocalOrder;
  items: LocalOrderItem[];
  money?: LocalOrderMoney;
  contact?: LocalOrderContact;
  currency: string;
  onAdvance: (order: LocalOrder, nextStatus: 'out_for_delivery' | 'completed') => Promise<void>;
  onOpenCashCollected: (order: LocalOrder, balance: number) => void;
}

export function DeliveryCard({
  order,
  items,
  money,
  contact,
  currency,
  onAdvance,
  onOpenCashCollected,
}: DeliveryCardProps) {
  const { t } = useApp();
  const [advancing, setAdvancing] = useState(false);

  const phone = contact?.phone || order.customer_phone || '';
  const address = contact?.address || '';
  const addressNote = contact?.address_note || '';

  const telUri = formatTelUri(phone);
  const mapUri = formatMapUri(address);

  const total = money?.total ?? 0;
  const paid = money?.paid_amount ?? 0;
  const amountToCollect = calculateAmountToCollect(total, paid);

  const timerInfo = getAgeTimerInfo(order.created_at, order.due_at, new Date());
  const timerBadgeClass =
    timerInfo.severity === 'red'
      ? 'bg-red-500/15 text-red-600 font-bold border border-red-500/30'
      : timerInfo.severity === 'amber'
      ? 'bg-amber/15 text-amber border border-amber/30'
      : 'bg-line/40 text-slate';

  const handleBigButtonClick = async () => {
    if (advancing) return;

    if (order.status === 'ready') {
      setAdvancing(true);
      try {
        await onAdvance(order, 'out_for_delivery');
      } finally {
        setAdvancing(false);
      }
    } else if (order.status === 'out_for_delivery') {
      if (amountToCollect > 0) {
        onOpenCashCollected(order, amountToCollect);
      } else {
        setAdvancing(true);
        try {
          await onAdvance(order, 'completed');
        } finally {
          setAdvancing(false);
        }
      }
    }
  };

  return (
    <article
      className="bg-surface border border-line rounded-card p-4 mb-4 shadow-sm space-y-4"
      aria-label={`Delivery order ${order.order_code || order.temp_ref}`}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold font-tabular text-ink">
            {order.order_code || order.temp_ref}
          </span>
          {order.label && (
            <span className="text-xs px-2 py-0.5 rounded bg-line/60 font-semibold text-ink">
              {order.label}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs num flex items-center gap-1 ${timerBadgeClass}`}>
            {timerInfo.displayTimer}
          </span>
          <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-ink text-surface">
            {t(`status.${order.status}` as MessageKey) || order.status}
          </span>
        </div>
      </div>

      {/* Customer & Address Details */}
      <div className="p-3.5 bg-paper rounded-control border border-line/70 space-y-2.5">
        <div>
          <div className="flex items-center gap-1 text-[11px] font-semibold text-slate uppercase tracking-wider">
            <span>📍</span>
            <span>{t('delivery.address')}</span>
          </div>
          <p className="text-sm font-bold text-ink mt-0.5 leading-snug">
            {address || 'No address specified'}
          </p>
          {addressNote && (
            <p className="text-xs text-slate italic mt-0.5">
              &quot;{addressNote}&quot;
            </p>
          )}
        </div>

        {/* Action Link Buttons: Call and Map */}
        <div className="flex items-center gap-2 pt-1">
          {telUri ? (
            <a
              href={telUri}
              className="inline-flex items-center gap-1.5 h-9 px-3 bg-surface border border-line rounded-control text-xs font-semibold text-ink hover:bg-paper active:scale-95 transition-transform"
              title="Call customer"
            >
              <span>📞</span>
              <span>{t('delivery.call')}</span>
              {phone && <span className="font-tabular text-slate text-[11px]">({phone})</span>}
            </a>
          ) : (
            <span className="text-xs text-slate italic">
              {phone || 'No phone'}
            </span>
          )}

          {mapUri && (
            <a
              href={mapUri}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-9 px-3 bg-surface border border-line rounded-control text-xs font-semibold text-ink hover:bg-paper active:scale-95 transition-transform"
              title="Open location in Google Maps"
            >
              <span>🗺️</span>
              <span>{t('delivery.map')}</span>
            </a>
          )}
        </div>
      </div>

      {/* Order Items Summary */}
      <div className="text-xs space-y-1">
        <div className="text-[11px] font-semibold text-slate uppercase tracking-wider mb-1">
          {items.length} {t('orders.items')}
        </div>
        <div className="space-y-0.5">
          {items.map((item) => (
            <div key={item.id} className="flex justify-between text-ink py-0.5">
              <span>
                <strong className="font-bold mr-1.5">{item.qty}×</strong>
                {item.name}
              </span>
              {item.note && <span className="text-slate italic text-[11px]">{item.note}</span>}
            </div>
          ))}
        </div>
        {order.note && (
          <p className="text-xs text-slate italic bg-paper p-2 rounded border border-line/40 mt-1">
            Note: {order.note}
          </p>
        )}
      </div>

      {/* Amount To Collect / Paid Status */}
      <div className="flex items-center justify-between p-3 rounded-control bg-paper border border-line/60">
        <span className="text-xs font-semibold text-slate">
          {t('delivery.amountToCollect')}
        </span>
        {amountToCollect > 0 ? (
          <span className="text-base font-bold font-tabular text-ember">
            {amountToCollect.toFixed(2)} {currency}
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-forest/15 text-forest border border-forest/30">
            ✓ {t('delivery.paidInFull')}
          </span>
        )}
      </div>

      {/* ONE BIG STATUS BUTTON (h-14, 56px height, instant feedback) */}
      <button
        type="button"
        disabled={advancing}
        onClick={handleBigButtonClick}
        className={`w-full h-14 rounded-control text-base font-bold flex items-center justify-center gap-2 shadow-sm transition-transform active:scale-[0.99] disabled:opacity-50 ${
          order.status === 'ready'
            ? 'bg-ink text-surface hover:bg-slate'
            : 'bg-ember text-on-ember hover:opacity-95'
        }`}
      >
        {advancing ? (
          <span>{t('orders.syncing')}</span>
        ) : order.status === 'ready' ? (
          <>
            <span className="text-xl">🛵</span>
            <span>{t('delivery.pickedUp')}</span>
          </>
        ) : (
          <>
            <span className="text-xl">✅</span>
            <span>{t('delivery.delivered')}</span>
          </>
        )}
      </button>
    </article>
  );
}
