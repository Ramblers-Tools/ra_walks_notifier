const fs = require('fs');
const path = require('path');
const { paths: defaultPaths } = require('./config');
const { nowUkDateTime } = require('./time');

function ensureDirs(paths = defaultPaths) {
  fs.mkdirSync(path.dirname(paths.logFile), { recursive: true });
  fs.mkdirSync(paths.debugDir, { recursive: true });
  fs.mkdirSync(path.dirname(paths.sessionFile), { recursive: true });
  fs.mkdirSync(path.dirname(paths.stateFile), { recursive: true });
  fs.mkdirSync(path.dirname(paths.statusFile), { recursive: true });
  fs.mkdirSync(path.dirname(paths.configFile), { recursive: true });
}

function log(message, paths = defaultPaths) {
  ensureDirs(paths);
  const line = `${nowUkDateTime()} ${message}`;
  console.log(line);
  fs.appendFileSync(paths.logFile, `${line}\n`);
}

module.exports = { log, ensureDirs };
