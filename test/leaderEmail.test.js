const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLeaderEmailSettings,
  leaderEmailConfigured,
  shouldSendSubmitted,
  shouldSendPublished,
  lookupLeaderEmail,
  testLeaderEmailApi,
  leaderEmailHtml,
  confirmWalkPublished,
  isAllowedTestLeaderEmail
} = require('../src/leaderEmail');

test('leader email settings default to disabled and require API details', () => {
  assert.deepEqual(
    normalizeLeaderEmailSettings({}),
    {
      enabled: false,
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
  assert.equal(
    shouldSendPublished(
      { id: 'walk-1', status: 'Submitted for checking' },
      { leaderEmails: { submitted: { 'walk-1': { email: 'leader@example.org' } } } }
    ),
    true
  );
});

test('leader email template can use distinct header colours', () => {
  const submitted = leaderEmailHtml('Walk submitted', ['Thanks'], { title: 'Test walk', date: 'Tuesday' }, { headerBackground: '#5f6872' });
  const published = leaderEmailHtml('Walk published', ['Published'], { title: 'Test walk', date: 'Tuesday' }, { headerBackground: '#173b2f' });

  assert.match(submitted, /background:#5f6872;color:#ffffff/);
  assert.match(published, /background:#173b2f;color:#ffffff/);
});

test('confirmWalkPublished accepts a public page containing the walk title', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return '<html><h1>RH test walk</h1><p>Walk details</p></html>';
    }
  });

  try {
    assert.deepEqual(
      await confirmWalkPublished({ href: 'https://example.org/walk', title: 'RH test walk' }),
      { ok: true }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('confirmWalkPublished rejects missing or deleted public pages', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 404,
    async text() {
      return 'Page not found';
    }
  });

  try {
    assert.deepEqual(
      await confirmWalkPublished({ href: 'https://example.org/deleted-walk', title: 'Deleted walk' }),
      { ok: false, reason: 'public walk page returned HTTP 404' }
    );
  } finally {
    global.fetch = originalFetch;
  }
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

test('testLeaderEmailApi reports missing API settings clearly', async () => {
  assert.deepEqual(
    await testLeaderEmailApi({ apiBaseUrl: '', apiToken: '' }),
    { ok: false, message: 'Enter the Joomla API URL and token first.' }
  );
});

test('testLeaderEmailApi confirms a resolved profile', async () => {
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
          }
        ]
      };
    }
  });

  try {
    assert.deepEqual(
      await testLeaderEmailApi({ apiBaseUrl: 'https://example.org/api/index.php/v1', apiToken: 'token' }),
      { ok: true, message: 'API connected. Found Richard Higham <me@example.org>.' }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('leader email test gate only allows the configured test leader', () => {
  assert.equal(isAllowedTestLeaderEmail('me@richyhigham.uk', {}), true);
  assert.equal(isAllowedTestLeaderEmail('other.leader@example.org', {}), false);
  assert.equal(
    isAllowedTestLeaderEmail('other.leader@example.org', { testAllowedEmails: ['other.leader@example.org'] }),
    true
  );
});
