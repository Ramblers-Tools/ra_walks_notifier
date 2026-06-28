const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const rootDir = path.resolve(__dirname, '..');
const paths = {
  rootDir,
  sessionFile: path.join(rootDir, 'sessions', 'auth.json'),
  stateFile: path.join(rootDir, 'data', 'state.json'),
  statusFile: path.join(rootDir, 'data', 'status.json'),
  logFile: path.join(rootDir, 'logs', 'WalksManagerWatch.log'),
  debugDir: path.join(rootDir, 'logs', 'debug'),
  configFile: path.join(rootDir, 'config.json'),
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

const app = readJson(paths.configFile, {});
const groups = readJson(paths.groupsFile, [{ name: 'East Cheshire Group', gid: 414 }]);

const smtp = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.MAIL_FROM || process.env.SMTP_USER,
  to: process.env.MAIL_TO || process.env.NOTIFY_TO
};

function validateEmailConfig() {
  const missing = [];
  for (const key of ['host', 'port', 'user', 'pass', 'to']) {
    if (!smtp[key]) missing.push(key);
  }
  if (missing.length) {
    throw new Error(`Missing email configuration: ${missing.join(', ')}. Check your .env file.`);
  }
}

module.exports = { paths, app, groups, smtp, validateEmailConfig };
