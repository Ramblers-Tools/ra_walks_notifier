const { app, Menu, shell, dialog, BrowserWindow, ipcMain } = require('electron');
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
  showDashboard();
});

migrateLegacyConfig();

const apiClient = require('./apiClient');

let statusPollTimer;
let dashboardWindow;
let loginWindow;
let updateStatus = 'Not checked';
let manualUpdateCheck = false;
let updateHandlersConfigured = false;
let quittingForUpdate = false;
let lastLoginAutoAdvanceAt = 0;

// In-memory cache of the last successful API responses, refreshed on a
// timer and re-read by the Dashboard's Status section on demand.
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
  // Never explicitly set - persist the computed default immediately so it
  // survives a later update from a beta build to a stable one (otherwise
  // this always re-derives from isBetaBuild(), which silently flips to
  // false the moment a beta user updates to stable, making their
  // subscription look like it was cleared when it was never actually saved).
  const defaultValue = isBetaBuild();
  apiClient.setIncludeBetaUpdates(defaultValue);
  return defaultValue;
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
    if (result.response !== 1) return includeBetaUpdates();
  }
  apiClient.setIncludeBetaUpdates(nextValue);
  return nextValue;
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

function showDashboard() {
  if (dashboardWindow) {
    dashboardWindow.focus();
    return;
  }

  dashboardWindow = new BrowserWindow(appWindowOptions({
    width: 1280,
    height: 900,
    title: 'RA Walks Notifier',
    backgroundColor: '#e9ebef',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'dashboardPreload.js')
    }
  }));

  dashboardWindow.once('ready-to-show', () => {
    dashboardWindow.maximize();
    dashboardWindow.show();
  });

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });

  dashboardWindow.loadFile(path.join(root, 'src', 'dashboard.html'));
}

function handleRevokedApiKey(message) {
  apiClient.clearApiKey();
  cachedConfig = null;
  cachedGroups = [];
  cachedSessionPresent = false;
  cachedStatus = null;
  dialog.showMessageBox({
    type: 'error',
    title: 'RA Walks Notifier',
    message: 'Reconnect required',
    detail: message
  });
  showDashboard();
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
}

async function startStatusPolling() {
  if (statusPollTimer) clearInterval(statusPollTimer);
  await refreshCache();
  statusPollTimer = setInterval(refreshCache, statusPollIntervalMs);
}

async function checkNow(force = false) {
  if (!isConfigured()) {
    return { ok: false, error: 'Setup required before running a check.' };
  }

  try {
    await apiClient.postCheckNow(force);
  } catch (error) {
    if (error.code === 'unauthorized') {
      handleRevokedApiKey(error.message);
      return { ok: false, error: error.message };
    }
    return { ok: false, error: error.message };
  }
  // The check runs asynchronously on the server; poll shortly after to
  // pick up progress, then again once it should have finished.
  setTimeout(refreshCache, 5000);
  setTimeout(refreshCache, 90000);
  return { ok: true };
}

async function chooseBrandLogo() {
  const result = await dialog.showOpenDialog({
    title: 'Choose Ramblers Logo',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
  });
  if (result.canceled || !result.filePaths.length) return { ok: false };

  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).slice(1);
  try {
    const data = fs.readFileSync(filePath).toString('base64');
    await apiClient.putLogo(data, ext);
    return { ok: true, message: 'Logo updated.' };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function resetBrandLogo() {
  try {
    await apiClient.deleteLogo();
    return { ok: true, message: 'Logo reset to the built-in Ramblers logo.' };
  } catch (error) {
    return { ok: false, error: error.message };
  }
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
    return enabled;
  }

  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    path: process.execPath
  });
  return enabled;
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
  // isSilent=true: on Windows this suppresses the NSIS installer wizard so
  // the update just replaces files and relaunches, matching the mac/Linux
  // experience where there's no equivalent visible install step to skip.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
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
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('before-quit-for-update', () => {
    prepareForUpdateInstall();
  });

  autoUpdater.on('checking-for-update', () => {
    updateStatus = 'Checking...';
  });

  autoUpdater.on('update-not-available', () => {
    updateStatus = 'No update available';
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
    updateStatus = `Downloading version ${info.version}...`;
    // Runs synchronously before autoUpdater's own auto-download kicks in
    // (it starts downloading right after this event finishes emitting).
    cleanupDownloadedUpdateCache();
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateStatus = `Version ${info.version} ready`;
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
        if (groups.length) {
          return { groups, diagnostic: 'select found with ' + groups.length + ' option(s)' };
        }
        // A select element exists but has no usable options - treat this
        // the same as no select at all and fall through to the URL/my-groups
        // fallbacks, rather than reporting zero groups.
      }

      // Walks Manager omits the group selector entirely for accounts that
      // only belong to one group, since there is nothing to choose between.
      // Fall back to the gid embedded in the current review-list URL.
      const gid = Number(new URLSearchParams(window.location.search).get('gid'));
      if (!gid) {
        return { groups: [], diagnostic: (select ? 'select found with 0 usable options' : 'no select') + ' and no gid in URL (' + window.location.href + ')' };
      }
      // Skip visually-hidden accessibility headings (e.g. Drupal's hidden
      // "Breadcrumb" <h2> that precedes the breadcrumb nav) and anything
      // inside a breadcrumb region - we want the actual page title.
      const isHiddenOrBreadcrumb = (el) => {
        if (el.closest('nav[aria-label], .breadcrumb, .breadcrumbs, ol.breadcrumb')) return true;
        const classes = (el.className && el.className.toString) ? el.className.toString() : '';
        if (/visually-hidden|visuallyhidden|sr-only|screen-reader-text/i.test(classes)) return true;
        return /^breadcrumb$/i.test((el.textContent || '').trim());
      };
      const headingCandidates = Array.from(document.querySelectorAll('h1, h2, .page-title, [data-drupal-selector="page-title"]'));
      const heading = headingCandidates.find(el => !isHiddenOrBreadcrumb(el));
      const name = (heading && heading.textContent || '').trim();
      // Don't synthesize a "Group <gid>" placeholder here - if no usable
      // heading was found, report zero groups so the caller falls through
      // to the my-groups page fallback, which scrapes the real group name
      // from a table rather than guessing from the page's heading markup.
      if (!name) {
        return { groups: [], diagnostic: 'no select; used gid=' + gid + ' from URL, but no usable heading found' };
      }
      return {
        groups: [{ gid, name }],
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
      const extractGid = (href) => {
        const queryMatch = href.match(/[?&]gid=(\\d+)/);
        if (queryMatch) return Number(queryMatch[1]);
        // Action links (e.g. "View walk leaders") carry the gid as a bare
        // path segment instead, with no "gid=" text anywhere on the page:
        // /walks-manager/my-groups/229/contact-preferences-walk-leaders
        const pathMatch = href.match(/\\/my-groups\\/(\\d+)(?:[/?]|$)/);
        return pathMatch ? Number(pathMatch[1]) : null;
      };

      // Groups are listed as table rows: the group name is the row's first
      // cell, and the gid comes from any action link within that same row.
      const rows = Array.from(document.querySelectorAll('table tr'));
      const fromRows = [];
      for (const row of rows) {
        const hrefs = Array.from(row.querySelectorAll('a[href]')).map(a => a.getAttribute('href') || '');
        const gid = hrefs.map(extractGid).find(value => value);
        if (!gid) continue;
        const nameCell = row.querySelector('td');
        const name = (nameCell && nameCell.textContent || '').trim();
        if (name) fromRows.push({ gid, name });
      }
      if (fromRows.length) {
        return { groups: fromRows, diagnostic: 'my-groups page: found ' + fromRows.length + ' table row(s) with a group link at ' + window.location.href };
      }

      // Fall back to any bare link with a recognizable gid, in case an
      // account's page isn't rendered as a table.
      const links = Array.from(document.querySelectorAll('a[href]'));
      const groups = links
        .map(a => {
          const gid = extractGid(a.getAttribute('href') || '');
          if (!gid) return null;
          return { gid, name: (a.textContent || '').trim() };
        })
        .filter(group => group && group.gid && group.name);
      return { groups, diagnostic: 'my-groups page: found ' + groups.length + ' link(s) with a group gid at ' + window.location.href };
    })()
  `, true).catch((error) => ({ groups: [], diagnostic: `my-groups executeJavaScript failed: ${error && error.message}` })), 5000, { groups: [], diagnostic: 'my-groups page timed out' });
}

function showConfiguringWindow() {
  const win = new BrowserWindow(appWindowOptions({
    width: 420,
    height: 180,
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    title: 'RA Walks Notifier',
    backgroundColor: '#f7f8fa'
  }));
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
}

// Re-runs group detection against the already-saved Walks Manager session
// (same persisted cookie partition used at login) instead of requiring the
// user to sign in again just to retry a failed group lookup.
async function redetectGroupsFromExistingSession() {
  const window = new BrowserWindow(appWindowOptions({
    width: 1180,
    height: 820,
    show: false,
    webPreferences: {
      partition: walksPartition,
      nodeIntegration: false,
      contextIsolation: true
    }
  }));

  try {
    await window.loadURL(reviewUrlForGroup());
    await withTimeout(new Promise((resolve) => {
      if (!window.webContents.isLoading()) {
        resolve();
        return;
      }
      window.webContents.once('did-finish-load', resolve);
    }), 8000, null);

    const text = await withTimeout(
      window.webContents.executeJavaScript('document.body ? document.body.innerText : ""', true).catch(() => ''),
      5000,
      ''
    );
    const url = window.webContents.getURL();

    if (!isWalksManagerReviewPage(text, url)) {
      return { groups: [], diagnostic: `session is no longer valid or the review page wasn't reached (${url})`, sessionExpired: true };
    }

    let { groups, diagnostic } = await extractWalksManagerGroups(window);
    if (!groups.length) {
      const fallback = await extractGroupsFromMyGroupsPage(window);
      if (fallback.groups.length) {
        groups = fallback.groups;
        diagnostic = fallback.diagnostic;
      } else {
        diagnostic = `${diagnostic}; ${fallback.diagnostic}`;
      }
    }
    return { groups, diagnostic };
  } finally {
    if (!window.isDestroyed()) window.close();
  }
}

// Ramblers Walks Manager delegates sign-in to an Auth0-hosted login page
// (a third party we don't control), so its form fields aren't fixed HTML we
// can rely on long-term, and it may use an "identifier first" flow (email on
// one screen, password on a second screen that Auth0 renders client-side
// without a full page navigation). So this polls the DOM directly on an
// interval rather than only reacting to Electron navigation events, and
// handles both a combined username+password form and a two-step one.
async function inspectLoginForm(window) {
  return withTimeout(window.webContents.executeJavaScript(`
    (() => {
      const usernameInput = document.querySelector('input[name="username"], input[name="email"], input[type="email"]');
      const passwordInput = document.querySelector('input[type="password"]');
      return { hasUsername: !!usernameInput, hasPassword: !!passwordInput };
    })()
  `, true).catch(() => null), 3000, null);
}

function fillAndSubmit(window, fields) {
  return withTimeout(window.webContents.executeJavaScript(`
    (() => {
      const fields = ${JSON.stringify(fields)};
      let anchor = null;
      for (const { selector, value } of fields) {
        const input = document.querySelector(selector);
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        anchor = input;
      }
      const form = anchor && anchor.closest('form');
      const submitButton = (form || document).querySelector('button[type="submit"], input[type="submit"]');
      if (submitButton) {
        submitButton.click();
      } else if (form) {
        form.submit();
      } else {
        return false;
      }
      return true;
    })()
  `, true).catch(() => false), 4000, false);
}

// Auth0's default error copy for a bad login on Ramblers' tenant. Kept
// narrow on purpose: only phrases we're confident mean "wrong credentials"
// should skip the browser handoff, since anything else masked as this could
// leave the user stuck retyping a password that was never the problem.
const CREDENTIAL_ERROR_PATTERN = /wrong (?:email|username) or password|incorrect (?:email|username) or password|invalid (?:email|username) or password/i;

async function detectCredentialError(window) {
  const text = await withTimeout(
    window.webContents.executeJavaScript('document.body ? document.body.innerText : ""', true).catch(() => ''),
    3000,
    ''
  );
  return CREDENTIAL_ERROR_PATTERN.test(text || '');
}

// onNeedsHuman is called at most once, with 'credentials' when Auth0 reports
// a plain wrong-username-or-password error (safe to let the user just retry
// in our own form, no browser needed) or 'unknown' for anything else we
// can't interpret (MFA, CAPTCHA, an Auth0 UI change) - those need a human in
// the actual browser window.
function watchForAutofillOpportunity(window, credentials, onNeedsHuman) {
  let settled = false;
  let identifierSubmitted = false;
  let passwordSubmitted = false;
  let lastFormSeenAt = Date.now();
  const startedAt = Date.now();

  const stop = () => {
    settled = true;
    clearInterval(poll);
  };

  const needsHuman = (reason) => {
    if (settled) return;
    stop();
    onNeedsHuman(reason);
  };

  const poll = setInterval(async () => {
    if (settled || window.isDestroyed()) {
      stop();
      return;
    }

    if (Date.now() - startedAt > 30000) {
      // Absolute ceiling in case an identifier screen keeps re-rendering
      // without ever reaching a password field - don't leave the window
      // hidden indefinitely.
      needsHuman('unknown');
      return;
    }

    const form = await inspectLoginForm(window);
    if (!form || (!form.hasUsername && !form.hasPassword)) {
      // No recognizable login form right now - either mid-navigation
      // (fine, keep waiting) or past the login page entirely (the main
      // login poller will pick up success from here).
      if (Date.now() - lastFormSeenAt > 20000) {
        // Still stuck after 20s with no form: if we're not back on Walks
        // Manager, something unrecognized is blocking progress (CAPTCHA,
        // an unfamiliar Auth0 screen) - a human needs to see it.
        const url = window.webContents.getURL();
        if (!/walks-manager\.ramblers\.org\.uk/i.test(url)) {
          needsHuman('unknown');
        } else {
          stop();
        }
      }
      return;
    }
    lastFormSeenAt = Date.now();

    const usernameSelector = 'input[name="username"], input[name="email"], input[type="email"]';
    const passwordSelector = 'input[type="password"]';

    if (form.hasUsername && form.hasPassword) {
      // Combined single-screen form - fill both before submitting once.
      if (passwordSubmitted) {
        // We already submitted and Auth0 is showing both fields again -
        // wrong credentials, MFA, or something we can't handle.
        needsHuman((await detectCredentialError(window)) ? 'credentials' : 'unknown');
        return;
      }
      passwordSubmitted = true;
      await fillAndSubmit(window, [
        { selector: usernameSelector, value: credentials.username },
        { selector: passwordSelector, value: credentials.password }
      ]);
      return;
    }

    if (form.hasPassword) {
      // Two-step flow, second screen (password only).
      if (passwordSubmitted) {
        needsHuman((await detectCredentialError(window)) ? 'credentials' : 'unknown');
        return;
      }
      passwordSubmitted = true;
      await fillAndSubmit(window, [{ selector: passwordSelector, value: credentials.password }]);
      return;
    }

    if (form.hasUsername) {
      // Two-step flow, first screen (identifier only).
      if (identifierSubmitted) return; // waiting for the password screen to render
      identifierSubmitted = true;
      await fillAndSubmit(window, [{ selector: usernameSelector, value: credentials.username }]);
    }
  }, 700);

  return { stop };
}

function openWalksManagerLoginWindow(credentials) {
  const attemptingAutofill = !!(credentials && credentials.username && credentials.password);
  let autofillWatcher = null;

  if (loginWindow) {
    loginWindow.focus();
  } else {
    lastLoginAutoAdvanceAt = 0;
    loginWindow = new BrowserWindow(appWindowOptions({
      width: 1180,
      height: 820,
      title: 'Walks Manager Login',
      resizable: true,
      minimizable: true,
      fullscreenable: true,
      show: !attemptingAutofill,
      webPreferences: {
        partition: walksPartition,
        nodeIntegration: false,
        contextIsolation: true
      }
    }));

    loginWindow.on('closed', () => {
      loginWindow = null;
    });

    loginWindow.loadURL(reviewUrlForGroup());
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (autofillWatcher) autofillWatcher.stop();
      resolve(result);
    };

    if (attemptingAutofill && !autofillWatcher && loginWindow) {
      autofillWatcher = watchForAutofillOpportunity(loginWindow, credentials, (reason) => {
        if (reason === 'credentials') {
          // A plain wrong-username-or-password error - no need to drag the
          // user into a browser for this, they can just retry in the app.
          if (loginWindow) loginWindow.close();
          finish({ code: 2, message: 'Incorrect Walks Manager username or password. Please try again.' });
          return;
        }
        // Anything we can't interpret (MFA, CAPTCHA, an Auth0 UI change)
        // needs a human in the actual browser window.
        if (loginWindow && !loginWindow.isDestroyed() && !loginWindow.isVisible()) {
          loginWindow.show();
        }
        dialog.showMessageBox({
          type: 'info',
          title: 'Walks Manager Login',
          message: "We couldn't sign you in automatically. Please finish signing in using the window that just opened - once you're logged in, the rest happens automatically."
        });
      });
    }

    const startedAt = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    let configuringWindow = null;
    const interval = setInterval(async () => {
      if (settled) {
        clearInterval(interval);
        return;
      }

      if (!loginWindow) {
        clearInterval(interval);
        finish({ code: 1, message: 'Login window was closed before the session was saved.' });
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(interval);
        finish({ code: 1, message: 'Timed out waiting for Walks Manager login.' });
        return;
      }

      try {
        const { text, url } = await advanceLoginWindowToReviewList(loginWindow);
        if (!isWalksManagerReviewPage(text, url)) return;

        clearInterval(interval);
        if (autofillWatcher) autofillWatcher.stop();
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
          finish({ code: 0, message: `Walks Manager login saved. Group set to ${groups[0].name}. (${diagnostic})`, groups, sessionPresent: true });
          return;
        }

        if (groups.length > 1) {
          finish({ code: 0, message: 'Walks Manager login saved. Select the group for this app.', groups, sessionPresent: true });
          return;
        }

        finish({ code: 0, message: `Walks Manager login session saved. No group selector was found. (${diagnostic})`, groups: [], sessionPresent: true });
      } catch (error) {
        clearInterval(interval);
        if (configuringWindow && !configuringWindow.isDestroyed()) configuringWindow.close();
        if (loginWindow) loginWindow.show();
        finish({ code: 1, message: error.message });
      }
    }, 1500);
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  configureUpdates();
  // Wait for the first cache fill before opening the Dashboard, so its
  // Status section doesn't start out reading the empty initial cache.
  await startStatusPolling();
  showDashboard();
  if (isConfigured()) startUpdateChecks();
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
  return { ok: true };
});

ipcMain.handle('connect:login', async (_event, credentials) => {
  const result = await openWalksManagerLoginWindow(credentials);
  if (result.code === 0) {
    await refreshCache();
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

ipcMain.handle('connect:redetect-groups', async () => {
  const result = await redetectGroupsFromExistingSession();
  if (result.sessionExpired) {
    cachedSessionPresent = false;
    return {
      code: 1,
      message: "Your Walks Manager session has expired - please log in again.",
      groups: cachedGroups,
      sessionPresent: cachedSessionPresent
    };
  }
  if (result.groups.length === 1) {
    await saveSelectedGroups(result.groups);
    return {
      code: 0,
      message: `Group set to ${result.groups[0].name}. (${result.diagnostic})`,
      groups: result.groups,
      sessionPresent: cachedSessionPresent
    };
  }
  if (result.groups.length > 1) {
    return {
      code: 0,
      message: 'Select the group for this app.',
      groups: result.groups,
      sessionPresent: cachedSessionPresent
    };
  }
  return {
    code: 1,
    message: `Still couldn't detect a group. (${result.diagnostic})`,
    groups: cachedGroups,
    sessionPresent: cachedSessionPresent
  };
});

// New: opt-in Walks Manager username/password storage so the server can
// auto-relogin on session expiry instead of only emailing the user. The
// client verifies the credentials itself first (reusing the same headless
// autofill machinery as connect:login) before handing them to the server,
// so a typo never gets encrypted and stored. Wrong credentials get up to 3
// silent attempts, then automatically fall back to the existing interactive
// login + session-upload flow, which remains the standing fallback.
ipcMain.handle('credentials:status', async () => {
  cachedConfig = await apiClient.getConfig();
  const creds = cachedConfig.walksManagerCredentials || {};
  return { username: creds.username || '', credentialsSet: Boolean(creds.credentialsSet) };
});

ipcMain.handle('credentials:save', async (_event, credentials) => {
  const username = String(credentials?.username || '').trim();
  const password = String(credentials?.password || '');
  if (!username || !password) throw new Error('Enter your Ramblers email address and password.');

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await openWalksManagerLoginWindow({ username, password });

    if (result.code === 0) {
      await apiClient.putConfig({ walksManagerCredentials: { username, password } });
      await refreshCache();
      return { status: 'saved', message: `Credentials verified and saved for auto-relogin. ${result.message}` };
    }

    if (result.code === 2) {
      if (attempt < maxAttempts) continue;
      const fallback = await openWalksManagerLoginWindow();
      if (fallback.code === 0) await refreshCache();
      return {
        status: 'fallback-session',
        message: `Couldn't verify those credentials after ${maxAttempts} attempts, so credentials weren't saved. ${fallback.message}`
      };
    }

    // code 1: something we can't interpret (MFA/timeout/window closed) -
    // surface it immediately rather than silently retrying with the same
    // credentials.
    return { status: 'error', message: result.message };
  }
});

ipcMain.handle('recipients:load', async () => {
  cachedConfig = await apiClient.getConfig();
  return cachedConfig.notificationRecipients || [];
});
ipcMain.handle('recipients:save', async (_event, text) => {
  const recipients = parseRecipients(text);
  cachedConfig = await apiClient.putConfig({ notificationRecipients: recipients });
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
  return { checkIntervalMinutes: cachedConfig.checkIntervalMinutes, activeHours: cachedConfig.activeHours };
});

ipcMain.handle('leader-email:load', async () => {
  cachedConfig = await apiClient.getConfig();
  return cachedConfig.leaderEmails || {};
});
ipcMain.handle('leader-email:save', async (_event, settings) => {
  cachedConfig = await apiClient.putConfig({ leaderEmails: settings });
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

ipcMain.handle('app:check-now', (_event, force) => checkNow(Boolean(force)));
ipcMain.handle('app:open-review-list', () => shell.openExternal(reviewUrlForGroup()));

ipcMain.handle('app:settings-load', () => ({
  canStartOnLogin: supportsLoginItemSettings(),
  startAtBootEnabled: startAtBootEnabled(),
  includeBetaUpdates: includeBetaUpdates(),
  updateStatus
}));
ipcMain.handle('app:toggle-start-at-boot', () => ({ startAtBootEnabled: toggleStartAtBoot() }));
ipcMain.handle('app:toggle-beta-updates', async () => ({ includeBetaUpdates: await toggleBetaUpdates() }));
ipcMain.handle('app:check-for-updates', () => checkForUpdates(true));
ipcMain.handle('app:choose-logo', () => chooseBrandLogo());
ipcMain.handle('app:reset-logo', () => resetBrandLogo());

app.on('before-quit', () => {
  if (statusPollTimer) clearInterval(statusPollTimer);
  stopUpdateChecks();
});
app.on('window-all-closed', () => {
  if (!quittingForUpdate) app.quit();
});
