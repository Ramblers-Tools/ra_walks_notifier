# Walks Manager Watch - Desktop Tray App

Electron menu bar app for macOS and Linux that lets a Ramblers group's
volunteers manage their Walks Manager Watch settings and see check status,
without needing a machine running 24/7.

All actual checking, browsing, and email sending happens server-side (see
`ra_walks_notifier_server`, a separate private repository). This app is a
thin client: it talks to that server over its HTTP API using a per-tenant
API key, and it's the one thing that genuinely needs a screen - the
interactive Ramblers single sign-on login, which uploads the resulting
session to the server.

From the tray menu you can:

- Check Now
- Connect / Login to Walks Manager (server connection, SSO login, group selection)
- Manage notification recipients
- Manage walk leader email settings
- Change the email logo
- View schedule/active hours
- View logs (pulled live from the server)

## Install for local testing

```bash
npm install
npm test
```

Then run:

```bash
npm run app
```

On first launch, the app opens **Connect** if it isn't configured yet
(server API key, Walks Manager login, group selection). Reopen it from the
tray menu at any time.

Local client state (API key, cached settings) is stored outside the app
bundle:

```text
~/Library/Application Support/Walks Manager Watch/
```

On Linux, Electron stores app data under the current user's standard
application config/data folders.

## Build signed app

Your signing identity is already configured in `package.json`:

```text
Richard Higham (9PG75A2TYV)
```

For a local unsigned packaging test:

```bash
npm run build:mac:unsigned
```

Build with:

```bash
npm run build:mac:signed
```

This produces installer/update artifacts in `dist/`:

- `.dmg` for first install
- `.zip` for future app update feeds

For a signed and notarized release build from a clean temporary folder:

```bash
npm run release:mac:clean
```

For Linux installer/update artifacts, build on Linux:

```bash
npm run release:linux
```

The Linux build currently targets x64 AppImage, DEB, and RPM packages. The DEB/RPM installers put the app into the desktop application launcher and keep it installed outside the Downloads folder.

Before publishing a release, copy the Linux `dist/latest-linux.yml`, AppImage, DEB, and RPM files back to the Mac repo `dist/` folder, then run:

```bash
npm run release:validate
npm run release:publish -- "Release notes go here."
```

The validator checks that both `latest-mac.yml` and `latest-linux.yml` match the current `package.json` version and that all expected update assets exist.

On Linux, **Start App on Login** uses the standard XDG autostart file:

```text
~/.config/autostart/walks-manager-watch.desktop
```

Tray visibility can vary by desktop environment. GNOME may need AppIndicator/status notifier support enabled.

The signing certificate must be installed in the macOS login keychain. Check it with:

```bash
security find-identity -v -p codesigning
```

## Notarization setup

Run this once, replacing the placeholders. Use an app-specific password from Apple ID, not your normal Apple password.

```bash
xcrun notarytool store-credentials WalksManagerWatchNotary --apple-id YOUR_APPLE_ID --team-id 9PG75A2TYV --password YOUR_APP_SPECIFIC_PASSWORD
```

Then submit the latest built DMG/ZIP:

```bash
npm run notary:submit
```

## Verify Gatekeeper

After notarization:

```bash
spctl -a -vv dist/*.dmg
```

## Notes

This package intentionally does not include any saved Walks Manager
session or server credentials - those live server-side, per tenant.

If the saved server-side Walks Manager session expires, choose **Connect**
from the tray menu and sign in again.
