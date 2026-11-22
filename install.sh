#!/usr/bin/env bash
# Install dsh-fish-memory into a DSH profile on macOS / Linux.
#
# Why a copy instead of a symlink: the host only resolves @deepseek-ai/* for
# packages that physically live in the profile, and pnpm rewrites "link:"
# dependencies into symlinks whenever it installs anything.
#
# Usage:
#   ./install.sh              # desktop profile
#   PROFILE=other ./install.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="${PROFILE:-desktop}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PKG="$PROFILE_DIR/package.json"
PATCH="$PROFILE_DIR/cordis.patch.yml"
MOD_DIR="$PROFILE_DIR/node_modules"
STORE_DIR="$PROFILE_DIR/local-packages"
STORE_COPY="$STORE_DIR/dsh-fish-memory"
TARGET="$MOD_DIR/dsh-fish-memory"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ ! -f "$PKG" ]; then
  echo "profile not found: $PKG" >&2
  exit 1
fi

cp "$PKG" "$PKG.bak-$STAMP"
if [ -f "$PATCH" ]; then
  cp "$PATCH" "$PATCH.bak-$STAMP"
  echo "backup: package.json.bak-$STAMP, cordis.patch.yml.bak-$STAMP"
else
  echo "backup: package.json.bak-$STAMP (no cordis.patch.yml yet)"
fi

# Keep an own copy inside the profile. The dependency points at this copy, so
# deleting or moving the folder you downloaded from breaks nothing.
mkdir -p "$STORE_COPY"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '*.bak-*' --exclude 'loaded.txt' --exclude 'load-error.txt' \
    --exclude 'node_modules' --exclude '.git' --exclude 'test' \
    "$HERE"/ "$STORE_COPY"/
else
  cp -R "$HERE"/. "$STORE_COPY"/
  rm -rf "$STORE_COPY/node_modules" "$STORE_COPY/.git" "$STORE_COPY/test"
fi
echo "stored: $STORE_COPY"

mkdir -p "$MOD_DIR"
if [ -L "$TARGET" ]; then
  rm "$TARGET"
  echo "broke an existing symlink"
fi
mkdir -p "$TARGET"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '*.bak-*' --exclude 'loaded.txt' --exclude 'load-error.txt' \
    --exclude 'node_modules' --exclude '.git' --exclude 'test' \
    "$HERE"/ "$TARGET"/
else
  cp -R "$HERE"/. "$TARGET"/
  rm -rf "$TARGET/node_modules" "$TARGET/.git" "$TARGET/test" "$TARGET/loaded.txt" "$TARGET/load-error.txt"
  find "$TARGET" -maxdepth 1 -name '*.bak-*' -delete 2>/dev/null || true
fi
echo "copied: $HERE -> $TARGET"

node - "$PKG" "$STORE_COPY" <<'NODE'
const fs = require('node:fs')
const [pkgPath, here] = process.argv.slice(2)
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
pkg.dependencies = pkg.dependencies || {}
if (!pkg.dependencies['dsh-fish-memory']) {
  pkg.dependencies['dsh-fish-memory'] = 'link:' + here.replace(/\\/g, '/')
  console.log('dep: dsh-fish-memory added')
}
pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
if (!bundles.includes('dsh-fish-memory')) {
  bundles.push('dsh-fish-memory')
  pkg.dsh.profile.bundles = bundles
  console.log('bundle: dsh-fish-memory added')
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
NODE

# 4) cordis.patch.yml: 这里不再插条目。包自带的 cordis.patch.yml（bundle）已经
#    插入 fish-memory 行；再插一份会和它重复，DSH 对重复 id 会报冲突。
#    要改配置，手动写 `- id: fish-memory` + config，覆盖 bundle 的默认值。
if [ -f "$PATCH" ]; then
node - "$PATCH" <<'NODE'
const fs = require('node:fs')
const [patchPath] = process.argv.slice(2)
const patch = fs.readFileSync(patchPath, 'utf8')
if (patch.length < 100) {
  console.error('cordis.patch.yml looks empty; aborting')
  process.exit(1)
}
console.log('patch: unchanged (fish-memory row comes from the bundle)')
NODE
else
  echo "patch: no cordis.patch.yml yet; skipped (bundle provides the row)"
fi

if command -v node >/dev/null 2>&1; then
  node --check "$TARGET/index.js"
fi

echo ""
echo "done. Restart DSH to apply."
echo "The memory root defaults to $DSH_HOME/memory (normally ~/.dsh/memory); an empty one builds its own skeleton on first boot."
echo "If you install other plugins later, re-run this script so the package stays a real directory."
