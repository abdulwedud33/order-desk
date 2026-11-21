// src/domain/repair.ts
// Pure domain logic for repair orders, pickup code handling, waiting reasons, and turnaround

export type WaitingReasonKey =
  | 'waiting_parts'
  | 'waiting_approval'
  | 'waiting_payment'
  | 'waiting_device_info'
  | 'estimate_exceeded'
  | 'other';

export interface RepairJobInput {
  device: string;
  problem: string;
  serial?: string;
  pickupCode?: string;
}

export interface RepairEstimateValidation {
  valid: boolean;
  isExceeded: boolean;
  approvedTotal?: number | null;
  currentTotal: number;
}

/** Generates a 4-digit numeric pickup code (e.g. "4821") */
export function generatePickupCode(): string {
  const code = Math.floor(1000 + Math.random() * 9000);
  return code.toString();
}

/** Checks whether the order total exceeds the approved estimate */
export function checkEstimateThreshold(
  currentTotal: number,
  approvedTotal?: number | null
): RepairEstimateValidation {
  const isExceeded = approvedTotal != null && currentTotal > approvedTotal;
  return {
    valid: !isExceeded,
    isExceeded,
    approvedTotal,
    currentTotal,
  };
}

/** Computes turnaround hours between creation and completion/now */
export function calculateTurnaroundHours(
  createdAtStr: string,
  completedAtStr?: string | null,
  nowDate: Date = new Date()
): number {
  const start = new Date(createdAtStr).getTime();
  const end = completedAtStr ? new Date(completedAtStr).getTime() : nowDate.getTime();
  const diffMs = Math.max(0, end - start);
  return Math.round((diffMs / (1000 * 60 * 60)) * 10) / 10;
}

/** Formats turnaround duration into readable days and hours */
export function formatTurnaroundHours(hours: number): string {
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return `${mins}m`;
  }
  if (hours < 24) {
    return `${Math.round(hours)}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = Math.round(hours % 24);
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

/** Builds customer status update text from templates */
export function buildStatusNotificationMessage(params: {
  shopName: string;
  orderCode: string;
  statusLabel: string;
  customerFirstName?: string;
  locale?: 'en' | 'am' | 'om';
}): string {
  const { shopName, orderCode, statusLabel, customerFirstName, locale = 'en' } = params;

  if (locale === 'am') {
    const greeting = customerFirstName ? `ሰላም ${customerFirstName}፣ ` : 'ሰላም፣ ';
    return `${greeting}ይህ ${shopName} ነው። የትዕዛዝ ቁጥር ${orderCode} ሁኔታ: ${statusLabel}። እናመሰግናለን።`;
  }

  if (locale === 'om') {
    const greeting = customerFirstName ? `Akkam ${customerFirstName}, ` : 'Akkam, ';
    return `${greeting}kun ${shopName}. Haalli ajaja ${orderCode}: ${statusLabel}. Galatoomaa.`;
  }

  const greeting = customerFirstName ? `Hello ${customerFirstName}, ` : 'Hello, ';
  return `${greeting}this is ${shopName}. Your order ${orderCode} is ${statusLabel}. Thank you.`;
}
