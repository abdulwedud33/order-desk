// src/domain/orders.ts
// Order creation, calculation, duplicate check, and promised-time suggestions

export interface OrderItemInput {
  itemId?: string;
  name: string;
  qty: number;
  price?: number; // client price or override
  note?: string;
  prepMinutes?: number;
}

export interface OrderContactInput {
  phone?: string;
  address?: string;
  address_note?: string;
}

export interface CreateOrderInput {
  id: string; // client-generated UUID
  shopId: string;
  type: 'dine_in' | 'takeaway' | 'delivery' | 'repair';
  label?: string;
  channel?: 'walk_in' | 'phone' | 'telegram' | 'whatsapp' | 'instagram' | 'other';
  note?: string;
  dueAt?: string;
  items: OrderItemInput[];
  contact?: OrderContactInput;
  deliveryFee?: number;
  customerId?: string;
  repair?: {
    device: string;
    problem: string;
    serial?: string;
    pickup_code?: string;
  };
}

/** Formats temporary reference displayed while order is offline / pending sync */
export function formatTemporaryReference(uuid: string): string {
  const short = uuid.replace(/-/g, '').slice(0, 4).toUpperCase();
  return `~PEND-${short}`;
}

/** Suggests promised time (due_at) based on preparation times of the items */
export function suggestPromisedMinutes(prepMinutesArray: number[]): number {
  if (prepMinutesArray.length === 0) return 15; // default 15 min
  const maxPrep = Math.max(...prepMinutesArray);
  // Default to max prep time, clamped between 10 and 180 minutes
  return Math.min(180, Math.max(10, maxPrep));
}

export function calculateSuggestedDueAt(now: Date, prepMinutesArray: number[], extraMinutes: number = 0): Date {
  const baseMinutes = suggestPromisedMinutes(prepMinutesArray) + extraMinutes;
  return new Date(now.getTime() + baseMinutes * 60_000);
}

export interface ExistingOrderSnapshot {
  id: string;
  phone?: string | null;
  items: { itemId?: string | null; name: string }[];
  createdAt: string; // ISO string
}

/**
 * Duplicate warning (FR-O7): Same customer phone + same items within 10 minutes (600,000 ms).
 */
export function findDuplicateOrder(
  newPhone: string | undefined,
  newItems: { itemId?: string; name: string }[],
  existingOrders: ExistingOrderSnapshot[],
  now: Date = new Date()
): ExistingOrderSnapshot | null {
  if (!newPhone || !newPhone.trim()) return null;
  if (newItems.length === 0) return null;

  const normalizedPhone = newPhone.replace(/\D/g, '');
  if (!normalizedPhone) return null;

  const newItemKeys = new Set(newItems.map((i) => i.itemId || i.name.toLowerCase().trim()));
  const TEN_MINUTES_MS = 10 * 60 * 1000;

  for (const ord of existingOrders) {
    if (!ord.phone) continue;
    const ordPhone = ord.phone.replace(/\D/g, '');
    if (ordPhone !== normalizedPhone) continue;

    const ordTime = new Date(ord.createdAt).getTime();
    if (Math.abs(now.getTime() - ordTime) > TEN_MINUTES_MS) continue;

    // Check if items match
    const ordItemKeys = new Set(ord.items.map((i) => i.itemId || i.name.toLowerCase().trim()));
    if (newItemKeys.size !== ordItemKeys.size) continue;

    let allMatch = true;
    for (const key of newItemKeys) {
      if (!ordItemKeys.has(key)) {
        allMatch = false;
        break;
      }
    }

    if (allMatch) {
      return ord;
    }
  }

  return null;
}
