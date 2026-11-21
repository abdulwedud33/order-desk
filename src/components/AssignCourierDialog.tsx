'use client';

import { useState, useEffect } from 'react';
import { useApp } from '../lib/session';
import { supabase } from '../lib/supabase';
import { queueAssignOrder } from '../lib/sync';
import type { LocalOrder } from '../lib/db';

interface CourierMember {
  user_id: string;
  display_name: string | null;
}

interface AssignCourierDialogProps {
  order: LocalOrder;
  isOpen: boolean;
  onClose: () => void;
  onAssigned?: () => void;
}

const DEMO_COURIERS: CourierMember[] = [
  { user_id: '44444444-4444-4444-4444-444444444444', display_name: 'Courier Carl' },
  { user_id: '66666666-6666-6666-6666-666666666666', display_name: 'Courier Dave' },
];

export function AssignCourierDialog({
  order,
  isOpen,
  onClose,
  onAssigned,
}: AssignCourierDialogProps) {
  const { t, shop, showToast } = useApp();
  const [couriers, setCouriers] = useState<CourierMember[]>(DEMO_COURIERS);
  const [selectedCourierId, setSelectedCourierId] = useState<string>(order.assigned_to || DEMO_COURIERS[0]?.user_id || '');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !shop?.id) return;
    setSelectedCourierId(order.assigned_to || '');

    let active = true;
    async function loadCouriers() {
      try {
        const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) =>
          setTimeout(() => resolve({ data: null, error: new Error('timeout') }), 400)
        );
        const fetchPromise = supabase
          .from('shop_members')
          .select('user_id, display_name')
          .eq('shop_id', shop?.id || '')
          .eq('role', 'courier');

        const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);
        if (active && !error && data && data.length > 0) {
          setCouriers(data as CourierMember[]);
        }
      } catch {
        // Fallback to DEMO_COURIERS
      }
    }

    loadCouriers();
    return () => {
      active = false;
    };
  }, [isOpen, shop?.id, order.assigned_to]);

  if (!isOpen) return null;

  const handleAssign = async () => {
    if (!selectedCourierId || submitting) return;

    setSubmitting(true);
    try {
      const shopId = shop?.id || '00000000-0000-0000-0000-000000000001';
      await queueAssignOrder(shopId, order.id, selectedCourierId);
      showToast(t('delivery.assignSuccess'));
      if (onAssigned) onAssigned();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/50 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assign-courier-title"
    >
      <div className="bg-surface rounded-card max-w-sm w-full p-5 border border-line shadow-sheet">
        <h2 id="assign-courier-title" className="text-base font-bold text-ink">
          {t('delivery.assignTitle')}
        </h2>
        <p className="text-xs text-slate mt-1">
          {order.order_code || order.temp_ref} • {order.label || t('order.delivery')}
        </p>

        <div className="mt-4 space-y-2 max-h-60 overflow-y-auto">
          {couriers.length === 0 ? (
            <p className="text-xs text-slate p-3 bg-paper rounded-control border border-line/60">
              {t('delivery.noCouriers')}
            </p>
          ) : (
            couriers.map((courier) => {
              const isSelected = selectedCourierId === courier.user_id;
              return (
                <button
                  key={courier.user_id}
                  type="button"
                  onClick={() => setSelectedCourierId(courier.user_id)}
                  className={`w-full p-3 rounded-control text-left flex items-center justify-between border transition-colors ${
                    isSelected
                      ? 'border-ember bg-ember/5 text-ink'
                      : 'border-line/70 bg-paper text-slate hover:border-ink/30'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-base">🛵</span>
                    <div>
                      <p className="text-xs font-semibold text-ink">
                        {courier.display_name || 'Courier'}
                      </p>
                      <p className="text-[10px] text-slate font-tabular">
                        {courier.user_id.slice(0, 8)}...
                      </p>
                    </div>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      isSelected ? 'border-ember bg-ember' : 'border-line'
                    }`}
                  >
                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-5 pt-3 border-t border-line">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-medium text-slate hover:text-ink rounded-control"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleAssign}
            disabled={!selectedCourierId || submitting}
            className="px-4 py-2 bg-ember text-on-ember text-xs font-semibold rounded-control shadow-sm disabled:opacity-50 transition-transform active:scale-95"
          >
            {submitting ? t('orders.syncing') : t('delivery.assignCourier')}
          </button>
        </div>
      </div>
    </div>
  );
}
