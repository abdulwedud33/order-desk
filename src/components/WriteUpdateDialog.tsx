'use client';

import { useState } from 'react';
import { useApp } from '../lib/session';
import { draftStatusUpdate } from '../lib/aiApi';
import type { LocalOrder } from '../lib/db';

interface WriteUpdateDialogProps {
  order: LocalOrder;
  isOpen: boolean;
  onClose: () => void;
}

export function WriteUpdateDialog({ order, isOpen, onClose }: WriteUpdateDialogProps) {
  const { t, shop, showToast, errorText, locale } = useApp();
  const [reason, setReason] = useState<'ready' | 'delayed' | 'needs_approval'>('ready');
  const [tone, setTone] = useState<'friendly' | 'direct' | 'formal'>('friendly');
  const [minutesDelayed, setMinutesDelayed] = useState(15);
  const [draftedMessage, setDraftedMessage] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const orderCode = order.order_code || order.temp_ref;

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const res = await draftStatusUpdate({
        orderId: order.id,
        orderCode,
        status: order.status,
        reason,
        tone,
        minutesDelayed: reason === 'delayed' ? minutesDelayed : undefined,
        locale: (locale as 'en' | 'am' | 'om') || 'en',
        shopName: shop?.name || 'Order Desk',
        dueTime: order.due_at || undefined,
      });
      setDraftedMessage(res.draft_text);
    } catch {
      showToast(errorText('UPDATE_DRAFT_FAILED'));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!draftedMessage) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(draftedMessage);
      showToast(t('ai.messageCopied'));
    }
  };

  const handleShare = async () => {
    if (!draftedMessage) return;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `Update on Order ${orderCode}`,
          text: draftedMessage,
        });
        return;
      } catch {
        // Fall back to copy
      }
    }
    handleCopy();
  };

  const wordCount = draftedMessage.trim() ? draftedMessage.trim().split(/\s+/).length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-xs">
      <div
        className="w-full max-w-md bg-surface rounded-2xl shadow-sheet overflow-hidden animate-in fade-in-50 zoom-in-95"
        role="dialog"
        aria-modal="true"
        aria-labelledby="write-update-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div>
            <h2 id="write-update-title" className="text-base font-bold text-ink flex items-center gap-1.5">
              <span>💬</span> {t('ai.statusDraftTitle')}
            </h2>
            <p className="text-xs text-slate">Order #{orderCode}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate hover:text-ink rounded-lg hover:bg-slate-50 transition-colors"
            aria-label={t('common.cancel')}
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <div className="p-4 space-y-4">
          {/* Reason Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate mb-1">
              {t('ai.reason')}
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'ready', label: t('ai.reasonReady') },
                  { id: 'delayed', label: t('ai.reasonDelayed') },
                  { id: 'needs_approval', label: t('ai.reasonWaitingApproval') },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setReason(opt.id)}
                  className={`py-2 px-1 text-xs rounded-xl border text-center font-medium transition-all ${
                    reason === opt.id
                      ? 'border-ember bg-ember-soft text-ember'
                      : 'border-line bg-surface text-slate hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Delay Minutes (conditional) */}
          {reason === 'delayed' && (
            <div>
              <label className="block text-xs font-semibold text-slate mb-1">
                {t('ai.delayMinutes')}
              </label>
              <div className="flex gap-2">
                {[5, 10, 15, 30, 45].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setMinutesDelayed(mins)}
                    className={`flex-1 py-1 text-xs rounded-lg border font-semibold ${
                      minutesDelayed === mins
                        ? 'border-amber-500 bg-amber-50 text-amber-800'
                        : 'border-line bg-surface text-slate hover:bg-slate-50'
                    }`}
                  >
                    +{mins}m
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tone Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate mb-1">
              {t('ai.tone')}
            </label>
            <div className="flex gap-2">
              {(
                [
                  { id: 'friendly', label: t('ai.toneFriendly') },
                  { id: 'direct', label: t('ai.toneDirect') },
                  { id: 'formal', label: t('ai.toneFormal') },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTone(opt.id)}
                  className={`flex-1 py-1.5 text-xs rounded-xl border font-medium ${
                    tone === opt.id
                      ? 'border-ember bg-ember-soft text-ember'
                      : 'border-line bg-surface text-slate hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Generate Draft Button */}
          {!draftedMessage && (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className="w-full py-2.5 bg-ember text-on-ember font-semibold rounded-xl hover:bg-ember-rich disabled:opacity-50 transition-all text-sm flex items-center justify-center gap-1.5"
            >
              <span>✨</span>
              <span>{loading ? t('ai.drafting') : t('ai.generateDraft')}</span>
            </button>
          )}

          {/* Draft Display */}
          {draftedMessage && (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate">
                Generated Message (Editable)
              </label>
              <textarea
                value={draftedMessage}
                onChange={(e) => setDraftedMessage(e.target.value)}
                rows={3}
                className="w-full p-2.5 text-sm bg-slate-50 border border-line rounded-xl focus:border-ember focus:ring-1 focus:ring-ember outline-hidden"
              />
              <div className="flex justify-between items-center text-xs text-slate">
                <span>Safe message: no money or phone leaked</span>
                <span className={wordCount > 60 ? 'text-ember font-bold' : ''}>
                  {wordCount}/60 words
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={loading}
                  className="py-2.5 px-3 border border-line bg-surface text-slate hover:text-ink font-semibold rounded-xl text-xs"
                >
                  Regenerate
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex-1 py-2.5 bg-surface border border-ember text-ember font-semibold rounded-xl hover:bg-ember-soft transition-colors text-xs flex items-center justify-center gap-1"
                >
                  <span>📋</span>
                  <span>{t('ai.copyMessage')}</span>
                </button>
                <button
                  type="button"
                  onClick={handleShare}
                  className="flex-1 py-2.5 bg-ember text-on-ember font-semibold rounded-xl hover:bg-ember-rich transition-colors text-xs flex items-center justify-center gap-1"
                >
                  <span>↗️</span>
                  <span>{t('ai.shareMessage')}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
