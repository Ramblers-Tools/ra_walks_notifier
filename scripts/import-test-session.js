// Dev-only tool: injects a Playwright-style storageState JSON (the same
// format the app itself uploads via apiClient.postSession, see
// saveElectronLoginSession in src/main.js) into the app's persisted Walks
// Manager cookie partition, so you can test against another account's
// session (e.g. one downloaded from the server for a specific tenant)
// without going through a real login on this machine.
//
// Usage: close the app first (it locks the cookie DB while running), then:
//   npx electron scripts/import-test-session.js /path/to/session.json
//
// Afterwards, launch the app normally - it will see the session as present.

const { app, session } = require('electron');
const fs = require('fs');
const path = require('path');

const PARTITION = 'persist:walks-manager-watch-browser';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx electron scripts/import-test-session.js /path/to/session.json');
    app.exit(1);
    return;
  }

  const storageState = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  const ses = session.fromPartition(PARTITION);

  for (const cookie of storageState.cookies || []) {
    const url = `https://${cookie.domain.replace(/^\./, '')}${cookie.path || '/'}`;
    await ses.cookies.set({
      url,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
      sameSite: cookie.sameSite === 'Strict' ? 'strict' : cookie.sameSite === 'Lax' ? 'lax' : 'no_restriction',
      expirationDate: cookie.expires && cookie.expires > 0 ? cookie.expires : undefined
    });
  }
  console.log(`Imported ${(storageState.cookies || []).length} cookie(s) into partition ${PARTITION}.`);

  for (const origin of storageState.origins || []) {
    if (!origin.localStorage || !origin.localStorage.length) continue;
    const { BrowserWindow } = require('electron');
    const win = new BrowserWindow({ show: false, webPreferences: { partition: PARTITION } });
    await win.loadURL(origin.origin);
    const script = origin.localStorage
      .map(item => `localStorage.setItem(${JSON.stringify(item.name)}, ${JSON.stringify(item.value)});`)
      .join('\n');
    await win.webContents.executeJavaScript(script);
    win.close();
    console.log(`Imported ${origin.localStorage.length} localStorage item(s) for ${origin.origin}.`);
  }

  app.quit();
}

app.whenReady().then(main).catch((error) => {
  console.error('Import failed:', error);
  app.exit(1);
});
