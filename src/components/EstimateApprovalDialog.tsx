'use client';

import React, { useState } from 'react';
import { useApp } from '../lib/session';
import type { LocalOrder, LocalRepairJob } from '../lib/db';
import { queueApproveEstimate } from '../lib/sync';

interface EstimateApprovalDialogProps {
  order: LocalOrder;
  repairJob?: LocalRepairJob | null;
  currentTotal: number;
  isOpen: boolean;
  onClose: () => void;
  onEstimateApproved?: () => void;
}

export function EstimateApprovalDialog({
  order,
  repairJob,
  currentTotal,
  isOpen,
  onClose,
  onEstimateApproved,
}: EstimateApprovalDialogProps) {
  const { t, showToast, shop } = useApp();
  const [amountStr, setAmountStr] = useState<string>(
    repairJob?.approved_total ? repairJob.approved_total.toString() : currentTotal.toString()
  );
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(amountStr) || 0;
    if (amount < 0) return;

    setSubmitting(true);
    try {
      await queueApproveEstimate(order.shop_id, order.id, amount);
      showToast(t('repair.estimateSuccess'));
      if (onEstimateApproved) onEstimateApproved();
      onClose();
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
        aria-labelledby="estimate-approval-title"
      >
        <div className="flex items-center justify-between pb-3 border-b border-line mb-4">
          <h2 id="estimate-approval-title" className="text-lg font-bold font-heading text-ink">
            {t('repair.approveEstimateTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate hover:text-ink rounded-full transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-3 bg-paper rounded-control text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-slate">Current Order Total:</span>
              <span className="font-semibold font-tabular text-ink">
                {shop?.currency || 'ETB'} {currentTotal.toFixed(2)}
              </span>
            </div>
            {repairJob?.approved_total != null && (
              <div className="flex justify-between">
                <span className="text-slate">{t('repair.approvedEstimate')}:</span>
                <span className="font-semibold font-tabular text-slate">
                  {shop?.currency || 'ETB'} {repairJob.approved_total.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="approved-amount" className="block text-xs font-medium text-slate mb-1">
              {t('repair.estimateAmount')} ({shop?.currency || 'ETB'})
            </label>
            <input
              id="approved-amount"
              type="number"
              step="0.01"
              min="0"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="w-full h-12 px-3 rounded-control border border-line bg-surface text-lg font-bold font-tabular text-ink focus:outline-hidden focus:ring-2 focus:ring-ember/20 focus:border-ember"
              required
              autoFocus
            />
          </div>

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
              disabled={submitting}
              className="flex-1 h-11 px-4 text-xs font-semibold rounded-control bg-ember text-on-ember hover:bg-ember/90 transition-colors"
            >
              {submitting ? '...' : t('repair.approveEstimate')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
