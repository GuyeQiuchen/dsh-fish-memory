import assert from 'node:assert'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store } from '../index.js'

const root = mkdtempSync(path.join(tmpdir(), 'fish-bootcheck-'))

try {
  writeFileSync(path.join(root, 'index.md'), '# Memory Index\n\n- [甲](a.md) — 甲页\n', 'utf8')
  writeFileSync(path.join(root, 'a.md'), '# A\n\n内容\n', 'utf8')

  const clean = new Store(root, {}).bootTextSync()
  assert.ok(!clean.includes('开机检查'), `索引干净时不该出现开机检查行，实际：${clean}`)

  // 补不了的页（只有标题，没正文也没摘要）仍要报警
  mkdirSync(path.join(root, 'sub'), { recursive: true })
  writeFileSync(path.join(root, 'sub', 'b.md'), '# B\n', 'utf8')

  const dirty = new Store(root, {}).bootTextSync()
  assert.ok(dirty.includes('开机检查'), `补不了的未登记页该报警，实际：${dirty}`)
  assert.ok(dirty.includes('sub/b.md'), `该报出具体页面，实际：${dirty}`)

  // 死链现在会被自动清掉，不再报警
  writeFileSync(
    path.join(root, 'index.md'),
    '# Memory Index\n\n- [甲](a.md) — 甲页\n- [鬼](ghost.md) — 不存在的页\n',
    'utf8',
  )
  const dead = new Store(root, {}).bootTextSync()
  const after = readFileSync(path.join(root, 'index.md'), 'utf8')
  assert.ok(!after.includes('ghost.md'), `死链该被自动删掉，实际：${after}`)
  assert.ok(!dead.includes('ghost.md'), '删掉后不该再报')
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('bootcheck tests: ok')
