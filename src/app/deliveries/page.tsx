'use client';

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../../lib/session';
import { db, type LocalOrder } from '../../lib/db';
import { queueAdvanceOrder, queueRecordPayment, subscribeToOrders } from '../../lib/sync';
import { playNewOrderAlert } from '../../lib/alerts';
import { DeliveryCard } from '../../components/DeliveryCard';
import { CashCollectedDialog } from '../../components/CashCollectedDialog';
import { SkeletonDeliveryCard } from '../../components/Skeleton';

export default function DeliveriesPage() {
  const { t, shop, user, role, online, showToast } = useApp();
  const shopId = shop?.id || '00000000-0000-0000-0000-000000000001';

  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');
  const [cashOrder, setCashOrder] = useState<LocalOrder | null>(null);
  const [cashBalance, setCashBalance] = useState<number>(0);

  // Subscribe to Realtime orders with alert sound
  useEffect(() => {
    if (!online || !shopId) return;
    const cleanup = subscribeToOrders(shopId, () => {
      playNewOrderAlert();
    });
    return cleanup;
  }, [shopId, online]);

  // Reactive Live Query for courier deliveries
  const deliveries = useLiveQuery(
    async () => {
      if (!db) return [];

      let ords: LocalOrder[] = await db.orders
        .where('shop_id')
        .equals(shopId)
        .toArray();

      // Filter for delivery orders
      ords = ords.filter((o: LocalOrder) => o.type === 'delivery');

      // If user is courier and authenticated, filter to their assigned deliveries
      if (role === 'courier' && user?.id) {
        ords = ords.filter((o: LocalOrder) => o.assigned_to === user.id);
      }

      ords.sort((a: LocalOrder, b: LocalOrder) => (b.created_at || '').localeCompare(a.created_at || ''));

      return Promise.all(
        ords.map(async (ord: LocalOrder) => {
          const items = await db.order_items.where('order_id').equals(ord.id).toArray();
          const money = await db.order_money.get(ord.id);
          const contact = await db.order_contacts.get(ord.id);
          return { ...ord, items, money, contact };
        })
      );
    },
    [shopId, user?.id, role]
  );

  const loading = deliveries === undefined;
  const deliveryList = deliveries || [];

  const activeDeliveries = deliveryList.filter(
    (d) => d.status === 'ready' || d.status === 'out_for_delivery'
  );
  const completedDeliveries = deliveryList.filter((d) => d.status === 'completed');

  const displayedDeliveries = activeTab === 'active' ? activeDeliveries : completedDeliveries;

  const handleAdvance = async (order: LocalOrder, nextStatus: 'out_for_delivery' | 'completed') => {
    try {
      await queueAdvanceOrder(shopId, order.id, nextStatus, order.status);
      if (nextStatus === 'out_for_delivery') {
        showToast(t('delivery.pickedUpSuccess'));
      } else {
        showToast(t('delivery.deliverySuccess'));
      }
    } catch {
      showToast(t('err.UNKNOWN'));
    }
  };

  const handleOpenCashCollected = (order: LocalOrder, balance: number) => {
    setCashOrder(order);
    setCashBalance(balance);
  };

  const handleConfirmCash = async (amount: number) => {
    if (!cashOrder) return;

    if (amount > 0) {
      await queueRecordPayment(
        shopId,
        cashOrder.id,
        'payment',
        amount,
        'cash',
        'Courier cash on delivery'
      );
    }
    await queueAdvanceOrder(shopId, cashOrder.id, 'completed', 'out_for_delivery');
    showToast(t('delivery.deliverySuccess'));
    setCashOrder(null);
  };

  return (
    <main className="min-h-screen pb-24 max-w-lg mx-auto bg-paper">
      {/* Courier Deliveries Header */}
      <header className="p-4 bg-surface border-b border-line flex justify-between items-center sticky top-0 z-30 shadow-sm">
        <div>
          <h1 className="text-xl font-bold font-heading text-ink flex items-center gap-2">
            <span>🛵</span>
            <span>{t('delivery.title')}</span>
          </h1>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className={`w-2 h-2 rounded-full ${online ? 'bg-forest' : 'bg-amber'}`}
              aria-hidden="true"
            />
            <span className="text-xs text-slate">
              {online ? `${activeDeliveries.length} ${t('delivery.active').toLowerCase()}` : t('orders.savedOnPhone')}
            </span>
          </div>
        </div>

        {/* Tab switcher: Active vs Completed */}
        <div className="flex bg-paper p-1 rounded-control border border-line">
          <button
            type="button"
            onClick={() => setActiveTab('active')}
            className={`px-3 py-1.5 rounded-control text-xs font-semibold transition-colors ${
              activeTab === 'active'
                ? 'bg-ink text-surface shadow-xs'
                : 'text-slate hover:text-ink'
            }`}
          >
            {t('delivery.active')} ({activeDeliveries.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('completed')}
            className={`px-3 py-1.5 rounded-control text-xs font-semibold transition-colors ${
              activeTab === 'completed'
                ? 'bg-ink text-surface shadow-xs'
                : 'text-slate hover:text-ink'
            }`}
          >
            {t('delivery.completed')} ({completedDeliveries.length})
          </button>
        </div>
      </header>

      {/* Content Area */}
      <div className="p-4">
        {loading ? (
          <div className="space-y-4">
            <SkeletonDeliveryCard />
            <SkeletonDeliveryCard />
          </div>
        ) : displayedDeliveries.length === 0 ? (
          <div className="text-center py-16 px-4 bg-surface border border-line rounded-card space-y-2">
            <div className="text-3xl mb-1">🛵</div>
            <h2 className="text-sm font-bold text-ink">
              {activeTab === 'active' ? t('delivery.noDeliveries') : t('delivery.completed')}
            </h2>
            <p className="text-xs text-slate max-w-xs mx-auto">
              {activeTab === 'active'
                ? t('delivery.noDeliveries')
                : 'Completed deliveries will appear here.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {displayedDeliveries.map((delivery) => (
              <DeliveryCard
                key={delivery.id}
                order={delivery}
                items={delivery.items}
                money={delivery.money}
                contact={delivery.contact}
                currency={shop?.currency || 'ETB'}
                onAdvance={handleAdvance}
                onOpenCashCollected={handleOpenCashCollected}
              />
            ))}
          </div>
        )}
      </div>

      {/* Cash Collected Modal */}
      {cashOrder && (
        <CashCollectedDialog
          order={cashOrder}
          balance={cashBalance}
          currency={shop?.currency || 'ETB'}
          isOpen={true}
          onClose={() => setCashOrder(null)}
          onConfirm={handleConfirmCash}
        />
      )}
    </main>
  );
}
