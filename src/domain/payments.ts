// src/domain/payments.ts
// Pure domain logic for payments, deposits, refunds, balance chips, and ledger invariants

export type PaymentKind = 'payment' | 'deposit' | 'refund';
export type PayMethod = 'cash' | 'mobile_money' | 'bank' | 'other';
export type BalanceStatus = 'unpaid' | 'partial' | 'paid' | 'settle_later';

export interface PaymentValidationParams {
  total: number;
  paidAmount: number;
  amount: number;
  kind: PaymentKind;
  role: 'owner' | 'staff' | 'kitchen' | 'courier';
  method: PayMethod;
  note?: string | null;
  isAssignedDelivery?: boolean;
}

export interface PaymentValidationResult {
  valid: boolean;
  error?: 'FORBIDDEN' | 'VALIDATION' | 'OVERPAYMENT';
  message?: string;
}

/** Computes the balance status chip type */
export function getBalanceStatus(
  total: number,
  paidAmount: number,
  settleLater?: boolean
): BalanceStatus {
  const roundedTotal = Math.round(total * 100) / 100;
  const roundedPaid = Math.round(paidAmount * 100) / 100;

  if (roundedPaid >= roundedTotal) {
    return 'paid';
  }
  if (settleLater) {
    return 'settle_later';
  }
  if (roundedPaid <= 0) {
    return 'unpaid';
  }
  return 'partial';
}

/** Calculates outstanding balance */
export function calculateBalance(total: number, paidAmount: number): number {
  const balance = Math.max(0, total - paidAmount);
  return Math.round(balance * 100) / 100;
}

/** Validates payment recording according to business rules */
export function validatePayment(params: PaymentValidationParams): PaymentValidationResult {
  const { total, paidAmount, amount, kind, role, method, note, isAssignedDelivery } = params;

  // Kitchen role has zero money access
  if (role === 'kitchen') {
    return { valid: false, error: 'FORBIDDEN', message: 'Kitchen role cannot record payments' };
  }

  // Courier restrictions: assigned delivery, payment kind, cash only
  if (role === 'courier') {
    if (!isAssignedDelivery) {
      return { valid: false, error: 'FORBIDDEN', message: 'Courier can only record payment on assigned delivery' };
    }
    if (kind !== 'payment') {
      return { valid: false, error: 'FORBIDDEN', message: 'Couriers can only record payments (no refunds or deposits)' };
    }
    if (method !== 'cash') {
      return { valid: false, error: 'FORBIDDEN', message: 'Couriers can only record cash payments' };
    }
  }

  // Amount must be positive
  if (amount <= 0 || isNaN(amount)) {
    return { valid: false, error: 'VALIDATION', message: 'Payment amount must be greater than zero' };
  }

  const roundedAmount = Math.round(amount * 100) / 100;
  const roundedPaid = Math.round(paidAmount * 100) / 100;
  const roundedTotal = Math.round(total * 100) / 100;
  const balance = calculateBalance(roundedTotal, roundedPaid);

  // Refund rules
  if (kind === 'refund') {
    if (role !== 'owner') {
      return { valid: false, error: 'FORBIDDEN', message: 'Refunds can only be recorded by shop owners' };
    }
    if (!note || note.trim().length === 0) {
      return { valid: false, error: 'VALIDATION', message: 'Refund requires a note explaining the reason' };
    }
    if (roundedAmount > roundedPaid) {
      return { valid: false, error: 'OVERPAYMENT', message: 'Refund exceeds paid amount' };
    }
    return { valid: true };
  }

  // Payments and Deposits: cannot exceed outstanding balance
  if (roundedAmount > balance) {
    return { valid: false, error: 'OVERPAYMENT', message: 'Payment amount exceeds the outstanding balance' };
  }

  return { valid: true };
}

/** Pure ledger calculation updating paid_amount */
export function applyLedgerEntry(
  currentPaid: number,
  kind: PaymentKind,
  amount: number
): number {
  const roundedCurrent = Math.round(currentPaid * 100);
  const roundedDelta = Math.round(amount * 100);

  let newCents: number;
  if (kind === 'refund') {
    newCents = roundedCurrent - roundedDelta;
  } else {
    newCents = roundedCurrent + roundedDelta;
  }

  return Math.max(0, newCents) / 100;
}
