#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

VERSION=$(node -p "require('./package.json').version")

npm ci
npm run build:linux

if ! grep -q "^version: $VERSION$" dist/latest-linux.yml; then
  echo "dist/latest-linux.yml does not contain version $VERSION"
  exit 1
fi

for file in \
  "dist/Walks-Manager-Watch-$VERSION-x86_64.AppImage" \
  "dist/Walks-Manager-Watch-$VERSION-amd64.deb" \
  "dist/Walks-Manager-Watch-$VERSION-x86_64.rpm"; do
  if [ ! -s "$file" ]; then
    echo "Missing release artifact: $file"
    exit 1
  fi
done

echo "Linux release artifacts are ready for $VERSION"
