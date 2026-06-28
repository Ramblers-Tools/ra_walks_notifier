const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { paths, groups, app } = require('./config');
const { sendEmail } = require('./email');
const { log, ensureDirs } = require('./logger');
const { parseWalks } = require('./parser');

const forceEmail = process.argv.includes('--force-email');

function readJson(file, fallback) { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; } catch { return fallback; } }
function writeJson(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function sameWalk(a, b) { return JSON.stringify({ title:a.title,date:a.date,leader:a.leader,status:a.status,href:a.href }) === JSON.stringify({ title:b.title,date:b.date,leader:b.leader,status:b.status,href:b.href }); }
function asMap(walks) { return Object.fromEntries(walks.map(w => [w.id, w])); }
function htmlEscape(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function buildEmail(newWalks, changedWalks, clearedWalks, currentWalks) {
  const lines = [];
  lines.push(`Walks Manager Watch found ${currentWalks.length} current pending walk(s).`);
  if (newWalks.length) lines.push(`\nNew walks: ${newWalks.length}`);
  for (const w of newWalks) lines.push(`- ${w.title}\n  ${w.date}\n  Leader: ${w.leader}\n  Status: ${w.status}\n  ${w.href || ''}`);
  if (changedWalks.length) lines.push(`\nChanged walks: ${changedWalks.length}`);
  for (const w of changedWalks) lines.push(`- ${w.title}\n  ${w.date}\n  Leader: ${w.leader}\n  Status: ${w.status}\n  ${w.href || ''}`);
  if (clearedWalks.length) lines.push(`\nCleared walks: ${clearedWalks.length}`);
  for (const w of clearedWalks) lines.push(`- ${w.title}`);
  lines.push('\nReview list: https://walks-manager.ramblers.org.uk/walks-manager/list?gid=414&review=1');
  const text = lines.join('\n');
  const rows = [...newWalks.map(w=>['New',w]), ...changedWalks.map(w=>['Changed',w]), ...clearedWalks.map(w=>['Cleared',w])]
    .map(([kind,w]) => `<tr><td>${htmlEscape(kind)}</td><td><strong>${htmlEscape(w.title)}</strong><br>${htmlEscape(w.date)}<br>Leader: ${htmlEscape(w.leader)}<br>Status: ${htmlEscape(w.status)}${w.href ? `<br><a href="${htmlEscape(w.href)}">Open walk</a>` : ''}</td></tr>`).join('');
  const html = `<p>Walks Manager Watch found <strong>${currentWalks.length}</strong> current pending walk(s).</p><table border="1" cellpadding="8" cellspacing="0">${rows}</table><p><a href="https://walks-manager.ramblers.org.uk/walks-manager/list?gid=414&review=1">Open review list</a></p>`;
  return { text, html };
}
async function notifyMac(title, message) {
  if (!app.macNotifications) return;
  const { execFile } = require('child_process');
  execFile('osascript', ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`], () => {});
}
(async () => {
  ensureDirs();
  const startedAt = new Date().toISOString();
  log('Starting Walks Manager check.');
  let status = readJson(paths.statusFile, {});
  status.lastCheckStartedAt = startedAt;
  status.lastError = null;
  writeJson(paths.statusFile, status);
  if (!fs.existsSync(paths.sessionFile)) throw new Error('No saved login session. Run login.command first.');
  const prev = readJson(paths.stateFile, { walks: [] });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: paths.sessionFile });
  const page = await context.newPage();
  const currentWalks = [];
  try {
    for (const group of groups) {
      const url = `https://walks-manager.ramblers.org.uk/walks-manager/list?gid=${group.gid}&review=1`;
      log(`Checking ${group.name}: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(5000);
      const walks = await parseWalks(page, group.name);
      log(`Found ${walks.length} pending walk(s) for ${group.name}.`);
      currentWalks.push(...walks);
    }
    await browser.close();
    const prevMap = asMap(prev.walks || []);
    const currentMap = asMap(currentWalks);
    const newWalks = currentWalks.filter(w => !prevMap[w.id]);
    const changedWalks = currentWalks.filter(w => prevMap[w.id] && !sameWalk(w, prevMap[w.id]));
    const clearedWalks = (prev.walks || []).filter(w => !currentMap[w.id]);
    log(`Summary: ${currentWalks.length} current, ${newWalks.length} new, ${changedWalks.length} changed, ${clearedWalks.length} cleared.`);
    const shouldEmail = forceEmail || (app.notifyOnNew !== false && newWalks.length) || (app.notifyOnChanged !== false && changedWalks.length) || (app.notifyOnCleared !== false && clearedWalks.length);
    if (shouldEmail) {
      const total = newWalks.length + changedWalks.length + clearedWalks.length;
      const subject = total === 1 ? 'Walks Manager Watch: 1 change' : `Walks Manager Watch: ${total} changes`;
      const { text, html } = buildEmail(newWalks, changedWalks, clearedWalks, currentWalks);
      await sendEmail(subject, text, html);
      await notifyMac('Walks Manager Watch', `${total} change(s) detected.`);
      log('Email sent.');
      status.lastEmailAt = new Date().toISOString();
    } else {
      log('No notification needed.');
    }
    writeJson(paths.stateFile, { updatedAt: new Date().toISOString(), walks: currentWalks });
    status.lastCheckCompletedAt = new Date().toISOString();
    status.pendingWalks = currentWalks.length;
    status.lastResult = `${currentWalks.length} pending; ${newWalks.length} new; ${changedWalks.length} changed; ${clearedWalks.length} cleared`;
    writeJson(paths.statusFile, status);
  } catch (err) {
    await browser.close().catch(() => {});
    log(`ERROR: ${err.stack || err.message}`);
    status.lastError = err.message;
    status.lastCheckCompletedAt = new Date().toISOString();
    writeJson(paths.statusFile, status);
    try { await sendEmail('Walks Manager Watch failed', err.stack || err.message); } catch (e) { log(`Could not send failure email: ${e.message}`); }
    process.exit(1);
  }
})();
