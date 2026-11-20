/**
 * 引擎健康检查的测试：不碰真实记忆库。
 * 删掉这个功能时，连带删掉本文件。
 */
import assert from 'node:assert'
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { engineHealth } from '../lib/health.js'

const dir = mkdtempSync(path.join(tmpdir(), 'fish-health-'))
const report = path.join(dir, 'last-report.json')

try {
  // 一、文件不在：当作没装，不出声
  assert.equal(engineHealth({ reportPath: report }), '', '没有报告文件时不该报警')

  // 二、刚出过报告：不出声
  writeFileSync(report, '[]', 'utf8')
  assert.equal(engineHealth({ reportPath: report, limitHours: 24 }), '', '新鲜报告不该报警')

  // 三、一天多没动静：报警，并带上小时数
  const old = new Date(Date.now() - 30 * 3600 * 1000)
  utimesSync(report, old, old)
  const warn = engineHealth({ reportPath: report, limitHours: 24 })
  assert.ok(warn.includes('压缩引擎'), `该报警，实际：${warn}`)
  assert.ok(warn.includes('30'), `该带小时数，实际：${warn}`)

  // 四、阈值可调：放到 48 小时就不再报
  assert.equal(engineHealth({ reportPath: report, limitHours: 48 }), '', '阈值放宽后不该报警')

  // 五、坏参数不该炸
  assert.equal(engineHealth({ reportPath: report, limitHours: 0 }), '', '阈值非法时不出声')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('health tests: ok')
