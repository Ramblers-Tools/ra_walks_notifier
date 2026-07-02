const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wmw-apiclient-test-'));
process.env.WMW_APP_DATA = tmpRoot;

const apiClient = require('../src/apiClient');

test.after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('hasApiKey is false and getApiKey is empty before anything is saved', () => {
  assert.equal(apiClient.hasApiKey(), false);
  assert.equal(apiClient.getApiKey(), '');
});

test('setApiKey persists the key with restrictive file permissions', () => {
  apiClient.setApiKey('abc123');
  assert.equal(apiClient.getApiKey(), 'abc123');
  assert.equal(apiClient.hasApiKey(), true);

  const { paths } = require('../src/config');
  const stat = fs.statSync(paths.clientConfigFile);
  assert.equal(stat.mode & 0o777, 0o600);
});

test('setApiKey trims whitespace', () => {
  apiClient.setApiKey('  spaced-key  ');
  assert.equal(apiClient.getApiKey(), 'spaced-key');
});

test('apiFetch throws a clear error when no API key is configured', async () => {
  apiClient.setApiKey('');
  await assert.rejects(() => apiClient.getStatus(), /No server connection configured/);
});

test('apiFetch sends the Bearer header and returns the parsed JSON body', async () => {
  apiClient.setApiKey('test-key');
  const originalFetch = global.fetch;
  let capturedHeaders;
  global.fetch = async (url, options) => {
    capturedHeaders = options.headers;
    return { ok: true, json: async () => ({ hello: 'world' }) };
  };
  try {
    const result = await apiClient.getStatus();
    assert.deepEqual(result, { hello: 'world' });
    assert.equal(capturedHeaders.Authorization, 'Bearer test-key');
  } finally {
    global.fetch = originalFetch;
  }
});

test('apiFetch surfaces the server error message on a non-2xx response', async () => {
  apiClient.setApiKey('test-key');
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) });
  try {
    await assert.rejects(() => apiClient.getStatus(), /unauthorized/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('apiFetch flags maintenance mode distinctly from other errors', async () => {
  apiClient.setApiKey('test-key');
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: 'maintenance', message: 'Back shortly.' })
  });
  try {
    await assert.rejects(() => apiClient.getStatus(), (error) => {
      assert.equal(error.code, 'maintenance');
      assert.match(error.message, /Back shortly\./);
      return true;
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('testConnection rejects with a clear message on 401 without requiring a saved key', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  try {
    await assert.rejects(() => apiClient.testConnection('some-key'), /not accepted/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('testConnection resolves true on a successful response', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  try {
    assert.equal(await apiClient.testConnection('some-key'), true);
  } finally {
    global.fetch = originalFetch;
  }
});
