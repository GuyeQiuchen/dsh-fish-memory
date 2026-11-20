/**
 * 整理工作单的测试：纯函数为主，不碰真实记忆库。
 * 删掉整理功能时，连带删掉本文件。
 */
import assert from 'node:assert'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseLog, listPages, indexedPaths, buildWorklist } from '../lib/consolidate.js'

// 一、log 按日期切块
const log = [
  '# 记忆日志',
  '',
  '## [2026-11-17] note | 停用鹦鹉螺',
  '- 压缩回退 vcc。',
  '',
  '## [2026-11-18] note | 鲫鱼改名',
  '- 改叫鲫鱼，投影逻辑没动。',
].join('\n')
const entries = parseLog(log)
assert.equal(entries.length, 2, `应切出两条，实际 ${entries.length}`)
assert.equal(entries[0].date, '2026-11-17')
assert.equal(entries[1].date, '2026-11-18')
assert.ok(entries[1].body.includes('鲫鱼'))

// 二、页面清单：跳过根部大文件，递归收子目录
const root = mkdtempSync(path.join(tmpdir(), 'fish-consolidate-'))
mkdirSync(path.join(root, 'identity'), { recursive: true })
mkdirSync(path.join(root, 'projects'), { recursive: true })
writeFileSync(path.join(root, 'log.md'), log, 'utf8')
writeFileSync(path.join(root, 'index.md'), '# 索引\n\n- [家规](identity/house-rules.md) — 规矩\n', 'utf8')
writeFileSync(path.join(root, 'SOUL.md'), '# SOUL\n', 'utf8')
writeFileSync(path.join(root, 'identity', 'house-rules.md'), '# 家规\n', 'utf8')
writeFileSync(path.join(root, 'projects', 'jiyu.md'), '# 鲫鱼\n', 'utf8')

const pages = listPages(root)
const paths = pages.map((page) => page.path).sort()
assert.deepEqual(paths, ['identity/house-rules.md', 'projects/jiyu.md'], `页面清单不对：${paths}`)

const indexed = indexedPaths(root)
assert.ok(indexed.has('identity/house-rules.md'), '索引里的页应被识别')
assert.ok(!indexed.has('projects/jiyu.md'), '没登记的页不该被算作已索引')

// 三、工作单：摆材料 + 提示，不下判断
const work = buildWorklist(root, { days: 7 })
assert.ok(Array.isArray(work.logEntries))
assert.ok(work.pages.length === 2)
assert.deepEqual(work.unindexed, ['projects/jiyu.md'], `未索引页不对：${work.unindexed}`)
assert.ok(typeof work.window.days === 'number')
assert.ok(Array.isArray(work.hints))

rmSync(root, { recursive: true, force: true })
console.log('consolidate tests: ok')
