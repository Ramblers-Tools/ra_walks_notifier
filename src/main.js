const { app, Tray, Menu, shell, dialog, Notification, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { formatUkDateTime } = require('./time');
const { parseRecipients, resolveRecipients, resolveSmtp } = require('./config');

let tray;
let timer;
let recipientsWindow;
let smtpWindow;
let setupWindow;
let loginWindow;
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
  const { paths } = require('./config');
  return readJson(paths.configFile, readJson(paths.rootConfigFile, { checkIntervalMinutes: 5, activeHours: { start: 7, end: 22 } }));
}

function writeAppConfig(config) {
  const { paths } = require('./config');
  fs.mkdirSync(path.dirname(paths.configFile), { recursive: true });
  fs.writeFileSync(paths.configFile, `${JSON.stringify(config, null, 2)}\n`);
}

function currentRecipients() {
  return resolveRecipients(appConfig(), process.env);
}

function currentSmtp() {
  const settings = resolveSmtp(appConfig(), process.env);
  return {
    host: settings.host || '',
    port: settings.port || 587,
    secure: Boolean(settings.secure),
    user: settings.user || '',
    pass: settings.pass || '',
    from: settings.from || ''
  };
}

function setupState() {
  const recipients = currentRecipients();
  const smtp = currentSmtp();
  return {
    recipients,
    smtp,
    sessionPresent: fs.existsSync(sessionFile()),
    complete: Boolean(recipients.length && smtp.host && smtp.user && smtp.pass && smtp.from && fs.existsSync(sessionFile()))
  };
}

function groupsConfig() {
  const { paths } = require('./config');
  return readJson(paths.groupsFile, []);
}

function statusFile() { const { paths } = require('./config'); return paths.statusFile; }
function stateFile() { const { paths } = require('./config'); return paths.stateFile; }
function sessionFile() { const { paths } = require('./config'); return paths.sessionFile; }
function logFile() { const { paths } = require('./config'); return paths.logFile; }
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
    `SMTP: ${currentSmtp().host || 'Not configured'}`,
    `Last error: ${s.lastError || 'None'}`,
    '',
    `Session: ${fs.existsSync(sessionFile()) ? 'Present' : 'Missing'}`,
    `Settings folder: ${path.dirname(configFilePath())}`,
    `Log file: ${logFile()}`
  ].filter(Boolean).join('\n');
}

function configFilePath() {
  const { paths } = require('./config');
  return paths.configFile;
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

function showSmtpWindow() {
  if (smtpWindow) {
    smtpWindow.focus();
    return;
  }

  smtpWindow = new BrowserWindow({
    width: 520,
    height: 460,
    title: 'SMTP Settings',
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'smtpPreload.js')
    }
  });

  smtpWindow.on('closed', () => {
    smtpWindow = null;
  });

  smtpWindow.loadFile(path.join(root, 'src', 'smtp.html'));
}

function showSetupWindow() {
  if (setupWindow) {
    setupWindow.focus();
    return;
  }

  setupWindow = new BrowserWindow({
    width: 640,
    height: 660,
    title: 'Walks Manager Watch Setup',
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'setupPreload.js')
    }
  });

  setupWindow.on('closed', () => {
    setupWindow = null;
  });

  setupWindow.loadFile(path.join(root, 'src', 'setup.html'));
}

function sameSiteForStorageState(value) {
  if (value === 'strict') return 'Strict';
  if (value === 'no_restriction') return 'None';
  return 'Lax';
}

async function saveElectronLoginSession(window) {
  const { paths } = require('./config');
  const { ensureDirs, log } = require('./logger');
  ensureDirs();

  const cookies = await window.webContents.session.cookies.get({ url: 'https://walks-manager.ramblers.org.uk' });
  const localStorageItems = await window.webContents.executeJavaScript(`
    JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])))
  `);
  const localStorage = Object.entries(JSON.parse(localStorageItems || '{}')).map(([name, value]) => ({ name, value }));
  const storageState = {
    cookies: cookies.map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      expires: cookie.expirationDate || -1,
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
      sameSite: sameSiteForStorageState(cookie.sameSite)
    })),
    origins: [{
      origin: 'https://walks-manager.ramblers.org.uk',
      localStorage
    }]
  };

  fs.mkdirSync(path.dirname(paths.sessionFile), { recursive: true });
  fs.writeFileSync(paths.sessionFile, `${JSON.stringify(storageState, null, 2)}\n`);
  log(`Saved Walks Manager session to ${paths.sessionFile}`);
}

function isWalksManagerReviewPage(text, url) {
  return /walks-manager\.ramblers\.org\.uk\/walks-manager\//.test(url)
    && /Walks Manager|Submitted for checking|Awaiting publishing|Ready to publish/i.test(text || '');
}

function openWalksManagerLoginWindow() {
  if (loginWindow) {
    loginWindow.focus();
  } else {
    loginWindow = new BrowserWindow({
      width: 1180,
      height: 820,
      title: 'Walks Manager Login',
      resizable: true,
      minimizable: true,
      fullscreenable: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    loginWindow.on('closed', () => {
      loginWindow = null;
    });

    loginWindow.loadURL(reviewUrl);
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    const interval = setInterval(async () => {
      if (!loginWindow) {
        clearInterval(interval);
        resolve({ code: 1, message: 'Login window was closed before the session was saved.' });
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(interval);
        resolve({ code: 1, message: 'Timed out waiting for Walks Manager login.' });
        return;
      }

      try {
        const url = loginWindow.webContents.getURL();
        const text = await loginWindow.webContents.executeJavaScript('document.body ? document.body.innerText : ""', true);
        if (!isWalksManagerReviewPage(text, url)) return;

        await saveElectronLoginSession(loginWindow);
        clearInterval(interval);
        loginWindow.close();
        resolve({ code: 0, message: 'Walks Manager login session saved.' });
      } catch (error) {
        clearInterval(interval);
        resolve({ code: 1, message: error.message });
      }
    }, 1500);
  });
}

async function checkNow(force = false) {
  if (!setupState().complete && !force) {
    lastStatus = 'Setup required';
    buildMenu();
    showSetupWindow();
    return;
  }

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
    { label: 'Setup', click: () => showSetupWindow() },
    { label: 'Show Status', click: () => showStatus() },
    { label: 'Check Now', click: () => checkNow(false) },
    { label: 'Force Test Email', click: () => checkNow(true) },
    { label: 'Manage Recipients', click: () => showRecipientsWindow() },
    { label: 'SMTP Settings', click: () => showSmtpWindow() },
    { label: 'Send Test Email', click: () => runNode(['src/testEmail.js'], true) },
    { label: 'Login to Walks Manager', click: () => openWalksManagerLoginWindow().then(result => {
      dialog.showMessageBox({
        type: result.code === 0 ? 'info' : 'error',
        title: 'Walks Manager Login',
        message: result.message
      });
    }) },
    { label: 'Open Review List', click: () => shell.openExternal(reviewUrl) },
    { type: 'separator' },
    { label: 'Open Settings Folder', click: () => shell.openPath(path.dirname(configFilePath())) },
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
  if (!setupState().complete) {
    showSetupWindow();
  }
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
ipcMain.handle('smtp:load', () => currentSmtp());
ipcMain.handle('smtp:save', (_event, settings) => {
  const cfg = appConfig();
  cfg.smtp = {
    host: String(settings.host || '').trim(),
    port: Number(settings.port || 587),
    secure: Boolean(settings.secure),
    user: String(settings.user || '').trim(),
    pass: String(settings.pass || ''),
    from: String(settings.from || '').trim()
  };
  writeAppConfig(cfg);
  buildMenu();
  return currentSmtp();
});
ipcMain.handle('setup:load', () => setupState());
ipcMain.handle('setup:save', (_event, settings) => {
  const cfg = appConfig();
  cfg.notificationRecipients = parseRecipients(settings.recipients);
  cfg.smtp = {
    host: String(settings.smtp?.host || '').trim(),
    port: Number(settings.smtp?.port || 587),
    secure: Boolean(settings.smtp?.secure),
    user: String(settings.smtp?.user || '').trim(),
    pass: String(settings.smtp?.pass || ''),
    from: String(settings.smtp?.from || '').trim()
  };
  writeAppConfig(cfg);
  buildMenu();
  return setupState();
});
ipcMain.handle('setup:login', async () => {
  await dialog.showMessageBox({
    type: 'info',
    title: 'Walks Manager Login',
    message: 'A browser window will open. Sign in to Walks Manager and wait until the review list loads. The app will save the session automatically.'
  });
  const result = await openWalksManagerLoginWindow();
  return { code: result.code, message: result.message, sessionPresent: fs.existsSync(sessionFile()) };
});
ipcMain.handle('setup:test-email', () => runNode(['src/testEmail.js'], true));
app.on('before-quit', () => { if (timer) clearInterval(timer); });
app.on('window-all-closed', (e) => e.preventDefault());
