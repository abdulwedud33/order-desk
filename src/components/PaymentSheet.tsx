'use client';

import React, { useState, useEffect } from 'react';
import { useApp } from '../lib/session';
import {
  calculateBalance,
  validatePayment,
  type PaymentKind,
  type PayMethod,
} from '../domain/payments';
import { queueRecordPayment, queueSetSettleLater } from '../lib/sync';
import type { LocalOrder, LocalOrderMoney } from '../lib/db';

interface PaymentSheetProps {
  order: LocalOrder;
  money?: LocalOrderMoney | null;
  isOpen: boolean;
  onClose: () => void;
  userRole?: 'owner' | 'staff' | 'kitchen' | 'courier';
  currency?: string;
  onPaymentRecorded?: () => void;
  onSettleLaterChange?: (settleLater: boolean) => void;
}

const STORAGE_KEY_LAST_METHOD = 'orderdesk_last_pay_method';

export function PaymentSheet({
  order,
  money,
  isOpen,
  onClose,
  userRole = 'staff',
  currency = 'ETB',
  onPaymentRecorded,
  onSettleLaterChange,
}: PaymentSheetProps) {
  const { t } = useApp();

  const total = money?.total ?? 0;
  const paidAmount = money?.paid_amount ?? 0;
  const balance = calculateBalance(total, paidAmount);

  const [kind, setKind] = useState<PaymentKind>('payment');
  const [amountStr, setAmountStr] = useState<string>('');
  const [method, setMethod] = useState<PayMethod>('cash');
  const [note, setNote] = useState<string>('');
  const [settleLater, setSettleLater] = useState<boolean>(order.settle_later ?? false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const isOwner = userRole === 'owner';
  const isCourier = userRole === 'courier';

  // Initialize prefilled amount and last used payment method on open
  useEffect(() => {
    if (isOpen) {
      setKind('payment');
      setAmountStr(balance > 0 ? balance.toString() : '');

      const storedMethod = (typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY_LAST_METHOD) : null) as PayMethod | null;
      if (storedMethod && ['cash', 'mobile_money', 'bank', 'other'].includes(storedMethod)) {
        setMethod(storedMethod);
      } else {
        setMethod('cash');
      }

      setNote('');
      setSettleLater(order.settle_later ?? false);
    }
  }, [isOpen, balance, order.settle_later]);

  const handleKindSelect = (k: PaymentKind) => {
    setKind(k);
    if (k === 'refund') {
      setAmountStr(paidAmount > 0 ? paidAmount.toString() : '');
    } else {
      setAmountStr(balance > 0 ? balance.toString() : '');
    }
  };

  const handleMethodSelect = (m: PayMethod) => {
    setMethod(m);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_LAST_METHOD, m);
    }
  };

  const currentAmount = parseFloat(amountStr) || 0;

  const validation = validatePayment({
    total,
    paidAmount,
    amount: currentAmount,
    kind,
    role: userRole,
    method,
    note,
    isAssignedDelivery: isCourier && order.type === 'delivery',
  });

  const isOverpayment = validation.error === 'OVERPAYMENT';
  const isValidationErr = validation.error === 'VALIDATION';
  const canSubmit = validation.valid && currentAmount > 0 && !isSubmitting;

  const handleSettleLaterToggle = async (checked: boolean) => {
    setSettleLater(checked);
    if (onSettleLaterChange) {
      onSettleLaterChange(checked);
    }
    await queueSetSettleLater(order.shop_id, order.id, checked);
  };

  const handleClose = async () => {
    if (settleLater !== order.settle_later) {
      await queueSetSettleLater(order.shop_id, order.id, settleLater);
    }
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      // 1. If settleLater status changed, queue update
      if (settleLater !== order.settle_later) {
        await queueSetSettleLater(order.shop_id, order.id, settleLater);
      }

      // 2. Queue payment
      await queueRecordPayment(
        order.shop_id,
        order.id,
        kind,
        currentAmount,
        method,
        note.trim() || undefined
      );

      if (onPaymentRecorded) {
        onPaymentRecorded();
      }
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Scrim backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Sheet / Dialog surface */}
      <div
        className="relative w-full max-w-lg bg-surface rounded-t-[20px] sm:rounded-[20px] shadow-2xl p-6 z-10 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-sheet-title"
      >
        <div className="flex items-center justify-between pb-4 border-b border-line mb-4">
          <div>
            <h2 id="payment-sheet-title" className="text-xl font-bold font-heading text-ink">
              {kind === 'refund' ? t('pay.kindRefund') : t('pay.title')}
            </h2>
            <p className="text-xs text-slate">
              {order.order_code || order.temp_ref} · {order.type}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 text-slate hover:text-ink rounded-full transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Financial Summary */}
        <div className="grid grid-cols-3 gap-2 p-3 bg-paper rounded-control mb-5 text-center">
          <div>
            <div className="text-xs text-slate">{t('pay.total')}</div>
            <div className="text-sm font-semibold font-tabular text-ink">
              {currency} {total.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate">{t('pay.paidAmount')}</div>
            <div className="text-sm font-semibold font-tabular text-[#0F7B5F]">
              {currency} {paidAmount.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate">{t('pay.balance')}</div>
            <div className={`text-sm font-semibold font-tabular ${balance > 0 ? 'text-amber-600' : 'text-slate'}`}>
              {currency} {balance.toFixed(2)}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Kind Selector (Payment, Deposit, Refund) */}
          <div className="flex rounded-control bg-paper p-1 border border-line">
            <button
              type="button"
              onClick={() => handleKindSelect('payment')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-control transition-all ${
                kind === 'payment' ? 'bg-surface text-ink shadow-xs' : 'text-slate hover:text-ink'
              }`}
            >
              {t('pay.kindPayment')}
            </button>
            <button
              type="button"
              onClick={() => handleKindSelect('deposit')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-control transition-all ${
                kind === 'deposit' ? 'bg-surface text-ink shadow-xs' : 'text-slate hover:text-ink'
              }`}
            >
              {t('pay.kindDeposit')}
            </button>
            {isOwner && (
              <button
                type="button"
                onClick={() => handleKindSelect('refund')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-control transition-all ${
                  kind === 'refund' ? 'bg-surface text-red-600 font-semibold shadow-xs' : 'text-slate hover:text-ink'
                }`}
              >
                {t('pay.kindRefund')}
              </button>
            )}
          </div>

          {/* Amount input & quick action */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label htmlFor="payment-amount" className="block text-xs font-medium text-slate">
                {t('pay.amount')} ({currency})
              </label>
              {kind !== 'refund' && balance > 0 && (
                <button
                  type="button"
                  onClick={() => setAmountStr(balance.toString())}
                  className="text-xs text-ember hover:underline font-medium"
                >
                  {t('pay.balance')}: {balance.toFixed(2)}
                </button>
              )}
            </div>
            <input
              id="payment-amount"
              type="number"
              step="0.01"
              min="0.01"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0.00"
              className={`w-full h-12 px-3 rounded-control border bg-surface text-lg font-tabular text-ink focus:outline-hidden focus:ring-2 ${
                isOverpayment ? 'border-red-500 focus:ring-red-500/20' : 'border-line focus:ring-ember/20 focus:border-ember'
              }`}
              required
            />
            {/* Inline validation messages */}
            <div className="min-h-[20px] mt-1">
              {isOverpayment && (
                <p className="text-xs text-red-500 font-medium">
                  {t('err.OVERPAYMENT')}
                </p>
              )}
              {isValidationErr && currentAmount > 0 && (
                <p className="text-xs text-red-500 font-medium">
                  {validation.message || t('err.VALIDATION')}
                </p>
              )}
            </div>
          </div>

          {/* Payment Method Chips */}
          <div>
            <label className="block text-xs font-medium text-slate mb-2">
              {t('pay.method')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['cash', 'mobile_money', 'bank', 'other'] as PayMethod[]).map((m) => {
                const isSelected = method === m;
                const methodLabelKey =
                  m === 'cash'
                    ? 'pay.methodCash'
                    : m === 'mobile_money'
                    ? 'pay.methodMobileMoney'
                    : m === 'bank'
                    ? 'pay.methodBank'
                    : 'pay.methodOther';

                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleMethodSelect(m)}
                    className={`h-11 px-3 text-xs font-medium rounded-control border flex items-center justify-center transition-all ${
                      isSelected
                        ? 'border-ember bg-ember/10 text-ember font-semibold'
                        : 'border-line bg-surface text-slate hover:text-ink'
                    }`}
                  >
                    {t(methodLabelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Refund note (Required for refund) */}
          {kind === 'refund' && (
            <div>
              <label htmlFor="refund-note" className="block text-xs font-medium text-slate mb-1">
                {t('pay.refundReason')} *
              </label>
              <input
                id="refund-note"
                type="text"
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Defective item, customer return"
                className="w-full h-12 px-3 rounded-control border border-line bg-surface text-sm text-ink focus:outline-hidden focus:ring-2 focus:ring-ember/20 focus:border-ember"
                required
              />
            </div>
          )}

          {/* Settle Later toggle */}
          {kind !== 'refund' && (
            <div className="flex items-center gap-3 p-3 rounded-control border border-line bg-paper/50">
              <input
                id="settle-later-checkbox"
                type="checkbox"
                checked={settleLater}
                onChange={(e) => handleSettleLaterToggle(e.target.checked)}
                className="w-4 h-4 rounded text-ember focus:ring-ember/20 border-line cursor-pointer"
              />
              <label htmlFor="settle-later-checkbox" className="text-xs text-ink cursor-pointer select-none">
                {t('pay.settleLaterToggle')}
              </label>
            </div>
          )}

          {/* Primary Action Button */}
          <button
            type="submit"
            disabled={!canSubmit}
            className={`w-full min-h-[48px] rounded-control font-semibold text-sm transition-all flex items-center justify-center ${
              canSubmit
                ? kind === 'refund'
                  ? 'bg-red-600 hover:bg-red-700 text-white active:scale-95'
                  : 'bg-ember hover:bg-[#A84508] text-white active:scale-95'
                : 'bg-paper text-slate/50 border border-line cursor-not-allowed'
            }`}
          >
            {isSubmitting
              ? t('orders.syncing')
              : kind === 'refund'
              ? t('pay.submitRefund')
              : t('pay.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
