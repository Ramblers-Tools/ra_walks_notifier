const { app, Tray, Menu, shell, dialog, Notification } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { formatUkDateTime } = require('./time');

let tray;
let timer;
let lastStatus = 'Starting...';
const root = path.join(__dirname, '..');
const reviewUrl = 'https://walks-manager.ramblers.org.uk/walks-manager/list?gid=414&review=1';

function readJson(file, fallback = {}) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

function appConfig() {
  return readJson(path.join(root, 'config.json'), { checkIntervalMinutes: 15, activeHours: { start: 7, end: 22 } });
}

function groupsConfig() {
  return readJson(path.join(root, 'groups.json'), []);
}

function statusFile() { return path.join(root, 'data', 'status.json'); }
function stateFile() { return path.join(root, 'data', 'state.json'); }
function sessionFile() { return path.join(root, 'sessions', 'auth.json'); }
function logFile() { return path.join(root, 'logs', 'watch.log'); }
function readStatus() { return readJson(statusFile(), {}); }

function runNode(args, showDialog = false) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' });
    const child = spawn(process.execPath, args, { cwd: root, env });
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { out += d.toString(); });
    child.on('error', err => {
      out += err.stack || err.message;
      if (showDialog) dialog.showMessageBox({ type: 'error', title: 'Walks Manager Watch', message: out });
      resolve({ code: 1, out });
    });
    child.on('close', code => {
      if (showDialog) {
        dialog.showMessageBox({
          type: code === 0 ? 'info' : 'error',
          title: 'Walks Manager Watch',
          message: out || `Finished with code ${code}`
        });
      }
      resolve({ code, out });
    });
  });
}

function buildStatusText() {
  const s = readStatus();
  const state = readJson(stateFile(), { walks: [] });
  const cfg = appConfig();
  const groups = groupsConfig();
  const pending = Number(s.pendingWalks ?? (state.walks ? state.walks.length : 0) ?? 0);
  const running = timer ? 'Running' : 'Stopped';
  const next = s.nextCheckAt || 'Scheduled in app';
  return [
    'Walks Manager Watch',
    '',
    `Status: ${running}`,
    `Pending walks: ${pending}`,
    `Groups: ${groups.length}`,
    `Schedule: Every ${cfg.checkIntervalMinutes || 15} minutes`,
    cfg.activeHours ? `Active hours: ${cfg.activeHours.start}:00 to ${cfg.activeHours.end}:00` : null,
    '',
    `Last check: ${formatUkDateTime(s.lastCheckCompletedAt)}`,
    `Last result: ${s.lastResult || 'None yet'}`,
    `Last email: ${formatUkDateTime(s.lastEmailAt)}`,
    `Last error: ${s.lastError || 'None'}`,
    '',
    `Session: ${fs.existsSync(sessionFile()) ? 'Present' : 'Missing'}`,
    `Project folder: ${root}`,
    `Log file: ${logFile()}`
  ].filter(Boolean).join('\n');
}

function showStatus() {
  dialog.showMessageBox({
    type: 'info',
    title: 'Walks Manager Watch Status',
    message: buildStatusText(),
    buttons: ['OK', 'Open folder'],
    defaultId: 0
  }).then(result => {
    if (result.response === 1) shell.openPath(root);
  });
}

function updateTrayLabel() {
  const s = readStatus();
  const count = Number(s.pendingWalks || 0);
  const err = s.lastError;
  lastStatus = err ? `Error: ${err}` : `${count} pending walk${count === 1 ? '' : 's'}`;
  if (tray) tray.setTitle(count ? ` ${count}` : '');
  buildMenu();
}

async function checkNow(force = false) {
  lastStatus = 'Checking...';
  buildMenu();
  const res = await runNode(['src/check.js'].concat(force ? ['--force-email'] : []));
  updateTrayLabel();
  if (res.code !== 0) {
    new Notification({ title: 'Walks Manager Watch failed', body: 'Open status for details.' }).show();
  }
}

function buildMenu() {
  const s = readStatus();
  const lastCheck = formatUkDateTime(s.lastCheckCompletedAt);
  const menu = Menu.buildFromTemplate([
    { label: `Status: ${lastStatus}`, enabled: false },
    { label: `Last check: ${lastCheck}`, enabled: false },
    { type: 'separator' },
    { label: 'Show Status', click: () => showStatus() },
    { label: 'Check Now', click: () => checkNow(false) },
    { label: 'Force Test Email', click: () => checkNow(true) },
    { label: 'Login to Walks Manager', click: () => runNode(['src/login.js'], true) },
    { label: 'Open Review List', click: () => shell.openExternal(reviewUrl) },
    { type: 'separator' },
    { label: 'Open Project Folder', click: () => shell.openPath(root) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

function startScheduler() {
  const cfg = appConfig();
  const intervalMinutes = cfg.checkIntervalMinutes || 15;
  timer = setInterval(() => checkNow(false), intervalMinutes * 60 * 1000);
  checkNow(false);
}

app.whenReady().then(() => {
  tray = new Tray(path.join(root, 'assets', 'trayTemplate.png'));
  tray.setToolTip('Walks Manager Watch');
  buildMenu();
  startScheduler();
});
app.on('before-quit', () => { if (timer) clearInterval(timer); });
app.on('window-all-closed', (e) => e.preventDefault());
