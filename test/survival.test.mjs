/**
 * 约束存活核对：投影式压缩下按「所在行」核对的单元测试。
 * 用法：node test/survival.test.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store } from '../index.js'

const CONFIG = {
  bootMaxChars: 1400,
  recallMaxChars: 1600,
  maxRecallResults: 6,
  maxIndexLines: 10,
  maxLogEntries: 2,
  rulesPage: 'identity/house-rules.md',
  growthPage: 'identity/growth.md',
  mustKeepPage: 'identity/must-keep.md',
  survivalCoverage: 0.6,
  keywordCoverage: 0.5,
  maxWarnChars: 180,
  warnMaxAgeMs: 7200000,
  maxGrowthChars: 220,
  maxRulesChars: 500,
  maxRuleChars: 22,
  rulesHint: true,
}

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
}

function makeSession(events) {
  return {
    events,
    eventAt: (seq) => events.find((e) => Number(e.seq) === Number(seq)),
  }
}

const userMsg = (seq, text) => ({
  type: 'user/message',
  seq,
  data: { content: [{ type: 'text', text }], source: { kind: 'user' } },
})

function run(name, summary, events, shadowed, expectLost) {
  const root = mkdtempSync(path.join(tmpdir(), 'fishmem-'))
  mkdirSync(path.join(root, '.fish-memory'), { recursive: true })
  const store = new Store(root, CONFIG)
  const session = makeSession(events)
  const event = { type: 'compaction/summary', seq: 999, data: { summary, shadowedSeqs: shadowed } }
  const result = store.handleCompaction(session, event)
  check(name, result.lost === expectLost, `checked=${result.checked} lost=${result.lost}`)
  const lossFile = path.join(root, '.fish-memory', 'compaction-loss.json')
  const recorded = existsSync(lossFile) ? (JSON.parse(readFileSync(lossFile, 'utf8')).lost ?? []) : []
  check(`${name}：丢失记录条数`, recorded.length === expectLost, `${recorded.length} 条`)
  if (expectLost > 0) console.log('   丢失内容：', recorded.map((l) => l.text).join(' | '))
  rmSync(root, { recursive: true, force: true })
}

// 1) 关键词行覆盖到约束 → 不算丢
run(
  '关键词行命中（EC 那类）',
  [
    '[块 seq 5-12 · 09-01 10:00] 词：ec 0xc531 字节 风扇 备份',
    '[块 seq 20-25 · 09-01 10:05] · 「记得每次改完都要实测」 · 原文按 seq 取回',
  ].join('\n'),
  [userMsg(10, '以后不要动 EC 的 0xC531 这个字节'), userMsg(20, '记得每次改完都要实测')],
  [10, 20],
  0,
)

// 2) 关键词行没覆盖到 → 判丢
run(
  '关键词行没命中',
  [
    '[块 seq 5-12 · 09-01 10:00] 词：风扇 安装 工具箱',
    '[块 seq 20-25 · 09-01 10:05] · 「记得每次改完都要实测」 · 原文按 seq 取回',
  ].join('\n'),
  [userMsg(10, '以后不要动 EC 的 0xC531 这个字节'), userMsg(20, '记得每次改完都要实测')],
  [10, 20],
  1,
)

// 3) 没有 seq 标记、但整句出现在摘要里（普通摘要式引擎）→ 旧判据放行
run(
  '整句在摘要里（无 seq 标记）',
  '摘要：以后不要动 EC 的 0xC531 这个字节。',
  [userMsg(10, '以后不要动 EC 的 0xC531 这个字节')],
  [10],
  0,
)

// 4) 没有 seq 标记的摘要（别的引擎）→ 退回整句切片判据
run(
  '无 seq 标记时回退',
  '摘要里只剩：必须保留备份，别乱动系统文件。',
  [userMsg(30, '必须保留备份，别乱动系统文件')],
  [30],
  0,
)

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`)
process.exitCode = failures === 0 ? 0 : 1
