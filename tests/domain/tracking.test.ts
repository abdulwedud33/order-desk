import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidTrackingToken,
  isTokenExpired,
  formatTrackingResponse,
  calculateTrackingStepper,
  TrackingRateLimiter,
  type TrackingLookupData,
} from '../../src/domain/tracking';

test('isValidTrackingToken: validates base64url and length constraints', () => {
  // Valid 22-char base64url token (128-bit random)
  assert.equal(isValidTrackingToken('abc123XYZ_-45678901234'), true);
  assert.equal(isValidTrackingToken('1234567890123456'), true); // 16 chars min
  assert.equal(isValidTrackingToken('A'.repeat(64)), true); // 64 chars max

  // Invalid tokens
  assert.equal(isValidTrackingToken(''), false);
  assert.equal(isValidTrackingToken(null), false);
  assert.equal(isValidTrackingToken(undefined), false);
  assert.equal(isValidTrackingToken('short'), false); // < 16 chars
  assert.equal(isValidTrackingToken('A'.repeat(65)), false); // > 64 chars
  assert.equal(isValidTrackingToken('token with spaces!'), false);
  assert.equal(isValidTrackingToken('<script>alert(1)</script>'), false);
  assert.equal(isValidTrackingToken("' OR 1=1 --"), false);
});

test('isTokenExpired: enforces 30-day cancellation and 60-day completion expiration windows', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Active open orders never expire
  assert.equal(
    isTokenExpired({ status: 'new', updated_at: '2026-01-01T00:00:00Z' }, now),
    false
  );
  assert.equal(
    isTokenExpired({ status: 'in_progress', updated_at: '2026-01-01T00:00:00Z' }, now),
    false
  );
  assert.equal(
    isTokenExpired({ status: 'ready', updated_at: '2026-01-01T00:00:00Z' }, now),
    false
  );
  assert.equal(
    isTokenExpired({ status: 'out_for_delivery', updated_at: '2026-01-01T00:00:00Z' }, now),
    false
  );

  // Cancelled orders: 30 days window
  const cancelled20DaysAgo = new Date(now.getTime() - 20 * DAY_MS).toISOString();
  assert.equal(
    isTokenExpired({ status: 'cancelled', cancelled_at: cancelled20DaysAgo }, now),
    false
  );

  const cancelled31DaysAgo = new Date(now.getTime() - 31 * DAY_MS).toISOString();
  assert.equal(
    isTokenExpired({ status: 'cancelled', cancelled_at: cancelled31DaysAgo }, now),
    true
  );

  // Completed orders: 60 days window
  const completed50DaysAgo = new Date(now.getTime() - 50 * DAY_MS).toISOString();
  assert.equal(
    isTokenExpired({ status: 'completed', completed_at: completed50DaysAgo }, now),
    false
  );

  const completed61DaysAgo = new Date(now.getTime() - 61 * DAY_MS).toISOString();
  assert.equal(
    isTokenExpired({ status: 'completed', completed_at: completed61DaysAgo }, now),
    true
  );
});

test('formatTrackingResponse: strictly exposes only minimal public fields and strips personal data', () => {
  const rawDbPayload: TrackingLookupData = {
    shop_name: 'Bole Express Cafe',
    business_type: 'food',
    order_code: 'A-012',
    order_type: 'delivery',
    status: 'ready',
    due_at: '2026-11-21T12:30:00Z',
    updated_at: '2026-11-21T12:05:00Z',

    // Sensitive fields that might come from joined DB tables:
    phone: '+251911223344',
    address: 'Bole Medhanialem, House 42',
    customer_name: 'Abebe Bikila',
    items: [{ name: 'Burger', price: 250, qty: 2 }],
    total: 500,
    paid_amount: 500,
    id: 'e6b84013-0975-4702-8618-9366df0e2cf7',
  };

  const response = formatTrackingResponse(rawDbPayload);

  assert.equal(response.found, true);
  if (response.found) {
    assert.equal(response.shop_name, 'Bole Express Cafe');
    assert.equal(response.business_type, 'food');
    assert.equal(response.order_code, 'A-012');
    assert.equal(response.order_type, 'delivery');
    assert.equal(response.status, 'ready');
    assert.equal(response.due_at, '2026-11-21T12:30:00Z');
    assert.equal(response.updated_at, '2026-11-21T12:05:00Z');

    // Security assertion: None of the sensitive keys must exist in response
    const keys = Object.keys(response);
    assert.equal(keys.includes('phone'), false);
    assert.equal(keys.includes('address'), false);
    assert.equal(keys.includes('customer_name'), false);
    assert.equal(keys.includes('name'), false);
    assert.equal(keys.includes('items'), false);
    assert.equal(keys.includes('prices'), false);
    assert.equal(keys.includes('total'), false);
    assert.equal(keys.includes('paid_amount'), false);
    assert.equal(keys.includes('id'), false);
  }

  // Not found gives generic calm answer
  const notFound = formatTrackingResponse(null);
  assert.equal(notFound.found, false);
  if (!notFound.found) {
    assert.equal(notFound.message, "We couldn't find this order.");
  }
});

test('calculateTrackingStepper: calculates correct milestone stepper per order type and status', () => {
  // Food dine-in
  const foodProgress = calculateTrackingStepper('dine_in', 'in_progress');
  assert.equal(foodProgress.isCancelled, false);
  assert.equal(foodProgress.steps.length, 4);
  assert.equal(foodProgress.steps[0]?.isCompleted, true); // received is completed
  assert.equal(foodProgress.steps[1]?.isCurrent, true); // preparing is current

  // Delivery order out for delivery
  const deliveryOut = calculateTrackingStepper('delivery', 'out_for_delivery');
  assert.equal(deliveryOut.steps.length, 5);
  assert.equal(deliveryOut.steps[2]?.isCompleted, true); // ready is completed
  assert.equal(deliveryOut.steps[3]?.isCurrent, true); // out_for_delivery is current
  assert.equal(deliveryOut.steps[4]?.isCompleted, false); // delivered is not completed

  // Repair order completed
  const repairComplete = calculateTrackingStepper('repair', 'completed');
  assert.equal(repairComplete.steps.length, 4);
  assert.equal(repairComplete.steps.every((s) => s.isCompleted), true);

  // Cancelled order
  const cancelled = calculateTrackingStepper('dine_in', 'cancelled');
  assert.equal(cancelled.isCancelled, true);
});

test('TrackingRateLimiter: enforces 30/min per IP and 10/min per token limits', () => {
  const limiter = new TrackingRateLimiter(30, 10, 60_000);
  const now = 100_000;
  const ip = '192.168.1.100';
  const token = 'abc123xyz_token_4567';

  // 10 requests with token succeed
  for (let i = 0; i < 10; i++) {
    const res = limiter.check(ip, token, now + i);
    assert.equal(res.allowed, true);
  }

  // 11th request with the same token exceeds token rate limit
  const tokenExceeded = limiter.check(ip, token, now + 11);
  assert.equal(tokenExceeded.allowed, false);
  assert.equal(typeof tokenExceeded.retryAfter, 'number');

  // But another token from the same IP can still proceed until IP limit (30) is reached
  const otherToken = 'different_token_778899';
  const otherTokenRes = limiter.check(ip, otherToken, now + 12);
  assert.equal(otherTokenRes.allowed, true);

  // After 20 more requests from this IP (total 10 + 1 + 19 = 30), IP limit is reached
  for (let i = 0; i < 19; i++) {
    limiter.check(ip, `token_${i}_unique`, now + 20 + i);
  }

  // 31st request from this IP fails even with new token
  const ipExceeded = limiter.check(ip, 'yet_another_token_9999', now + 50);
  assert.equal(ipExceeded.allowed, false);
  assert.equal(typeof ipExceeded.retryAfter, 'number');

  // Advance time past 60s window: requests allowed again
  const nextWindow = limiter.check(ip, token, now + 65_000);
  assert.equal(nextWindow.allowed, true);
});
