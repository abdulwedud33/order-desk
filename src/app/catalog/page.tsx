'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useApp } from '../../lib/session';
import { db, type LocalCatalogItem, type LocalCategory } from '../../lib/db';
import { pullCatalog } from '../../lib/sync';
import { supabase } from '../../lib/supabase';
import { SkeletonRow } from '../../components/Skeleton';

export default function CatalogPage() {
  const { t, role, shop, showToast, errorText } = useApp();
  const [categories, setCategories] = useState<LocalCategory[]>([]);
  const [items, setItems] = useState<LocalCatalogItem[]>([]);
  const [selectedCat, setSelectedCat] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // Quick Add Form fields (3 fields per FR-C2)
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isOwner = role === 'owner';

  const loadData = useCallback(async () => {
    if (!shop || !db) return;
    try {
      const localCats = await db.categories.where('shop_id').equals(shop.id).sortBy('sort');
      const localItems = await db.items.where('shop_id').equals(shop.id).toArray();
      setCategories(localCats);
      setItems(localItems);
    } catch {}
    setLoading(false);
  }, [shop]);

  useEffect(() => {
    if (!shop) return;
    loadData();
    pullCatalog(shop.id).then(loadData).catch(() => {});
  }, [shop, loadData]);

  const filteredItems = useMemo(() => {
    if (selectedCat === 'all') return items;
    return items.filter((i) => i.category_id === selectedCat);
  }, [items, selectedCat]);

  const handleToggleAvailable = async (item: LocalCatalogItem) => {
    if (!isOwner || !shop) return;
    const newStatus = !item.available;

    // Optimistic local update
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, available: newStatus } : i))
    );
    if (db) {
      await db.items.update(item.id, { available: newStatus });
    }

    try {
      const { error } = await supabase
        .from('catalog_items')
        .update({ available: newStatus })
        .eq('id', item.id)
        .eq('shop_id', shop.id);

      if (error) throw error;
      showToast(newStatus ? t('catalog.available') : t('catalog.unavailable'));
    } catch (err) {
      // Rollback on failure
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, available: !newStatus } : i))
      );
      if (db) {
        await db.items.update(item.id, { available: !newStatus });
      }
      showToast(errorText(err));
    }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner || !shop) return;

    const numericPrice = parseFloat(price);
    if (!name.trim() || isNaN(numericPrice) || numericPrice < 0) return;

    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from('catalog_items')
        .insert({
          shop_id: shop.id,
          name: name.trim(),
          price: numericPrice,
          category_id: categoryId || null,
          available: true,
        })
        .select()
        .single();

      if (error) throw error;

      if (data && db) {
        await db.items.put(data as LocalCatalogItem);
      }
      showToast(t('catalog.addItem'));
      setName('');
      setPrice('');
      setCategoryId('');
      setShowAddModal(false);
      await loadData();
    } catch (err) {
      showToast(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen pb-24 max-w-lg mx-auto bg-paper">
      {/* Header */}
      <header className="p-4 bg-surface border-b border-line flex justify-between items-center sticky top-0 z-30">
        <h1 className="text-xl font-bold font-heading text-ink">{t('catalog.title')}</h1>
        {isOwner && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="px-3.5 py-1.5 bg-ember text-on-ember rounded-control text-xs font-semibold shadow-sm active:opacity-90"
          >
            + {t('catalog.addItem')}
          </button>
        )}
      </header>

      {/* Category Pills */}
      <div className="flex gap-2 p-3 overflow-x-auto bg-surface/50 border-b border-line no-scrollbar">
        <button
          type="button"
          onClick={() => setSelectedCat('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
            selectedCat === 'all'
              ? 'bg-ember text-on-ember'
              : 'bg-surface border border-line text-slate hover:text-ink'
          }`}
        >
          {t('catalog.allCategories')}
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setSelectedCat(c.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              selectedCat === c.id
                ? 'bg-ember text-on-ember'
                : 'bg-surface border border-line text-slate hover:text-ink'
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Item List */}
      <div className="p-4 space-y-2.5">
        {loading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate bg-surface rounded-ticket border border-line">
            {t('catalog.empty')}
          </div>
        ) : (
          filteredItems.map((item) => (
            <div
              key={item.id}
              className={`p-3.5 bg-surface border rounded-ticket flex items-center justify-between transition-colors ${
                item.available ? 'border-line' : 'border-line/60 bg-surface/60 opacity-75'
              }`}
            >
              <div className="flex-1 mr-3">
                <div className="font-semibold text-sm text-ink">{item.name}</div>
                <div className="text-sm font-heading font-semibold text-slate num mt-0.5">
                  {item.price.toFixed(2)} ETB
                </div>
              </div>

              {isOwner ? (
                <button
                  type="button"
                  onClick={() => handleToggleAvailable(item)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-all active:scale-95 ${
                    item.available
                      ? 'bg-st-ready/15 text-st-ready border border-st-ready/30'
                      : 'bg-slate/15 text-slate border border-line'
                  }`}
                >
                  {item.available ? t('catalog.available') : t('catalog.unavailable')}
                </button>
              ) : (
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    item.available ? 'text-st-ready bg-st-ready/10' : 'text-slate bg-line'
                  }`}
                >
                  {item.available ? t('catalog.available') : t('catalog.unavailable')}
                </span>
              )}
            </div>
          ))
        )}
      </div>

      {/* Quick Add Modal (3 Fields) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-end sm:items-center justify-center p-0 sm:p-4 fade-in">
          <div className="bg-surface rounded-t-sheet sm:rounded-ticket w-full max-w-md p-6 space-y-4 shadow-sheet">
            <div className="flex justify-between items-center border-b border-line pb-3">
              <h2 className="text-lg font-bold font-heading text-ink">{t('catalog.addItem')}</h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate hover:text-ink font-semibold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddItem} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate mb-1">
                  1. {t('catalog.name')}
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Doro Wet, Screen Glass"
                  className="w-full h-12 px-3 rounded-control border border-line bg-surface text-ink text-sm focus:outline-none focus:border-ember"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate mb-1">
                  2. {t('catalog.price')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full h-12 px-3 rounded-control border border-line bg-surface text-ink text-sm num focus:outline-none focus:border-ember"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate mb-1">
                  3. {t('catalog.category')}
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full h-12 px-3 rounded-control border border-line bg-surface text-ink text-sm focus:outline-none focus:border-ember"
                >
                  <option value="">(No Category)</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 h-12 bg-surface border border-line rounded-control font-semibold text-sm text-ink"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 h-12 bg-ember text-on-ember rounded-control font-semibold text-sm active:opacity-90 disabled:opacity-50"
                >
                  {submitting ? t('common.loading') : t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
