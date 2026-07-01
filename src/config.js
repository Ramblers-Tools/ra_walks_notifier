const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const appSupportDir = process.env.WMW_APP_DATA || path.join(os.homedir(), 'Library', 'Application Support', 'Walks Manager Watch');

const paths = {
  rootDir,
  appSupportDir,
  clientConfigFile: path.join(appSupportDir, 'client.json')
};

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

module.exports = { paths, parseRecipients, readJson };
