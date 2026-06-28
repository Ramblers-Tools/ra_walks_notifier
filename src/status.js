const fs = require('fs');
const { execSync } = require('child_process');
const { paths, groups, app } = require('./config');
function readJson(file, fallback) { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; } catch { return fallback; } }
function loaded() { try { execSync(`launchctl print gui/$(id -u)/uk.richard.walkswatch`, { stdio: 'ignore', shell: '/bin/bash' }); return true; } catch { return false; } }
const s = readJson(paths.statusFile, {});
const state = readJson(paths.stateFile, { walks: [] });
const isLoaded = loaded();
console.log('────────────────────────────────────────────');
console.log('Walks Manager Watch');
console.log('Version          3.0');
console.log('Status           ' + (isLoaded ? 'Loaded/running ✅' : 'Not loaded ❌'));
console.log('Groups           ' + groups.length);
console.log('Schedule         Every ' + (app.checkIntervalMinutes || 15) + ' minutes');
if (app.activeHours) console.log('Active hours     ' + app.activeHours.start + ':00 to ' + app.activeHours.end + ':00');
console.log('Pending walks    ' + (s.pendingWalks ?? state.walks.length ?? 0));
console.log('Last check       ' + (s.lastCheckCompletedAt || 'Never'));
console.log('Last result      ' + (s.lastResult || 'None yet'));
console.log('Last email       ' + (s.lastEmailAt || 'Never'));
console.log('Last error       ' + (s.lastError || 'None'));
console.log('Session file     ' + (fs.existsSync(paths.sessionFile) ? 'Present ✅' : 'Missing ❌'));
console.log('Log file         ' + paths.logFile);
console.log('────────────────────────────────────────────');
