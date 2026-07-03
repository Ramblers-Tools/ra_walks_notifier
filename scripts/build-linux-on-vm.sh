#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

LINUX_BUILD_HOST=${LINUX_BUILD_HOST:-10.10.10.68}
LINUX_BUILD_USER=${LINUX_BUILD_USER:-richard}
LINUX_BUILD_REPO=${LINUX_BUILD_REPO:-/home/richard/Documents/code/ra_walks_notifier}
LINUX_BUILD_BRANCH=${LINUX_BUILD_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}
VERSION=$(node -p "require('./package.json').version")
REMOTE="$LINUX_BUILD_USER@$LINUX_BUILD_HOST"

ssh "$REMOTE" "
  set -euo pipefail
  cd '$LINUX_BUILD_REPO'
  git fetch origin '$LINUX_BUILD_BRANCH'
  git checkout '$LINUX_BUILD_BRANCH'
  git reset --hard 'origin/$LINUX_BUILD_BRANCH'
  npm ci
  npm run release:linux
"

scp \
  "$REMOTE:$LINUX_BUILD_REPO/dist/latest-linux.yml" \
  "$REMOTE:$LINUX_BUILD_REPO/dist/RA-Walks-Notifier-$VERSION-x86_64.AppImage" \
  "$REMOTE:$LINUX_BUILD_REPO/dist/RA-Walks-Notifier-$VERSION-amd64.deb" \
  "$REMOTE:$LINUX_BUILD_REPO/dist/RA-Walks-Notifier-$VERSION-x86_64.rpm" \
  "$ROOT_DIR/dist/"

echo "Linux release artifacts copied to $ROOT_DIR/dist for $VERSION"
