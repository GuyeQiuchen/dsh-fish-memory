import assert from 'node:assert'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store } from '../index.js'

// 一、空目录：第一次读 boot 就把骨架铺出来
const root = mkdtempSync(path.join(tmpdir(), 'fish-home-'))
const boot = new Store(root, {}).bootTextSync()
assert.ok(boot.includes('记忆库刚建好'), '建了库要在 boot 里说一句：' + boot.slice(0, 120))
for (const rel of ['index.md', 'SOUL.md', 'identity/growth.md', 'identity/house-rules.md']) {
  assert.ok(existsSync(path.join(root, rel)), '缺少骨架文件 ' + rel)
}
assert.ok(readFileSync(path.join(root, 'index.md'), 'utf8').includes('# Memory Index'))

// 二、第二次读不再重建，也不再提「刚建好」
const again = new Store(root, {}).bootTextSync()
assert.ok(!again.includes('记忆库刚建好'), '第二次不该再说刚建好')

// 三、已有库不会被铺成骨架：原来的标题还在
// （索引列表本身可能被自动整理修掉死链，那是有意的，不算覆盖）
writeFileSync(path.join(root, 'index.md'), '# 我的索引\n- [甲](a.md) — 甲页\n', 'utf8')
new Store(root, {}).bootTextSync()
const kept = readFileSync(path.join(root, 'index.md'), 'utf8')
assert.ok(kept.includes('我的索引'), '骨架覆盖了已有的索引：' + kept)

rmSync(root, { recursive: true, force: true })
console.log('autohome tests: ok')
