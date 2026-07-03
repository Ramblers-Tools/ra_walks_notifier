const { app, Tray, Menu, shell, dialog, Notification, BrowserWindow, ipcMain, nativeImage, session: electronSession } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { formatUkDateTime } = require('./time');
const { migrateLegacyConfig, parseRecipients } = require('./config');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (isConfigured()) {
    showStatus();
  } else {
    showConnectWindow();
  }
});

migrateLegacyConfig();

const apiClient = require('./apiClient');

let tray;
let statusPollTimer;
let connectWindow;
let recipientsWindow;
let scheduleWindow;
let leaderEmailWindow;
let loginWindow;
let logWindow;
let aboutWindow;
let statusWindow;
let lastStatus = 'Starting...';
let updateStatus = 'Not checked';
let manualUpdateCheck = false;
let updateHandlersConfigured = false;
let quittingForUpdate = false;
let lastLoginAutoAdvanceAt = 0;

// In-memory cache of the last successful API responses. The tray/menu/status
// text are all built from this cache rather than fetching live on every
// render, since Electron menu/tray updates need to be synchronous.
let cachedConfig = null;
let cachedStatus = null;
let cachedGroups = [];
let cachedSessionPresent = false;

const root = path.join(__dirname, '..');
const websiteUrl = 'https://rawalksnotifier.ramblers.tools/';
const walksPartition = 'persist:walks-manager-watch-browser';
const updateCheckIntervalMs = 6 * 60 * 60 * 1000;
const statusPollIntervalMs = 30 * 1000;

function isBetaBuild() {
  return /-beta(?:\.|$)/.test(app.getVersion());
}

function releaseChannelLabel() {
  return isBetaBuild() ? 'Beta' : 'Stable';
}

function displayVersion() {
  const version = app.getVersion();
  return isBetaBuild() ? `${version} Beta` : version;
}

function includeBetaUpdates() {
  const configured = apiClient.getIncludeBetaUpdates();
  if (typeof configured === 'boolean') return configured;
  return isBetaBuild();
}

async function toggleBetaUpdates() {
  const nextValue = !includeBetaUpdates();
  if (nextValue) {
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: 'Subscribe to Beta Updates',
      message: 'Subscribe to beta updates?',
      detail: 'Beta versions may include unfinished changes and may not work correctly. Use this option only if you are happy to test new builds.',
      buttons: ['Cancel', 'Subscribe'],
      defaultId: 0,
      cancelId: 0
    });
    if (result.response !== 1) {
      buildMenu();
      return;
    }
  }
  apiClient.setIncludeBetaUpdates(nextValue);
  buildMenu();
}

function ramblersLogoPath() {
  return path.join(root, 'assets', 'ramblers-logo.png');
}
function appIconPath() {
  return ramblersLogoPath();
}
function appWindowOptions(options) {
  return Object.assign({ icon: appIconPath() }, options);
}
function logWindowOptions(options) {
  return Object.assign({ icon: ramblersLogoPath() }, options);
}
function visibleAppWindows() {
  return [connectWindow, recipientsWindow, scheduleWindow, leaderEmailWindow, loginWindow, logWindow, aboutWindow, statusWindow].filter(window => window && !window.isDestroyed());
}
function showDockIcon(iconPath = appIconPath()) {
  if (!app.dock) return;
  app.dock.setIcon(iconPath);
  app.dock.show();
}
function refreshDockVisibility() {
  if (!app.dock) return;
  if (visibleAppWindows().length) {
    app.dock.show();
  } else {
    app.dock.hide();
  }
}
function trackVisibleWindow(window, iconPath = appIconPath()) {
  showDockIcon(iconPath);
  window.on('closed', () => {
    setImmediate(refreshDockVisibility);
  });
  return window;
}

function statusLine(label, value) {
  return `${label}: ${value}`;
}

function statusList(label, values, empty = 'None configured') {
  if (!values.length) return statusLine(label, empty);
  return `${label}:\n${values.map(value => `  ${value}`).join('\n')}`;
}

function isConfigured() {
  return Boolean(
    apiClient.hasApiKey() &&
    cachedSessionPresent &&
    cachedGroups.length &&
    (cachedConfig?.notificationRecipients || []).length
  );
}

function buildStatusText() {
  const s = cachedStatus || {};
  const groupNames = cachedGroups.map(group => group.name || `Group ${group.gid}`);
  const recipients = parseRecipients(cachedConfig?.notificationRecipients || []);
  const schedule = { checkIntervalMinutes: cachedConfig?.checkIntervalMinutes || 5, activeHours: cachedConfig?.activeHours || { start: 7, end: 22 } };
  const pending = Number(s.pendingWalks || 0);
  return [
    `Status: ${s.maintenanceMessage ? 'Server offline (maintenance)' : apiClient.hasApiKey() ? 'Connected' : 'Not connected'}`,
    `Last error: ${s.lastError || 'None'}`,
    `Session: ${cachedSessionPresent ? 'Present' : 'Missing'}`,
    `Pending walks: ${pending}`,
    '',
    statusList(cachedGroups.length === 1 ? 'Group' : 'Groups', groupNames, 'Not selected'),
    '',
    `Schedule: Every ${schedule.checkIntervalMinutes} minutes`,
    `Active hours: ${String(schedule.activeHours.start).padStart(2, '0')}:00 to ${String(schedule.activeHours.end).padStart(2, '0')}:00`,
    `Last check: ${formatUkDateTime(s.lastCheckCompletedAt)}`,
    `Last result: ${s.lastResult || 'None yet'}`,
    `Last email: ${formatUkDateTime(s.lastEmailAt)}`,
    '',
    statusList('Recipients', recipients)
  ].join('\n');
}

function selectedGroup() {
  return cachedGroups[0] || null;
}

function reviewUrlForGroup(group = selectedGroup()) {
  if (!group) return 'https://walks-manager.ramblers.org.uk/walks-manager/list?review=1';
  return `https://walks-manager.ramblers.org.uk/walks-manager/list?gid=${encodeURIComponent(group.gid)}&review=1`;
}

function showStatus() {
  if (statusWindow) {
    statusWindow.focus();
    return;
  }

  statusWindow = trackVisibleWindow(new BrowserWindow(appWindowOptions({
    width: 480,
    height: 640,
    title: 'RA Walks Notifier Status',
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: path.join(__dirname, 'statusPreload.js')
    }
  })));

  statusWindow.once('ready-to-show', () => {
    statusWindow.show();
  });

  statusWindow.on('closed', () => {
    statusWindow = null;
  });

  statusWindow.loadFile(path.join(__dirname, 'status.html'));
}

function showLogWindow() {
  if (logWindow) {
    logWindow.focus();
    return;
  }

  logWindow = trackVisibleWindow(new BrowserWindow(logWindowOptions({
    width: 900,
    height: 620,
    title: 'RA Walks Notifier Logs',
    webPreferences: {
      preload: path.join(__dirname, 'logPreload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })), ramblersLogoPath());

  logWindow.on('closed', () => {
    logWindow = null;
  });

  logWindow.loadFile(path.join(__dirname, 'log.html'));
}

function handleRevokedApiKey(message) {
  apiClient.clearApiKey();
  cachedConfig = null;
  cachedGroups = [];
  cachedSessionPresent = false;
  cachedStatus = null;
  buildMenu();
  dialog.showMessageBox({
    type: 'error',
    title: 'RA Walks Notifier',
    message: 'Reconnect required',
    detail: message
  });
  showConnectWindow();
}

async function refreshCache() {
  if (!apiClient.hasApiKey()) return;
  try {
    const [config, status, sessionStatus] = await Promise.all([
      apiClient.getConfig(),
      apiClient.getStatus(),
      apiClient.getSessionStatus()
    ]);
    cachedConfig = config;
    cachedStatus = status;
    cachedGroups = config.groups || [];
    cachedSessionPresent = sessionStatus.present;
  } catch (error) {
    if (error.code === 'unauthorized') {
      handleRevokedApiKey(error.message);
      return;
    }
    if (error.code === 'maintenance') {
      cachedStatus = { ...(cachedStatus || {}), maintenanceMessage: `${error.message} [${error.diagnostic || 'no diagnostic'}]` };
    } else {
      cachedStatus = { ...(cachedStatus || {}), maintenanceMessage: null, lastError: `Could not reach server: ${error.message}` };
    }
  }
  updateTrayLabel();
}

async function startStatusPolling() {
  if (statusPollTimer) clearInterval(statusPollTimer);
  await refreshCache();
  statusPollTimer = setInterval(refreshCache, statusPollIntervalMs);
}

function updateTrayLabel() {
  const s = cachedStatus || {};
  const count = Number(s.pendingWalks || 0);
  const err = s.lastError;
  lastStatus = s.maintenanceMessage
    ? '⚠ Server offline (maintenance)'
    : s.checking ? 'Checking...' : err ? `Error: ${err}` : `${count} pending walk${count === 1 ? '' : 's'}`;
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

async function checkNow(force = false) {
  if (!isConfigured()) {
    lastStatus = 'Setup required';
    buildMenu();
    showConnectWindow();
    return;
  }

  lastStatus = 'Checking...';
  buildMenu();
  try {
    await apiClient.postCheckNow(force);
  } catch (error) {
    if (error.code === 'unauthorized') {
      handleRevokedApiKey(error.message);
      return;
    }
    new Notification({ title: 'RA Walks Notifier', body: error.message }).show();
  }
  // The check runs asynchronously on the server; poll shortly after to
  // pick up progress, then again once it should have finished.
  setTimeout(refreshCache, 5000);
  setTimeout(refreshCache, 90000);
}

async function chooseBrandLogo() {
  const result = await dialog.showOpenDialog({
    title: 'Choose Ramblers Logo',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
  });
  if (result.canceled || !result.filePaths.length) return;

  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).slice(1);
  try {
    const data = fs.readFileSync(filePath).toString('base64');
    await apiClient.putLogo(data, ext);
    dialog.showMessageBox({ type: 'info', title: 'RA Walks Notifier', message: 'Logo updated.' });
  } catch (error) {
    dialog.showMessageBox({ type: 'error', title: 'RA Walks Notifier', message: error.message });
  }
}

async function resetBrandLogo() {
  try {
    await apiClient.deleteLogo();
    dialog.showMessageBox({ type: 'info', title: 'RA Walks Notifier', message: 'Logo reset to the built-in Ramblers logo.' });
  } catch (error) {
    dialog.showMessageBox({ type: 'error', title: 'RA Walks Notifier', message: error.message });
  }
}

function showAbout() {
  if (aboutWindow) {
    aboutWindow.focus();
    return;
  }

  aboutWindow = trackVisibleWindow(new BrowserWindow(appWindowOptions({
    width: 360,
    height: 390,
    title: 'About RA Walks Notifier',
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: path.join(__dirname, 'aboutPreload.js')
    }
  })));

  aboutWindow.once('ready-to-show', () => {
    aboutWindow.show();
  });

  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });

  aboutWindow.loadFile(path.join(__dirname, 'about.html'));
}

function supportsLoginItemSettings() {
  return process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux';
}

function linuxAutostartFile() {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config');
  return path.join(configHome, 'autostart', 'walks-manager-watch.desktop');
}

function quoteDesktopExec(value) {
  return `"${String(value).replace(/(["\\`$])/g, '\\$1')}"`;
}

function linuxAutostartEntry() {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=RA Walks Notifier',
    'Comment=Monitor Ramblers Walks Manager review queues',
    `Exec=${quoteDesktopExec(process.execPath)}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    'Categories=Utility;',
    ''
  ].join('\n');
}

function startAtBootEnabled() {
  if (!supportsLoginItemSettings()) return false;
  if (process.platform === 'linux') return fs.existsSync(linuxAutostartFile());
  return app.getLoginItemSettings().openAtLogin;
}

function toggleStartAtBoot() {
  const enabled = !startAtBootEnabled();
  if (process.platform === 'linux') {
    const autostartFile = linuxAutostartFile();
    if (enabled) {
      fs.mkdirSync(path.dirname(autostartFile), { recursive: true });
      fs.writeFileSync(autostartFile, linuxAutostartEntry());
    } else if (fs.existsSync(autostartFile)) {
      fs.rmSync(autostartFile, { force: true });
    }
    buildMenu();
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    path: process.execPath
  });
  buildMenu();
}

function prepareForUpdateInstall() {
  quittingForUpdate = true;
  if (statusPollTimer) clearInterval(statusPollTimer);
  statusPollTimer = null;
  stopUpdateChecks();
  cleanupShipItUpdateCache();
}

function installDownloadedUpdate() {
  prepareForUpdateInstall();
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
}

function removePathIfPresent(target) {
  try {
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  } catch (error) {
    console.error(`Could not remove update cache path ${target}: ${error.message}`);
  }
}

function cleanupShipItUpdateCache() {
  const shipItDir = path.join(app.getPath('home'), 'Library', 'Caches', 'uk.richardhigham.walksmanagerwatch.ShipIt');
  for (const dir of [shipItDir]) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        if (entry.startsWith('update.')) removePathIfPresent(path.join(dir, entry));
      }
    } catch (error) {
      console.error(`Could not clean ShipIt update cache ${dir}: ${error.message}`);
    }
  }
}

function cleanupDownloadedUpdateCache() {
  cleanupShipItUpdateCache();
  removePathIfPresent(path.join(app.getPath('home'), 'Library', 'Caches', 'walks-manager-watch-updater'));
}

function configureUpdates() {
  if (updateHandlersConfigured) return;
  updateHandlersConfigured = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('before-quit-for-update', () => {
    prepareForUpdateInstall();
  });

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
        title: 'RA Walks Notifier',
        message: 'RA Walks Notifier is up to date.'
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
      title: 'RA Walks Notifier Update',
      message: `Version ${info.version} is available.`,
      detail: 'Download it now and install when ready?',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then(result => {
      if (result.response === 0) {
        updateStatus = 'Downloading...';
        buildMenu();
        cleanupDownloadedUpdateCache();
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateStatus = `Version ${info.version} ready`;
    buildMenu();
    dialog.showMessageBox({
      type: 'info',
      title: 'RA Walks Notifier Update',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'Install it now? The app will restart.',
      buttons: ['Install and Restart', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then(result => {
      if (result.response === 0) installDownloadedUpdate();
    });
  });

  autoUpdater.on('error', (error) => {
    updateStatus = 'Check failed';
    buildMenu();
    const detail = error.stack || error.message;
    const lowSpace = /no space left on device|ENOSPC|Could not write update request/i.test(detail);
    if (manualUpdateCheck) {
      dialog.showMessageBox({
        type: 'error',
        title: 'RA Walks Notifier Update',
        message: 'Update check failed.',
        detail: lowSpace
          ? `${detail}\n\nYour Mac needs more free disk space to unpack the update. Free at least 1-2 GB, then try Check for Updates again.`
          : detail
      });
    }
    manualUpdateCheck = false;
    console.error(`Update error: ${error.stack || error.message}`);
  });
}

function checkForUpdates(manual = true) {
  configureUpdates();
  autoUpdater.allowPrerelease = includeBetaUpdates();
  manualUpdateCheck = manual;
  if (!app.isPackaged) {
    if (manual) {
      dialog.showMessageBox({
        type: 'info',
        title: 'RA Walks Notifier Update',
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

let updateTimer;
let initialUpdateTimer;

function startUpdateChecks() {
  stopUpdateChecks();
  if (!isConfigured()) return;

  initialUpdateTimer = setTimeout(() => checkForUpdates(false), 10000);
  updateTimer = setInterval(() => checkForUpdates(false), updateCheckIntervalMs);
}

function showConnectWindow() {
  if (connectWindow) {
    connectWindow.focus();
    return;
  }

  connectWindow = trackVisibleWindow(new BrowserWindow(appWindowOptions({
    width: 560,
    height: 860,
    title: 'Server Connection & Login',
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'connectPreload.js')
    }
  })));

  connectWindow.on('closed', () => {
    connectWindow = null;
  });

  connectWindow.loadFile(path.join(root, 'src', 'connect.html'));
}

function showRecipientsWindow() {
  if (recipientsWindow) {
    recipientsWindow.focus();
    return;
  }

  recipientsWindow = trackVisibleWindow(new BrowserWindow(appWindowOptions({
    width: 520,
    height: 360,
    title: 'Notification Recipients',
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'recipientsPreload.js')
    }
  })));

  recipientsWindow.on('closed', () => {
    recipientsWindow = null;
  });

  recipientsWindow.loadFile(path.join(root, 'src', 'recipients.html'));
}

function showScheduleWindow() {
  if (scheduleWindow) {
    scheduleWindow.focus();
    return;
  }

  scheduleWindow = trackVisibleWindow(new BrowserWindow(appWindowOptions({
    width: 520,
    height: 320,
    title: 'Check Schedule and Active Hours',
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'schedulePreload.js')
    }
  })));

  scheduleWindow.on('closed', () => {
    scheduleWindow = null;
  });

  scheduleWindow.loadFile(path.join(root, 'src', 'schedule.html'));
}

function showLeaderEmailWindow() {
  if (leaderEmailWindow) {
    leaderEmailWindow.focus();
    return;
  }

  leaderEmailWindow = trackVisibleWindow(new BrowserWindow(appWindowOptions({
    width: 560,
    height: 470,
    title: 'Leader Email Settings',
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'leaderEmailPreload.js')
    }
  })));

  leaderEmailWindow.on('closed', () => {
    leaderEmailWindow = null;
  });

  leaderEmailWindow.loadFile(path.join(root, 'src', 'leaderEmail.html'));
}

function sameSiteForStorageState(value) {
  if (value === 'strict') return 'Strict';
  if (value === 'no_restriction') return 'None';
  return 'Lax';
}

async function saveElectronLoginSession(window) {
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

  await apiClient.postSession(storageState);
  cachedSessionPresent = true;
}

function isWalksManagerReviewPage(text, url) {
  return /walks-manager\.ramblers\.org\.uk\/walks-manager\//.test(url)
    && /Walks Manager|Submitted for checking|Awaiting publishing|Ready to publish/i.test(text || '');
}

function withTimeout(promise, timeoutMs, fallback) {
  let timeout;
  return Promise.race([
    promise,
    new Promise(resolve => {
      timeout = setTimeout(() => resolve(fallback), timeoutMs);
    })
  ]).finally(() => clearTimeout(timeout));
}

async function acceptCookieBanner(window) {
  return withTimeout(window.webContents.executeJavaScript(`
    (() => {
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && !el.disabled;
      };
      const controls = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a')).filter(visible);
      const accept = controls.find(el => /^(accept|accept all|allow all|agree|ok)$/i.test(String(el.innerText || el.value || el.ariaLabel || el.title || '').trim()))
        || controls.find(el => /accept.*cookie|allow.*cookie|agree.*cookie/i.test(String(el.innerText || el.value || el.ariaLabel || el.title || '')));
      if (!accept) return false;
      accept.click();
      return true;
    })()
  `, true).catch(() => false), 3000, false);
}

async function clickListWalksControl(window) {
  return withTimeout(window.webContents.executeJavaScript(`
    (() => {
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && !el.disabled;
      };
      const controls = Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"]')).filter(visible);
      const listWalks = controls.find(el => /\\blist walks\\b/i.test(String(el.innerText || el.value || el.ariaLabel || el.title || '').trim()))
        || controls.find(el => /\\/walks-manager\\/list/i.test(String(el.href || el.getAttribute('href') || '')));
      if (!listWalks) return false;
      listWalks.click();
      return true;
    })()
  `, true).catch(() => false), 3000, false);
}

function looksLikeLoggedInRamblersPage(text, url) {
  if (!/ramblers\.org\.uk/i.test(url)) return false;
  if (/password|sign in|log in|login|verification|multi-factor|one[- ]time|incorrect|invalid/i.test(text || '')) return false;
  return /my account|sign out|log out|logged in|profile|dashboard|member/i.test(text || '');
}

async function advanceLoginWindowToReviewList(window) {
  const url = window.webContents.getURL();
  const text = await withTimeout(
    window.webContents.executeJavaScript('document.body ? document.body.innerText : ""', true).catch(() => ''),
    5000,
    ''
  );
  await acceptCookieBanner(window);

  if (isWalksManagerReviewPage(text, url)) return { text, url };

  if (/walks-manager\.ramblers\.org\.uk/i.test(url)) {
    const clicked = await clickListWalksControl(window);
    if (clicked) return { text, url };
  }

  if (looksLikeLoggedInRamblersPage(text, url)) {
    const now = Date.now();
    if (now - lastLoginAutoAdvanceAt < 10000) return { text, url };
    lastLoginAutoAdvanceAt = now;
    const target = reviewUrlForGroup();
    if (url !== target) {
      window.loadURL(target).catch(() => {});
    }
  }

  return { text, url };
}

async function extractWalksManagerGroups(window) {
  const result = await withTimeout(window.webContents.executeJavaScript(`
    (() => {
      const select = document.querySelector('select[name="gid"], #edit-gid, [data-drupal-selector="edit-gid"]');
      if (select) {
        const groups = Array.from(select.options || [])
          .filter(option => option.value && /^\\d+$/.test(option.value))
          .map(option => ({ gid: Number(option.value), name: (option.textContent || '').trim() }))
          .filter(group => group.gid && group.name);
        return { groups, diagnostic: 'select found with ' + groups.length + ' option(s)' };
      }

      // Walks Manager omits the group selector entirely for accounts that
      // only belong to one group, since there is nothing to choose between.
      // Fall back to the gid embedded in the current review-list URL.
      const gid = Number(new URLSearchParams(window.location.search).get('gid'));
      if (!gid) {
        return { groups: [], diagnostic: 'no select and no gid in URL (' + window.location.href + ')' };
      }
      const heading = document.querySelector('h1, h2, .page-title, [data-drupal-selector="page-title"]');
      const name = (heading && heading.textContent || '').trim();
      return {
        groups: [{ gid, name: name || ('Group ' + gid) }],
        diagnostic: 'no select; used gid=' + gid + ' from URL, heading=' + JSON.stringify(name)
      };
    })()
  `, true).catch((error) => ({ groups: [], diagnostic: 'executeJavaScript failed: ' + (error && error.message) })), 5000, { groups: [], diagnostic: 'timed out' });

  const seen = new Set();
  const groups = (result.groups || []).filter(group => {
    if (seen.has(group.gid)) return false;
    seen.add(group.gid);
    return true;
  });
  return { groups, diagnostic: result.diagnostic };
}

// For single-group accounts, Walks Manager renders neither a group-picker
// <select> nor a gid in the review-list URL. The "My Groups" page lists the
// account's group(s) as links containing gid, so use it as a fallback.
async function extractGroupsFromMyGroupsPage(window) {
  try {
    await window.webContents.loadURL('https://walks-manager.ramblers.org.uk/walks-manager/my-groups');
  } catch (error) {
    return { groups: [], diagnostic: `failed to load my-groups page: ${error.message}` };
  }

  await withTimeout(new Promise((resolve) => {
    if (!window.webContents.isLoading()) {
      resolve();
      return;
    }
    window.webContents.once('did-finish-load', resolve);
  }), 8000, null);

  return withTimeout(window.webContents.executeJavaScript(`
    (() => {
      const links = Array.from(document.querySelectorAll('a[href*="gid="]'));
      const groups = links
        .map(a => {
          const match = (a.getAttribute('href') || '').match(/gid=(\\d+)/);
          if (!match) return null;
          return { gid: Number(match[1]), name: (a.textContent || '').trim() };
        })
        .filter(group => group && group.gid && group.name);
      return { groups, diagnostic: 'my-groups page: found ' + groups.length + ' link(s) with gid at ' + window.location.href };
    })()
  `, true).catch((error) => ({ groups: [], diagnostic: `my-groups executeJavaScript failed: ${error && error.message}` })), 5000, { groups: [], diagnostic: 'my-groups page timed out' });
}

function showConfiguringWindow() {
  const win = trackVisibleWindow(new BrowserWindow(appWindowOptions({
    width: 420,
    height: 180,
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    title: 'RA Walks Notifier',
    backgroundColor: '#f7f8fa'
  })));
  win.loadURL(`data:text/html,${encodeURIComponent(`
    <!doctype html>
    <html>
      <head>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background: #f7f8fa;
            color: #1f2933;
          }
          p {
            font-size: 14px;
            line-height: 1.5;
            text-align: center;
            padding: 0 24px;
          }
        </style>
      </head>
      <body>
        <p>Please wait&hellip;<br>Configuring Walks Manager settings.</p>
      </body>
    </html>
  `)}`);
  win.once('ready-to-show', () => win.show());
  return win;
}

async function saveSelectedGroups(groups) {
  const normalized = (groups || [])
    .map(group => ({ name: String(group.name || '').trim(), gid: Number(group.gid) }))
    .filter(group => group.name && Number.isFinite(group.gid));
  if (!normalized.length) return;
  cachedConfig = await apiClient.putConfig({ groups: normalized });
  cachedGroups = cachedConfig.groups || [];
  buildMenu();
}

function openWalksManagerLoginWindow() {
  if (loginWindow) {
    loginWindow.focus();
  } else {
    lastLoginAutoAdvanceAt = 0;
    loginWindow = trackVisibleWindow(new BrowserWindow(appWindowOptions({
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
    })));

    loginWindow.on('closed', () => {
      loginWindow = null;
    });

    loginWindow.loadURL(reviewUrlForGroup());
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    let configuringWindow = null;
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
        const { text, url } = await advanceLoginWindowToReviewList(loginWindow);
        if (!isWalksManagerReviewPage(text, url)) return;

        clearInterval(interval);
        configuringWindow = showConfiguringWindow();
        loginWindow.hide();

        let { groups, diagnostic } = await extractWalksManagerGroups(loginWindow);
        await saveElectronLoginSession(loginWindow);

        if (!groups.length) {
          const fallback = await extractGroupsFromMyGroupsPage(loginWindow);
          if (fallback.groups.length) {
            groups = fallback.groups;
            diagnostic = fallback.diagnostic;
          } else {
            diagnostic = `${diagnostic}; ${fallback.diagnostic}`;
          }
        }

        configuringWindow.close();
        configuringWindow = null;
        loginWindow.close();

        if (groups.length === 1) {
          await saveSelectedGroups(groups);
          resolve({ code: 0, message: `Walks Manager login saved. Group set to ${groups[0].name}.`, groups, sessionPresent: true });
          return;
        }

        if (groups.length > 1) {
          resolve({ code: 0, message: 'Walks Manager login saved. Select the group for this app.', groups, sessionPresent: true });
          return;
        }

        resolve({ code: 0, message: `Walks Manager login session saved. No group selector was found. (${diagnostic})`, groups: [], sessionPresent: true });
      } catch (error) {
        clearInterval(interval);
        if (configuringWindow && !configuringWindow.isDestroyed()) configuringWindow.close();
        if (loginWindow) loginWindow.show();
        resolve({ code: 1, message: error.message });
      }
    }, 1500);
  });
}

function buildMenu() {
  const s = cachedStatus || {};
  const lastCheck = formatUkDateTime(s.lastCheckCompletedAt);
  const configured = isConfigured();
  const statusLabel = configured ? lastStatus : 'Setup required';
  const canStartOnLogin = supportsLoginItemSettings();
  const bootEnabled = startAtBootEnabled();
  const betaUpdates = includeBetaUpdates();
  const menu = Menu.buildFromTemplate([
    {
      label: `Status: ${statusLabel}`,
      enabled: !configured,
      click: () => showConnectWindow()
    },
    { label: `Last check: ${lastCheck}`, enabled: false },
    { label: `Update: ${updateStatus}`, enabled: false },
    { type: 'separator' },
    { label: 'Show Status', enabled: configured, click: () => showStatus() },
    { label: 'Check Now', enabled: configured, click: () => checkNow(false) },
    { label: 'Send Walks Report Email', enabled: configured, click: () => checkNow(true) },
    { label: 'Open Review List', enabled: configured, click: () => shell.openExternal(reviewUrlForGroup()) },
    {
      label: 'Settings && Configuration',
      submenu: [
        { label: 'Server Connection && Login', click: () => showConnectWindow() },
        { label: 'Manage Recipients', enabled: configured, click: () => showRecipientsWindow() },
        { label: 'Leader Email Settings', enabled: configured, click: () => showLeaderEmailWindow() },
        { label: 'Check Schedule and Active Hours', enabled: configured, click: () => showScheduleWindow() },
        {
          label: 'Start App on Login',
          type: 'checkbox',
          enabled: canStartOnLogin,
          checked: bootEnabled,
          click: () => toggleStartAtBoot()
        },
        {
          label: 'Subscribe to Beta Updates',
          type: 'checkbox',
          checked: betaUpdates,
          click: () => toggleBetaUpdates()
        },
        { type: 'separator' },
        { label: 'Change Logo', enabled: configured, click: () => chooseBrandLogo() },
        { label: 'Reset Logo', enabled: configured, click: () => resetBrandLogo() }
      ]
    },
    { type: 'separator' },
    { label: 'Check for Updates', click: () => checkForUpdates(true) },
    { label: 'About', click: () => showAbout() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  if (app.dock) app.dock.setIcon(appIconPath());
  if (app.dock) app.dock.hide();
  configureUpdates();

  tray = new Tray(trayIcon());
  tray.setToolTip('RA Walks Notifier');
  buildMenu();
  // Wait for the first cache fill before deciding whether setup is
  // needed - otherwise isConfigured() runs against the empty initial
  // cache on every launch and shows the connect window unnecessarily.
  await startStatusPolling();
  if (!isConfigured()) {
    showConnectWindow();
  } else {
    startUpdateChecks();
  }
});

ipcMain.handle('connect:status', async () => {
  const apiKeySet = apiClient.hasApiKey();
  if (!apiKeySet) return { apiKeySet: false, groups: [], sessionPresent: false };
  try {
    const [config, sessionStatus] = await Promise.all([apiClient.getConfig(), apiClient.getSessionStatus()]);
    cachedConfig = config;
    cachedGroups = config.groups || [];
    cachedSessionPresent = sessionStatus.present;
  } catch (_) {
    // Key saved but server unreachable right now - report what we know locally.
  }
  return { apiKeySet, groups: cachedGroups, sessionPresent: cachedSessionPresent };
});

ipcMain.handle('connect:save-api-key', async (_event, apiKey) => {
  const trimmed = String(apiKey || '').trim();
  if (!trimmed) throw new Error('Enter an API key first.');
  await apiClient.testConnection(trimmed);
  apiClient.setApiKey(trimmed);
  await refreshCache();
  buildMenu();
  return { ok: true };
});

ipcMain.handle('connect:login', async () => {
  await dialog.showMessageBox({
    type: 'info',
    title: 'Walks Manager Login',
    message: 'A browser window will open. Sign in to Walks Manager and wait until the review list loads. The session will be uploaded to the server automatically.'
  });
  const result = await openWalksManagerLoginWindow();
  if (result.code === 0) {
    await refreshCache();
    buildMenu();
  }
  return {
    code: result.code,
    message: result.message,
    groups: result.groups || cachedGroups,
    sessionPresent: cachedSessionPresent
  };
});

ipcMain.handle('connect:save-groups', async (_event, groups) => {
  await saveSelectedGroups(groups);
  return { groups: cachedGroups };
});

ipcMain.handle('recipients:load', async () => {
  cachedConfig = await apiClient.getConfig();
  return cachedConfig.notificationRecipients || [];
});
ipcMain.handle('recipients:save', async (_event, text) => {
  const recipients = parseRecipients(text);
  cachedConfig = await apiClient.putConfig({ notificationRecipients: recipients });
  buildMenu();
  return cachedConfig.notificationRecipients || [];
});

ipcMain.handle('schedule:load', async () => {
  cachedConfig = await apiClient.getConfig();
  return { checkIntervalMinutes: cachedConfig.checkIntervalMinutes || 5, activeHours: cachedConfig.activeHours || { start: 7, end: 22 } };
});
ipcMain.handle('schedule:save', async (_event, settings) => {
  const { normalizeSchedule } = require('./schedule');
  const schedule = normalizeSchedule(settings || {});
  cachedConfig = await apiClient.putConfig({ checkIntervalMinutes: schedule.checkIntervalMinutes, activeHours: schedule.activeHours });
  buildMenu();
  return { checkIntervalMinutes: cachedConfig.checkIntervalMinutes, activeHours: cachedConfig.activeHours };
});

ipcMain.handle('leader-email:load', async () => {
  cachedConfig = await apiClient.getConfig();
  return cachedConfig.leaderEmails || {};
});
ipcMain.handle('leader-email:save', async (_event, settings) => {
  cachedConfig = await apiClient.putConfig({ leaderEmails: settings });
  buildMenu();
  return cachedConfig.leaderEmails || {};
});
ipcMain.handle('leader-email:test-api', (_event, settings) => apiClient.testLeaderApi({ ...settings, name: 'Richard Higham' }));

ipcMain.handle('logs:load', async () => {
  try {
    const result = await apiClient.getLogs();
    return (result.lines || []).slice().reverse();
  } catch (error) {
    return [`Could not load logs: ${error.message}`];
  }
});

ipcMain.handle('about:load', () => ({
  version: displayVersion(),
  channel: releaseChannelLabel()
}));
ipcMain.handle('about:open-website', () => shell.openExternal(websiteUrl));

ipcMain.handle('status:load', () => ({
  text: buildStatusText(),
  maintenanceMessage: cachedStatus?.maintenanceMessage || null
}));
ipcMain.handle('status:retry', async () => {
  try {
    await refreshCache();
    return {
      text: buildStatusText(),
      maintenanceMessage: cachedStatus?.maintenanceMessage || null
    };
  } catch (error) {
    return {
      text: `Check failed unexpectedly: ${error.message}`,
      maintenanceMessage: null
    };
  }
});
ipcMain.handle('status:open-log', () => showLogWindow());

app.on('before-quit', () => {
  if (statusPollTimer) clearInterval(statusPollTimer);
  stopUpdateChecks();
});
app.on('window-all-closed', (e) => {
  if (!quittingForUpdate) e.preventDefault();
});
