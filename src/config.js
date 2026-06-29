const fs = require('fs');
const os = require('os');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const rootDir = path.resolve(__dirname, '..');
const appSupportDir = process.env.WMW_APP_DATA || path.join(os.homedir(), 'Library', 'Application Support', 'Walks Manager Watch');
const logsDir = process.env.WMW_LOG_DIR || path.join(os.homedir(), 'Library', 'Logs', 'Walks Manager Watch');
const paths = {
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
  groupsFile: path.join(rootDir, 'groups.json'),
  plistTemplate: path.join(rootDir, 'launchd', 'uk.richard.walkswatch.plist'),
  userPlist: path.join(process.env.HOME || '', 'Library', 'LaunchAgents', 'uk.richard.walkswatch.plist')
};

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

const app = readJson(paths.configFile, readJson(paths.rootConfigFile, {}));
const groups = readJson(paths.groupsFile, [{ name: 'East Cheshire Group', gid: 414 }]);

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

module.exports = { paths, app, groups, smtp, validateEmailConfig, parseRecipients, resolveRecipients, resolveSmtp };
