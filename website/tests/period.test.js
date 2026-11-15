'use strict';
// Tests for the period / comparison rules (run with: npm test).
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePeriod } = require('../server/query');
const C = require('../server/calc');

const cfg = { weekStart: 6, numbering: 'jan1', workDays: [6, 0, 1, 2, 3, 4] }; // Saturday start, Friday off

test('a running week is compared with the same days of the previous week', () => {
  // data ends on Saturday 14 Nov 2026, the first day of WK47
  const { period, compare } = resolvePeriod({}, { min: '2026-08-01', max: '2026-11-14' }, cfg);
  assert.equal(period.from, '2026-11-14');
  assert.equal(period.partial, true);
  assert.equal(period.elapsedWorkDays, 1);
  assert.equal(period.workDays, 6);
  assert.equal(compare.from, '2026-11-07');
  assert.equal(compare.to, '2026-11-07');
  assert.equal(compare.sameDays, true);
  assert.equal(compare.short, 'WK46');
  assert.match(compare.label, /^WK46 \(7 Nov\)$/);
});

test('a complete week is compared with the full previous week', () => {
  const { period, compare } = resolvePeriod({ week: '202646' }, { min: '2026-08-01', max: '2026-11-14' }, cfg);
  assert.equal(period.partial, undefined);
  assert.equal(C.daysBetween(compare.from, compare.to), 6);
  assert.equal(compare.label, 'WK45');
});

test('a running week keeps the same days when compared with 4 weeks earlier', () => {
  const { compare } = resolvePeriod({ cmp: 'month' }, { min: '2026-08-01', max: '2026-11-16' }, cfg);
  assert.equal(compare.from, '2026-10-17');
  assert.equal(compare.to, '2026-10-19');
});

test('a custom comparison is never changed', () => {
  const { compare } = resolvePeriod({ cmp: 'custom', cfrom: '2026-10-01', cto: '2026-10-31' }, { min: '2026-08-01', max: '2026-11-14' }, cfg);
  assert.equal(compare.from, '2026-10-01');
  assert.equal(compare.to, '2026-10-31');
});
