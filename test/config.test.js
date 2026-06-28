const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRecipients, resolveRecipients } = require('../src/config');

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

test('resolveRecipients lets menu-managed config override env recipients', () => {
  assert.deepEqual(
    resolveRecipients(
      { notificationRecipients: ['menu@example.com'] },
      { MAIL_TO: 'env@example.com' }
    ),
    ['menu@example.com']
  );
});

test('resolveRecipients falls back to env recipients when config is empty', () => {
  assert.deepEqual(
    resolveRecipients(
      { notificationRecipients: [] },
      { MAIL_TO: 'env@example.com, second@example.com' }
    ),
    ['env@example.com', 'second@example.com']
  );
});
