'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../lib/session';
import { db } from '../lib/db';
import { subscribeToOrders } from '../lib/sync';
import { isAlertMuted, setAlertMuted, playNewOrderAlert } from '../lib/alerts';
import { OrderTicket } from '../components/OrderTicket';
import { SkeletonTicket } from '../components/Skeleton';
import { QuickEntrySheet } from '../components/QuickEntrySheet';

export default function BoardPage() {
  const { t, shop, online, role } = useApp();
  const router = useRouter();
  const shopId = shop?.id || '00000000-0000-0000-0000-000000000001';

  // Automatically route courier to dedicated My Deliveries view
  useEffect(() => {
    if (role === 'courier') {
      router.replace('/deliveries');
    }
  }, [role, router]);

  // Phone tab selection: 'new' | 'in_progress' | 'ready' | 'all'
  const [activeTab, setActiveTab] = useState<'new' | 'in_progress' | 'ready' | 'all'>('new');
  const [muted, setMuted] = useState(false);
  const [isQuickEntryOpen, setIsQuickEntryOpen] = useState(false);

  useEffect(() => {
    setMuted(isAlertMuted());
  }, []);

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    setAlertMuted(next);
  };

  // Realtime subscription with sound alert and 10s polling fallback
  useEffect(() => {
    if (!online || !shopId) return;
    const cleanup = subscribeToOrders(shopId, () => {
      playNewOrderAlert();
    });
    return cleanup;
  }, [shopId, online]);

  // Reactive Live Query from Dexie
  const orders = useLiveQuery(
    async () => {
      if (!db) return [];
      const ords = await db.orders
        .where('shop_id')
        .equals(shopId)
        .toArray();

      ords.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

      return Promise.all(
        ords.map(async (ord) => {
          const items = await db.order_items.where('order_id').equals(ord.id).toArray();
          const money = await db.order_money.get(ord.id);
          return { ...ord, items, money };
        })
      );
    },
    [shopId]
  );

  const loading = orders === undefined;
  const orderList = orders || [];

  // Group orders for tabs / columns
  const openOrders = orderList.filter((o) => o.status !== 'completed' && o.status !== 'cancelled');
  const newOrders = openOrders.filter((o) => o.status === 'new');
  const progressOrders = openOrders.filter((o) => o.status === 'accepted' || o.status === 'in_progress' || o.status === 'waiting');
  const readyOrders = openOrders.filter((o) => o.status === 'ready' || o.status === 'out_for_delivery');

  const filteredOrders =
    activeTab === 'new'
      ? newOrders
      : activeTab === 'in_progress'
      ? progressOrders
      : activeTab === 'ready'
      ? readyOrders
      : openOrders;

  return (
    <main className="min-h-screen pb-24 max-w-5xl mx-auto bg-paper">
      {/* Board Header */}
      <header className="p-4 bg-surface border-b border-line flex justify-between items-center sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold font-heading text-ink">{shop?.name || 'Order Desk'}</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`w-2 h-2 rounded-full ${online ? 'bg-forest' : 'bg-amber'}`}
                aria-hidden="true"
              />
              <span className="text-xs text-slate">
                {online ? `${openOrders.length} active orders` : t('orders.savedOnPhone')}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Mute toggle button */}
          <button
            type="button"
            onClick={handleToggleMute}
            className="h-9 px-2.5 rounded-control border border-line text-xs font-medium text-slate hover:text-ink flex items-center gap-1"
            title={muted ? t('kitchen.unmute') : t('kitchen.mute')}
          >
            <span>{muted ? '🔇' : '🔔'}</span>
          </button>

          {/* New Order Button */}
          {(role === 'owner' || role === 'staff') && (
            <button
              type="button"
              onClick={() => setIsQuickEntryOpen(true)}
              className="h-9 px-3 bg-ember-soft text-ember border border-ember/30 font-medium text-xs rounded-control flex items-center justify-center gap-1 transition-transform active:scale-95 shadow-xs"
              aria-label={t('ai.quickEntry')}
            >
              <span>✨</span>
              <span>{t('ai.quickEntry')}</span>
            </button>
          )}

          <Link
            href="/orders/new"
            className="h-9 px-3.5 bg-ember text-on-ember font-medium text-xs rounded-control flex items-center justify-center transition-transform active:scale-95 shadow-sm"
          >
            + {t('orders.newOrder')}
          </Link>
        </div>
      </header>

      {/* Phone View: Status Tabs (< md) */}
      <div className="md:hidden p-3 bg-surface border-b border-line flex gap-1.5 sticky top-[69px] z-20">
        {[
          { id: 'new', label: t('board.newTab'), count: newOrders.length },
          { id: 'in_progress', label: t('board.progressTab'), count: progressOrders.length },
          { id: 'ready', label: t('board.readyTab'), count: readyOrders.length },
          { id: 'all', label: t('board.allTab'), count: openOrders.length },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`flex-1 h-9 rounded-control text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === tab.id
                ? 'bg-ink text-surface shadow-sm'
                : 'bg-paper text-slate hover:text-ink'
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] num ${
                activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-line text-slate'
              }`}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="p-4">
        {loading ? (
          <div className="space-y-3 max-w-lg mx-auto">
            <SkeletonTicket />
            <SkeletonTicket />
            <SkeletonTicket />
          </div>
        ) : (
          <>
            {/* Phone List (< md) */}
            <div className="md:hidden max-w-lg mx-auto">
              {filteredOrders.length === 0 ? (
                <div className="p-8 text-center bg-surface border border-dashed border-line rounded-card text-slate text-sm">
                  {t('orders.noOrders')}
                </div>
              ) : (
                filteredOrders.map((ord) => (
                  <OrderTicket
                    key={ord.id}
                    order={ord}
                    items={ord.items}
                    money={ord.money}
                  />
                ))
              )}
            </div>

            {/* Tablet / Desktop Kanban Columns (>= md) */}
            <div className="hidden md:grid md:grid-cols-3 md:gap-4 items-start">
              {/* Column 1: New */}
              <div className="bg-paper border border-line rounded-card p-3 min-h-[600px] flex flex-col">
                <div className="flex justify-between items-center mb-3 pb-2 border-b border-line">
                  <h2 className="font-heading font-bold text-sm text-ink flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-st-new" />
                    <span>{t('board.newTab')}</span>
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-line text-ink num">
                    {newOrders.length}
                  </span>
                </div>
                <div className="space-y-3 flex-1 overflow-y-auto">
                  {newOrders.length === 0 ? (
                    <p className="text-xs text-slate text-center py-6">No new orders</p>
                  ) : (
                    newOrders.map((ord) => (
                      <OrderTicket
                        key={ord.id}
                        order={ord}
                        items={ord.items}
                        money={ord.money}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Column 2: In Progress */}
              <div className="bg-paper border border-line rounded-card p-3 min-h-[600px] flex flex-col">
                <div className="flex justify-between items-center mb-3 pb-2 border-b border-line">
                  <h2 className="font-heading font-bold text-sm text-ink flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-st-progress" />
                    <span>{t('board.progressTab')}</span>
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-line text-ink num">
                    {progressOrders.length}
                  </span>
                </div>
                <div className="space-y-3 flex-1 overflow-y-auto">
                  {progressOrders.length === 0 ? (
                    <p className="text-xs text-slate text-center py-6">Nothing in progress</p>
                  ) : (
                    progressOrders.map((ord) => (
                      <OrderTicket
                        key={ord.id}
                        order={ord}
                        items={ord.items}
                        money={ord.money}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Column 3: Ready */}
              <div className="bg-paper border border-line rounded-card p-3 min-h-[600px] flex flex-col">
                <div className="flex justify-between items-center mb-3 pb-2 border-b border-line">
                  <h2 className="font-heading font-bold text-sm text-ink flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-st-ready" />
                    <span>{t('board.readyTab')}</span>
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-line text-ink num">
                    {readyOrders.length}
                  </span>
                </div>
                <div className="space-y-3 flex-1 overflow-y-auto">
                  {readyOrders.length === 0 ? (
                    <p className="text-xs text-slate text-center py-6">Nothing ready</p>
                  ) : (
                    readyOrders.map((ord) => (
                      <OrderTicket
                        key={ord.id}
                        order={ord}
                        items={ord.items}
                        money={ord.money}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Quick Entry Sheet (M10) */}
      <QuickEntrySheet
        isOpen={isQuickEntryOpen}
        onClose={() => setIsQuickEntryOpen(false)}
      />
    </main>
  );
}
