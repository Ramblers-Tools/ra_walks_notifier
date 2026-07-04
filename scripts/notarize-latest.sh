#!/usr/bin/env bash
set -euo pipefail

VERSION=$(node -p "require('./package.json').version")
APP_ZIP=$(ls -t "dist/"*"$VERSION"*.zip 2>/dev/null | head -1 || true)
DMG=$(ls -t "dist/"*"$VERSION"*.dmg 2>/dev/null | head -1 || true)
TARGET="${DMG:-$APP_ZIP}"
if [ -z "$TARGET" ]; then
  echo "No built .dmg or .zip for version $VERSION found in dist/. Run npm run build:mac:signed first."
  exit 1
fi
if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]; then
  NOTARY_ARGS=(--apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD")
else
  NOTARY_ARGS=(--keychain-profile WalksManagerWatchNotary)
  if [ -n "${WMW_NOTARY_KEYCHAIN:-}" ]; then
    NOTARY_ARGS+=(--keychain "$WMW_NOTARY_KEYCHAIN")
  fi
fi
xcrun notarytool submit "$TARGET" "${NOTARY_ARGS[@]}" --wait
if [[ "$TARGET" == *.dmg ]]; then
  xcrun stapler staple "$TARGET"
  spctl -a -t open --context context:primary-signature -vv "$TARGET" || true
else
  spctl -a -vv "$TARGET" || true
fi
echo "Notarization complete: $TARGET"
