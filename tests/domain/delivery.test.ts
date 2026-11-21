import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTelUri,
  formatMapUri,
  calculateAmountToCollect,
  isCourierAssignedToOrder,
} from '../../src/domain/delivery';

test('formatTelUri: validates standard Ethiopian phone numbers and formats tel: URI', () => {
  assert.equal(formatTelUri('+251911223344'), 'tel:+251911223344');
  assert.equal(formatTelUri('0911223344'), 'tel:0911223344');
  assert.equal(formatTelUri('0911 22 33 44'), 'tel:0911223344');
  assert.equal(formatTelUri('+251 (911) 22-33-44'), 'tel:+251911223344');
});

test('formatTelUri: rejects empty, invalid, and malicious phone inputs safely', () => {
  assert.equal(formatTelUri(''), '');
  assert.equal(formatTelUri(null), '');
  assert.equal(formatTelUri(undefined), '');
  assert.equal(formatTelUri('   '), '');
  assert.equal(formatTelUri('123'), ''); // too short (< 7 digits)
  assert.equal(formatTelUri('javascript:alert(1)'), ''); // protocol injection
  assert.equal(formatTelUri('<script>evil()</script>'), ''); // XSS
  assert.equal(formatTelUri('+251911223344\nmalicious'), ''); // newline injection
  assert.equal(formatTelUri('+251911223344;ext=123'), ''); // semicolon / uri control chars
});

test('formatMapUri: builds safely percent-encoded Google Maps link from address', () => {
  const basic = formatMapUri('Bole Atlas, Addis Ababa');
  assert.equal(basic, 'https://maps.google.com/?q=Bole%20Atlas%2C%20Addis%20Ababa');

  // Unicode / Amharic support
  const amharic = formatMapUri('ቦሌ መድኃኔዓለም');
  assert.equal(
    amharic,
    `https://maps.google.com/?q=${encodeURIComponent('ቦሌ መድኃኔዓለም')}`
  );
  assert.equal(
    decodeURIComponent(new URL(amharic).searchParams.get('q')!),
    'ቦሌ መድኃኔዓለም'
  );

  // Special characters and raw punctuation
  const complex = formatMapUri('House #45 & Road / 12? Behind Market');
  assert.equal(
    complex,
    'https://maps.google.com/?q=House%20%2345%20%26%20Road%20%2F%2012%3F%20Behind%20Market'
  );

  // Potential injection strings are safely URI-encoded, never raw HTML
  const xss = formatMapUri('"><script>alert("xss")</script>');
  assert.equal(
    xss,
    'https://maps.google.com/?q=%22%3E%3Cscript%3Ealert(%22xss%22)%3C%2Fscript%3E'
  );
});

test('formatMapUri: returns empty string for empty, null, or whitespace addresses', () => {
  assert.equal(formatMapUri(''), '');
  assert.equal(formatMapUri(null), '');
  assert.equal(formatMapUri(undefined), '');
  assert.equal(formatMapUri('   \n\t  '), '');
});

test('calculateAmountToCollect: computes balance due correctly', () => {
  assert.equal(calculateAmountToCollect(450, 0), 450);
  assert.equal(calculateAmountToCollect(450, 150), 300);
  assert.equal(calculateAmountToCollect(450, 450), 0);
  assert.equal(calculateAmountToCollect(450, 500), 0); // Overpayment edge case returns 0
  assert.equal(calculateAmountToCollect(320.555, 120.1), 200.46);
});

test('isCourierAssignedToOrder: checks delivery order and assignment strictly', () => {
  const courierId = '44444444-4444-4444-4444-444444444444';
  const otherCourierId = '99999999-9999-9999-9999-999999999999';

  assert.equal(
    isCourierAssignedToOrder({ type: 'delivery', assigned_to: courierId }, courierId),
    true
  );
  assert.equal(
    isCourierAssignedToOrder({ type: 'delivery', assigned_to: otherCourierId }, courierId),
    false
  );
  assert.equal(
    isCourierAssignedToOrder({ type: 'delivery', assigned_to: null }, courierId),
    false
  );
  assert.equal(
    isCourierAssignedToOrder({ type: 'dine_in', assigned_to: courierId }, courierId),
    false
  );
  assert.equal(
    isCourierAssignedToOrder({ type: 'delivery', assigned_to: courierId }, null),
    false
  );
});
