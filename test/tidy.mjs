/**
 * 整理提醒的测试：不碰真实记忆库。
 * 删掉整理提醒时，连带删掉本文件。
 */
import assert from 'node:assert'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { tidyLine, tidyDue, markTidy, readTidy, tidyPath } from '../lib/tidy.js'

const root = mkdtempSync(path.join(tmpdir(), 'fish-tidy-'))
mkdirSync(path.join(root, '.fish-memory'), { recursive: true })

// 一、从没整理过：算到期，而且是「首次」，提示要求先把骨架立稳
const fresh = tidyDue(root, {})
assert.equal(fresh.due, true)
assert.equal(fresh.first, true)
assert.equal(fresh.hoursSince, null)
assert.ok(tidyLine(root, {}).includes('首次'))
assert.ok(tidyLine(root, {}).includes('mem_consolidate'))
// 首次带上工作单摘要时，摘要跟着走，别再重复那句默认指引
const withBrief = tidyLine(root, {}, '页 3 个\n没进索引：a.md')
assert.ok(withBrief.includes('页 3 个'))
assert.ok(!withBrief.includes('先调 mem_consolidate 拿工作单'))

// 二、刚整理过：不到期，boot 里不占字
const state = markTidy(root)
assert.equal(state.count, 1)
assert.equal(tidyDue(root, {}).due, false)
assert.equal(tidyLine(root, {}), '')

// 三、超过一天：到期，提示里带小时数
writeFileSync(tidyPath(root), JSON.stringify({ at: Date.now() - 26 * 3600000, count: 3 }), 'utf8')
const old = tidyDue(root, {})
assert.equal(old.due, true)
assert.equal(old.hoursSince, 26)
const line = tidyLine(root, {})
assert.ok(line.includes('26 小时'))
assert.ok(line.includes('mem_consolidate'))

// 四、配置改间隔：36 小时时，同样的旧记录还不到期
assert.equal(tidyDue(root, { tidyHours: 36 }).due, false)

// 五、坏文件当没记过，不抛
writeFileSync(tidyPath(root), 'not json', 'utf8')
assert.equal(readTidy(root), null)
assert.equal(tidyDue(root, {}).due, true)

rmSync(root, { recursive: true, force: true })
console.log('tidy tests: ok')
