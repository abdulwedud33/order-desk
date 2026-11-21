import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchCustomers } from '../../src/domain/search';
import type { LocalCustomer } from '../../src/lib/db';

const TEST_CUSTOMERS: LocalCustomer[] = [
  { id: '1', shop_id: 's1', name: 'Abebe Bikila', phone: '0911223344', updated_at: '2026-11-21' },
  { id: '2', shop_id: 's1', name: 'Abel Tesfaye', phone: '0922334455', updated_at: '2026-11-21' },
  { id: '3', shop_id: 's1', name: 'Chaltu Gemeda', phone: '0933445566', updated_at: '2026-11-21' },
  { id: '4', shop_id: 's1', name: 'Dawit Tsige', phone: '0944556677', updated_at: '2026-11-21' },
  { id: '5', shop_id: 's1', name: 'Sara Abebe', phone: '0955667788', updated_at: '2026-11-21' },
];

test('search requires at least 2 characters', () => {
  assert.deepEqual(searchCustomers('', TEST_CUSTOMERS), []);
  assert.deepEqual(searchCustomers('a', TEST_CUSTOMERS), []);
  assert.deepEqual(searchCustomers('0', TEST_CUSTOMERS), []);
  assert.equal(searchCustomers('ab', TEST_CUSTOMERS).length, 3); // Abebe, Abel, Sara Abebe
});

test('prefix name matches rank ahead of substring matches', () => {
  const results = searchCustomers('abe', TEST_CUSTOMERS);
  assert.equal(results[0]?.name, 'Abebe Bikila');
  assert.equal(results[1]?.name, 'Abel Tesfaye');
  assert.equal(results[2]?.name, 'Sara Abebe');
});

test('searches by phone number digits', () => {
  const results = searchCustomers('3344', TEST_CUSTOMERS);
  assert.equal(results.length, 3); // Abebe (0911223344), Abel (0922334455), Chaltu (0933445566)
});

test('handles special characters and casing cleanly', () => {
  const results = searchCustomers('  CHALTU  ', TEST_CUSTOMERS);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.name, 'Chaltu Gemeda');
});
