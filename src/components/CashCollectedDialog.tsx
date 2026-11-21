'use client';

import { useState, useEffect } from 'react';
import { useApp } from '../lib/session';
import type { LocalOrder } from '../lib/db';

interface CashCollectedDialogProps {
  order: LocalOrder;
  balance: number;
  currency: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (cashAmount: number) => Promise<void>;
}

export function CashCollectedDialog({
  order,
  balance,
  currency,
  isOpen,
  onClose,
  onConfirm,
}: CashCollectedDialogProps) {
  const { t } = useApp();
  const [amountStr, setAmountStr] = useState<string>(String(balance));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setAmountStr(String(balance));
      setError(null);
    }
  }, [isOpen, balance]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const val = parseFloat(amountStr);
    if (isNaN(val) || val < 0) {
      setError(t('err.VALIDATION'));
      return;
    }

    if (val > balance + 0.001) {
      setError(t('err.OVERPAYMENT'));
      return;
    }

    setSubmitting(true);
    try {
      await onConfirm(val);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/50 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cash-collected-title"
    >
      <div className="bg-surface rounded-card max-w-sm w-full p-5 border border-line shadow-sheet">
        <h2 id="cash-collected-title" className="text-base font-bold text-ink">
          {t('delivery.enterCash')}
        </h2>
        <p className="text-xs text-slate mt-1">
          {order.order_code || order.temp_ref} • {order.label || t('order.delivery')}
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate mb-1">
              {t('delivery.enterCashPrompt')}
            </label>
            <div className="relative mt-1">
              <input
                type="number"
                step="0.01"
                min="0"
                max={balance}
                value={amountStr}
                onChange={(e) => {
                  setAmountStr(e.target.value);
                  setError(null);
                }}
                className="w-full h-12 px-3 text-lg font-bold font-tabular text-ink bg-paper border border-line rounded-control focus:outline-none focus:border-ember"
                autoFocus
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate">
                {currency}
              </span>
            </div>
            <p className="text-[11px] text-slate mt-1">
              {t('pay.balance')}: {balance.toFixed(2)} {currency}
            </p>
          </div>

          {error && (
            <div className="p-2.5 rounded-control bg-amber/10 border border-amber/30 text-xs text-amber font-medium">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3.5 py-2.5 text-xs font-medium text-slate hover:text-ink rounded-control"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2.5 bg-ember text-on-ember text-xs font-semibold rounded-control shadow-sm disabled:opacity-50 transition-transform active:scale-95"
            >
              {submitting ? t('orders.syncing') : t('delivery.confirmAndComplete')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
