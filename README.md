# Walks Manager Watch - Desktop Tray App

This repository is based on the working v4.1 Electron app attachment and is the stable desktop baseline for the v4.3 background-agent refactor.

It is an Electron desktop application for macOS, with Linux AppImage packaging being added for testing. It does not use PHP, Joomla, Laravel, Symfony, or any web framework.

The app reuses the working checker/parser and adds a menu bar/tray icon with:

- Check Now
- Force Test Email
- Login to Walks Manager
- Open Review List
- Show Status
- automatic checks using the interval in `config.json`

The current notification implementation uses the existing SMTP/nodemailer path from v4.1. Microsoft Graph OAuth email delivery is the intended v4.3 notification refactor.

## Install for local testing

```bash
npm install
npx playwright install chromium
npm test
```

Copy these from your working v3.1 folder:

```text
.env
sessions/auth.json
```

Then run:

```bash
npm run app
```

On first launch, the app opens **Setup** if required settings are missing. Setup collects notification recipients, SMTP email settings, and the saved Walks Manager login session needed for background checks. You can reopen it from the menu bar via **Setup**.

Runtime settings are stored outside the app bundle:

```text
~/Library/Application Support/Walks Manager Watch/
```

On Linux, Electron stores app data under the current user's standard application config/data folders.

Logs are stored in:

```text
~/Library/Logs/Walks Manager Watch/
```

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

For a signed and notarized release build:

```bash
npm run release:mac
```

For an experimental Linux AppImage build:

```bash
npm run build:linux
```

The Linux build currently targets x64 AppImage. Tray visibility and start-on-login behaviour can vary by desktop environment; start-on-login is not configured automatically for Linux yet.

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

This package intentionally does not include your `.env` or saved Ramblers login session.

If Playwright login expires, choose **Login to Walks Manager** from the menu bar and sign in again.
