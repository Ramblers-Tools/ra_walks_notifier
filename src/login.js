const { chromium } = require('playwright');
const { paths } = require('./config');
const { log, ensureDirs } = require('./logger');

(async () => {
  ensureDirs();
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  log('Opening Walks Manager login. Sign in, then return to this Terminal window.');
  await page.goto('https://walks-manager.ramblers.org.uk/walks-manager/list?gid=414&review=1', { waitUntil: 'domcontentloaded' });
  console.log('\nAfter you are fully logged in and can see Walks Manager, press Enter here to save the session.');
  process.stdin.resume();
  process.stdin.once('data', async () => {
    await context.storageState({ path: paths.sessionFile });
    log(`Saved login session to ${paths.sessionFile}`);
    await browser.close();
    process.exit(0);
  });
})();
