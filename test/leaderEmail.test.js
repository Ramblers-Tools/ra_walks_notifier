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
  isAllowedTestLeaderEmail,
  missingContactPreferences,
  contactPreferenceNotes
} = require('../src/leaderEmail');

test('leader email settings default to disabled and require API details', () => {
  assert.deepEqual(
    normalizeLeaderEmailSettings({}),
    {
      enabled: false,
      sendOnSubmit: true,
      sendOnPublish: true,
      apiBaseUrl: '',
      apiToken: '',
      notifyOnLookupFailure: false,
      lookupFailureNotifyAddress: ''
    }
  );
  assert.equal(leaderEmailConfigured({}), false);
});

test('leader email settings read the lookup-failure notification option', () => {
  assert.deepEqual(
    normalizeLeaderEmailSettings({
      leaderEmails: { notifyOnLookupFailure: true, lookupFailureNotifyAddress: ' admin@example.org ' }
    }),
    {
      enabled: false,
      sendOnSubmit: true,
      sendOnPublish: true,
      apiBaseUrl: '',
      apiToken: '',
      notifyOnLookupFailure: true,
      lookupFailureNotifyAddress: 'admin@example.org'
    }
  );
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

test('missingContactPreferences reports nothing when preferences are absent or all enabled', () => {
  assert.deepEqual(missingContactPreferences({}), []);
  assert.deepEqual(
    missingContactPreferences({ leaderContactPreferences: { phone: true, email: true, personalInfo: true } }),
    []
  );
});

test('missingContactPreferences lists only the disabled preferences', () => {
  assert.deepEqual(
    missingContactPreferences({ leaderContactPreferences: { phone: false, email: true, personalInfo: false } }),
    ['phone', 'personalInfo']
  );
});

test('contactPreferenceNotes is empty when nothing is missing', () => {
  assert.deepEqual(contactPreferenceNotes([]), []);
});

test('contactPreferenceNotes highlights a missing name in red with the alias explanation, plus one shared link', () => {
  assert.deepEqual(contactPreferenceNotes(['personalInfo']), [
    {
      red: true,
      text: 'We recommend sharing at least your name with walkers (please note the public listing will not show your full name, but your first name and the first initial of your surname, for example "John S.").',
      html: 'We recommend sharing at least your name with walkers (please note the public listing will not show your full name, but your first name and the first initial of your surname, for example &quot;John S.&quot;).'
    },
    {
      red: false,
      text: 'You can update your preferences here: https://walks-manager.ramblers.org.uk/user/contact-preferences',
      html: 'You can update your preferences <a href="https://walks-manager.ramblers.org.uk/user/contact-preferences">here</a>.'
    }
  ]);
});

test('contactPreferenceNotes keeps phone/email note un-highlighted, joins with "and", and links once', () => {
  assert.deepEqual(contactPreferenceNotes(['phone', 'email']), [
    {
      red: false,
      text: 'Your phone number and email address are currently not shared with walkers.',
      html: 'Your phone number and email address are currently not shared with walkers.'
    },
    {
      red: false,
      text: 'You can update your preferences here: https://walks-manager.ramblers.org.uk/user/contact-preferences',
      html: 'You can update your preferences <a href="https://walks-manager.ramblers.org.uk/user/contact-preferences">here</a>.'
    }
  ]);
});

test('contactPreferenceNotes returns a red name note, a normal phone/email note, and one shared link when all are missing', () => {
  const notes = contactPreferenceNotes(['phone', 'email', 'personalInfo']);
  assert.equal(notes.length, 3);
  assert.equal(notes[2].text, 'You can update your preferences here: https://walks-manager.ramblers.org.uk/user/contact-preferences');
  assert.equal(notes[0].red, true);
  assert.match(notes[0].text, /^We recommend sharing at least your name/);
  assert.equal(notes[1].red, false);
  assert.match(notes[1].text, /^Your phone number and email address are also currently not shared/);
});
