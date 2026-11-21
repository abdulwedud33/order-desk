'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../../lib/session';
import { db, type LocalOrder, type LocalOrderItem, type LocalOrderMoney } from '../../lib/db';
import { pullRecentOrders } from '../../lib/sync';
import { SkeletonCard } from '../../components/Skeleton';
import { BalanceChip } from '../../components/BalanceChip';
import type { MessageKey } from '../../i18n/en';

interface OrderWithDetails extends LocalOrder {
  items: LocalOrderItem[];
  money?: LocalOrderMoney;
}

export default function OrdersPage() {
  const { t, shop, online } = useApp();
  const shopId = shop?.id || '00000000-0000-0000-0000-000000000001';

  const orders = useLiveQuery(
    async () => {
      if (!db) return [];
      const localOrds = await db.orders
        .where('shop_id')
        .equals(shopId)
        .toArray();

      localOrds.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

      const fullOrders: OrderWithDetails[] = await Promise.all(
        localOrds.map(async (ord) => {
          const items = await db.order_items.where('order_id').equals(ord.id).toArray();
          const money = await db.order_money.get(ord.id);
          return { ...ord, items, money };
        })
      );

      return fullOrders;
    },
    [shopId]
  );

  useEffect(() => {
    if (online && shopId) {
      pullRecentOrders(shopId).catch(() => {});
    }
  }, [shopId, online]);

  const loading = orders === undefined;
  const orderList = orders || [];

  return (
    <main className="min-h-screen pb-24 max-w-lg mx-auto bg-paper">
      {/* Header */}
      <header className="p-4 bg-surface border-b border-line flex justify-between items-center sticky top-0 z-30">
        <div>
          <h1 className="text-xl font-bold font-heading text-ink">{t('orders.title')}</h1>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className={`w-2 h-2 rounded-full ${online ? 'bg-forest' : 'bg-amber'}`}
              aria-hidden="true"
            />
            <span className="text-xs text-slate">
              {online ? shop?.name || 'Online' : t('orders.savedOnPhone')}
            </span>
          </div>
        </div>
        <Link
          href="/orders/new"
          className="h-9 px-3.5 bg-ember text-on-ember font-medium text-xs rounded-control flex items-center justify-center transition-transform active:scale-95 shadow-sm"
        >
          + {t('orders.newOrder')}
        </Link>
      </header>

      {/* Orders List */}
      <div className="p-4 space-y-3">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : orderList.length === 0 ? (
          <div className="p-8 text-center bg-surface border border-dashed border-line rounded-card text-slate text-sm">
            {t('orders.noOrders')}
            <div className="mt-3">
              <Link
                href="/orders/new"
                className="text-ember font-semibold hover:underline"
              >
                + {t('orders.newOrder')}
              </Link>
            </div>
          </div>
        ) : (
          orderList.map((ord) => {
            const isPending = ord.sync_status === 'pending';
            const displayCode = ord.order_code || ord.temp_ref;

            return (
              <div
                key={ord.id}
                className="bg-surface border border-line rounded-card p-4 shadow-sm relative overflow-hidden transition-all hover:border-slate/40"
              >
                {/* Header Row: Code & Status */}
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-heading font-bold text-lg text-ink num">
                      #{displayCode}
                    </span>
                    {isPending && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber/15 text-amber border border-amber/30">
                        {t('orders.savedOnPhone')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-line text-ink">
                      {t(`status.${ord.status}` as MessageKey) || ord.status}
                    </span>
                  </div>
                </div>

                {/* Sub-header: Type & Label */}
                <div className="flex items-center gap-2 text-xs text-slate mb-2">
                  <span className="capitalize">{t(`order.${ord.type}` as MessageKey) || ord.type}</span>
                  {ord.label && (
                    <>
                      <span>•</span>
                      <span className="font-medium text-ink">{ord.label}</span>
                    </>
                  )}
                  {ord.due_at && (
                    <>
                      <span>•</span>
                      <span>ETA: {new Date(ord.due_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </>
                  )}
                </div>

                {/* Items Summary */}
                <div className="text-xs text-ink/80 space-y-0.5 border-t border-line/60 pt-2 mb-2">
                  {ord.items.map((item) => (
                    <div key={item.id} className="flex justify-between">
                      <span>
                        <strong className="num text-ink">{item.qty}x</strong> {item.name}
                        {item.note && <span className="text-slate italic"> ({item.note})</span>}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Footer: Money & Created Time */}
                <div className="flex justify-between items-center text-xs pt-1 border-t border-line/40 text-slate">
                  <span>{new Date(ord.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {ord.money && (
                    <div className="flex items-center gap-2">
                      <BalanceChip
                        total={ord.money.total}
                        paidAmount={ord.money.paid_amount}
                        settleLater={ord.settle_later}
                      />
                      <span className="font-heading font-semibold text-ink num text-sm">
                        {ord.money.total.toFixed(2)} ETB
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}
