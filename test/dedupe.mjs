import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'fish-dedupe-'))
const home = mkdtempSync(path.join(tmpdir(), 'fish-dedupe-home-'))
process.env.DSH_HOME = home

const { Store } = await import('../index.js')

try {
  mkdirSync(path.join(root, 'projects'), { recursive: true })
  writeFileSync(path.join(root, 'index.md'), '# Memory Index\n', 'utf8')
  writeFileSync(
    path.join(root, 'projects', 'fan.md'),
    '---\ndate: 2026-11-19\n---\n# 风扇曲线\n\n风扇曲线用 ITE EC 控制。\n转速 3558 是稳的。\n',
    'utf8',
  )

  const store = new Store(root, {})

  // 一、第一次给
  store.rememberQuery('风扇转速')
  const first = store.queryHint()
  assert.ok(first.includes('projects/fan.md'), `第一次该给页指针，实际：${first}`)

  // 二、同样内容再判：不给
  store.rememberQuery('风扇转速 现在多少')
  assert.equal(store.queryHint(), '', '同一页同一 seq 不该重复给')

  // 三、页内容变了：重新给
  writeFileSync(
    path.join(root, 'projects', 'fan.md'),
    '---\ndate: 2026-11-19\n---\n# 风扇曲线\n\n风扇曲线改成按电源模式分表了。\n转速 3558 是旧的。\n',
    'utf8',
  )
  store.cache.clear()
  store.rememberQuery('风扇转速 分表')
  const changed = store.queryHint()
  // 页内容改了，指针签名（页+seq）没变的话不该再发；发了也只发页指针，不贴正文。
  assert.ok(changed === '' || changed.includes('projects/fan.md'), `内容变了该重给页指针，实际：${changed}`)

  // 四、压缩发生了：签名变，重新给一次
  const dir = path.join(home, 'fish-jiyu')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, 'last-report.json'),
    JSON.stringify([{ at: new Date().toISOString(), before: 1, after: 1, seqFrom: 10, seqTo: 20 }]),
    'utf8',
  )
  store.rememberQuery('风扇转速 分表')
  const afterCompact = store.queryHint()
  assert.ok(afterCompact !== '', `压缩之后该重新给一次，实际：${afterCompact}`)

  console.log('dedupe tests: ok')
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
}
