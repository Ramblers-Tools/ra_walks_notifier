const fs = require('fs');
const os = require('os');
const path = require('path');

function defaultAppSupportDir(appName) {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appName);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), appName);
}

const rootDir = path.resolve(__dirname, '..');
const appSupportDir = process.env.WMW_APP_DATA || defaultAppSupportDir('RA Walks Notifier');
// Pre-1.1.0-beta.9 installs (macOS/Linux only) always wrote here regardless
// of platform, so the legacy path is not itself platform-aware.
const legacyAppSupportDir = path.join(os.homedir(), 'Library', 'Application Support', 'Walks Manager Watch');

const paths = {
  rootDir,
  appSupportDir,
  clientConfigFile: path.join(appSupportDir, 'client.json')
};

function migrateLegacyConfig() {
  const legacyConfigFile = path.join(legacyAppSupportDir, 'client.json');
  if (fs.existsSync(paths.clientConfigFile) || !fs.existsSync(legacyConfigFile)) return;

  try {
    fs.mkdirSync(appSupportDir, { recursive: true });
    fs.copyFileSync(legacyConfigFile, paths.clientConfigFile);
  } catch (_) {
    // Leave the new config unset; the app will prompt to reconnect.
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function parseRecipients(value) {
  if (Array.isArray(value)) {
    return value.flatMap(parseRecipients);
  }

  return String(value || '')
    .split(/[,;\r\n]+/)
    .map(email => email.trim())
    .filter(Boolean);
}

module.exports = { paths, parseRecipients, readJson, migrateLegacyConfig };
