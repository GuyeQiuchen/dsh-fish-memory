import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// 用临时 DSH_HOME，别碰真实报告
const home = mkdtempSync(path.join(tmpdir(), 'fish-compact-'))
process.env.DSH_HOME = home

const { compactionLine, lastCompaction } = await import('../lib/compact.js')

const dir = path.join(home, 'fish-jiyu')
mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'last-report.json')

const now = Date.now()

try {
  // 一、没装引擎：零字
  assert.equal(compactionLine(), '', '没有报告文件时不该有这行')

  // 二、刚压完，带 seq 范围
  writeFileSync(file, JSON.stringify([{ at: new Date(now - 30 * 60 * 1000).toISOString(), before: 120000, after: 60000, seqFrom: 1024, seqTo: 1082 }]), 'utf8')
  const line = compactionLine()
  assert.ok(line.includes('seq 1024-1082'), `该带上 seq 范围，实际：${line}`)
  assert.ok(line.includes('刚才'), `半小时前该说刚才，实际：${line}`)

  // 三、超过十二小时就不再提
  writeFileSync(file, JSON.stringify([{ at: new Date(now - 20 * 60 * 60 * 1000).toISOString(), before: 1, after: 1, seqFrom: 1, seqTo: 2 }]), 'utf8')
  assert.equal(compactionLine(), '', '二十小时前的压缩不该再顶出来')

  // 四、老报告没有 seq 字段也不炸
  writeFileSync(file, JSON.stringify([{ at: new Date(now - 60 * 1000).toISOString(), before: 1, after: 1 }]), 'utf8')
  const plain = compactionLine()
  assert.ok(plain.includes('上次压缩'), `老报告也该有一行，实际：${plain}`)
  assert.ok(!plain.includes('盖住 seq'), `没有范围就不该编一个，实际：${plain}`)

  // 五、坏文件不能炸
  writeFileSync(file, '{oops', 'utf8')
  assert.equal(lastCompaction(), null, '坏文件当没有')
  assert.equal(compactionLine(), '', '坏文件时零字')

  console.log('compact tests: ok')
} finally {
  rmSync(home, { recursive: true, force: true })
}
