'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useApp } from '../../lib/session';
import type { MessageKey } from '../../i18n/en';
import {
  fetchShopMemory,
  saveShopMemory,
  deleteShopMemory,
  clearShopMemory,
  type ShopMemoryRow,
} from '../../lib/memoryApi';
import { SkeletonRow } from '../../components/Skeleton';

export default function MemoryPage() {
  const { t, shop, role, showToast } = useApp();
  const [items, setItems] = useState<ShopMemoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  // New Memory Form State
  const [kind, setKind] = useState<'alias' | 'preference' | 'fact'>('alias');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const loadMemory = useCallback(async () => {
    if (!shop) return;
    try {
      const data = await fetchShopMemory(shop.id);
      setItems(data);
    } catch {
      // Offline or error
    } finally {
      setLoading(false);
    }
  }, [shop]);

  useEffect(() => {
    loadMemory();
  }, [loadMemory]);

  // Only owner can view/manage memory
  if (role !== 'owner') {
    return (
      <main className="p-4 max-w-lg mx-auto space-y-4">
        <h1 className="text-xl font-bold text-ink">{t('memory.title')}</h1>
        <p className="text-sm text-slate">{t('rep.ownerOnly')}</p>
        <Link href="/" className="text-sm text-ember underline font-medium">
          {t('common.back')}
        </Link>
      </main>
    );
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !value.trim() || !shop) return;
    setSaving(true);

    try {
      await saveShopMemory(shop.id, {
        kind,
        key,
        value,
      });
      showToast(t('memory.savedSuccess'));
      setKey('');
      setValue('');
      await loadMemory();
    } catch (_err: unknown) {
      showToast(t('memory.safetyError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteShopMemory(id);
      showToast(t('memory.deletedSuccess'));
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch {
      showToast('Failed to delete item');
    }
  };

  const handleClearAll = async () => {
    if (!shop) return;
    try {
      await clearShopMemory(shop.id);
      showToast(t('memory.clearSuccess'));
      setItems([]);
      setConfirmClear(false);
    } catch {
      showToast('Failed to clear memory');
    }
  };

  return (
    <main className="p-4 max-w-lg mx-auto pb-24 space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink flex items-center gap-2">
            <span>🧠</span> {t('memory.title')}
          </h1>
          <p className="text-xs text-slate mt-0.5">{t('memory.subtitle')}</p>
        </div>
        <Link
          href="/more"
          className="text-xs px-2.5 py-1.5 border border-line rounded-lg text-slate hover:text-ink font-medium transition-colors"
        >
          {t('common.back')}
        </Link>
      </div>

      {/* Add Memory Form */}
      <div className="p-4 bg-surface border border-line rounded-2xl shadow-card space-y-3">
        <h2 className="text-sm font-bold text-ink">{t('memory.addTitle')}</h2>
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="flex gap-2">
            {(['alias', 'preference', 'fact'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`flex-1 py-1 text-xs rounded-lg border font-medium capitalize transition-all ${
                  kind === k
                    ? 'border-ember bg-ember-soft text-ember'
                    : 'border-line bg-surface text-slate hover:bg-slate-50'
                }`}
              >
                {t(`memory.${k}` as MessageKey)}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <div>
              <label className="block text-xs font-semibold text-slate mb-1">
                {kind === 'alias' ? 'Item Nickname' : t('memory.key')}
              </label>
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value.slice(0, 80))}
                placeholder={kind === 'alias' ? 'e.g. shiro' : 'e.g. rush hour'}
                required
                className="w-full px-3 py-2 text-sm bg-surface border border-line rounded-xl focus:border-ember focus:ring-1 focus:ring-ember outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate mb-1">
                {kind === 'alias' ? 'Catalog Item Name' : t('memory.value')}
              </label>
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value.slice(0, 300))}
                placeholder={kind === 'alias' ? 'e.g. Shiro wet with injera' : 'e.g. Friday lunch is our busiest time'}
                required
                className="w-full px-3 py-2 text-sm bg-surface border border-line rounded-xl focus:border-ember focus:ring-1 focus:ring-ember outline-hidden"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving || !key.trim() || !value.trim()}
            className="w-full py-2.5 bg-ember text-on-ember font-semibold rounded-xl hover:bg-ember-rich disabled:opacity-50 transition-all text-sm"
          >
            {saving ? t('common.saving') : t('memory.addBtn')}
          </button>
        </form>
      </div>

      {/* Memory Items List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink">
            Saved Memory Items ({items.length}/200)
          </h2>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="text-xs text-ember hover:underline font-semibold"
            >
              {t('memory.clearAll')}
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : items.length === 0 ? (
          <div className="p-6 text-center border border-dashed border-line rounded-2xl bg-surface">
            <p className="text-sm text-slate">{t('memory.empty')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="p-3 bg-surface border border-line rounded-xl flex items-center justify-between gap-3 shadow-xs"
              >
                <div className="space-y-0.5 flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-md bg-slate-100 text-slate">
                      {item.kind}
                    </span>
                    <span className="font-semibold text-sm text-ink truncate">
                      &quot;{item.key}&quot;
                    </span>
                  </div>
                  <p className="text-xs text-slate truncate">↳ {item.value}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  className="p-2 text-slate hover:text-ember transition-colors rounded-lg hover:bg-slate-50"
                  aria-label={t('memory.delete')}
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Clear All Confirmation Modal */}
      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-surface p-5 rounded-2xl shadow-sheet space-y-4">
            <h3 className="text-base font-bold text-ink">{t('memory.clearAll')}</h3>
            <p className="text-xs text-slate">{t('memory.clearConfirm')}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="flex-1 py-2 text-xs border border-line rounded-xl text-slate hover:text-ink font-semibold"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="flex-1 py-2 text-xs bg-red-600 text-white rounded-xl hover:bg-red-700 font-semibold"
              >
                {t('common.undo')} / Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
