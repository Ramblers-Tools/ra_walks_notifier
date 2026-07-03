#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

WIN_BUILD_HOST=${WIN_BUILD_HOST:?Set WIN_BUILD_HOST to the Windows VM's IP or hostname}
WIN_BUILD_USER=${WIN_BUILD_USER:-richard}
WIN_BUILD_REPO=${WIN_BUILD_REPO:-/c/Users/$WIN_BUILD_USER/Documents/code/ra_walks_notifier}
WIN_BUILD_BRANCH=${WIN_BUILD_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}
VERSION=$(node -p "require('./package.json').version")
REMOTE="$WIN_BUILD_USER@$WIN_BUILD_HOST"

# Requires OpenSSH Server enabled on the Windows VM with Git for Windows
# installed (provides bash, git, and node/npm on PATH).
ssh "$REMOTE" "
  set -euo pipefail
  cd '$WIN_BUILD_REPO'
  git fetch origin '$WIN_BUILD_BRANCH'
  git checkout '$WIN_BUILD_BRANCH'
  git reset --hard 'origin/$WIN_BUILD_BRANCH'
  npm run release:win
"

scp \
  "$REMOTE:$WIN_BUILD_REPO/dist/latest.yml" \
  "$REMOTE:$WIN_BUILD_REPO/dist/RA-Walks-Notifier-$VERSION-x64-setup.exe" \
  "$ROOT_DIR/dist/"

echo "Windows release artifacts copied to $ROOT_DIR/dist for $VERSION"
