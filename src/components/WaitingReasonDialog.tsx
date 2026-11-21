'use client';

import React, { useState } from 'react';
import { useApp } from '../lib/session';
import type { LocalOrder, LocalRepairJob } from '../lib/db';
import { queueSetWaitingReason } from '../lib/sync';
import type { WaitingReasonKey } from '../domain/repair';
import type { MessageKey } from '../i18n/en';

interface WaitingReasonDialogProps {
  order: LocalOrder;
  repairJob?: LocalRepairJob | null;
  isOpen: boolean;
  onClose: () => void;
  onReasonSaved?: () => void;
}

export function WaitingReasonDialog({
  order,
  repairJob,
  isOpen,
  onClose,
  onReasonSaved,
}: WaitingReasonDialogProps) {
  const { t, showToast } = useApp();
  const [reason, setReason] = useState<WaitingReasonKey>(
    (repairJob?.waiting_reason as WaitingReasonKey) || 'waiting_parts'
  );
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const reasons: { key: WaitingReasonKey; labelKey: MessageKey }[] = [
    { key: 'waiting_parts', labelKey: 'repair.waitingParts' },
    { key: 'waiting_approval', labelKey: 'repair.waitingApproval' },
    { key: 'waiting_payment', labelKey: 'repair.waitingPayment' },
    { key: 'waiting_device_info', labelKey: 'repair.waitingDeviceInfo' },
    { key: 'other', labelKey: 'repair.waitingOther' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await queueSetWaitingReason(order.shop_id, order.id, reason);
      showToast('Waiting reason updated');
      if (onReasonSaved) onReasonSaved();
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
        aria-labelledby="waiting-reason-title"
      >
        <div className="flex items-center justify-between pb-3 border-b border-line mb-4">
          <h2 id="waiting-reason-title" className="text-lg font-bold font-heading text-ink">
            {t('repair.waitingReason')}
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
          <div className="space-y-2">
            {reasons.map((r) => {
              const isSelected = reason === r.key;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setReason(r.key)}
                  className={`w-full text-left p-3 rounded-control border text-xs font-medium transition-all ${
                    isSelected
                      ? 'border-[#6B4BC4] bg-[#6B4BC4]/10 text-[#6B4BC4] font-semibold'
                      : 'border-line bg-surface text-slate hover:text-ink'
                  }`}
                >
                  {t(r.labelKey)}
                </button>
              );
            })}
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
              {submitting ? '...' : 'Save Reason'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
