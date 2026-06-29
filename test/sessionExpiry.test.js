const test = require('node:test');
const assert = require('node:assert/strict');
const { isLoginPage } = require('../src/sessionExpiry');

test('detects Ramblers single sign-on redirect as login required', () => {
  assert.equal(
    isLoginPage('https://login.microsoftonline.com/common/oauth2/v2.0/authorize', 'Sign in to your account'),
    true
  );
});

test('does not treat a loaded Walks Manager review page as login required', () => {
  assert.equal(
    isLoginPage('https://walks-manager.ramblers.org.uk/walks-manager/list?gid=414&review=1', 'Walks Manager Submitted for checking'),
    false
  );
});
