// tests/domain/payments.test.ts
// Unit tests and property-style test for payment ledger invariants, overpayment, refund limits, and balance status

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getBalanceStatus,
  calculateBalance,
  validatePayment,
  applyLedgerEntry,
  type PaymentKind,
  type PayMethod,
} from '../../src/domain/payments';

test('balance chip status maps correctly to financial state', () => {
  assert.equal(getBalanceStatus(200, 0, false), 'unpaid');
  assert.equal(getBalanceStatus(200, 50, false), 'partial');
  assert.equal(getBalanceStatus(200, 200, false), 'paid');
  assert.equal(getBalanceStatus(200, 250, false), 'paid'); // edge case overpaid
  assert.equal(getBalanceStatus(200, 50, true), 'settle_later');
  assert.equal(getBalanceStatus(200, 0, true), 'settle_later');
  assert.equal(getBalanceStatus(200, 200, true), 'paid'); // paid trumps settle_later
});

test('calculateBalance rounds correctly to santim and prevents negative balance', () => {
  assert.equal(calculateBalance(200, 0), 200);
  assert.equal(calculateBalance(200, 150.25), 49.75);
  assert.equal(calculateBalance(200, 200), 0);
  assert.equal(calculateBalance(200, 250), 0);
});

test('overpayment is strictly blocked on payments and deposits', () => {
  // Balance is 100
  const validationOver = validatePayment({
    total: 200,
    paidAmount: 100,
    amount: 100.01,
    kind: 'payment',
    role: 'staff',
    method: 'cash',
  });
  assert.equal(validationOver.valid, false);
  assert.equal(validationOver.error, 'OVERPAYMENT');

  const validationDepositOver = validatePayment({
    total: 200,
    paidAmount: 100,
    amount: 150,
    kind: 'deposit',
    role: 'staff',
    method: 'mobile_money',
  });
  assert.equal(validationDepositOver.valid, false);
  assert.equal(validationDepositOver.error, 'OVERPAYMENT');

  // Exact balance succeeds
  const validationExact = validatePayment({
    total: 200,
    paidAmount: 100,
    amount: 100,
    kind: 'payment',
    role: 'staff',
    method: 'cash',
  });
  assert.equal(validationExact.valid, true);
});

test('refund limits: owner only, note required, capped at paid_amount', () => {
  // Staff cannot refund
  const staffRefund = validatePayment({
    total: 200,
    paidAmount: 100,
    amount: 50,
    kind: 'refund',
    role: 'staff',
    method: 'cash',
    note: 'Customer return',
  });
  assert.equal(staffRefund.valid, false);
  assert.equal(staffRefund.error, 'FORBIDDEN');

  // Owner without note cannot refund
  const noNoteRefund = validatePayment({
    total: 200,
    paidAmount: 100,
    amount: 50,
    kind: 'refund',
    role: 'owner',
    method: 'cash',
    note: '   ',
  });
  assert.equal(noNoteRefund.valid, false);
  assert.equal(noNoteRefund.error, 'VALIDATION');

  // Owner refund exceeding paid amount fails
  const overRefund = validatePayment({
    total: 200,
    paidAmount: 100,
    amount: 100.01,
    kind: 'refund',
    role: 'owner',
    method: 'cash',
    note: 'Customer return',
  });
  assert.equal(overRefund.valid, false);
  assert.equal(overRefund.error, 'OVERPAYMENT');

  // Valid owner refund succeeds
  const validRefund = validatePayment({
    total: 200,
    paidAmount: 100,
    amount: 50,
    kind: 'refund',
    role: 'owner',
    method: 'cash',
    note: 'Customer return',
  });
  assert.equal(validRefund.valid, true);
});

test('courier role limits: assigned deliveries and cash payment only', () => {
  // Courier unassigned
  assert.equal(
    validatePayment({
      total: 300,
      paidAmount: 0,
      amount: 300,
      kind: 'payment',
      role: 'courier',
      method: 'cash',
      isAssignedDelivery: false,
    }).error,
    'FORBIDDEN'
  );

  // Courier mobile money
  assert.equal(
    validatePayment({
      total: 300,
      paidAmount: 0,
      amount: 300,
      kind: 'payment',
      role: 'courier',
      method: 'mobile_money',
      isAssignedDelivery: true,
    }).error,
    'FORBIDDEN'
  );

  // Courier refund
  assert.equal(
    validatePayment({
      total: 300,
      paidAmount: 300,
      amount: 100,
      kind: 'refund',
      role: 'courier',
      method: 'cash',
      note: 'Return',
      isAssignedDelivery: true,
    }).error,
    'FORBIDDEN'
  );

  // Valid courier cash payment on assigned delivery
  assert.equal(
    validatePayment({
      total: 300,
      paidAmount: 0,
      amount: 300,
      kind: 'payment',
      role: 'courier',
      method: 'cash',
      isAssignedDelivery: true,
    }).valid,
    true
  );
});

test('property-style: ledger sum equals paid_amount after random operation sequences', () => {
  const KINDS: PaymentKind[] = ['payment', 'deposit', 'refund'];
  const METHODS: PayMethod[] = ['cash', 'mobile_money', 'bank', 'other'];

  // Run 50 simulated random sequences
  for (let run = 0; run < 50; run++) {
    const total = 100 + Math.floor(Math.random() * 2000); // 100 to 2100 ETB
    let paidAmount = 0;
    const ledger: Array<{ kind: PaymentKind; amount: number }> = [];

    // 25 operations per sequence
    for (let op = 0; op < 25; op++) {
      const kind = KINDS[Math.floor(Math.random() * KINDS.length)]!;
      const method = METHODS[Math.floor(Math.random() * METHODS.length)]!;
      // Generate random amounts: some small, some exact, some exceeding
      const rawAmount = Math.round((Math.random() * (total + 50)) * 100) / 100;
      const amount = Math.max(1, rawAmount);

      const validation = validatePayment({
        total,
        paidAmount,
        amount,
        kind,
        role: 'owner',
        method,
        note: kind === 'refund' ? 'Legitimate test refund note' : undefined,
      });

      if (validation.valid) {
        paidAmount = applyLedgerEntry(paidAmount, kind, amount);
        ledger.push({ kind, amount });
      }

      // Invariant: sum of payments and deposits minus refunds must strictly equal paidAmount to the santim
      const expectedLedgerSumCents = ledger.reduce((acc, entry) => {
        const cents = Math.round(entry.amount * 100);
        return entry.kind === 'refund' ? acc - cents : acc + cents;
      }, 0);

      const expectedPaidAmount = Math.max(0, expectedLedgerSumCents) / 100;
      assert.equal(
        paidAmount,
        expectedPaidAmount,
        `Ledger sum mismatch in run ${run} op ${op}: expected ${expectedPaidAmount}, got ${paidAmount}`
      );
      assert.ok(paidAmount >= 0, 'paid_amount must never be negative');
      assert.ok(paidAmount <= total, 'paid_amount must never exceed total');
    }
  }
});

test('idempotent replay prevents double counting ledger entries', () => {
  let paidAmount = 0;
  const processedClientIds = new Set<string>();

  function record(clientId: string, amount: number): void {
    if (processedClientIds.has(clientId)) {
      // Replay: no-op
      return;
    }
    processedClientIds.add(clientId);
    paidAmount = applyLedgerEntry(paidAmount, 'payment', amount);
  }

  record('client-uuid-1', 75.5);
  assert.equal(paidAmount, 75.5);

  // Replay
  record('client-uuid-1', 75.5);
  assert.equal(paidAmount, 75.5);

  // Second unique payment
  record('client-uuid-2', 24.5);
  assert.equal(paidAmount, 100);

  // Replay first again
  record('client-uuid-1', 75.5);
  assert.equal(paidAmount, 100);
});
