#!/usr/bin/env bash
# Uninstall dsh-jiyiti-memory from a DSH profile on macOS / Linux.
#
# Reverses install.sh: removes the copied package, the dependency, the bundle
# entry and the fish-memory patch block. Does not touch your memory files under
# ~/.memory.
#
# Usage:
#   ./uninstall.sh              # desktop profile
#   PROFILE=other ./uninstall.sh

set -euo pipefail

PROFILE="${PROFILE:-desktop}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PKG="$PROFILE_DIR/package.json"
PATCH="$PROFILE_DIR/cordis.patch.yml"
TARGET="$PROFILE_DIR/node_modules/dsh-jiyiti-memory"
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

if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  rm -rf "$TARGET"
  echo "removed: $TARGET"
fi

# install.sh 在 local-packages 里留了一份自己的副本，卸载时也要一起清掉
STORE_COPY="$PROFILE_DIR/local-packages/dsh-jiyiti-memory"
if [ -e "$STORE_COPY" ]; then
  rm -rf "$STORE_COPY"
  echo "removed: $STORE_COPY"
fi

node - "$PKG" <<'NODE'
const fs = require('node:fs')
const [pkgPath] = process.argv.slice(2)
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
if (pkg.dependencies) delete pkg.dependencies['dsh-jiyiti-memory']
const bundles = pkg.dsh?.profile?.bundles
if (Array.isArray(bundles)) {
  pkg.dsh.profile.bundles = bundles.filter((b) => b !== 'dsh-jiyiti-memory')
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
console.log('package.json cleaned')
NODE

if [ -f "$PATCH" ]; then
node - "$PATCH" <<'NODE'
const fs = require('node:fs')
const [patchPath] = process.argv.slice(2)
let patch = fs.readFileSync(patchPath, 'utf8')
patch = patch.replace(/\n*- insert:\r?\n    - id: fish-memory\r?\n(?:      .*\r?\n)*/m, '\n')
fs.writeFileSync(patchPath, patch, 'utf8')
console.log('patch: fish-memory entry removed')
NODE
else
  echo "patch: no cordis.patch.yml; skipped"
fi

echo ""
echo "done. Restart DSH to apply."
echo "Your memory files under ~/.memory are untouched."
