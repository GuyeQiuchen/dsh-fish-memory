import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store } from '../index.js'
import { readMetrics, bumpMetric, metricsLine } from '../lib/metrics.js'

const root = mkdtempSync(path.join(tmpdir(), 'fish-metrics-'))

try {
  mkdirSync(path.join(root, 'projects'), { recursive: true })
  writeFileSync(path.join(root, 'index.md'), '# Memory Index\n', 'utf8')
  writeFileSync(
    path.join(root, 'projects', 'fan.md'),
    '# 风扇曲线\n\n风扇曲线用 ITE EC 控制。\n转速 3558 是稳的。\n',
    'utf8',
  )

  const store = new Store(root, {})

  // 一、没调过召回就没数
  assert.equal(metricsLine(root), '', '没调过召回不该有度量行')

  // 二、召回有结果记一次命中
  const ok = store.recall('风扇转速')
  assert.equal(ok.status, 'ok')
  let m = readMetrics(root)
  assert.equal(m.recall, 1, '召回该计一次')
  assert.equal(m.recallHit, 1, '有结果该计一次命中')

  // 三、召回没结果只记调用
  const empty = store.recall('量子力学')
  assert.equal(empty.status, 'empty')
  m = readMetrics(root)
  assert.equal(m.recall, 2)
  assert.equal(m.recallHit, 1, '没结果不该算命中')

  // 四、自动提示命中另计
  store.rememberQuery('风扇转速')
  store.queryHint()
  m = readMetrics(root)
  assert.equal(m.hint, 1, '自动提示该计一次')

  // 五、度量行有数
  const line = metricsLine(root)
  assert.ok(line.includes('50%'), `两次召回一次命中，该是 50%，实际：${line}`)

  // 六、坏文件不能把召回弄挂
  writeFileSync(path.join(root, '.fish-memory', 'metrics.json'), '{oops', 'utf8')
  assert.deepEqual(readMetrics(root), {}, '坏文件当空的')
  assert.equal(bumpMetric(root, 'recall'), 1, '坏了也能重新开始记')

  console.log('metrics tests: ok')
} finally {
  rmSync(root, { recursive: true, force: true })
}
