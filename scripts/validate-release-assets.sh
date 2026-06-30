#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

VERSION=$(node -p "require('./package.json').version")

require_file() {
  if [ ! -s "$1" ]; then
    echo "Missing release asset: $1"
    exit 1
  fi
}

require_version() {
  local file="$1"
  if ! grep -q "^version: $VERSION$" "$file"; then
    echo "$file is not for version $VERSION"
    echo "Found:"
    head -5 "$file"
    exit 1
  fi
}

require_version dist/latest-mac.yml
require_version dist/latest-linux.yml

require_file "dist/Walks-Manager-Watch-$VERSION-arm64.dmg"
require_file "dist/Walks-Manager-Watch-$VERSION-arm64-mac.zip"
require_file "dist/Walks-Manager-Watch-$VERSION-arm64-mac.zip.blockmap"
require_file "dist/Walks-Manager-Watch-$VERSION-x86_64.AppImage"
require_file "dist/Walks-Manager-Watch-$VERSION-amd64.deb"
require_file "dist/Walks-Manager-Watch-$VERSION-x86_64.rpm"

for asset in \
  "Walks-Manager-Watch-$VERSION-arm64.dmg" \
  "Walks-Manager-Watch-$VERSION-arm64-mac.zip" \
  "Walks-Manager-Watch-$VERSION-x86_64.AppImage" \
  "Walks-Manager-Watch-$VERSION-amd64.deb" \
  "Walks-Manager-Watch-$VERSION-x86_64.rpm"; do
  if ! grep -q "$asset" dist/latest-mac.yml dist/latest-linux.yml; then
    echo "No update metadata references $asset"
    exit 1
  fi
done

echo "Release assets are valid for $VERSION"
