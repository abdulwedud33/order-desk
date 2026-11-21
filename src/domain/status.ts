// src/domain/status.ts
// Order status machine - Single Source of Truth

export type OrderType = 'dine_in' | 'takeaway' | 'delivery' | 'repair';
export type OrderChannel = 'walk_in' | 'phone' | 'telegram' | 'whatsapp' | 'instagram' | 'other';
export type OrderStatus =
  | 'new'
  | 'accepted'
  | 'in_progress'
  | 'waiting'
  | 'ready'
  | 'out_for_delivery'
  | 'completed'
  | 'cancelled';

export type MemberRole = 'owner' | 'staff' | 'kitchen' | 'courier';

export interface TransitionRule {
  orderType: OrderType;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  roles: readonly MemberRole[];
}

const COMMON_TRANSITIONS = [
  { fromStatus: 'new', toStatus: 'accepted', roles: ['owner', 'staff', 'kitchen'] },
  { fromStatus: 'new', toStatus: 'cancelled', roles: ['owner', 'staff'] },
  { fromStatus: 'accepted', toStatus: 'in_progress', roles: ['owner', 'staff', 'kitchen'] },
  { fromStatus: 'accepted', toStatus: 'waiting', roles: ['owner', 'staff'] },
  { fromStatus: 'accepted', toStatus: 'cancelled', roles: ['owner', 'staff'] },
  { fromStatus: 'in_progress', toStatus: 'ready', roles: ['owner', 'staff', 'kitchen'] },
  { fromStatus: 'in_progress', toStatus: 'waiting', roles: ['owner', 'staff'] },
  { fromStatus: 'waiting', toStatus: 'in_progress', roles: ['owner', 'staff'] },
  { fromStatus: 'waiting', toStatus: 'cancelled', roles: ['owner', 'staff'] },
  { fromStatus: 'ready', toStatus: 'completed', roles: ['owner', 'staff'] },
  { fromStatus: 'ready', toStatus: 'cancelled', roles: ['owner', 'staff'] },
] as const;

export const ORDER_TRANSITIONS: readonly TransitionRule[] = [
  // dine_in
  ...COMMON_TRANSITIONS.map((t) => ({ orderType: 'dine_in' as OrderType, ...t })),
  // takeaway
  ...COMMON_TRANSITIONS.map((t) => ({ orderType: 'takeaway' as OrderType, ...t })),
  // delivery (includes out_for_delivery)
  ...COMMON_TRANSITIONS.map((t) => ({ orderType: 'delivery' as OrderType, ...t })),
  { orderType: 'delivery', fromStatus: 'ready', toStatus: 'out_for_delivery', roles: ['owner', 'staff', 'courier'] },
  { orderType: 'delivery', fromStatus: 'out_for_delivery', toStatus: 'completed', roles: ['owner', 'staff', 'courier'] },
  { orderType: 'delivery', fromStatus: 'out_for_delivery', toStatus: 'cancelled', roles: ['owner', 'staff'] },
  // repair
  ...COMMON_TRANSITIONS.map((t) => ({ orderType: 'repair' as OrderType, ...t })),
];

export function canTransition(
  orderType: OrderType,
  fromStatus: OrderStatus,
  toStatus: OrderStatus,
  role: MemberRole
): boolean {
  const rule = ORDER_TRANSITIONS.find(
    (r) => r.orderType === orderType && r.fromStatus === fromStatus && r.toStatus === toStatus
  );
  if (!rule) return false;
  return rule.roles.includes(role);
}

export function getAllowedNextStatuses(
  orderType: OrderType,
  currentStatus: OrderStatus,
  role: MemberRole
): OrderStatus[] {
  return ORDER_TRANSITIONS.filter(
    (r) => r.orderType === orderType && r.fromStatus === currentStatus && r.roles.includes(role)
  ).map((r) => r.toStatus);
}
