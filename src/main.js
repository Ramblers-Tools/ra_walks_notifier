const { app, Tray, Menu, shell, dialog, Notification, BrowserWindow, ipcMain, nativeImage, session: electronSession } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { formatUkDateTime } = require('./time');
const { parseRecipients, resolveRecipients, resolveSmtp } = require('./config');
const { parseWalkEntries } = require('./parser');
const { buildEmail } = require('./emailSummary');
const { sendEmail } = require('./email');
const { log, ensureDirs } = require('./logger');
const { copyLogo, logoDataUrl, logoPath } = require('./branding');
const { isLoginPage, sendSessionExpiredEmail } = require('./sessionExpiry');

let tray;
let timer;
let updateTimer;
let initialUpdateTimer;
let recipientsWindow;
let smtpWindow;
let setupWindow;
let loginWindow;
let lastStatus = 'Starting...';
let updateStatus = 'Not checked';
let manualUpdateCheck = false;
let updateHandlersConfigured = false;
const root = path.join(__dirname, '..');
const reviewUrl = 'https://walks-manager.ramblers.org.uk/walks-manager/list?gid=414&review=1';
const repoUrl = 'https://github.com/East-Cheshire-Ramblers/ra_walks_notifier';
const walksPartition = 'persist:walks-manager-watch-browser';
const updateCheckIntervalMs = 6 * 60 * 60 * 1000;

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
    fromName: settings.fromName || '',
    from: settings.from || ''
  };
}

function setupState() {
  const recipients = currentRecipients();
  const smtp = currentSmtp();
  const cfg = appConfig();
  return {
    recipients,
    smtp,
    branding: {
      logoPath: logoPath(cfg),
      logoDataUrl: logoDataUrl(cfg)
    },
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
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function sameWalk(a, b) {
  return JSON.stringify({ title: a.title, date: a.date, leader: a.leader, status: a.status, href: a.href }) === JSON.stringify({ title: b.title, date: b.date, leader: b.leader, status: b.status, href: b.href });
}

function asMap(walks) {
  return Object.fromEntries((walks || []).map(walk => [walk.id, walk]));
}

function cookieUrl(cookie) {
  const domain = String(cookie.domain || 'walks-manager.ramblers.org.uk').replace(/^\./, '');
  return `${cookie.secure === false ? 'http' : 'https'}://${domain}${cookie.path || '/'}`;
}

async function loadSavedSessionIntoElectron() {
  const browserSession = electronSession.fromPartition(walksPartition);
  await browserSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb']
  });

  const saved = readJson(sessionFile(), { cookies: [], origins: [] });
  for (const cookie of saved.cookies || []) {
    await browserSession.cookies.set({
      url: cookieUrl(cookie),
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
      expirationDate: cookie.expires && cookie.expires > 0 ? cookie.expires : undefined
    }).catch(() => {});
  }
}

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
    `Logo: ${logoPath() || 'Not configured'}`,
    `Settings folder: ${path.dirname(configFilePath())}`,
    `Log file: ${logFile()}`
  ].filter(Boolean).join('\n');
}

function configFilePath() {
  const { paths } = require('./config');
  return paths.configFile;
}

function showStatus() {
  const iconPath = logoPath();
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : undefined;
  dialog.showMessageBox({
    type: 'info',
    title: 'Walks Manager Watch Status',
    message: buildStatusText(),
    icon: icon && !icon.isEmpty() ? icon : undefined,
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
  if (tray) tray.setTitle(` ${count}`);
  buildMenu();
}

function trayIcon() {
  const image = nativeImage.createFromPath(path.join(root, 'assets', 'ramblers-logo.png'));
  if (image.isEmpty()) {
    return nativeImage.createFromPath(path.join(root, 'assets', 'trayTemplate.png'));
  }
  const resized = image.resize({ width: 18, height: 18 });
  resized.setTemplateImage(false);
  return resized;
}

async function sendSmtpTestEmail(showDialog = true) {
  try {
    await sendEmail(
      'Walks Manager Watch test email',
      'This is a test email from Walks Manager Watch.',
      '<p>This is a test email from <strong>Walks Manager Watch</strong>.</p>'
    );
    if (showDialog) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Walks Manager Watch',
        message: 'SMTP test email sent.'
      });
    }
    return { code: 0 };
  } catch (error) {
    if (showDialog) {
      dialog.showMessageBox({
        type: 'error',
        title: 'Walks Manager Watch',
        message: 'SMTP test email failed.',
        detail: error.stack || error.message
      });
    }
    return { code: 1, error };
  }
}

async function chooseBrandLogo(showConfirmation = true) {
  const result = await dialog.showOpenDialog({
    title: 'Choose Ramblers Logo',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
  });
  if (result.canceled || !result.filePaths.length) return setupState();

  const storedLogo = copyLogo(result.filePaths[0]);
  const cfg = appConfig();
  cfg.branding = Object.assign({}, cfg.branding, { logoPath: storedLogo });
  writeAppConfig(cfg);
  buildMenu();
  if (showConfirmation) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Walks Manager Watch',
      message: 'Logo updated.',
      detail: storedLogo
    });
  }
  return setupState();
}

async function resetBrandLogo() {
  const cfg = appConfig();
  delete cfg.branding;
  writeAppConfig(cfg);
  buildMenu();
  dialog.showMessageBox({
    type: 'info',
    title: 'Walks Manager Watch',
    message: 'Logo reset to the built-in Ramblers logo.'
  });
  return setupState();
}

function showAbout() {
  dialog.showMessageBox({
    type: 'info',
    title: 'About Walks Manager Watch',
    message: 'Walks Manager Watch',
    detail: [
      `Version: ${app.getVersion()}`,
      'macOS menu bar app for monitoring Ramblers Walks Manager review queues.',
      '',
      repoUrl
    ].join('\n'),
    buttons: ['OK', 'Open GitHub'],
    defaultId: 0
  }).then(result => {
    if (result.response === 1) shell.openExternal(repoUrl);
  });
}

function startAtBootEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

function toggleStartAtBoot() {
  const enabled = !startAtBootEnabled();
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    path: process.execPath
  });
  buildMenu();
}

function configureUpdates() {
  if (updateHandlersConfigured) return;
  updateHandlersConfigured = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    updateStatus = 'Checking...';
    buildMenu();
  });

  autoUpdater.on('update-not-available', () => {
    updateStatus = 'No update available';
    buildMenu();
    if (manualUpdateCheck) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Walks Manager Watch',
        message: 'Walks Manager Watch is up to date.'
      });
    }
    manualUpdateCheck = false;
  });

  autoUpdater.on('update-available', (info) => {
    manualUpdateCheck = false;
    updateStatus = `Version ${info.version} available`;
    buildMenu();
    dialog.showMessageBox({
      type: 'info',
      title: 'Walks Manager Watch Update',
      message: `Version ${info.version} is available.`,
      detail: 'Download it now and install when ready?',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then(result => {
      if (result.response === 0) {
        updateStatus = 'Downloading...';
        buildMenu();
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateStatus = `Version ${info.version} ready`;
    buildMenu();
    dialog.showMessageBox({
      type: 'info',
      title: 'Walks Manager Watch Update',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'Install it now? The app will restart.',
      buttons: ['Install and Restart', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then(result => {
      if (result.response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (error) => {
    updateStatus = 'Check failed';
    buildMenu();
    if (manualUpdateCheck) {
      dialog.showMessageBox({
        type: 'error',
        title: 'Walks Manager Watch Update',
        message: 'Update check failed.',
        detail: error.stack || error.message
      });
    }
    manualUpdateCheck = false;
    log(`Update error: ${error.stack || error.message}`);
  });
}

function checkForUpdates(manual = true) {
  configureUpdates();
  manualUpdateCheck = manual;
  if (!app.isPackaged) {
    if (manual) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Walks Manager Watch Update',
        message: 'Update checks are available in the installed app.'
      });
    }
    updateStatus = 'Installed app only';
    manualUpdateCheck = false;
    buildMenu();
    return;
  }
  autoUpdater.checkForUpdates();
}

function stopUpdateChecks() {
  if (initialUpdateTimer) clearTimeout(initialUpdateTimer);
  if (updateTimer) clearInterval(updateTimer);
  initialUpdateTimer = null;
  updateTimer = null;
}

function startUpdateChecks() {
  stopUpdateChecks();
  if (!setupState().complete) return;

  initialUpdateTimer = setTimeout(() => checkForUpdates(false), 10000);
  updateTimer = setInterval(() => checkForUpdates(false), updateCheckIntervalMs);
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
    height: 520,
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
    height: 790,
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
  const status = readJson(paths.statusFile, {});
  status.sessionExpiredEmailSent = false;
  status.lastError = null;
  writeJson(paths.statusFile, status);
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
        partition: walksPartition,
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
  const res = await runElectronCheck(force);
  updateTrayLabel();
  if (!res.ok) {
    new Notification({ title: 'Walks Manager Watch failed', body: 'Open status for details.' }).show();
  }
}

function waitForWindowEvent(window, event, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onFail = (_event, code, description) => {
      cleanup();
      reject(new Error(description || `Page load failed with code ${code}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      window.webContents.off(event, onSuccess);
      window.webContents.off('did-fail-load', onFail);
    };
    window.webContents.once(event, onSuccess);
    window.webContents.once('did-fail-load', onFail);
  });
}

async function extractWalkEntries(window) {
  return window.webContents.executeJavaScript(`
    Array.from(document.querySelectorAll('a[href*="/go-walking/group-walks/"]')).map(link => {
      let node = link;
      let card = null;
      while (node && node !== document.body) {
        const text = node.innerText || '';
        if (/Submitted for checking|Awaiting publishing|Ready to publish/i.test(text)) {
          card = node;
          break;
        }
        node = node.parentElement;
      }
      return {
        href: link.getAttribute('href') || '',
        title: link.innerText || '',
        text: card ? card.innerText : ''
      };
    })
  `, true);
}

async function runElectronCheck(force = false) {
  const { groups } = require('./config');
  const { nowUkDateTime } = require('./time');
  ensureDirs();
  log('Starting Walks Manager check.');

  const startedAt = nowUkDateTime();
  const status = readJson(statusFile(), {});
  status.lastCheckStartedAt = startedAt;
  status.lastError = null;
  writeJson(statusFile(), status);

  const prev = readJson(stateFile(), { walks: [] });
  const currentWalks = [];
  let checkWindow;

  try {
    checkWindow = new BrowserWindow({
      width: 1200,
      height: 900,
      show: false,
      webPreferences: {
        partition: walksPartition,
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    await loadSavedSessionIntoElectron();

    for (const group of groups) {
      const url = `https://walks-manager.ramblers.org.uk/walks-manager/list?gid=${group.gid}&review=1`;
      log(`Checking ${group.name}: ${url}`);
      const loaded = waitForWindowEvent(checkWindow, 'did-finish-load', 45000);
      checkWindow.loadURL(url);
      await loaded;
      await new Promise(resolve => setTimeout(resolve, 5000));
      const pageText = await checkWindow.webContents.executeJavaScript('document.body ? document.body.innerText : ""', true);
      if (isLoginPage(checkWindow.webContents.getURL(), pageText)) {
        const message = 'Walks Manager login required. The saved Ramblers single sign-on session may have expired.';
        log(message);
        status.lastError = message;
        status.lastCheckCompletedAt = nowUkDateTime();
        status.lastResult = 'Login required';
        if (!status.sessionExpiredEmailSent) {
          await sendSessionExpiredEmail();
          status.sessionExpiredEmailSent = true;
          status.lastEmailAt = nowUkDateTime();
          log('Session expiry email sent.');
        }
        writeJson(statusFile(), status);
        checkWindow.close();
        checkWindow = null;
        return { ok: false, error: new Error(message) };
      }
      const entries = await extractWalkEntries(checkWindow);
      const walks = parseWalkEntries(entries, group.name);
      log(`Found ${walks.length} pending walk(s) for ${group.name}.`);
      currentWalks.push(...walks);
    }

    checkWindow.close();
    checkWindow = null;

    const prevMap = asMap(prev.walks);
    const currentMap = asMap(currentWalks);
    const newWalks = currentWalks.filter(walk => !prevMap[walk.id]);
    const changedWalks = currentWalks.filter(walk => prevMap[walk.id] && !sameWalk(walk, prevMap[walk.id]));
    const clearedWalks = (prev.walks || []).filter(walk => !currentMap[walk.id]);
    log(`Summary: ${currentWalks.length} current, ${newWalks.length} new, ${changedWalks.length} changed, ${clearedWalks.length} cleared.`);

    const cfg = appConfig();
    const shouldEmail = force || (cfg.notifyOnNew !== false && newWalks.length) || (cfg.notifyOnChanged !== false && changedWalks.length);
    if (shouldEmail) {
      const total = newWalks.length + changedWalks.length;
      const subject = total === 1 ? 'Walks Manager Watch: 1 change' : `Walks Manager Watch: ${total} changes`;
      const { text, html } = buildEmail(newWalks, changedWalks, clearedWalks, currentWalks);
      await sendEmail(subject, text, html);
      new Notification({ title: 'Walks Manager Watch', body: `${total} change(s) detected.` }).show();
      log('Email sent.');
      status.lastEmailAt = nowUkDateTime();
    } else {
      log('No notification needed.');
    }

    writeJson(stateFile(), { updatedAt: nowUkDateTime(), walks: currentWalks });
    status.lastCheckCompletedAt = nowUkDateTime();
    status.pendingWalks = currentWalks.length;
    status.lastResult = `${currentWalks.length} pending; ${newWalks.length} new; ${changedWalks.length} changed; ${clearedWalks.length} cleared`;
    status.sessionExpiredEmailSent = false;
    writeJson(statusFile(), status);
    return { ok: true };
  } catch (error) {
    if (checkWindow) checkWindow.close();
    log(`ERROR: ${error.stack || error.message}`);
    status.lastError = error.message;
    status.lastCheckCompletedAt = nowUkDateTime();
    writeJson(statusFile(), status);
    return { ok: false, error };
  }
}

function buildMenu() {
  const s = readStatus();
  const lastCheck = formatUkDateTime(s.lastCheckCompletedAt);
  const setup = setupState();
  const configured = setup.complete;
  const bootEnabled = startAtBootEnabled();
  const menu = Menu.buildFromTemplate([
    { label: `Status: ${lastStatus}`, enabled: false },
    { label: `Last check: ${lastCheck}`, enabled: false },
    { label: `Update: ${updateStatus}`, enabled: false },
    { type: 'separator' },
    { label: 'Show Status', enabled: configured, click: () => showStatus() },
    { label: 'Check Now', enabled: configured, click: () => checkNow(false) },
    { label: 'Send Walks Report Email', enabled: configured, click: () => checkNow(true) },
    { label: 'Login to Walks Manager', click: () => openWalksManagerLoginWindow().then(result => {
      dialog.showMessageBox({
        type: result.code === 0 ? 'info' : 'error',
        title: 'Walks Manager Login',
        message: result.message
      });
    }), enabled: configured },
    { label: 'Open Review List', enabled: configured, click: () => shell.openExternal(reviewUrl) },
    {
      enabled: configured,
      label: 'Settings && Configuration',
      submenu: [
        { label: 'Configured', enabled: false },
        { type: 'separator' },
        { label: 'Manage Recipients', click: () => showRecipientsWindow() },
        { label: 'SMTP Settings', click: () => showSmtpWindow() },
        {
          label: 'Start at Boot',
          type: 'checkbox',
          checked: bootEnabled,
          click: () => toggleStartAtBoot()
        },
        { type: 'separator' },
        { label: 'Change Logo', click: () => chooseBrandLogo() },
        { label: 'Reset Logo', click: () => resetBrandLogo() }
      ]
    },
    { type: 'separator' },
    { label: 'Send SMTP Test Email', enabled: configured, click: () => sendSmtpTestEmail(true) },
    { label: 'Check for Updates', enabled: configured, click: () => checkForUpdates(true) },
    { label: 'About', click: () => showAbout() },
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

function refreshScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  startScheduler();
}

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  configureUpdates();

  tray = new Tray(trayIcon());
  tray.setToolTip('Walks Manager Watch');
  buildMenu();
  startScheduler();
  if (!setupState().complete) {
    showSetupWindow();
  } else {
    startUpdateChecks();
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
    fromName: String(settings.fromName || '').trim(),
    from: String(settings.from || '').trim()
  };
  writeAppConfig(cfg);
  buildMenu();
  return currentSmtp();
});
ipcMain.handle('setup:load', () => setupState());
ipcMain.handle('setup:choose-logo', () => chooseBrandLogo(false));
ipcMain.handle('setup:save', (_event, settings) => {
  const cfg = appConfig();
  cfg.notificationRecipients = parseRecipients(settings.recipients);
  cfg.smtp = {
    host: String(settings.smtp?.host || '').trim(),
    port: Number(settings.smtp?.port || 587),
    secure: Boolean(settings.smtp?.secure),
    user: String(settings.smtp?.user || '').trim(),
    pass: String(settings.smtp?.pass || ''),
    fromName: String(settings.smtp?.fromName || '').trim(),
    from: String(settings.smtp?.from || '').trim()
  };
  writeAppConfig(cfg);
  const state = setupState();
  buildMenu();
  if (state.complete) {
    if (setupWindow) setupWindow.close();
    refreshScheduler();
    startUpdateChecks();
  }
  return state;
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
ipcMain.handle('setup:test-email', () => sendSmtpTestEmail(true));
app.on('before-quit', () => {
  if (timer) clearInterval(timer);
  stopUpdateChecks();
});
app.on('window-all-closed', (e) => e.preventDefault());
