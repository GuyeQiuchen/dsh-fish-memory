/**
 * 检索命中的测试：中文查询要能命中，别被「整句当一个词」卡死。
 * 删掉检索时连带删掉本文件。
 */
import assert from 'node:assert'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store } from '../index.js'

const root = mkdtempSync(path.join(tmpdir(), 'fish-recall-'))

try {
  mkdirSync(path.join(root, 'projects'), { recursive: true })
  writeFileSync(path.join(root, 'index.md'), '# Memory Index\n', 'utf8')
  writeFileSync(
    path.join(root, 'projects', 'fan.md'),
    '# 风扇曲线\n\n风扇曲线用 ITE EC 控制，切电源模式后要等两秒再写表。\n转速 3558 是稳的。\n',
    'utf8',
  )
  writeFileSync(
    path.join(root, 'projects', 'zip.md'),
    '# 压缩引擎\n\n压缩每次都从原始日志重新投影，不叠摘要链。\n',
    'utf8',
  )
  writeFileSync(
    path.join(root, 'log.md'),
    '# 时间线\n\n## [2026-11-18] note | 随便记的一条\n- 风扇、压缩、记忆都碰过一点。\n',
    'utf8',
  )

  const store = new Store(root, {})

  // 一、中文整句要能命中：这是以前最大的坑
  const fan = store.recall('风扇为什么老是转')
  assert.equal(fan.status, 'ok', `中文问句该有命中，实际 ${fan.status}`)
  assert.ok(fan.result.includes('projects/fan.md'), `该命中风扇页，实际：${fan.result.slice(0, 120)}`)

  // 二、专题页要压过时间线：log 行数多，但不该永远排第一
  const zip = store.recall('压缩是怎么弄的')
  assert.equal(zip.status, 'ok')
  const first = zip.result.split('\n').find((line) => line.startsWith('## ')) ?? ''
  assert.ok(first.includes('projects/zip.md'), `压缩该先命中专题页，实际第一行：${first}`)

  // 三、虚词不能撑着把每页都命中
  const nothing = store.recall('的了吗呢这个那个')
  assert.equal(nothing.status, 'empty', `纯虚词该查不到，实际 ${nothing.status}`)

  // 四、空查询拒绝
  assert.equal(store.recall('   ').status, 'rejected')

  console.log('recall tests: ok')
} finally {
  rmSync(root, { recursive: true, force: true })
}
