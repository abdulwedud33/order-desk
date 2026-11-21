import { test } from 'node:test';
import assert from 'node:assert/strict';
import { en } from '../../src/i18n/en';
import { am } from '../../src/i18n/am';
import { om } from '../../src/i18n/om';
import { translate } from '../../src/i18n/index';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every locale defines exactly the same keys as English', () => {
  const keys = Object.keys(en).sort();
  assert.deepEqual(Object.keys(am).sort(), keys);
  assert.deepEqual(Object.keys(om).sort(), keys);
});

test('placeholders match across languages and no message is empty', () => {
  for (const [key, text] of Object.entries(en)) {
    for (const [name, catalog] of [['am', am], ['om', om]] as const) {
      const other = (catalog as Record<string, string>)[key]!;
      assert.ok(other.trim().length > 0, `${name}:${key} is empty`);
      assert.equal(placeholders(other), placeholders(text), `${name}:${key} placeholders differ`);
    }
  }
});

test("Amharic text contains Ge'ez script and Afaan Oromo stays Latin", () => {
  assert.match(am['nav.board'], /[\u1200-\u137F]/);
  assert.doesNotMatch(om['nav.board'], /[\u1200-\u137F]/);
});

test('translate fills placeholders and falls back safely', () => {
  assert.equal(translate('en', 'join.success', { shopName: 'Abel Cafe' }), 'You have successfully joined Abel Cafe.');
  assert.equal(translate('am', 'join.success', { shopName: 'አቤል ካፌ' }), 'አቤል ካፌ በተሳካ ሁኔታ ተቀላቅለዋል።');
  assert.equal(translate('om', 'join.success', { shopName: 'Abel Cafe' }), 'Abel Cafe milkaa\'inaan makamtaniittu.');
});

test('error messages never expose technical text or codes', () => {
  for (const catalog of [en, am, om] as Record<string, string>[]) {
    for (const [k, v] of Object.entries(catalog)) {
      if (!k.startsWith('err.')) continue;
      assert.doesNotMatch(v, /sql|stack trace|exception|postgres|supabase|\b[45]\d\d\b/i, `${k}: technical terms found`);
      assert.doesNotMatch(v, /[A-Z]{3,}_[A-Z_]+/, `${k} must not contain an error code`);
    }
  }
});
