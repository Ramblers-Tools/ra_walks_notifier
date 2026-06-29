const test = require('node:test');
const assert = require('node:assert/strict');
const { isWithinActiveHours, normalizeSchedule } = require('../src/schedule');

test('normalizeSchedule keeps configured interval and active hours', () => {
  assert.deepEqual(
    normalizeSchedule({ checkIntervalMinutes: 15, activeHours: { start: 8, end: 20 } }),
    { checkIntervalMinutes: 15, activeHours: { start: 8, end: 20 } }
  );
});

test('normalizeSchedule falls back to safe defaults', () => {
  assert.deepEqual(
    normalizeSchedule({ checkIntervalMinutes: 0, activeHours: { start: 'bad', end: 99 } }),
    { checkIntervalMinutes: 5, activeHours: { start: 7, end: 23 } }
  );
});

test('isWithinActiveHours handles same-day active windows', () => {
  assert.equal(isWithinActiveHours({ start: 7, end: 22 }, 6), false);
  assert.equal(isWithinActiveHours({ start: 7, end: 22 }, 7), true);
  assert.equal(isWithinActiveHours({ start: 7, end: 22 }, 21), true);
  assert.equal(isWithinActiveHours({ start: 7, end: 22 }, 22), false);
});

test('isWithinActiveHours handles overnight active windows', () => {
  assert.equal(isWithinActiveHours({ start: 22, end: 7 }, 21), false);
  assert.equal(isWithinActiveHours({ start: 22, end: 7 }, 22), true);
  assert.equal(isWithinActiveHours({ start: 22, end: 7 }, 3), true);
  assert.equal(isWithinActiveHours({ start: 22, end: 7 }, 7), false);
});

test('isWithinActiveHours treats matching start and end as all day', () => {
  assert.equal(isWithinActiveHours({ start: 0, end: 0 }, 13), true);
});
