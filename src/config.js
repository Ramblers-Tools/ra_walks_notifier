const fs = require('fs');
const os = require('os');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const rootDir = path.resolve(__dirname, '..');
const appSupportDir = process.env.WMW_APP_DATA || path.join(os.homedir(), 'Library', 'Application Support', 'Walks Manager Watch');
const logsDir = process.env.WMW_LOG_DIR || path.join(os.homedir(), 'Library', 'Logs', 'Walks Manager Watch');

function buildPaths(appSupportDir, logsDir) {
  return {
    rootDir,
    appSupportDir,
    brandingDir: path.join(appSupportDir, 'branding'),
    sessionFile: path.join(appSupportDir, 'sessions', 'auth.json'),
    stateFile: path.join(appSupportDir, 'data', 'state.json'),
    statusFile: path.join(appSupportDir, 'data', 'status.json'),
    logFile: path.join(logsDir, 'WalksManagerWatch.log'),
    debugDir: path.join(logsDir, 'debug'),
    configFile: path.join(appSupportDir, 'config.json'),
    rootConfigFile: path.join(rootDir, 'config.json'),
    clientConfigFile: path.join(appSupportDir, 'client.json'),
    groupsFile: path.join(rootDir, 'groups.json'),
    plistTemplate: path.join(rootDir, 'launchd', 'uk.richard.walkswatch.plist'),
    userPlist: path.join(process.env.HOME || '', 'Library', 'LaunchAgents', 'uk.richard.walkswatch.plist')
  };
}

const paths = buildPaths(appSupportDir, logsDir);

const TENANT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function tenantsRootDir() {
  return process.env.WMW_TENANTS_DIR || path.join(rootDir, 'data', 'tenants');
}

function tenantLogsRootDir() {
  return process.env.WMW_TENANT_LOGS_DIR || path.join(rootDir, 'logs', 'tenants');
}

// Builds an isolated paths object for one tenant, rooted under its own
// directory, so two tenants can never read or write each other's config,
// state, session, or logs.
function pathsForTenant(tenantId) {
  if (!tenantId || typeof tenantId !== 'string' || !TENANT_ID_PATTERN.test(tenantId)) {
    throw new Error(`Invalid tenant id: ${tenantId}`);
  }
  const tenantAppSupportDir = path.join(tenantsRootDir(), tenantId);
  const tenantLogsDir = path.join(tenantLogsRootDir(), tenantId);
  return {
    ...buildPaths(tenantAppSupportDir, tenantLogsDir),
    tenantId,
    metaFile: path.join(tenantAppSupportDir, 'meta.json')
  };
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

const app = readJson(paths.configFile, readJson(paths.rootConfigFile, {}));

function normalizeGroups(value) {
  const input = Array.isArray(value) ? value : [];
  return input
    .map(group => ({
      name: String(group.name || '').trim(),
      gid: Number(group.gid || group.id || group.value)
    }))
    .filter(group => group.name && Number.isFinite(group.gid));
}

function resolveGroups(config = app, fallback = []) {
  const configured = normalizeGroups(config.groups);
  return configured.length ? configured : normalizeGroups(fallback);
}

const groups = resolveGroups(app, []);

function parseRecipients(value) {
  if (Array.isArray(value)) {
    return value.flatMap(parseRecipients);
  }

  return String(value || '')
    .split(/[,;\r\n]+/)
    .map(email => email.trim())
    .filter(Boolean);
}

function resolveRecipients(config = app, env = process.env) {
  const configured = parseRecipients(config.notificationRecipients);
  if (configured.length) {
    return [...new Set(configured)];
  }

  return [...new Set(parseRecipients(env.MAIL_TO || env.NOTIFY_TO))];
}

const recipients = resolveRecipients(app);

function resolveSmtp(config = app, env = process.env) {
  const configured = config.smtp || {};

  return {
    host: configured.host || env.SMTP_HOST,
    port: Number(configured.port || env.SMTP_PORT || 587),
    secure: typeof configured.secure === 'boolean'
      ? configured.secure
      : String(env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    user: configured.user || env.SMTP_USER,
    pass: configured.pass || env.SMTP_PASS,
    fromName: configured.fromName || env.MAIL_FROM_NAME || env.SMTP_FROM_NAME || '',
    from: configured.from || env.MAIL_FROM || configured.user || env.SMTP_USER,
    to: resolveRecipients(config, env)
  };
}

const smtp = resolveSmtp(app);

function validateEmailConfig() {
  const missing = [];
  for (const key of ['host', 'port', 'user', 'pass']) {
    if (!smtp[key]) missing.push(key);
  }
  if (!smtp.to.length) missing.push('to');
  if (missing.length) {
    throw new Error(`Missing email configuration: ${missing.join(', ')}. Check your .env file.`);
  }
}

module.exports = { paths, app, groups, smtp, validateEmailConfig, parseRecipients, resolveRecipients, resolveSmtp, normalizeGroups, resolveGroups, pathsForTenant, readJson };
