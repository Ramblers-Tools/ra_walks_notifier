const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wmw-tenants-test-'));
process.env.WMW_TENANTS_DIR = tmpRoot;

const { createTenant, listTenants, findTenantByApiKey, hashApiKey } = require('../src/tenants');
const { pathsForTenant } = require('../src/config');

test.after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('createTenant provisions an isolated directory and a one-time plaintext API key', () => {
  const tenant = createTenant('East Cheshire Ramblers');
  assert.equal(tenant.name, 'East Cheshire Ramblers');
  assert.ok(tenant.tenantId);
  assert.ok(tenant.apiKey);

  const meta = JSON.parse(fs.readFileSync(pathsForTenant(tenant.tenantId).metaFile, 'utf8'));
  assert.equal(meta.tenantId, tenant.tenantId);
  assert.equal(meta.apiKeyHash, hashApiKey(tenant.apiKey));
  assert.equal(meta.apiKey, undefined, 'plaintext API key must never be persisted');
});

test('createTenant disambiguates tenants with the same display name', () => {
  const a = createTenant('Duplicate Group');
  const b = createTenant('Duplicate Group');
  assert.notEqual(a.tenantId, b.tenantId);
});

test('findTenantByApiKey resolves a tenant from its plaintext key and rejects wrong keys', () => {
  const tenant = createTenant('Lookup Test Group');
  const found = findTenantByApiKey(tenant.apiKey);
  assert.equal(found.tenantId, tenant.tenantId);
  assert.equal(findTenantByApiKey('not-a-real-key'), null);
  assert.equal(findTenantByApiKey(''), null);
});

test('listTenants returns provisioned tenants without exposing API key hashes', () => {
  const tenant = createTenant('List Test Group');
  const tenants = listTenants();
  const match = tenants.find(t => t.tenantId === tenant.tenantId);
  assert.ok(match);
  assert.equal(match.apiKeyHash, undefined);
  assert.equal(match.apiKey, undefined);
});
