const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLeaderEmailSettings,
  leaderEmailConfigured,
  shouldSendSubmitted,
  shouldSendPublished,
  lookupLeaderEmail
} = require('../src/leaderEmail');

test('leader email settings default to enabled but require API details', () => {
  assert.deepEqual(
    normalizeLeaderEmailSettings({}),
    {
      enabled: true,
      sendOnSubmit: true,
      sendOnPublish: true,
      apiBaseUrl: '',
      apiToken: ''
    }
  );
  assert.equal(leaderEmailConfigured({}), false);
});

test('submitted and published leader email triggers use review status safely', () => {
  assert.equal(shouldSendSubmitted({ status: 'Submitted for checking' }), true);
  assert.equal(shouldSendSubmitted({ status: 'Ready to publish' }), false);
  assert.equal(shouldSendPublished({ status: 'Ready to publish' }), true);
  assert.equal(shouldSendPublished({ status: 'Awaiting publishing' }), true);
  assert.equal(shouldSendPublished({ status: 'Submitted for checking' }), false);
});

test('lookupLeaderEmail prefers exact profile matches over role-wrapped matches', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        data: [
          {
            type: 'profiles',
            id: '8',
            attributes: {
              preferred_name: 'Richard Higham',
              email: 'me@example.org'
            }
          },
          {
            type: 'profiles',
            id: '1',
            attributes: {
              preferred_name: 'Webmaster Richard Higham',
              email: 'webmaster@example.org'
            }
          }
        ]
      };
    }
  });

  try {
    assert.deepEqual(
      await lookupLeaderEmail('Richard Higham', { apiBaseUrl: 'https://example.org/api/index.php/v1', apiToken: 'token' }),
      {
        email: 'me@example.org',
        record: {
          type: 'profiles',
          id: '8',
          attributes: {
            preferred_name: 'Richard Higham',
            email: 'me@example.org'
          }
        }
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('lookupLeaderEmail refuses ambiguous matches', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        data: [
          { attributes: { preferred_name: 'Richard Higham', email: 'one@example.org' } },
          { attributes: { preferred_name: 'Richard Higham', email: 'two@example.org' } }
        ]
      };
    }
  });

  try {
    assert.deepEqual(
      await lookupLeaderEmail('Richard Higham', { apiBaseUrl: 'https://example.org/api/index.php/v1', apiToken: 'token' }),
      { email: '', reason: '2 matching leader profiles' }
    );
  } finally {
    global.fetch = originalFetch;
  }
});
