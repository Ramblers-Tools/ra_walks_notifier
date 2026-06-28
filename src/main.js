const { app, Tray, Menu, shell, dialog, Notification, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { formatUkDateTime } = require('./time');
const { parseRecipients, resolveRecipients } = require('./config');

let tray;
let timer;
let recipientsWindow;
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
  return readJson(path.join(root, 'config.json'), { checkIntervalMinutes: 5, activeHours: { start: 7, end: 22 } });
}

function configFile() { return path.join(root, 'config.json'); }

function writeAppConfig(config) {
  fs.writeFileSync(configFile(), `${JSON.stringify(config, null, 2)}\n`);
}

function currentRecipients() {
  return resolveRecipients(appConfig(), process.env);
}

function groupsConfig() {
  return readJson(path.join(root, 'groups.json'), []);
}

function statusFile() { return path.join(root, 'data', 'status.json'); }
function stateFile() { return path.join(root, 'data', 'state.json'); }
function sessionFile() { return path.join(root, 'sessions', 'auth.json'); }
function logFile() { return path.join(root, 'logs', 'watch.log'); }
function readStatus() { return readJson(statusFile(), {}); }

function nodeExecutable() {
  return process.env.WMW_NODE_PATH || process.env.npm_node_execpath || process.execPath;
}

function runNode(args, showDialog = false) {
  return new Promise((resolve) => {
    const executable = nodeExecutable();
    const isElectron = executable === process.execPath;
    const env = Object.assign({}, process.env, isElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {});
    const child = spawn(executable, args, { cwd: root, env });
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
    `Schedule: Every ${cfg.checkIntervalMinutes || 5} minutes`,
    cfg.activeHours ? `Active hours: ${cfg.activeHours.start}:00 to ${cfg.activeHours.end}:00` : null,
    '',
    `Last check: ${formatUkDateTime(s.lastCheckCompletedAt)}`,
    `Last result: ${s.lastResult || 'None yet'}`,
    `Last email: ${formatUkDateTime(s.lastEmailAt)}`,
    `Recipients: ${currentRecipients().length ? currentRecipients().join(', ') : 'None configured'}`,
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

function showRecipientsWindow() {
  if (recipientsWindow) {
    recipientsWindow.focus();
    return;
  }

  recipientsWindow = new BrowserWindow({
    width: 520,
    height: 360,
    title: 'Notification Recipients',
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'recipientsPreload.js')
    }
  });

  recipientsWindow.on('closed', () => {
    recipientsWindow = null;
  });

  recipientsWindow.loadFile(path.join(root, 'src', 'recipients.html'));
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
    { label: 'Manage Recipients', click: () => showRecipientsWindow() },
    { label: 'Send Test Email', click: () => runNode(['src/testEmail.js'], true) },
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
  const intervalMinutes = cfg.checkIntervalMinutes || 5;
  timer = setInterval(() => checkNow(false), intervalMinutes * 60 * 1000);
  checkNow(false);
}

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();

  tray = new Tray(path.join(root, 'assets', 'trayTemplate.png'));
  tray.setToolTip('Walks Manager Watch');
  buildMenu();
  startScheduler();
});
ipcMain.handle('recipients:load', () => currentRecipients());
ipcMain.handle('recipients:save', (_event, text) => {
  const recipients = parseRecipients(text);
  const cfg = appConfig();
  cfg.notificationRecipients = recipients;
  writeAppConfig(cfg);
  buildMenu();
  return recipients;
});
app.on('before-quit', () => { if (timer) clearInterval(timer); });
app.on('window-all-closed', (e) => e.preventDefault());
