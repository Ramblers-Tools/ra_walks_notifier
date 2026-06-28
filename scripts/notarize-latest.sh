#!/usr/bin/env bash
set -euo pipefail
APP_ZIP=$(ls -t dist/*.zip 2>/dev/null | head -1 || true)
DMG=$(ls -t dist/*.dmg 2>/dev/null | head -1 || true)
TARGET="${DMG:-$APP_ZIP}"
if [ -z "$TARGET" ]; then
  echo "No built .dmg or .zip found in dist/. Run npm run build:mac:signed first."
  exit 1
fi
xcrun notarytool submit "$TARGET" --keychain-profile WalksManagerWatchNotary --wait
if [[ "$TARGET" == *.dmg ]]; then
  xcrun stapler staple "$TARGET"
fi
spctl -a -vv "$TARGET" || true
echo "Notarization complete: $TARGET"
