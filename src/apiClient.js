const fs = require('fs');
const path = require('path');
const { paths } = require('./config');

const API_BASE_URL = process.env.WMW_API_BASE_URL || 'https://api-rawalksnotifier.ramblers.tools';

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function getApiKey() {
  return String(readJson(paths.clientConfigFile, {}).apiKey || '').trim();
}

function writeClientConfig(patch) {
  const current = readJson(paths.clientConfigFile, {});
  fs.mkdirSync(path.dirname(paths.clientConfigFile), { recursive: true });
  fs.writeFileSync(paths.clientConfigFile, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`, { mode: 0o600 });
}

function setApiKey(apiKey) {
  writeClientConfig({ apiKey: String(apiKey || '').trim() });
}

function hasApiKey() {
  return Boolean(getApiKey());
}

function clearApiKey() {
  setApiKey('');
}

// The beta-updates opt-in is a per-device preference, not tenant config, so
// it is stored locally rather than round-tripped through the server (the
// server's /api/config merge logic does not recognise this field and would
// silently drop it).
function getIncludeBetaUpdates() {
  const value = readJson(paths.clientConfigFile, {}).includeBetaUpdates;
  return typeof value === 'boolean' ? value : null;
}

function setIncludeBetaUpdates(value) {
  writeClientConfig({ includeBetaUpdates: Boolean(value) });
}

function errorFromResponse(response, body, pathName) {
  const diagnostic = `${pathName} -> HTTP ${response.status} ${JSON.stringify(body).slice(0, 200)} at ${new Date().toISOString()}`;
  if (response.status === 503 && body.error === 'maintenance') {
    const error = new Error(body.message || 'The server is undergoing maintenance. Please try again shortly.');
    error.code = 'maintenance';
    error.diagnostic = diagnostic;
    return error;
  }
  if (response.status === 401) {
    const error = new Error('That API key is no longer valid. Enter a new one to reconnect.');
    error.code = 'unauthorized';
    error.diagnostic = diagnostic;
    return error;
  }
  const error = new Error(body.error || `Server returned HTTP ${response.status}`);
  error.diagnostic = diagnostic;
  return error;
}

async function apiFetch(pathName, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No server connection configured. Enter your API key first.');

  const response = await fetch(`${API_BASE_URL}${pathName}`, {
    ...options,
    // Electron's main-process fetch is backed by Chromium's network stack,
    // which maintains its own on-disk HTTP cache independent of the server
    // and any CDN in front of it. A transient response (e.g. a maintenance
    // 503) could otherwise get served from that cache indefinitely, surviving
    // both app restarts and upstream cache purges.
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw errorFromResponse(response, body, pathName);
  }
  return body;
}

function getConfig() {
  return apiFetch('/api/config');
}

function putConfig(updates) {
  return apiFetch('/api/config', { method: 'PUT', body: JSON.stringify(updates) });
}

function getStatus() {
  return apiFetch('/api/status');
}

function getSessionStatus() {
  return apiFetch('/api/session/status');
}

function postSession(storageState) {
  return apiFetch('/api/session', { method: 'POST', body: JSON.stringify(storageState) });
}

function postCheckNow(forceEmail = false) {
  return apiFetch('/api/check-now', { method: 'POST', body: JSON.stringify({ forceEmail }) });
}

function getLogo() {
  return apiFetch('/api/branding/logo');
}

function putLogo(data, ext) {
  return apiFetch('/api/branding/logo', { method: 'PUT', body: JSON.stringify({ data, ext }) });
}

function deleteLogo() {
  return apiFetch('/api/branding/logo', { method: 'DELETE' });
}

function testLeaderApi(settings) {
  return apiFetch('/api/test-leader-api', { method: 'POST', body: JSON.stringify(settings) });
}

function testEmail() {
  return apiFetch('/api/test-email', { method: 'POST' });
}

function getLogs(lines = 500) {
  return apiFetch(`/api/logs?lines=${lines}`);
}

// A lightweight connectivity + auth check, distinct from the feature calls
// above, so the "Connect" window can confirm a key works before saving it.
async function testConnection(apiKey) {
  const response = await fetch(`${API_BASE_URL}/api/status`, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (response.status === 401) throw new Error('That API key was not accepted.');
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw errorFromResponse(response, body);
  }
  return true;
}

module.exports = {
  API_BASE_URL,
  getApiKey,
  setApiKey,
  clearApiKey,
  hasApiKey,
  getIncludeBetaUpdates,
  setIncludeBetaUpdates,
  getConfig,
  putConfig,
  getStatus,
  getSessionStatus,
  postSession,
  postCheckNow,
  getLogo,
  putLogo,
  deleteLogo,
  testLeaderApi,
  testEmail,
  getLogs,
  testConnection
};
