'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/session';
import { db, type LocalCatalogItem, type LocalCustomer } from '../../../lib/db';
import { queueCreateOrder } from '../../../lib/sync';
import {
  suggestPromisedMinutes,
  calculateSuggestedDueAt,
  findDuplicateOrder,
  type OrderItemInput,
  type ExistingOrderSnapshot,
} from '../../../domain/orders';
import { searchCustomers } from '../../../domain/search';
import { SkeletonRow } from '../../../components/Skeleton';
import type { OrderType, OrderChannel } from '../../../domain/status';
import type { MessageKey } from '../../../i18n/en';

export default function NewOrderPage() {
  const router = useRouter();
  const { t, shop, showToast, errorText } = useApp();

  // Order Details
  const [orderType, setOrderType] = useState<OrderType>('dine_in');
  const [label, setLabel] = useState('');
  const [channel, setChannel] = useState<OrderChannel>('walk_in');
  const [note, setNote] = useState('');
  const [extraMinutes, setExtraMinutes] = useState(0);

  // Items State
  const [catalogItems, setCatalogItems] = useState<LocalCatalogItem[]>([]);
  const [lines, setLines] = useState<OrderItemInput[]>([]);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [loadingItems, setLoadingItems] = useState(true);

  // Customer State
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<LocalCustomer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<LocalCustomer | null>(null);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  // Duplicate warning state
  const [duplicateOrder, setDuplicateOrder] = useState<ExistingOrderSnapshot | null>(null);
  const [ignoreDuplicate, setIgnoreDuplicate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Load catalog items & customers from local Dexie
  const loadLocalData = useCallback(async () => {
    if (!shop || !db) return;
    try {
      const items = await db.items.where('shop_id').equals(shop.id).toArray();
      const custs = await db.customers.where('shop_id').equals(shop.id).toArray();
      setCatalogItems(items.filter((i) => i.available));
      setCustomers(custs);
    } catch {}
    setLoadingItems(false);
  }, [shop]);

  useEffect(() => {
    loadLocalData();
    router.prefetch('/orders');
  }, [loadLocalData, router]);

  // Compute Promised Time based on items' prep minutes
  const prepMinutesList = useMemo(() => {
    return lines.map((l) => l.prepMinutes || 10);
  }, [lines]);

  const promisedDate = useMemo(() => {
    return calculateSuggestedDueAt(new Date(), prepMinutesList, extraMinutes);
  }, [prepMinutesList, extraMinutes]);

  // Customer search suggestions
  const customerSuggestions = useMemo(() => {
    if (customerSearch.trim().length < 2) return [];
    return searchCustomers(customerSearch, customers).slice(0, 5);
  }, [customerSearch, customers]);

  // Totals
  const subtotal = useMemo(() => {
    return lines.reduce((acc, l) => acc + (l.price ?? 0) * l.qty, 0);
  }, [lines]);

  const deliveryFee = orderType === 'delivery' ? (shop?.default_delivery_fee ?? 0) : 0;
  const total = subtotal + deliveryFee;

  // Add catalog item to lines
  const handleAddItem = (item: LocalCatalogItem) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) {
        return prev.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...prev,
        {
          itemId: item.id,
          name: item.name,
          qty: 1,
          price: item.price,
          prepMinutes: item.prep_minutes,
        },
      ];
    });
  };

  const handleUpdateQty = (idx: number, delta: number) => {
    setLines((prev) => {
      const updated = [...prev];
      const line = updated[idx];
      if (!line) return prev;
      const newQty = line.qty + delta;
      if (newQty <= 0) {
        return updated.filter((_, i) => i !== idx);
      }
      updated[idx] = { ...line, qty: newQty };
      return updated;
    });
  };

  const handleAddCustomItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) return;
    setLines((prev) => [
      ...prev,
      {
        name: customName.trim(),
        qty: 1,
        price: customPrice ? parseFloat(customPrice) : 0,
        prepMinutes: 10,
      },
    ]);
    setCustomName('');
    setCustomPrice('');
  };

  // Check Duplicate Order on phone or items change
  useEffect(() => {
    if (!db || !phone || lines.length === 0) {
      setDuplicateOrder(null);
      return;
    }

    db.orders
      .where('shop_id')
      .equals(shop?.id || '')
      .reverse()
      .limit(30)
      .toArray()
      .then(async (recentOrds) => {
        const snapshots: ExistingOrderSnapshot[] = await Promise.all(
          recentOrds.map(async (o) => {
            const ordItems = await db.order_items.where('order_id').equals(o.id).toArray();
            return {
              id: o.id,
              phone: o.customer_phone,
              items: ordItems.map((i) => ({ itemId: i.item_id, name: i.name })),
              createdAt: o.created_at,
            };
          })
        );

        const dup = findDuplicateOrder(
          phone,
          lines.map((l) => ({ itemId: l.itemId, name: l.name })),
          snapshots,
          new Date()
        );
        setDuplicateOrder(dup);
      })
      .catch(() => {});
  }, [phone, lines, shop]);

  const handleSubmitOrder = async () => {
    const shopId = shop?.id || '00000000-0000-0000-0000-000000000001';
    if (lines.length === 0) {
      showToast(t('err.VALIDATION'));
      return;
    }

    if (duplicateOrder && !ignoreDuplicate) {
      return; // show banner
    }

    setSubmitting(true);
    const orderId = crypto.randomUUID();

    try {
      await queueCreateOrder({
        id: orderId,
        shopId: shopId,
        type: orderType,
        label: label.trim() || undefined,
        channel,
        note: note.trim() || undefined,
        dueAt: promisedDate.toISOString(),
        items: lines,
        contact: phone.trim()
          ? {
              phone: phone.trim(),
              address: address.trim() || undefined,
            }
          : undefined,
        deliveryFee,
        customerId: selectedCustomer?.id,
      });

      showToast(t('orders.createSuccess'));
      router.push('/orders');
    } catch (err) {
      showToast(errorText(err));
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen pb-32 max-w-lg mx-auto bg-paper">
      {/* Header */}
      <header className="p-4 bg-surface border-b border-line flex justify-between items-center sticky top-0 z-30">
        <h1 className="text-xl font-bold font-heading text-ink">{t('orders.newOrder')}</h1>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-xs text-slate hover:text-ink font-medium px-2 py-1"
        >
          {t('common.cancel')}
        </button>
      </header>

      <div className="p-4 space-y-4">
        {/* Order Type Tabs */}
        <div>
          <label className="block text-xs font-semibold text-slate mb-1.5 uppercase tracking-wider">
            {t('orders.selectType')}
          </label>
          <div className="grid grid-cols-4 gap-1.5 bg-line/60 p-1 rounded-control">
            {(['dine_in', 'takeaway', 'delivery', 'repair'] as OrderType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setOrderType(type)}
                className={`h-9 text-xs font-medium rounded-control transition-colors ${
                  orderType === type
                    ? 'bg-surface text-ink font-semibold shadow-sm'
                    : 'text-slate hover:text-ink'
                }`}
              >
                {t(`order.${type}` as MessageKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Table / Label & Channel */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate mb-1">
              {t('orders.tableOrLabel')}
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Table 4"
              className="w-full h-11 px-3 bg-surface border border-line rounded-control text-sm text-ink focus:border-ember focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate mb-1">
              {t('orders.channel')}
            </label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as OrderChannel)}
              className="w-full h-11 px-3 bg-surface border border-line rounded-control text-sm text-ink focus:border-ember focus:outline-none"
            >
              <option value="walk_in">Walk-in</option>
              <option value="phone">Phone</option>
              <option value="telegram">Telegram</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        {/* Customer Search / Picker */}
        <div className="bg-surface border border-line rounded-card p-3.5 space-y-2.5">
          <label className="block text-xs font-semibold text-slate uppercase tracking-wider">
            {t('orders.customer')}
          </label>
          <input
            type="search"
            value={customerSearch}
            onChange={(e) => {
              setCustomerSearch(e.target.value);
              setPhone(e.target.value);
            }}
            placeholder="Search customer phone or name..."
            className="w-full h-11 px-3 bg-paper border border-line rounded-control text-sm text-ink focus:border-ember focus:outline-none"
          />

          {customerSuggestions.length > 0 && (
            <div className="bg-surface border border-line rounded-control divide-y divide-line overflow-hidden shadow-sm">
              {customerSuggestions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelectedCustomer(c);
                    setCustomerSearch(c.name);
                    setPhone(c.phone || '');
                  }}
                  className="w-full p-2.5 text-left text-xs hover:bg-paper flex justify-between items-center"
                >
                  <span className="font-semibold text-ink">{c.name}</span>
                  <span className="text-slate num">{c.phone}</span>
                </button>
              ))}
            </div>
          )}

          {orderType === 'delivery' && (
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Delivery address / landmark"
              className="w-full h-11 px-3 bg-paper border border-line rounded-control text-sm text-ink focus:border-ember focus:outline-none"
            />
          )}
        </div>

        {/* Duplicate Order Warning (FR-O7) */}
        {duplicateOrder && !ignoreDuplicate && (
          <div className="p-3.5 bg-amber/10 border border-amber/30 rounded-card text-xs text-ink space-y-2">
            <div className="flex items-center gap-1.5 font-semibold text-amber">
              <span>⚠️</span>
              <span>{t('orders.duplicateWarning')}</span>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIgnoreDuplicate(true)}
                className="px-3 py-1.5 bg-amber text-on-amber font-semibold rounded text-xs"
              >
                {t('orders.createAnyway')}
              </button>
              <button
                type="button"
                onClick={() => router.push('/orders')}
                className="px-3 py-1.5 bg-surface border border-line text-ink font-medium rounded text-xs"
              >
                {t('orders.viewExisting')}
              </button>
            </div>
          </div>
        )}

        {/* Selected Lines */}
        <div className="bg-surface border border-line rounded-card p-3.5 space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-xs font-semibold text-slate uppercase tracking-wider">
              {t('orders.items')} ({lines.length})
            </h2>
            <span className="text-sm font-bold font-heading text-ink num">
              {total.toFixed(2)} ETB
            </span>
          </div>

          {lines.length === 0 ? (
            <p className="text-xs text-slate text-center py-3">Tap menu items below to add.</p>
          ) : (
            <div className="divide-y divide-line/60">
              {lines.map((l, idx) => (
                <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
                  <div className="flex-1 pr-2">
                    <p className="font-semibold text-ink">{l.name}</p>
                    <p className="text-slate num">{(l.price ?? 0).toFixed(2)} ETB each</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleUpdateQty(idx, -1)}
                      className="w-7 h-7 rounded border border-line flex items-center justify-center font-bold text-slate hover:text-ink active:scale-95"
                    >
                      -
                    </button>
                    <span className="w-5 text-center font-bold text-ink num">{l.qty}</span>
                    <button
                      type="button"
                      onClick={() => handleUpdateQty(idx, 1)}
                      className="w-7 h-7 rounded border border-line flex items-center justify-center font-bold text-slate hover:text-ink active:scale-95"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Catalog Items Grid */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate uppercase tracking-wider">
            {t('nav.catalog')}
          </label>
          {loadingItems ? (
            <div className="space-y-2">
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {catalogItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleAddItem(item)}
                  className="p-3 bg-surface border border-line rounded-control text-left hover:border-ember transition-colors active:scale-98 shadow-sm flex flex-col justify-between"
                >
                  <span className="font-semibold text-xs text-ink line-clamp-1">{item.name}</span>
                  <span className="text-xs text-slate num mt-1">{item.price.toFixed(2)} ETB</span>
                </button>
              ))}
            </div>
          )}

          {/* Custom Line Item Input */}
          <form onSubmit={handleAddCustomItem} className="flex gap-2 pt-2">
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Custom item / part..."
              className="flex-1 h-10 px-3 bg-surface border border-line rounded-control text-xs text-ink focus:border-ember focus:outline-none"
            />
            <input
              type="number"
              step="0.01"
              value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)}
              placeholder="ETB"
              className="w-20 h-10 px-2 bg-surface border border-line rounded-control text-xs text-ink num focus:border-ember focus:outline-none"
            />
            <button
              type="submit"
              aria-label="Add custom item"
              className="px-3 h-10 bg-line text-ink font-semibold rounded-control text-xs hover:bg-slate/20"
            >
              +
            </button>
          </form>
        </div>

        {/* Promised Time (FR-O1: Duration chips) */}
        <div className="bg-surface border border-line rounded-card p-3.5 space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-semibold text-slate uppercase tracking-wider">
              {t('orders.promisedTime')}
            </span>
            <span className="font-bold text-ink num">
              {suggestPromisedMinutes(prepMinutesList) + extraMinutes} min (
              {promisedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
            </span>
          </div>
          <div className="flex gap-2">
            {[0, 10, 20, 30].map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => setExtraMinutes(mins)}
                className={`flex-1 h-8 text-xs font-semibold rounded-control transition-colors ${
                  extraMinutes === mins
                    ? 'bg-ember text-on-ember'
                    : 'bg-paper text-slate hover:text-ink border border-line'
                }`}
              >
                {mins === 0 ? 'Standard' : `+${mins}m`}
              </button>
            ))}
          </div>
        </div>

        {/* Order Notes */}
        <div>
          <label className="block text-xs font-semibold text-slate mb-1">
            {t('orders.notes')}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Special instructions..."
            rows={2}
            className="w-full p-3 bg-surface border border-line rounded-control text-xs text-ink focus:border-ember focus:outline-none resize-none"
          />
        </div>
      </div>

      {/* Fixed Bottom Action Bar */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-line p-3 max-w-lg mx-auto shadow-bar flex items-center justify-between gap-3">
        <div>
          <span className="text-xs text-slate block">{t('orders.total')}</span>
          <span className="font-heading font-bold text-lg text-ink num">
            {total.toFixed(2)} ETB
          </span>
        </div>
        <button
          type="button"
          disabled={submitting || lines.length === 0}
          onClick={handleSubmitOrder}
          className="h-12 px-6 bg-ember text-on-ember rounded-control font-semibold text-sm transition-transform active:scale-95 disabled:opacity-50 shadow-sheet"
        >
          {submitting ? t('orders.syncing') : t('orders.newOrder')}
        </button>
      </footer>
    </main>
  );
}
