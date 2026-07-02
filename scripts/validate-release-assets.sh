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
require_version dist/latest.yml

require_file "dist/RA-Walks-Notifier-$VERSION-arm64.dmg"
require_file "dist/RA-Walks-Notifier-$VERSION-arm64-mac.zip"
require_file "dist/RA-Walks-Notifier-$VERSION-arm64-mac.zip.blockmap"
require_file "dist/RA-Walks-Notifier-$VERSION-x86_64.AppImage"
require_file "dist/RA-Walks-Notifier-$VERSION-amd64.deb"
require_file "dist/RA-Walks-Notifier-$VERSION-x86_64.rpm"
require_file "dist/RA-Walks-Notifier-$VERSION-x64-setup.exe"

for asset in \
  "RA-Walks-Notifier-$VERSION-arm64.dmg" \
  "RA-Walks-Notifier-$VERSION-arm64-mac.zip" \
  "RA-Walks-Notifier-$VERSION-x86_64.AppImage" \
  "RA-Walks-Notifier-$VERSION-amd64.deb" \
  "RA-Walks-Notifier-$VERSION-x86_64.rpm" \
  "RA-Walks-Notifier-$VERSION-x64-setup.exe"; do
  if ! grep -q "$asset" dist/latest-mac.yml dist/latest-linux.yml dist/latest.yml; then
    echo "No update metadata references $asset"
    exit 1
  fi
done

echo "Release assets are valid for $VERSION"
