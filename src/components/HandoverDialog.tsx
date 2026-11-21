'use client';

import React, { useState } from 'react';
import { useApp } from '../lib/session';
import type { LocalOrder, LocalOrderMoney, LocalRepairJob } from '../lib/db';
import { queueHandoverOrder } from '../lib/sync';
import { calculateBalance } from '../domain/payments';

interface HandoverDialogProps {
  order: LocalOrder;
  repairJob?: LocalRepairJob | null;
  money?: LocalOrderMoney | null;
  isOpen: boolean;
  onClose: () => void;
  userRole?: string;
  onHandoverComplete?: () => void;
}

export function HandoverDialog({
  order,
  repairJob,
  money,
  isOpen,
  onClose,
  userRole = 'staff',
  onHandoverComplete,
}: HandoverDialogProps) {
  const { t, showToast } = useApp();
  const [code, setCode] = useState('');
  const [override, setOverride] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const isOwner = userRole === 'owner';
  const total = money?.total ?? 0;
  const paid = money?.paid_amount ?? 0;
  const balance = calculateBalance(total, paid);
  const isUnpaidWithoutSettleLater = balance > 0 && !order.settle_later;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (isUnpaidWithoutSettleLater) {
      setErrorMsg(t('pay.unpaidCompletionWarning'));
      return;
    }

    if (!override && (!code || code.trim().length === 0)) {
      setErrorMsg(t('repair.invalidCode'));
      return;
    }

    setSubmitting(true);
    try {
      await queueHandoverOrder(order.shop_id, order.id, code.trim(), override);
      showToast(t('repair.handoverSuccess'));
      if (onHandoverComplete) onHandoverComplete();
      onClose();
    } catch {
      setErrorMsg(t('err.UNKNOWN'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-xs" onClick={onClose} aria-hidden="true" />
      <div
        className="relative w-full max-w-md bg-surface rounded-[20px] shadow-2xl p-6 z-10 animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="handover-title"
      >
        <div className="flex items-center justify-between pb-3 border-b border-line mb-4">
          <div>
            <h2 id="handover-title" className="text-lg font-bold font-heading text-ink">
              {t('repair.handoverTitle')}
            </h2>
            <p className="text-xs text-slate">
              {order.order_code || order.temp_ref} · {repairJob?.device || order.label || 'Repair'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate hover:text-ink rounded-full transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Financial Warning if unpaid */}
        {isUnpaidWithoutSettleLater && (
          <div className="mb-4 p-3 rounded-control bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 font-medium">
            {t('pay.unpaidCompletionWarning')}
          </div>
        )}

        {/* Device summary */}
        {repairJob && (
          <div className="mb-4 p-3 bg-paper rounded-control text-xs space-y-1">
            <div className="font-semibold text-ink">{repairJob.device}</div>
            <div className="text-slate">{repairJob.problem}</div>
            {repairJob.serial && <div className="text-slate font-tabular">SN: {repairJob.serial}</div>}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!override && (
            <div>
              <label htmlFor="pickup-code-input" className="block text-xs font-medium text-slate mb-1">
                {t('repair.enterPickupCode')}
              </label>
              <input
                id="pickup-code-input"
                type="text"
                inputMode="numeric"
                maxLength={8}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setErrorMsg(null);
                }}
                placeholder="4-digit code"
                className="w-full h-12 px-3 text-center text-xl font-bold font-tabular tracking-widest rounded-control border border-line bg-surface text-ink focus:outline-hidden focus:ring-2 focus:ring-ember/20 focus:border-ember"
                autoFocus
              />
              <p className="text-xs text-slate mt-1">{t('repair.handoverPrompt')}</p>
            </div>
          )}

          {/* Owner Override Option */}
          {isOwner && (
            <div className="pt-2 border-t border-line">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate hover:text-ink">
                <input
                  type="checkbox"
                  checked={override}
                  onChange={(e) => {
                    setOverride(e.target.checked);
                    setErrorMsg(null);
                  }}
                  className="rounded-xs border-line text-ember focus:ring-ember"
                />
                <span className="font-medium text-slate">{t('repair.ownerOverride')}</span>
              </label>
              {override && (
                <p className="text-xs text-amber-600 mt-1 pl-5">
                  {t('repair.overrideConfirm')}
                </p>
              )}
            </div>
          )}

          {errorMsg && (
            <div className="p-2.5 rounded-control bg-red-500/10 border border-red-500/20 text-xs text-red-600 font-medium">
              {errorMsg}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 px-4 text-xs font-semibold rounded-control border border-line text-slate hover:text-ink transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || isUnpaidWithoutSettleLater}
              className="flex-1 h-11 px-4 text-xs font-semibold rounded-control bg-ember text-on-ember hover:bg-ember/90 disabled:opacity-50 transition-colors"
            >
              {submitting ? '...' : t('repair.completeHandover')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
