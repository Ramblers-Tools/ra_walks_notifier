const { chromium } = require('playwright');
const { paths } = require('./config');
const { log, ensureDirs } = require('./logger');

(async () => {
  ensureDirs();
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  log('Opening Walks Manager login. Sign in using the browser window.');
  await page.goto('https://walks-manager.ramblers.org.uk/walks-manager/list?gid=414&review=1', { waitUntil: 'domcontentloaded' });

  await page.waitForURL(/walks-manager\.ramblers\.org\.uk\/walks-manager\//, { timeout: 180000 }).catch(() => {});
  await page.waitForFunction(() => {
    const text = document.body ? document.body.innerText : '';
    return /Walks Manager|Submitted for checking|Awaiting publishing|Ready to publish/i.test(text);
  }, { timeout: 180000 });

  await context.storageState({ path: paths.sessionFile });
  log(`Saved login session to ${paths.sessionFile}`);
  await browser.close();
  process.exit(0);
})().catch(async (error) => {
  log(`ERROR saving Walks Manager session: ${error.stack || error.message}`);
  process.exit(1);
});
