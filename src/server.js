const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathsForTenant, resolveGroups, parseRecipients } = require('./config');
const { findTenantByApiKey, listTenants } = require('./tenants');
const { normalizeSchedule, isWithinActiveHours } = require('./schedule');
const { normalizeLeaderEmailSettings, leaderEmailConfigured, testLeaderEmailApi } = require('./leaderEmail');
const { runCheckForTenant } = require('./checkRunner');
const { sendEmail } = require('./email');
const { saveLogoBuffer, removeLogo, logoDataUrl } = require('./branding');
const { log } = require('./logger');
const { nowUkDateTime } = require('./time');

const PORT = Number(process.env.PORT || 7001);
const MAX_BODY_BYTES = 10 * 1024 * 1024;

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data, options = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: options.mode });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function authenticate(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  return findTenantByApiKey(match[1].trim());
}

// Never expose secret values back over the API — callers only learn
// whether they are set, so the UI can prompt for a replacement without
// ever round-tripping the current value.
function maskConfigForResponse(config) {
  const masked = { ...config };
  if (masked.leaderEmails) {
    masked.leaderEmails = {
      ...masked.leaderEmails,
      apiToken: undefined,
      apiTokenIsSet: Boolean(masked.leaderEmails.apiToken)
    };
  }
  delete masked.smtp;
  return masked;
}

function mergeConfig(existing, updates) {
  const cfg = { ...existing };
  if (updates.notificationRecipients !== undefined) {
    cfg.notificationRecipients = parseRecipients(updates.notificationRecipients);
  }
  if (updates.groups !== undefined) {
    cfg.groups = resolveGroups({ groups: updates.groups }, []);
  }
  if (updates.checkIntervalMinutes !== undefined || updates.activeHours !== undefined) {
    const schedule = normalizeSchedule({ ...cfg, ...updates });
    cfg.checkIntervalMinutes = schedule.checkIntervalMinutes;
    cfg.activeHours = schedule.activeHours;
  }
  if (updates.leaderEmails !== undefined) {
    const incoming = { ...updates.leaderEmails };
    // Blank/omitted apiToken means "leave unchanged" - never overwrite a
    // real secret with an empty string just because the client didn't send it.
    if (!incoming.apiToken) incoming.apiToken = (cfg.leaderEmails || {}).apiToken || '';
    cfg.leaderEmails = normalizeLeaderEmailSettings({ leaderEmails: incoming });
  }
  for (const flag of ['notifyOnNew', 'notifyOnChanged', 'notifyOnCleared', 'staleAfterDays']) {
    if (updates[flag] !== undefined) cfg[flag] = updates[flag];
  }
  return cfg;
}

const schedulerHandles = new Map();
const runningChecks = new Set();

function scheduleTenant(tenantId) {
  clearTenantSchedule(tenantId);
  const tick = async () => {
    if (runningChecks.has(tenantId)) return;
    try {
      const tenantPaths = pathsForTenant(tenantId);
      const config = readJson(tenantPaths.configFile, {});
      const schedule = normalizeSchedule(config);
      const currentHour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }));
      if (!isWithinActiveHours(schedule.activeHours, currentHour)) return;
      runningChecks.add(tenantId);
      await runCheckForTenant({ paths: tenantPaths, config });
    } catch (error) {
      log(`Scheduled check failed for tenant ${tenantId}: ${error.message}`, pathsForTenant(tenantId));
    } finally {
      runningChecks.delete(tenantId);
    }
  };
  const config = readJson(pathsForTenant(tenantId).configFile, {});
  const schedule = normalizeSchedule(config);
  const handle = setInterval(tick, schedule.checkIntervalMinutes * 60 * 1000);
  schedulerHandles.set(tenantId, handle);
}

function clearTenantSchedule(tenantId) {
  const handle = schedulerHandles.get(tenantId);
  if (handle) clearInterval(handle);
  schedulerHandles.delete(tenantId);
}

function scheduleAllTenants() {
  for (const tenant of listTenants()) scheduleTenant(tenant.tenantId);
}

function stopScheduler() {
  for (const tenantId of schedulerHandles.keys()) clearTenantSchedule(tenantId);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, time: nowUkDateTime() });
  }

  const tenant = authenticate(req);
  if (!tenant) return sendJson(res, 401, { error: 'unauthorized' });
  const tenantPaths = pathsForTenant(tenant.tenantId);

  try {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const status = readJson(tenantPaths.statusFile, {});
      return sendJson(res, 200, { ...status, checking: runningChecks.has(tenant.tenantId) });
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      const config = readJson(tenantPaths.configFile, {});
      return sendJson(res, 200, maskConfigForResponse(config));
    }

    if (req.method === 'PUT' && url.pathname === '/api/config') {
      const updates = await readBody(req) || {};
      const existing = readJson(tenantPaths.configFile, {});
      const merged = mergeConfig(existing, updates);
      writeJson(tenantPaths.configFile, merged);
      scheduleTenant(tenant.tenantId);
      return sendJson(res, 200, maskConfigForResponse(merged));
    }

    if (req.method === 'POST' && url.pathname === '/api/session') {
      const body = await readBody(req);
      if (!body || !Array.isArray(body.cookies) || !Array.isArray(body.origins)) {
        return sendJson(res, 400, { error: 'expected a Playwright storageState object with cookies[] and origins[]' });
      }
      writeJson(tenantPaths.sessionFile, body, { mode: 0o600 });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/session/status') {
      return sendJson(res, 200, { present: fs.existsSync(tenantPaths.sessionFile) });
    }

    if (req.method === 'GET' && url.pathname === '/api/logs') {
      const lines = Math.min(1000, Math.max(1, Number(url.searchParams.get('lines')) || 200));
      const content = fs.existsSync(tenantPaths.logFile) ? fs.readFileSync(tenantPaths.logFile, 'utf8') : '';
      const all = content.split('\n').filter(Boolean);
      return sendJson(res, 200, { lines: all.slice(-lines) });
    }

    if (req.method === 'GET' && url.pathname === '/api/branding/logo') {
      const config = readJson(tenantPaths.configFile, {});
      return sendJson(res, 200, { dataUrl: logoDataUrl(config, tenantPaths) });
    }

    if (req.method === 'PUT' && url.pathname === '/api/branding/logo') {
      const body = await readBody(req);
      if (!body || typeof body.data !== 'string' || typeof body.ext !== 'string') {
        return sendJson(res, 400, { error: 'expected { data: <base64>, ext: <file extension> }' });
      }
      try {
        saveLogoBuffer(Buffer.from(body.data, 'base64'), body.ext, tenantPaths);
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }
      const config = readJson(tenantPaths.configFile, {});
      return sendJson(res, 200, { dataUrl: logoDataUrl(config, tenantPaths) });
    }

    if (req.method === 'DELETE' && url.pathname === '/api/branding/logo') {
      removeLogo(tenantPaths);
      const config = readJson(tenantPaths.configFile, {});
      return sendJson(res, 200, { dataUrl: logoDataUrl(config, tenantPaths) });
    }

    if (req.method === 'POST' && url.pathname === '/api/check-now') {
      if (runningChecks.has(tenant.tenantId)) {
        return sendJson(res, 409, { error: 'a check is already in progress for this tenant' });
      }
      const body = await readBody(req) || {};
      const config = readJson(tenantPaths.configFile, {});
      // A check can take well over a minute (Playwright navigation + leader
      // enrichment), which is longer than the Cloudflare Tunnel's default
      // proxy keepalive timeout - run it in the background and let the
      // caller poll GET /api/status (which reports `checking: true` while
      // this is in flight) instead of holding the HTTP request open.
      runningChecks.add(tenant.tenantId);
      runCheckForTenant({ paths: tenantPaths, config, forceEmail: Boolean(body.forceEmail) })
        .catch(() => {})
        .finally(() => runningChecks.delete(tenant.tenantId));
      return sendJson(res, 202, { accepted: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/test-email') {
      const config = readJson(tenantPaths.configFile, {});
      await sendEmail(
        'Walks Manager Watch: test email',
        'This is a test email from Walks Manager Watch.',
        '<p>This is a test email from Walks Manager Watch.</p>',
        { paths: tenantPaths, to: config.notificationRecipients }
      );
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/test-leader-api') {
      const body = await readBody(req) || {};
      const config = readJson(tenantPaths.configFile, {});
      const settings = normalizeLeaderEmailSettings(config);
      const result = await testLeaderEmailApi(settings, body.name);
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (error) {
    log(`API error for tenant ${tenant.tenantId} on ${req.method} ${url.pathname}: ${error.message}`, tenantPaths);
    return sendJson(res, 500, { error: 'internal error' });
  }
}

function createServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch(error => sendJson(res, 500, { error: error.message }));
  });
}

if (require.main === module) {
  scheduleAllTenants();
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`Walks Manager Watch API listening on port ${PORT}`);
  });
}

module.exports = { createServer, scheduleAllTenants, scheduleTenant, clearTenantSchedule, stopScheduler, mergeConfig, maskConfigForResponse, runningChecks };
