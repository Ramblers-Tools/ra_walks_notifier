#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

VERSION=$(node -p "require('./package.json').version")

npm ci
npm run build:win

if ! grep -q "^version: $VERSION$" dist/latest.yml; then
  echo "dist/latest.yml does not contain version $VERSION"
  exit 1
fi

file="dist/RA-Walks-Notifier-$VERSION-x64-setup.exe"
if [ ! -s "$file" ]; then
  echo "Missing release artifact: $file"
  exit 1
fi

echo "Windows release artifacts are ready for $VERSION"
