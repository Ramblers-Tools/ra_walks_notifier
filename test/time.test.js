const test = require('node:test');
const assert = require('node:assert/strict');
const { formatUkDateTime } = require('../src/time');

test('formats timestamps in UK time including daylight saving', () => {
  assert.equal(
    formatUkDateTime('2026-06-28T11:00:00.000Z'),
    '28/06/2026 12:00:00 BST'
  );
});

test('keeps already formatted non-ISO values unchanged', () => {
  assert.equal(formatUkDateTime('28/06/2026 12:00:00 BST'), '28/06/2026 12:00:00 BST');
});
