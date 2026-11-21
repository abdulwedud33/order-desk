// tests/domain/timer.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAgeTimerInfo } from '../../src/domain/timer';

test('age timer returns neutral by default when well within promised time', () => {
  const createdAt = '2026-11-21T10:00:00Z';
  const dueAt = '2026-11-21T10:30:00Z'; // 30 min promised duration
  const now = new Date('2026-11-21T10:05:00Z'); // 5 min elapsed (16% of time)

  const timer = getAgeTimerInfo(createdAt, dueAt, now);
  assert.equal(timer.severity, 'neutral');
  assert.equal(timer.isLate, false);
  assert.equal(timer.ageMinutes, 5);
  assert.equal(timer.displayTimer, '5m');
});

test('age timer returns amber when approaching promised time (within 5 minutes)', () => {
  const createdAt = '2026-11-21T10:00:00Z';
  const dueAt = '2026-11-21T10:30:00Z';
  const now = new Date('2026-11-21T10:26:00Z'); // 4 min remaining (<= 5m)

  const timer = getAgeTimerInfo(createdAt, dueAt, now);
  assert.equal(timer.severity, 'amber');
  assert.equal(timer.isLate, false);
  assert.equal(timer.dueInMinutes, 4);
});

test('age timer returns red ONLY when promised time is exceeded (Late rule)', () => {
  const createdAt = '2026-11-21T10:00:00Z';
  const dueAt = '2026-11-21T10:30:00Z';
  const now = new Date('2026-11-21T10:38:00Z'); // 8 min overdue

  const timer = getAgeTimerInfo(createdAt, dueAt, now);
  assert.equal(timer.severity, 'red');
  assert.equal(timer.isLate, true);
  assert.equal(timer.minutesLate, 8);
  assert.equal(timer.displayTimer, '+8m');
});
