import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePickupCode,
  checkEstimateThreshold,
  calculateTurnaroundHours,
  formatTurnaroundHours,
  buildStatusNotificationMessage,
} from '../../src/domain/repair';

test('generatePickupCode produces a 4-digit numeric string', () => {
  for (let i = 0; i < 50; i++) {
    const code = generatePickupCode();
    assert.match(code, /^\d{4}$/, `Code ${code} must be exactly 4 digits`);
    const num = parseInt(code, 10);
    assert.ok(num >= 1000 && num <= 9999, 'Code must be between 1000 and 9999');
  }
});

test('checkEstimateThreshold: total above approved estimate triggers isExceeded', () => {
  // 1. Within estimate
  const under = checkEstimateThreshold(800, 1000);
  assert.equal(under.isExceeded, false);
  assert.equal(under.valid, true);

  // 2. Exact match
  const exact = checkEstimateThreshold(1000, 1000);
  assert.equal(exact.isExceeded, false);
  assert.equal(exact.valid, true);

  // 3. Exceeded: total > approved estimate
  const over = checkEstimateThreshold(1200, 1000);
  assert.equal(over.isExceeded, true);
  assert.equal(over.valid, false);

  // 4. No estimate set
  const none = checkEstimateThreshold(1200, null);
  assert.equal(none.isExceeded, false);
  assert.equal(none.valid, true);
});

test('calculateTurnaroundHours computes elapsed hours accurately', () => {
  const start = '2026-11-21T08:00:00.000Z';
  const end2h = '2026-11-21T10:00:00.000Z';
  const end30m = '2026-11-21T08:30:00.000Z';
  const end1d4h = '2026-11-22T12:00:00.000Z';

  assert.equal(calculateTurnaroundHours(start, end2h), 2);
  assert.equal(calculateTurnaroundHours(start, end30m), 0.5);
  assert.equal(calculateTurnaroundHours(start, end1d4h), 28);
});

test('formatTurnaroundHours formats minutes, hours, and days human-readably', () => {
  assert.equal(formatTurnaroundHours(0.4), '24m');
  assert.equal(formatTurnaroundHours(2.0), '2h');
  assert.equal(formatTurnaroundHours(14.0), '14h');
  assert.equal(formatTurnaroundHours(24.0), '1d');
  assert.equal(formatTurnaroundHours(28.0), '1d 4h');
  assert.equal(formatTurnaroundHours(50.0), '2d 2h');
});

test('buildStatusNotificationMessage generates correct wording across en, am, and om', () => {
  // English
  const enMsg = buildStatusNotificationMessage({
    shopName: 'QuickFix',
    orderCode: 'A-012',
    statusLabel: 'Ready for Pickup',
    customerFirstName: 'Abebe',
    locale: 'en',
  });
  assert.ok(enMsg.includes('Hello Abebe, this is QuickFix. Your order A-012 is Ready for Pickup. Thank you.'));

  // Amharic (contains Ge'ez script)
  const amMsg = buildStatusNotificationMessage({
    shopName: 'ፈጣን ጥገና',
    orderCode: 'A-012',
    statusLabel: 'ተጠናቋል',
    customerFirstName: 'አበበ',
    locale: 'am',
  });
  assert.match(amMsg, /[\u1200-\u137F]/);
  assert.ok(amMsg.includes('አበበ'));
  assert.ok(amMsg.includes('A-012'));
  assert.ok(amMsg.includes('ተጠናቋል'));

  // Afaan Oromo (Latin script)
  const omMsg = buildStatusNotificationMessage({
    shopName: 'QuickFix',
    orderCode: 'A-012',
    statusLabel: 'Qophii',
    customerFirstName: 'Chala',
    locale: 'om',
  });
  assert.doesNotMatch(omMsg, /[\u1200-\u137F]/);
  assert.ok(omMsg.includes('Chala'));
  assert.ok(omMsg.includes('A-012'));
  assert.ok(omMsg.includes('Qophii'));
});
