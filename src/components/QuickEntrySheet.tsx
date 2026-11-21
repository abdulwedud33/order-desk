'use client';

import { useState } from 'react';
import { useApp } from '../lib/session';
import { parseOrderWithAi, type ProposedDraft } from '../lib/aiApi';
import { saveShopMemory } from '../lib/memoryApi';
import { queueCreateOrder } from '../lib/sync';
import { calculateSuggestedDueAt, type OrderItemInput } from '../domain/orders';
import { SkeletonRow } from './Skeleton';
import type { OrderChannel } from '../domain/status';
import type { MessageKey } from '../i18n/en';

interface QuickEntrySheetProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderCreated?: (orderId: string) => void;
}

export function QuickEntrySheet({ isOpen, onClose, onOrderCreated }: QuickEntrySheetProps) {
  const { t, shop, showToast, errorText } = useApp();
  const [rawText, setRawText] = useState('');
  const [channel, setChannel] = useState<OrderChannel>('telegram');
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<ProposedDraft | null>(null);
  const [memorySuggestion, setMemorySuggestion] = useState<{
    kind: 'alias';
    key: string;
    ref_id: string;
    item_name: string;
  } | null>(null);
  const [clarification, setClarification] = useState<string | null>(null);
  const [savingMemory, setSavingMemory] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (!isOpen) return null;

  const handleParse = async () => {
    if (!rawText.trim() || !shop) return;
    setParsing(true);
    setClarification(null);
    setMemorySuggestion(null);

    try {
      const result = await parseOrderWithAi({
        message: rawText,
        channel,
        shopId: shop.id,
      });

      setDraft(result.draft);
      if (result.memory_suggestion) {
        setMemorySuggestion(result.memory_suggestion);
      }
      if (result.clarification) {
        setClarification(result.clarification);
      }
    } catch (_err: unknown) {
      showToast(errorText('PARSE_FAILED'));
    } finally {
      setParsing(false);
    }
  };

  const handleSaveMemory = async () => {
    if (!memorySuggestion || !shop) return;
    setSavingMemory(true);
    try {
      await saveShopMemory(shop.id, {
        kind: 'alias',
        key: memorySuggestion.key,
        value: memorySuggestion.item_name,
        ref_id: memorySuggestion.ref_id,
      });
      showToast(t('ai.rememberedSuccess'));
      setMemorySuggestion(null);
    } catch {
      showToast(t('memory.safetyError'));
    } finally {
      setSavingMemory(false);
    }
  };

  const handleConfirmOrder = async () => {
    if (!draft || !shop) return;
    setConfirming(true);

    try {
      const orderId = crypto.randomUUID();
      const prepMinutes = draft.items.map((i) => i.prep_minutes || 15);
      const suggestedDue = calculateSuggestedDueAt(new Date(), prepMinutes);

      const itemsInput: OrderItemInput[] = draft.items.map((it) => ({
        itemId: it.item_id || undefined,
        name: it.name,
        qty: it.qty,
        price: it.unit_price,
        note: it.note || undefined,
        prepMinutes: it.prep_minutes,
      }));

      const newOrder = await queueCreateOrder({
        id: orderId,
        shopId: shop.id,
        type: draft.type,
        channel: draft.channel,
        label: draft.label || undefined,
        note: draft.note || undefined,
        dueAt: suggestedDue.toISOString(),
        items: itemsInput,
        deliveryFee: draft.delivery_fee,
        contact:
          draft.customer_phone || draft.address
            ? {
                phone: draft.customer_phone || undefined,
                address: draft.address || undefined,
              }
            : undefined,
      });

      showToast(t('orders.createSuccess'));
      if (onOrderCreated) {
        onOrderCreated(newOrder.id);
      }
      handleDiscard();
    } catch {
      showToast(errorText('CREATE_FAILED'));
    } finally {
      setConfirming(false);
    }
  };

  const handleDiscard = () => {
    setRawText('');
    setDraft(null);
    setMemorySuggestion(null);
    setClarification(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40 p-0 sm:p-4 backdrop-blur-xs">
      <div
        className="w-full max-w-lg bg-surface rounded-t-2xl sm:rounded-2xl shadow-sheet max-h-[90vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-entry-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div>
            <h2 id="quick-entry-title" className="text-base font-bold text-ink flex items-center gap-1.5">
              <span>✨</span> {t('ai.quickEntryTitle')}
            </h2>
            <p className="text-xs text-slate">{t('ai.quickEntryDesc')}</p>
          </div>
          <button
            type="button"
            onClick={handleDiscard}
            className="p-1.5 text-slate hover:text-ink rounded-lg hover:bg-slate-50 transition-colors"
            aria-label={t('common.cancel')}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!draft ? (
            <div className="space-y-3">
              {/* Channel Selector */}
              <div>
                <label className="block text-xs font-medium text-slate mb-1">
                  {t('orders.channel')}
                </label>
                <div className="flex gap-2">
                  {(['telegram', 'whatsapp', 'phone', 'walk_in'] as const).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setChannel(ch)}
                      className={`flex-1 py-1.5 text-xs rounded-lg border font-medium capitalize transition-all ${
                        channel === ch
                          ? 'border-ember bg-ember-soft text-ember'
                          : 'border-line bg-surface text-slate hover:bg-slate-50'
                      }`}
                    >
                      {ch.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message Textarea */}
              <div>
                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value.slice(0, 600))}
                  placeholder={t('ai.pastePlaceholder')}
                  rows={5}
                  className="w-full p-3 text-sm bg-surface border border-line rounded-xl focus:border-ember focus:ring-1 focus:ring-ember outline-hidden resize-none placeholder:text-slate-400"
                  aria-label={t('ai.quickEntryTitle')}
                  autoFocus
                />
                <div className="flex justify-between items-center text-xs text-slate mt-1">
                  <span>Phone numbers are automatically redacted for privacy</span>
                  <span>{rawText.length}/600</span>
                </div>
              </div>

              {parsing ? (
                <div className="space-y-2 py-4">
                  <p className="text-xs font-medium text-ember animate-pulse text-center">
                    {t('ai.parsing')}
                  </p>
                  <SkeletonRow />
                  <SkeletonRow />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleParse}
                  disabled={!rawText.trim()}
                  className="w-full py-3 bg-ember text-on-ember font-semibold rounded-xl hover:bg-ember-rich disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  <span>✨</span>
                  <span>{t('ai.quickEntry')}</span>
                </button>
              )}
            </div>
          ) : (
            /* Draft Review Card (Confirm/Discard per guardrails) */
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 border border-line rounded-xl space-y-3">
                <div className="flex items-center justify-between border-b border-line/60 pb-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-ember">
                    {t('ai.draftTitle')}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate font-medium capitalize">
                    {t(`order.${draft.type}` as MessageKey) || draft.type}
                  </span>
                </div>

                {/* Items List */}
                <div className="space-y-2">
                  {draft.items.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-md bg-surface border border-line flex items-center justify-center font-bold text-xs text-ink">
                          {item.qty}×
                        </span>
                        <span className="font-medium text-ink">{item.name}</span>
                      </div>
                      <span className="font-semibold text-ink">
                        {item.line_total} {shop?.currency || 'ETB'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Totals */}
                <div className="border-t border-line/60 pt-2 space-y-1 text-xs">
                  <div className="flex justify-between text-slate">
                    <span>{t('orders.subtotal')}</span>
                    <span>{draft.subtotal} {shop?.currency || 'ETB'}</span>
                  </div>
                  {draft.delivery_fee > 0 && (
                    <div className="flex justify-between text-slate">
                      <span>{t('orders.deliveryFee')}</span>
                      <span>{draft.delivery_fee} {shop?.currency || 'ETB'}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold text-ink pt-1 border-t border-line/40">
                    <span>{t('orders.total')}</span>
                    <span>{draft.total} {shop?.currency || 'ETB'}</span>
                  </div>
                </div>

                {/* Contact info if present */}
                {(draft.customer_phone || draft.address) && (
                  <div className="border-t border-line/60 pt-2 text-xs text-slate space-y-0.5">
                    {draft.customer_phone && (
                      <p>
                        <span className="font-medium text-ink">Phone:</span> {draft.customer_phone}
                      </p>
                    )}
                    {draft.address && (
                      <p>
                        <span className="font-medium text-ink">Address:</span> {draft.address}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Clarification Alert */}
              {clarification && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                  {t('ai.clarificationNeeded', { question: clarification })}
                </div>
              )}

              {/* Memory Suggestion ("Remember this?") */}
              {memorySuggestion && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-2 text-xs">
                  <span className="text-emerald-950">
                    {t('ai.rememberSuggestion', {
                      key: memorySuggestion.key,
                      item: memorySuggestion.item_name,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={handleSaveMemory}
                    disabled={savingMemory}
                    className="px-2.5 py-1 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                  >
                    {t('ai.rememberAction')}
                  </button>
                </div>
              )}

              {/* Confirm / Discard Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleDiscard}
                  disabled={confirming}
                  className="flex-1 py-2.5 border border-line bg-surface text-slate hover:text-ink font-semibold rounded-xl transition-colors text-sm"
                >
                  {t('ai.discard')}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmOrder}
                  disabled={confirming}
                  className="flex-2 py-2.5 bg-ember text-on-ember font-semibold rounded-xl hover:bg-ember-rich transition-colors text-sm flex items-center justify-center gap-1.5"
                >
                  <span>✓</span>
                  <span>{t('ai.confirmOrder')}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
