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
TARGET="$MOD_DIR/dsh-fish-memory"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ ! -f "$PKG" ]; then
  echo "profile not found: $PKG" >&2
  exit 1
fi

cp "$PKG" "$PKG.bak-$STAMP"
cp "$PATCH" "$PATCH.bak-$STAMP"
echo "backup: package.json.bak-$STAMP, cordis.patch.yml.bak-$STAMP"

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

node - "$PKG" "$HERE" <<'NODE'
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

node - "$PATCH" <<'NODE'
const fs = require('node:fs')
const [patchPath] = process.argv.slice(2)
let patch = fs.readFileSync(patchPath, 'utf8')
if (patch.length < 100) {
  console.error('cordis.patch.yml looks empty; aborting')
  process.exit(1)
}
if (!/^- id: fish-memory/m.test(patch)) {
  patch = patch.trimEnd() + `
- insert:
    - id: fish-memory
      name: 'dsh-fish-memory'
      config:
        memoryRoot: ''
        bootMaxChars: 1400
        recallMaxChars: 1600
        maxRecallResults: 6
        rulesPage: 'identity/house-rules.md'
        maxRulesChars: 500
        maxRuleChars: 22
        alarm: true
`
}
fs.writeFileSync(patchPath, patch, 'utf8')
console.log('patch: fish-memory entry added')
NODE

if command -v node >/dev/null 2>&1; then
  node --check "$TARGET/index.js"
fi

echo ""
echo "done. Restart DSH to apply."
echo "The memory root defaults to ~/.memory; an empty one builds its own skeleton on first boot."
echo "If you install other plugins later, re-run this script so the package stays a real directory."
