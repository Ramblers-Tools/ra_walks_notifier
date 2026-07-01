const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { resolveGroups } = require('./config');
const { sendEmail } = require('./email');
const { log, ensureDirs } = require('./logger');
const { parseWalks } = require('./parser');
const { nowUkDateTime } = require('./time');
const { buildEmail } = require('./emailSummary');
const { isLoginPage, sendSessionExpiredEmail } = require('./sessionExpiry');
const { extractLeaderDetailsFromPlaywright, extractManagerEditHrefFromPlaywright } = require('./leaderDetails');
const { sendLeaderEmails } = require('./leaderEmail');

function readJson(file, fallback) { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; } catch { return fallback; } }
function writeJson(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function sameWalk(a, b) { return JSON.stringify({ title: a.title, date: a.date, leader: a.leader, status: a.status, href: a.href }) === JSON.stringify({ title: b.title, date: b.date, leader: b.leader, status: b.status, href: b.href }); }
function asMap(walks) { return Object.fromEntries(walks.map(w => [w.id, w])); }

async function enrichWalkLeaderDetails(page, walks, paths) {
  for (const walk of walks) {
    const detailHref = walk.managerHref || walk.href;
    if (!detailHref || walk.leaderFullName) continue;
    try {
      await page.goto(detailHref, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(1500);
      let details = await extractLeaderDetailsFromPlaywright(page);
      if (!details.leaderFullName) {
        const managerHref = await extractManagerEditHrefFromPlaywright(page);
        if (managerHref && managerHref !== page.url()) {
          walk.managerHref = managerHref;
          log(`Following manager detail link for ${walk.title}: ${managerHref}`, paths);
          await page.goto(managerHref, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await page.waitForTimeout(1500);
          details = await extractLeaderDetailsFromPlaywright(page);
        }
      }
      if (details.leaderFullName) walk.leaderFullName = details.leaderFullName;
      if (details.leaderVolunteerId) walk.leaderVolunteerId = details.leaderVolunteerId;
      if (details.contactPreferences) walk.leaderContactPreferences = details.contactPreferences;
      log(details.leaderFullName
        ? `Leader details found for ${walk.title}: ${details.leaderFullName}.`
        : `Leader details not found for ${walk.title} at ${page.url()}.`, paths);
    } catch (error) {
      log(`Could not read leader details for ${walk.title}: ${error.message}`, paths);
    }
  }
}

function notifyMac(title, message, config) {
  if (!config.macNotifications) return;
  const { execFile } = require('child_process');
  execFile('osascript', ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`], () => {});
}

// Runs one check cycle for a tenant: loads the saved Walks Manager session,
// visits each configured group's review list, diffs against the previous
// state, and sends admin/leader emails as needed. Shared by the CLI
// (npm run check, single implicit tenant via the default paths/config) and
// the server's per-tenant scheduler loop — callers just pass different
// `paths`/`config`.
async function runCheckForTenant({ paths, config, forceEmail = false }) {
  ensureDirs(paths);
  const groups = resolveGroups(config, []);
  const startedAt = nowUkDateTime();
  log('Starting Walks Manager check.', paths);
  let status = readJson(paths.statusFile, {});
  status.lastCheckStartedAt = startedAt;
  status.lastError = null;
  writeJson(paths.statusFile, status);

  if (!fs.existsSync(paths.sessionFile)) {
    const message = 'No saved Walks Manager login session. Open Setup and use Login to Walks Manager.';
    log(message, paths);
    status.lastError = message;
    status.lastCheckCompletedAt = nowUkDateTime();
    status.lastResult = 'Setup required: Walks Manager login session missing';
    writeJson(paths.statusFile, status);
    return status;
  }
  if (!groups.length) {
    const message = 'No Walks Manager group is configured. Open Setup and select a group.';
    log(message, paths);
    status.lastError = message;
    status.lastCheckCompletedAt = nowUkDateTime();
    status.lastResult = 'Setup required: Walks Manager group missing';
    writeJson(paths.statusFile, status);
    return status;
  }

  const prev = readJson(paths.stateFile, { walks: [] });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: paths.sessionFile });
  const page = await context.newPage();
  const currentWalks = [];
  try {
    for (const group of groups) {
      const url = `https://walks-manager.ramblers.org.uk/walks-manager/list?gid=${group.gid}&review=1`;
      log(`Checking ${group.name}: ${url}`, paths);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(5000);
      const pageText = await page.locator('body').innerText().catch(() => '');
      if (isLoginPage(page.url(), pageText)) {
        const message = 'Walks Manager login required. The saved Ramblers single sign-on session may have expired.';
        log(message, paths);
        status.lastError = message;
        status.lastCheckCompletedAt = nowUkDateTime();
        status.lastResult = 'Login required';
        if (!status.sessionExpiredEmailSent) {
          await sendSessionExpiredEmail(paths);
          status.sessionExpiredEmailSent = true;
          status.lastEmailAt = nowUkDateTime();
          log('Session expiry email sent.', paths);
        }
        writeJson(paths.statusFile, status);
        await browser.close();
        return status;
      }
      let walks = await parseWalks(page, group.name);
      if (!walks.length) {
        // A transient slow/incomplete page render can look identical to a
        // genuinely empty review list, and would otherwise be read as every
        // walk being cleared (and re-reported as new next cycle once the
        // page recovers). Reload and re-scrape once before trusting a zero
        // result.
        log(`No walks found for ${group.name} on first attempt - reloading to confirm before treating as cleared.`, paths);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(8000);
        walks = await parseWalks(page, group.name);
        if (!walks.length) log(`Still no walks found for ${group.name} after reloading - treating as genuinely empty.`, paths);
        else log(`Found ${walks.length} walk(s) for ${group.name} after reloading - first attempt was a false empty read.`, paths);
      }
      await enrichWalkLeaderDetails(page, walks, paths);
      log(`Found ${walks.length} pending walk(s) for ${group.name}.`, paths);
      currentWalks.push(...walks);
    }
    await browser.close();
    const prevMap = asMap(prev.walks || []);
    const currentMap = asMap(currentWalks);
    const newWalks = currentWalks.filter(w => !prevMap[w.id]);
    const changedWalks = currentWalks.filter(w => prevMap[w.id] && !sameWalk(w, prevMap[w.id]));
    const clearedWalks = (prev.walks || []).filter(w => !currentMap[w.id]);
    log(`Summary: ${currentWalks.length} current, ${newWalks.length} new, ${changedWalks.length} changed, ${clearedWalks.length} cleared.`, paths);
    if (newWalks.length) log(`New walks: ${newWalks.map(w => w.title).join('; ')}`, paths);
    if (changedWalks.length) log(`Changed walks: ${changedWalks.map(w => w.title).join('; ')}`, paths);
    if (clearedWalks.length) log(`Cleared walks: ${clearedWalks.map(w => w.title).join('; ')}`, paths);
    const shouldEmail = forceEmail || (config.notifyOnNew !== false && newWalks.length) || (config.notifyOnChanged !== false && changedWalks.length);
    if (shouldEmail) {
      const total = newWalks.length + changedWalks.length;
      const subject = total === 1 ? 'Walks Manager Watch: 1 change' : `Walks Manager Watch: ${total} changes`;
      const { text, html } = buildEmail(newWalks, changedWalks, clearedWalks, currentWalks);
      await sendEmail(subject, text, html, { paths });
      notifyMac('Walks Manager Watch', `${total} change(s) detected.`, config);
      log('Email sent.', paths);
      status.lastEmailAt = nowUkDateTime();
    } else {
      log('No notification needed.', paths);
    }
    const leaderEmailResult = await sendLeaderEmails({
      newWalks,
      clearedWalks,
      state: prev,
      config,
      paths
    });
    if (leaderEmailResult.sent || leaderEmailResult.skipped) {
      log(`Leader emails: ${leaderEmailResult.sent} sent, ${leaderEmailResult.skipped} skipped.`, paths);
      if (leaderEmailResult.sent) status.lastEmailAt = nowUkDateTime();
    }
    writeJson(paths.stateFile, { updatedAt: nowUkDateTime(), walks: currentWalks, leaderEmails: prev.leaderEmails || { submitted: {}, published: {} } });
    status.lastCheckCompletedAt = nowUkDateTime();
    status.pendingWalks = currentWalks.length;
    status.lastResult = `${currentWalks.length} pending; ${newWalks.length} new; ${changedWalks.length} changed; ${clearedWalks.length} cleared`;
    status.sessionExpiredEmailSent = false;
    writeJson(paths.statusFile, status);
    return status;
  } catch (err) {
    await browser.close().catch(() => {});
    log(`ERROR: ${err.stack || err.message}`, paths);
    status.lastError = err.message;
    status.lastCheckCompletedAt = nowUkDateTime();
    writeJson(paths.statusFile, status);
    try { await sendEmail('Walks Manager Watch failed', err.stack || err.message, undefined, { paths }); } catch (e) { log(`Could not send failure email: ${e.message}`, paths); }
    throw err;
  }
}

module.exports = { runCheckForTenant };
