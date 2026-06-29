const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRecipients, resolveRecipients, resolveSmtp, resolveGroups } = require('../src/config');

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

test('resolveSmtp lets config override env SMTP settings', () => {
  assert.deepEqual(
    resolveSmtp(
      {
        smtp: {
          host: 'smtp.config.example',
          port: 465,
          secure: true,
          user: 'config-user',
          pass: 'config-pass',
          fromName: 'Config Sender',
          from: 'sender@example.com'
        },
        notificationRecipients: ['recipient@example.com']
      },
      {
        SMTP_HOST: 'smtp.env.example',
        SMTP_PORT: '587',
        SMTP_SECURE: 'false',
        SMTP_USER: 'env-user',
        SMTP_PASS: 'env-pass',
        MAIL_FROM_NAME: 'Env Sender',
        MAIL_FROM: 'env@example.com',
        MAIL_TO: 'env-recipient@example.com'
      }
    ),
    {
      host: 'smtp.config.example',
      port: 465,
      secure: true,
      user: 'config-user',
      pass: 'config-pass',
      fromName: 'Config Sender',
      from: 'sender@example.com',
      to: ['recipient@example.com']
    }
  );
});

test('resolveGroups uses configured group selection before fallback groups', () => {
  assert.deepEqual(
    resolveGroups(
      { groups: [{ name: 'Sheffield Group', gid: '229' }] },
      [{ name: 'East Cheshire Group', gid: 414 }]
    ),
    [{ name: 'Sheffield Group', gid: 229 }]
  );
});

test('resolveGroups falls back when no group has been selected', () => {
  assert.deepEqual(
    resolveGroups(
      { groups: [] },
      [{ name: 'East Cheshire Group', gid: 414 }]
    ),
    [{ name: 'East Cheshire Group', gid: 414 }]
  );
});
