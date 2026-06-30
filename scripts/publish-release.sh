#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
REPO="East-Cheshire-Ramblers/ra_walks_notifier"
NOTES=${1:-"Walks Manager Watch $TAG release."}

bash scripts/validate-release-assets.sh

assets=(
  "dist/latest-mac.yml"
  "dist/Walks-Manager-Watch-$VERSION-arm64.dmg"
  "dist/Walks-Manager-Watch-$VERSION-arm64-mac.zip"
  "dist/Walks-Manager-Watch-$VERSION-arm64-mac.zip.blockmap"
  "dist/latest-linux.yml"
  "dist/Walks-Manager-Watch-$VERSION-x86_64.AppImage"
  "dist/Walks-Manager-Watch-$VERSION-amd64.deb"
  "dist/Walks-Manager-Watch-$VERSION-x86_64.rpm"
)

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" --repo "$REPO" --clobber "${assets[@]}"
else
  gh release create "$TAG" \
    --repo "$REPO" \
    --target main \
    --title "Walks Manager Watch $TAG" \
    --notes "$NOTES" \
    "${assets[@]}"
fi

echo "Published $TAG"
