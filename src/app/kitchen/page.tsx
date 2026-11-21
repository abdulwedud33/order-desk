'use client';

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../../lib/session';
import { db } from '../../lib/db';
import { subscribeToOrders } from '../../lib/sync';
import { isAlertMuted, setAlertMuted, playNewOrderAlert } from '../../lib/alerts';
import { OrderTicket } from '../../components/OrderTicket';
import { SkeletonTicket } from '../../components/Skeleton';

export default function KitchenPage() {
  const { t, shop, online } = useApp();
  const shopId = shop?.id || '00000000-0000-0000-0000-000000000001';
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setMuted(isAlertMuted());
  }, []);

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    setAlertMuted(next);
  };

  // Realtime subscription with sound chime on new orders
  useEffect(() => {
    if (!online || !shopId) return;
    const cleanup = subscribeToOrders(shopId, () => {
      playNewOrderAlert();
    });
    return cleanup;
  }, [shopId, online]);

  // Reactive Live Query from Dexie for Kitchen (only open orders: new, accepted, in_progress, waiting, ready)
  const orders = useLiveQuery(
    async () => {
      if (!db) return [];
      const ords = await db.orders
        .where('shop_id')
        .equals(shopId)
        .toArray();

      // Oldest first for kitchen (FIFO queue)
      ords.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

      // Filter only kitchen relevant statuses
      const kitchenOrds = ords.filter(
        (o) => o.status === 'new' || o.status === 'accepted' || o.status === 'in_progress' || o.status === 'waiting' || o.status === 'ready'
      );

      return Promise.all(
        kitchenOrds.map(async (ord) => {
          const items = await db.order_items.where('order_id').equals(ord.id).toArray();
          return { ...ord, items };
        })
      );
    },
    [shopId]
  );

  const loading = orders === undefined;
  const kitchenList = orders || [];

  return (
    <main className="min-h-screen pb-20 max-w-2xl mx-auto bg-paper">
      {/* Kitchen Header */}
      <header className="p-4 bg-surface border-b border-line flex justify-between items-center sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden="true">🍳</span>
          <div>
            <h1 className="text-xl font-bold font-heading text-ink">{t('kitchen.title')}</h1>
            <p className="text-xs text-slate">{kitchenList.length} tickets to prepare</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleMute}
            className="h-10 px-3 rounded-control border border-line text-xs font-semibold text-ink hover:bg-paper flex items-center gap-1.5"
            title={muted ? t('kitchen.unmute') : t('kitchen.mute')}
          >
            <span>{muted ? '🔇' : '🔔'}</span>
            <span>{muted ? t('kitchen.unmute') : t('kitchen.mute')}</span>
          </button>
        </div>
      </header>

      {/* Tickets Feed (Oldest first, big cards, no money, no contacts) */}
      <div className="p-4 space-y-4">
        {loading ? (
          <>
            <SkeletonTicket />
            <SkeletonTicket />
            <SkeletonTicket />
          </>
        ) : kitchenList.length === 0 ? (
          <div className="p-12 text-center bg-surface border border-dashed border-line rounded-card text-slate text-sm">
            <p className="text-base font-semibold text-ink mb-1">{t('kitchen.noOrders')}</p>
            <p className="text-xs">Incoming tickets will chime and appear here automatically.</p>
          </div>
        ) : (
          kitchenList.map((ord) => (
            <OrderTicket
              key={ord.id}
              order={ord}
              items={ord.items}
              isKitchen={true}
            />
          ))
        )}
      </div>
    </main>
  );
}
