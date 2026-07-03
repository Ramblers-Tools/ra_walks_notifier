const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRecipients } = require('../src/config');

test('parseRecipients accepts comma-separated recipient strings', () => {
  assert.deepEqual(
    parseRecipients('first@example.com, second@example.com'),
    ['first@example.com', 'second@example.com']
  );
});

test('parseRecipients accepts newline-separated recipient strings', () => {
  assert.deepEqual(
    parseRecipients('first@example.com\nsecond@example.com'),
    ['first@example.com', 'second@example.com']
  );
});

test('parseRecipients accepts arrays and drops blanks', () => {
  assert.deepEqual(
    parseRecipients(['first@example.com', ' second@example.com, ']),
    ['first@example.com', 'second@example.com']
  );
});
