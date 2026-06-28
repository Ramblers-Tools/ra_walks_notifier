const fs = require('fs');
const path = require('path');
const { paths } = require('./config');

function ensureDirs() {
  fs.mkdirSync(path.dirname(paths.logFile), { recursive: true });
  fs.mkdirSync(paths.debugDir, { recursive: true });
}

function log(message) {
  ensureDirs();
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  fs.appendFileSync(paths.logFile, `${line}\n`);
}

module.exports = { log, ensureDirs };
