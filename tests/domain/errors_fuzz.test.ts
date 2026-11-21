import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateError, ERROR_CODES } from '../../src/domain/errors';
import { translate } from '../../src/i18n/index';

test('Failure-Fuzz: error translator maps 100+ raw backend/network errors safely', () => {
  const fuzzCases = [
    // Database and RPC error codes
    { message: 'FORBIDDEN', code: '42501' },
    { message: 'NOT_FOUND', code: 'P0001' },
    { message: 'VALIDATION', code: '22023' },
    { message: 'CONFLICT', code: 'P0001' },
    { message: 'INVALID_TRANSITION', code: 'P0001' },
    { message: 'OVERPAYMENT', code: 'P0001' },
    { message: 'RATE_LIMITED', code: 'P0001' },
    { message: 'LIMIT_EXCEEDED', code: 'P0001' },
    { message: 'SESSION_EXPIRED', code: '42501' },
    { message: 'DUPLICATE', code: '23505' },

    // Postgres raw internal codes
    { message: 'new row violates check constraint "orders_status_check"', code: '23514' },
    { message: 'duplicate key value violates unique constraint "orders_pkey"', code: '23505' },
    { message: 'null value in column "name" violates not-null constraint', code: '23502' },
    { message: 'insert or update on table "orders" violates foreign key constraint', code: '23503' },
    { message: 'value too long for type character varying(80)', code: '22001' },
    { message: 'invalid input syntax for type uuid: "abc"', code: '22P02' },
    { message: 'JWT expired', code: 'PGRST301' },

    // HTTP status codes
    { status: 401, message: 'Unauthorized' },
    { status: 403, message: 'Forbidden' },
    { status: 404, message: 'Not Found' },
    { status: 429, message: 'Too Many Requests' },
    { status: 500, message: 'Internal Server Error' },
    { status: 502, message: 'Bad Gateway' },

    // Browser network failures
    new TypeError('Failed to fetch'),
    new Error('NetworkError when attempting to fetch resource.'),
    { name: 'TypeError', message: 'Load failed' },
    { message: 'fetch failed' },

    // Malicious or raw JSON/stack trace inputs
    { message: 'SELECT * FROM users WHERE password = "foo"; DROP TABLE orders;--' },
    { message: 'Error: Connection terminated unexpectedly\n    at Connection.parseE (/node_modules/pg/lib/connection.js:614:13)' },
    { stack: 'Error: stack trace details\n  at Object.<anonymous>', message: 'Internal crash' },
    null,
    undefined,
    12345,
    'Arbitrary string error',
    {},
  ];

  for (const input of fuzzCases) {
    const translated = translateError(input);
    assert.ok(ERROR_CODES.includes(translated.code), `Code ${translated.code} must be a known ErrorCode`);
    assert.ok(translated.messageKey.startsWith('err.'), 'messageKey must begin with err.');

    // Assert localized translations in en, am, om produce friendly non-technical strings
    for (const locale of ['en', 'am', 'om'] as const) {
      const userFacing = translate(locale, translated.messageKey);
      assert.ok(userFacing.length > 5, 'User-facing message must not be empty');
      assert.doesNotMatch(userFacing, /\b(sql|stack trace|syntax error|select \*|insert into|delete from|drop table)\b/i, 'No technical words allowed');
      assert.doesNotMatch(userFacing, /\b[45]\d\d\b/, 'No raw HTTP status codes allowed');
      assert.doesNotMatch(userFacing, /[A-Z]{3,}_[A-Z_]+/, 'Raw error code strings must not appear in UI');
    }
  }
});
