// src/domain/tracking.ts
// Pure functions for public order tracking: token validation, token expiry, rate limits, sanitized responses, and stepper calculations

export interface TrackingLookupData {
  shop_name: string;
  business_type: 'food' | 'delivery' | 'repair';
  order_code: string;
  order_type: 'dine_in' | 'takeaway' | 'delivery' | 'repair';
  status: 'new' | 'accepted' | 'in_progress' | 'waiting' | 'ready' | 'out_for_delivery' | 'completed' | 'cancelled';
  due_at?: string | null;
  updated_at: string;
  // Raw inputs may contain sensitive attributes from database joins; formatTrackingResponse strips all of them!
  phone?: string | null;
  address?: string | null;
  customer_name?: string | null;
  items?: unknown;
  total?: unknown;
  paid_amount?: unknown;
  id?: string;
}

export type TrackingResponse =
  | {
      found: true;
      shop_name: string;
      business_type: string;
      order_code: string;
      order_type: string;
      status: string;
      due_at: string | null;
      updated_at: string;
    }
  | {
      found: false;
      message: string;
    };

/**
 * Validates tracking token format: 16 to 64 URL-safe characters (Base64URL / alphanumeric).
 */
export function isValidTrackingToken(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  const trimmed = token.trim();
  return /^[A-Za-z0-9_-]{16,64}$/.test(trimmed);
}

/**
 * Checks if a tracking token has expired.
 * Rules per docs/05-backend-schema.md section 11:
 * - Cancelled orders: expire 30 days after cancellation.
 * - Completed orders: expire 60 days after completion.
 * - Active orders: never expire.
 */
export function isTokenExpired(
  order: {
    status: string;
    completed_at?: string | null;
    cancelled_at?: string | null;
    updated_at?: string | null;
  },
  now: Date = new Date()
): boolean {
  const nowMs = now.getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  if (order.status === 'cancelled') {
    const cancelTime = new Date(order.cancelled_at || order.updated_at || 0).getTime();
    return nowMs - cancelTime > 30 * DAY_MS;
  }

  if (order.status === 'completed') {
    const completeTime = new Date(order.completed_at || order.updated_at || 0).getTime();
    return nowMs - completeTime > 60 * DAY_MS;
  }

  return false;
}

/**
 * Sanitizes tracking lookup data strictly to the minimal allowed public fields.
 * Guarantees zero sensitive personal, financial, or line item fields are returned.
 */
export function formatTrackingResponse(data: TrackingLookupData | null): TrackingResponse {
  if (!data) {
    return {
      found: false,
      message: "We couldn't find this order.",
    };
  }

  return {
    found: true,
    shop_name: String(data.shop_name || ''),
    business_type: String(data.business_type || 'food'),
    order_code: String(data.order_code || ''),
    order_type: String(data.order_type || 'dine_in'),
    status: String(data.status || 'new'),
    due_at: data.due_at || null,
    updated_at: String(data.updated_at || new Date().toISOString()),
  };
}

export interface TrackingStep {
  key: string;
  labelKey: string;
  isCompleted: boolean;
  isCurrent: boolean;
}

export interface TrackingStepperResult {
  steps: TrackingStep[];
  isCancelled: boolean;
}

/**
 * Computes visual stepper progression based on order type and status.
 */
export function calculateTrackingStepper(
  orderType: string,
  status: string
): TrackingStepperResult {
  if (status === 'cancelled') {
    return {
      isCancelled: true,
      steps: [
        { key: 'received', labelKey: 'tracking.stepper.received', isCompleted: false, isCurrent: false },
        { key: 'cancelled', labelKey: 'status.cancelled', isCompleted: false, isCurrent: true },
      ],
    };
  }

  let stepKeys: { key: string; labelKey: string; statuses: string[] }[] = [];

  if (orderType === 'delivery') {
    stepKeys = [
      { key: 'received', labelKey: 'tracking.stepper.received', statuses: ['new', 'accepted'] },
      { key: 'preparing', labelKey: 'tracking.stepper.preparing', statuses: ['in_progress', 'waiting'] },
      { key: 'ready', labelKey: 'tracking.stepper.ready', statuses: ['ready'] },
      { key: 'out_for_delivery', labelKey: 'tracking.stepper.outForDelivery', statuses: ['out_for_delivery'] },
      { key: 'delivered', labelKey: 'tracking.stepper.delivered', statuses: ['completed'] },
    ];
  } else if (orderType === 'repair') {
    stepKeys = [
      { key: 'received', labelKey: 'tracking.stepper.received', statuses: ['new', 'accepted'] },
      { key: 'in_progress', labelKey: 'tracking.stepper.diagnosing', statuses: ['in_progress', 'waiting'] },
      { key: 'ready', labelKey: 'tracking.stepper.readyForPickup', statuses: ['ready'] },
      { key: 'completed', labelKey: 'tracking.stepper.collected', statuses: ['completed'] },
    ];
  } else {
    // food / dine_in / takeaway
    stepKeys = [
      { key: 'received', labelKey: 'tracking.stepper.received', statuses: ['new', 'accepted'] },
      { key: 'preparing', labelKey: 'tracking.stepper.preparing', statuses: ['in_progress', 'waiting'] },
      { key: 'ready', labelKey: 'tracking.stepper.ready', statuses: ['ready', 'out_for_delivery'] },
      { key: 'completed', labelKey: 'tracking.stepper.completed', statuses: ['completed'] },
    ];
  }

  let currentIndex = stepKeys.findIndex((s) => s.statuses.includes(status));
  if (currentIndex === -1) {
    currentIndex = 0;
  }

  const steps: TrackingStep[] = stepKeys.map((s, idx) => ({
    key: s.key,
    labelKey: s.labelKey,
    isCompleted: idx < currentIndex || status === 'completed',
    isCurrent: idx === currentIndex && status !== 'completed',
  }));

  return {
    isCancelled: false,
    steps,
  };
}

/**
 * In-memory sliding window rate limiter for public tracking endpoints.
 * Limits:
 * - 30 requests per minute per IP.
 * - 10 requests per minute per token.
 */
export class TrackingRateLimiter {
  private ipBuckets = new Map<string, number[]>();
  private tokenBuckets = new Map<string, number[]>();

  constructor(
    private readonly maxPerIp: number = 30,
    private readonly maxPerToken: number = 10,
    private readonly windowMs: number = 60_000
  ) {}

  check(
    ip: string,
    token?: string | null,
    now: number = Date.now()
  ): { allowed: boolean; retryAfter?: number } {
    const cleanIp = ip.trim() || 'unknown';

    // 1. Check IP rate limit
    const ipTimestamps = this.cleanBucket(this.ipBuckets, cleanIp, now);
    if (ipTimestamps.length >= this.maxPerIp) {
      const oldest = ipTimestamps[0] || now;
      const retryAfter = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      return { allowed: false, retryAfter };
    }

    // 2. Check Token rate limit (if token is provided)
    if (token) {
      const cleanToken = token.trim();
      const tokenTimestamps = this.cleanBucket(this.tokenBuckets, cleanToken, now);
      if (tokenTimestamps.length >= this.maxPerToken) {
        const oldest = tokenTimestamps[0] || now;
        const retryAfter = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
        return { allowed: false, retryAfter };
      }
    }

    // Record request
    this.record(this.ipBuckets, cleanIp, now);
    if (token) {
      this.record(this.tokenBuckets, token.trim(), now);
    }

    return { allowed: true };
  }

  private cleanBucket(map: Map<string, number[]>, key: string, now: number): number[] {
    const timestamps = map.get(key) || [];
    const valid = timestamps.filter((t) => now - t < this.windowMs);
    map.set(key, valid);
    return valid;
  }

  private record(map: Map<string, number[]>, key: string, now: number): void {
    const timestamps = map.get(key) || [];
    timestamps.push(now);
    map.set(key, timestamps);
  }

  reset(): void {
    this.ipBuckets.clear();
    this.tokenBuckets.clear();
  }
}
