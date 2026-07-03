#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
REPO="East-Cheshire-Ramblers/ra_walks_notifier"
NOTES=${1:-"RA Walks Notifier $TAG release."}

PRERELEASE_FLAGS=()
TARGET_BRANCH="main"
if [[ "$VERSION" == *-beta.* ]]; then
  PRERELEASE_FLAGS+=(--prerelease)
  TARGET_BRANCH="beta"
fi

bash scripts/validate-release-assets.sh

assets=(
  "dist/latest-mac.yml"
  "dist/RA-Walks-Notifier-$VERSION-arm64.dmg"
  "dist/RA-Walks-Notifier-$VERSION-arm64-mac.zip"
  "dist/RA-Walks-Notifier-$VERSION-arm64-mac.zip.blockmap"
  "dist/latest-linux.yml"
  "dist/RA-Walks-Notifier-$VERSION-x86_64.AppImage"
  "dist/RA-Walks-Notifier-$VERSION-amd64.deb"
  "dist/RA-Walks-Notifier-$VERSION-x86_64.rpm"
  "dist/latest.yml"
  "dist/RA-Walks-Notifier-$VERSION-x64-setup.exe"
)

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" --repo "$REPO" --clobber "${assets[@]}"
else
  gh release create "$TAG" \
    --repo "$REPO" \
    --target "$TARGET_BRANCH" \
    --title "RA Walks Notifier $TAG" \
    --notes "$NOTES" \
    "${PRERELEASE_FLAGS[@]+"${PRERELEASE_FLAGS[@]}"}" \
    "${assets[@]}"
fi

echo "Published $TAG"
