const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathsForTenant } = require('./config');

function tenantsRootDir() {
  return process.env.WMW_TENANTS_DIR || path.join(path.resolve(__dirname, '..'), 'data', 'tenants');
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

function slugify(name) {
  const slug = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'tenant';
}

function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey)).digest('hex');
}

function generateApiKey() {
  return crypto.randomBytes(32).toString('hex');
}

// Creates a new tenant with an isolated data directory and returns the
// plaintext API key exactly once — only its hash is ever persisted.
function createTenant(name) {
  const root = tenantsRootDir();
  const base = slugify(name);
  let tenantId = base;
  let attempt = 0;
  while (fs.existsSync(path.join(root, tenantId))) {
    attempt += 1;
    tenantId = `${base}-${attempt}`;
  }

  const tenantPaths = pathsForTenant(tenantId);
  const apiKey = generateApiKey();
  const meta = {
    tenantId,
    name: String(name || tenantId).trim(),
    apiKeyHash: hashApiKey(apiKey),
    createdAt: new Date().toISOString()
  };

  fs.mkdirSync(tenantPaths.appSupportDir, { recursive: true });
  writeJson(tenantPaths.metaFile, meta);

  return { tenantId, name: meta.name, apiKey, createdAt: meta.createdAt };
}

function listTenants() {
  const root = tenantsRootDir();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter(entry => fs.statSync(path.join(root, entry)).isDirectory())
    .map(tenantId => {
      const meta = readJson(pathsForTenant(tenantId).metaFile, null);
      if (!meta) return null;
      return { tenantId: meta.tenantId, name: meta.name, createdAt: meta.createdAt };
    })
    .filter(Boolean);
}

// Scans tenant metadata for a matching API key hash. Fine at small scale;
// revisit with an index file if the tenant count grows large.
function findTenantByApiKey(apiKey) {
  if (!apiKey) return null;
  const hash = hashApiKey(apiKey);
  const root = tenantsRootDir();
  if (!fs.existsSync(root)) return null;

  for (const tenantId of fs.readdirSync(root)) {
    const tenantDir = path.join(root, tenantId);
    if (!fs.statSync(tenantDir).isDirectory()) continue;
    const meta = readJson(pathsForTenant(tenantId).metaFile, null);
    if (meta && meta.apiKeyHash === hash) {
      return { tenantId: meta.tenantId, name: meta.name, createdAt: meta.createdAt };
    }
  }
  return null;
}

module.exports = { createTenant, listTenants, findTenantByApiKey, tenantsRootDir, hashApiKey, generateApiKey };
