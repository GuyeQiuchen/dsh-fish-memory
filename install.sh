#!/usr/bin/env bash
# Install dsh-jiyiti-memory into a DSH profile on macOS / Linux.
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
STORE_COPY="$STORE_DIR/dsh-jiyiti-memory"
TARGET="$MOD_DIR/dsh-jiyiti-memory"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ ! -f "$PKG" ]; then
  echo "profile not found: $PKG" >&2
  exit 1
fi

# 2026-11-27 M0-3：--verify-only 只查不装。
# 三件事：包是真目录（不是软链）、入口语法通过、lib 模块齐全并能被 import。
if [ "${1:-}" = "--verify-only" ]; then
  fail=0
  say() { printf '%s  %s\n' "$1" "$2"; }

  if [ -L "$TARGET" ]; then
    # 软链本身不致命：只要入口和 lib 都不 import @deepseek-ai/*，宿主不需要解析
    # 那些包，软链也能跑（记忆体现在就是这样，实测能加载）。
    # 一旦用到宿主包，pnpm 装的软链会让解析失败 → 静默不激活（鲫鱼 2026-11-27 22:39 那次）。
    if grep -rqs "@deepseek-ai/" "$TARGET/index.js" "$TARGET/lib" 2>/dev/null; then
      say "FAIL" "包是软链，且代码里 import 宿主包：$TARGET（宿主解析不到，会静默不激活）"
      fail=1
    else
      say "warn" "包是软链，但不用宿主包：$TARGET（可用；重装时 pnpm 可能改写它）"
    fi
  elif [ -d "$TARGET" ]; then
    say "ok  " "包是真目录：$TARGET"
  else
    say "FAIL" "没找到已装的包：$TARGET"
    fail=1
  fi

  if [ -f "$TARGET/index.js" ] && node --check "$TARGET/index.js" 2>/dev/null; then
    say "ok  " "入口语法：node --check 通过"
  else
    say "FAIL" "入口语法：index.js 缺失或语法错误"
    fail=1
  fi

  if [ -f "$TARGET/app.js" ] && node --check "$TARGET/app.js" 2>/dev/null; then
    say "ok  " "主体语法：app.js 通过"
  else
    say "FAIL" "主体语法：app.js 缺失或语法错误"
    fail=1
  fi

  if [ -f "$TARGET/lib/engine/api.js" ] && [ -f "$TARGET/lib/engine/CONTRACT.md" ]; then
    say "ok  " "引擎：api.js 与 CONTRACT.md 都在"
  else
    say "FAIL" "引擎文件缺失（lib/engine/api.js 或 CONTRACT.md）"
    fail=1
  fi

  libs=$(find "$TARGET/lib" -maxdepth 1 -name '*.js' 2>/dev/null | wc -l | tr -d ' ')
  if [ "${libs:-0}" -ge 15 ]; then
    say "ok  " "lib 模块：${libs} 个"
  else
    say "FAIL" "lib 模块不足：${libs:-0} 个（应 ≥15）"
    fail=1
  fi

  if node --input-type=module -e "await import('file://$TARGET/index.js')" >/dev/null 2>&1; then
    say "ok  " "入口能 import"
  else
    say "FAIL" "入口 import 失败（缺依赖或被自己拦住）"
    fail=1
  fi

  if [ "$fail" -eq 0 ]; then
    echo ""
    echo "现有安装没问题。"
    exit 0
  fi
  echo ""
  echo "自检没通过。" >&2
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
    --exclude 'node_modules' --exclude '.git' --exclude 'test' --exclude '*.tgz' \
    "$HERE"/ "$STORE_COPY"/
else
  cp -R "$HERE"/. "$STORE_COPY"/
  rm -rf "$STORE_COPY/node_modules" "$STORE_COPY/.git" "$STORE_COPY/test"
  find "$STORE_COPY" -maxdepth 1 -name '*.tgz' -delete 2>/dev/null || true
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
    --exclude 'node_modules' --exclude '.git' --exclude 'test' --exclude '*.tgz' \
    "$HERE"/ "$TARGET"/
else
  cp -R "$HERE"/. "$TARGET"/
  rm -rf "$TARGET/node_modules" "$TARGET/.git" "$TARGET/test" "$TARGET/loaded.txt" "$TARGET/load-error.txt"
  find "$TARGET" -maxdepth 1 -name '*.bak-*' -delete 2>/dev/null || true
  find "$TARGET" -maxdepth 1 -name '*.tgz' -delete 2>/dev/null || true
fi
echo "copied: $HERE -> $TARGET"

node - "$PKG" "$STORE_COPY" <<'NODE'
const fs = require('node:fs')
const [pkgPath, here] = process.argv.slice(2)
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
pkg.dependencies = pkg.dependencies || {}
if (!pkg.dependencies['dsh-jiyiti-memory']) {
  pkg.dependencies['dsh-jiyiti-memory'] = 'link:' + here.replace(/\\/g, '/')
  console.log('dep: dsh-jiyiti-memory added')
}
pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
if (!bundles.includes('dsh-jiyiti-memory')) {
  bundles.push('dsh-jiyiti-memory')
  pkg.dsh.profile.bundles = bundles
  console.log('bundle: dsh-jiyiti-memory added')
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
