import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'fish-noise-'))
const home = mkdtempSync(path.join(tmpdir(), 'fish-noise-home-'))
process.env.DSH_HOME = home

const { Store } = await import('../index.js')
const { readMetrics, metricsLine } = await import('../lib/metrics.js')

try {
  mkdirSync(path.join(root, 'projects'), { recursive: true })
  writeFileSync(path.join(root, 'index.md'), '# Memory Index\n', 'utf8')
  writeFileSync(
    path.join(root, 'projects', 'fan.md'),
    '# 风扇曲线\n\n风扇曲线用 ITE EC 控制。\n转速 3558 是稳的。\n',
    'utf8',
  )

  const store = new Store(root, {})

  // 一、提示给出去，下一轮没人碰：记一次空转
  store.rememberQuery('风扇转速')
  assert.ok(store.queryHint().includes('fan.md'), '该先给一次页指针')
  store.bootTextSync()
  assert.equal(readMetrics(root).hintIdle, 1, '没人碰该记空转')
  assert.equal(readMetrics(root).hintUsed, undefined, '还没用过')

  // 二、提示给出去，下一轮真去读那页：记一次有用
  // 这里直接摆一个待消费的提示，测的是召回那一侧的消费逻辑
  store.pendingHint = 'projects/fan.md'
  store.recall('风扇曲线 转速')
  const m = readMetrics(root)
  assert.equal(m.hintUsed, 1, '读了那页该记有用')
  assert.equal(m.hintIdle, 1, '空转不该因为有用而清零')

  // 三、度量行把两边都报出来
  const line = metricsLine(root)
  assert.ok(line.includes('真去读了'), `该报有用次数，实际：${line}`)
  assert.ok(line.includes('没人碰'), `该报空转次数，实际：${line}`)

  console.log('noise tests: ok')
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
}
