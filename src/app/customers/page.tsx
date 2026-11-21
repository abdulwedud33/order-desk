'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useApp } from '../../lib/session';
import { db, type LocalCustomer } from '../../lib/db';
import { pullCustomers } from '../../lib/sync';
import { searchCustomers } from '../../domain/search';
import { supabase } from '../../lib/supabase';
import { SkeletonRow } from '../../components/Skeleton';

export default function CustomersPage() {
  const { t, role, shop, showToast, errorText } = useApp();
  const [customers, setCustomers] = useState<LocalCustomer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // Quick Add Customer fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Security: Kitchen and Courier roles have ZERO access to customers table
  const isRestricted = role === 'kitchen' || role === 'courier';

  const loadData = useCallback(async () => {
    if (!shop || !db) return;
    try {
      const localCusts = await db.customers.where('shop_id').equals(shop.id).toArray();
      setCustomers(localCusts);
    } catch {}
    setLoading(false);
  }, [shop]);

  useEffect(() => {
    if (!shop || isRestricted) {
      setLoading(false);
      return;
    }
    loadData();
    pullCustomers(shop.id).then(loadData).catch(() => {});
  }, [shop, isRestricted, loadData]);

  const searchResults = useMemo(() => {
    if (searchQuery.trim().length < 2) {
      return customers.slice(0, 20); // Display recent customers by default
    }
    return searchCustomers(searchQuery, customers);
  }, [searchQuery, customers]);

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRestricted || !shop) return;
    if (!name.trim()) return;

    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from('customers')
        .insert({
          shop_id: shop.id,
          name: name.trim(),
          phone: phone.trim() || null,
          note: note.trim() || null,
        })
        .select()
        .single();

      if (error) throw error;

      if (data && db) {
        await db.customers.put(data as LocalCustomer);
      }
      showToast(t('customers.addCustomer'));
      setName('');
      setPhone('');
      setNote('');
      setShowAddModal(false);
      await loadData();
    } catch (err) {
      showToast(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (isRestricted) {
    return (
      <main className="min-h-screen p-8 text-center flex flex-col justify-center items-center max-w-md mx-auto">
        <p className="text-late text-sm font-semibold">{t('err.FORBIDDEN')}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-24 max-w-lg mx-auto bg-paper">
      {/* Header */}
      <header className="p-4 bg-surface border-b border-line flex justify-between items-center sticky top-0 z-30">
        <h1 className="text-xl font-bold font-heading text-ink">{t('customers.title')}</h1>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="px-3.5 py-1.5 bg-ember text-on-ember rounded-control text-xs font-semibold shadow-sm active:opacity-90"
        >
          + {t('customers.addCustomer')}
        </button>
      </header>

      {/* Search Bar */}
      <div className="p-4 bg-surface border-b border-line">
        <div className="relative">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('customers.searchPlaceholder')}
            className="w-full h-12 pl-10 pr-4 rounded-control border border-line bg-surface text-ink text-sm focus:outline-none focus:border-ember"
          />
          <span className="absolute left-3.5 top-3.5 text-slate text-sm">🔍</span>
        </div>
        {searchQuery.trim().length === 1 && (
          <p className="text-xs text-slate mt-2">{t('customers.searchPrompt')}</p>
        )}
      </div>

      {/* Customers List */}
      <div className="p-4 space-y-2">
        {loading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : searchResults.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate bg-surface rounded-ticket border border-line">
            {t('customers.empty')}
          </div>
        ) : (
          searchResults.map((cust) => (
            <div
              key={cust.id}
              className="p-3.5 bg-surface border border-line rounded-ticket flex justify-between items-center"
            >
              <div>
                <div className="font-semibold text-sm text-ink">{cust.name}</div>
                {cust.phone && (
                  <div className="text-xs text-slate num font-mono mt-0.5">{cust.phone}</div>
                )}
                {cust.note && (
                  <div className="text-xs text-slate italic mt-1">{cust.note}</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Customer Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-end sm:items-center justify-center p-0 sm:p-4 fade-in">
          <div className="bg-surface rounded-t-sheet sm:rounded-ticket w-full max-w-md p-6 space-y-4 shadow-sheet">
            <div className="flex justify-between items-center border-b border-line pb-3">
              <h2 className="text-lg font-bold font-heading text-ink">{t('customers.addCustomer')}</h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate hover:text-ink font-semibold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddCustomer} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate mb-1">
                  {t('customers.name')}
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Almaz Bekele"
                  className="w-full h-12 px-3 rounded-control border border-line bg-surface text-ink text-sm focus:outline-none focus:border-ember"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate mb-1">
                  {t('customers.phone')}
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="09..."
                  className="w-full h-12 px-3 rounded-control border border-line bg-surface text-ink text-sm num focus:outline-none focus:border-ember"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate mb-1">
                  {t('customers.note')}
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Address, preferences"
                  className="w-full h-12 px-3 rounded-control border border-line bg-surface text-ink text-sm focus:outline-none focus:border-ember"
                />
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
