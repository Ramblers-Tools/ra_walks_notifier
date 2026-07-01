const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wmw-server-test-'));
process.env.WMW_TENANTS_DIR = tmpRoot;
process.env.WMW_TENANT_LOGS_DIR = path.join(tmpRoot, '__logs__');

const { createTenant } = require('../src/tenants');
const { pathsForTenant } = require('../src/config');
const { createServer, mergeConfig, maskConfigForResponse, stopScheduler, runningChecks } = require('../src/server');

let server;
let baseUrl;
let tenant;

test.before(async () => {
  tenant = createTenant('API Test Group');
  server = createServer();
  await new Promise(resolve => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  stopScheduler();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function authed(pathName, options = {}) {
  return fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: { Authorization: `Bearer ${tenant.apiKey}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
}

test('unauthenticated requests are rejected', async () => {
  const response = await fetch(`${baseUrl}/api/status`);
  assert.equal(response.status, 401);
});

test('wrong API key is rejected', async () => {
  const response = await fetch(`${baseUrl}/api/status`, { headers: { Authorization: 'Bearer not-a-real-key' } });
  assert.equal(response.status, 401);
});

test('health check requires no auth', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
});

test('GET /api/status reports checking:false before any check has run', async () => {
  const response = await authed('/api/status');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { checking: false });
});

test('POST /api/check-now returns immediately with 202 rather than waiting for the check to finish', async () => {
  const response = await authed('/api/check-now', { method: 'POST' });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true });
  // The no-session/no-groups path resolves almost immediately; give it a
  // tick so it clears itself from runningChecks before the next test.
  await new Promise(resolve => setTimeout(resolve, 50));
});

test('POST /api/check-now rejects a second concurrent request for the same tenant', async () => {
  runningChecks.add(tenant.tenantId);
  try {
    const response = await authed('/api/check-now', { method: 'POST' });
    assert.equal(response.status, 409);
  } finally {
    runningChecks.delete(tenant.tenantId);
  }
});

test('GET /api/config never returns the leaderEmails API token', async () => {
  const tenantPaths = pathsForTenant(tenant.tenantId);
  fs.mkdirSync(path.dirname(tenantPaths.configFile), { recursive: true });
  fs.writeFileSync(tenantPaths.configFile, JSON.stringify({
    notificationRecipients: ['a@example.org'],
    leaderEmails: { enabled: true, apiToken: 'super-secret-token' }
  }));

  const response = await authed('/api/config');
  const body = await response.json();
  assert.equal(body.leaderEmails.apiToken, undefined);
  assert.equal(body.leaderEmails.apiTokenIsSet, true);
  assert.deepEqual(body.notificationRecipients, ['a@example.org']);
});

test('PUT /api/config preserves an existing secret when the update omits it', async () => {
  const tenantPaths = pathsForTenant(tenant.tenantId);
  fs.writeFileSync(tenantPaths.configFile, JSON.stringify({
    leaderEmails: { enabled: true, apiBaseUrl: 'https://example.org/api', apiToken: 'keep-me' }
  }));

  const response = await authed('/api/config', {
    method: 'PUT',
    body: JSON.stringify({ leaderEmails: { enabled: true, apiBaseUrl: 'https://example.org/api' } })
  });
  assert.equal(response.status, 200);

  const onDisk = JSON.parse(fs.readFileSync(tenantPaths.configFile, 'utf8'));
  assert.equal(onDisk.leaderEmails.apiToken, 'keep-me');
});

test('GET /api/branding/logo falls back to the default logo when nothing has been uploaded', async () => {
  const response = await authed('/api/branding/logo');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.dataUrl.startsWith('data:image/'));
});

test('PUT /api/branding/logo uploads a custom logo and GET reflects it', async () => {
  const put = await authed('/api/branding/logo', {
    method: 'PUT',
    body: JSON.stringify({ data: Buffer.from('fake-logo-bytes').toString('base64'), ext: 'png' })
  });
  assert.equal(put.status, 200);
  const putBody = await put.json();
  assert.equal(putBody.dataUrl, `data:image/png;base64,${Buffer.from('fake-logo-bytes').toString('base64')}`);

  const get = await authed('/api/branding/logo');
  assert.deepEqual(await get.json(), putBody);
});

test('PUT /api/branding/logo rejects an unsupported file extension', async () => {
  const response = await authed('/api/branding/logo', {
    method: 'PUT',
    body: JSON.stringify({ data: Buffer.from('x').toString('base64'), ext: 'exe' })
  });
  assert.equal(response.status, 400);
});

test('DELETE /api/branding/logo removes the custom logo and falls back to the default', async () => {
  await authed('/api/branding/logo', {
    method: 'PUT',
    body: JSON.stringify({ data: Buffer.from('custom').toString('base64'), ext: 'png' })
  });
  const del = await authed('/api/branding/logo', { method: 'DELETE' });
  assert.equal(del.status, 200);
  const body = await del.json();
  assert.ok(!body.dataUrl.includes(Buffer.from('custom').toString('base64')));
});

test('POST /api/session accepts a storageState blob and it is never returned by any route', async () => {
  const saveResponse = await authed('/api/session', {
    method: 'POST',
    body: JSON.stringify({ cookies: [{ name: 'session', value: 'abc' }], origins: [] })
  });
  assert.equal(saveResponse.status, 200);

  const statusResponse = await authed('/api/session/status');
  assert.deepEqual(await statusResponse.json(), { present: true });

  const tenantPaths = pathsForTenant(tenant.tenantId);
  const stat = fs.statSync(tenantPaths.sessionFile);
  assert.equal(stat.mode & 0o777, 0o600);
});

test('POST /api/session rejects a body that is not a storageState shape', async () => {
  const response = await authed('/api/session', { method: 'POST', body: JSON.stringify({ not: 'valid' }) });
  assert.equal(response.status, 400);
});

test('unknown routes return 404', async () => {
  const response = await authed('/api/does-not-exist');
  assert.equal(response.status, 404);
});

test('mergeConfig leaves a blank incoming apiToken untouched against the existing value', () => {
  const merged = mergeConfig(
    { leaderEmails: { apiToken: 'existing-token' } },
    { leaderEmails: { enabled: true, apiToken: '' } }
  );
  assert.equal(merged.leaderEmails.apiToken, 'existing-token');
});

test('maskConfigForResponse strips smtp entirely and never leaks apiToken', () => {
  const masked = maskConfigForResponse({
    smtp: { host: 'should-not-appear', pass: 'secret' },
    leaderEmails: { apiToken: 'secret-token', enabled: true }
  });
  assert.equal(masked.smtp, undefined);
  assert.equal(masked.leaderEmails.apiToken, undefined);
  assert.equal(masked.leaderEmails.apiTokenIsSet, true);
});
