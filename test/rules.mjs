import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store } from '../index.js'

const root = mkdtempSync(path.join(tmpdir(), 'fish-rules-'))
mkdirSync(path.join(root, 'identity'), { recursive: true })
const page = path.join(root, 'identity', 'house-rules.md')
writeFileSync(
  page,
  [
    '# 家规',
    '',
    '## 注入区',
    '',
    '<!-- rules:start -->',
    '称呼主人；结论先行',
    '<!-- rules:end -->',
    '',
    '## 口癖修正记录（append-only）',
    '',
    '| 日期 | 被纠正的 | 改成 |',
    '|---|---|---|',
    '| 2026-11-15 | 说「记下了」 | 说「记住了」 |',
    '',
  ].join('\n'),
  'utf8',
)

const store = new Store(root, {
  rulesPage: 'identity/house-rules.md',
  maxRulesChars: 23,
  maxRuleChars: 22,
  bootMaxChars: 1400,
  maxIndexLines: 10,
  maxLogEntries: 2,
  maxRecallResults: 6,
  recallMaxChars: 1600,
})

const before = store.rulesStatus()
assert.equal(before.chars, '称呼主人；结论先行'.length)
assert.equal(before.entries, 2)

const added = store.addRule({ short: '不用冒号话题标签', raw: '主人说别拿话题冒号分' })
assert.equal(added.status, 'ok', JSON.stringify(added))
assert.equal(added.chars, '称呼主人；结论先行；不用冒号话题标签'.length)
const after = readFileSync(page, 'utf8')
assert.match(after, /<!-- rules:start -->\n1\. 称呼主人\n2\. 结论先行\n3\. 不用冒号话题标签\n<!-- rules:end -->/, '每条家规应独占一行并带编号')
assert.match(store.rulesText(), /1\. 称呼主人\n2\. 结论先行\n3\. 不用冒号话题标签/, '注入文本也应分行编号')
assert.match(after, /\| 2026-\d\d-\d\d \| 主人说别拿话题冒号分 \| 不用冒号话题标签 \|/)

const dup = store.addRule({ short: '不用冒号话题标签' })
assert.equal(dup.status, 'duplicate')

const tooLong = store.addRule({ short: '这是一条明显超过二十二字上限的长规矩需要被拒绝' })
assert.equal(tooLong.status, 'rejected')

const over = store.addRule({ short: '别主动道别' })
assert.equal(over.status, 'over_budget', JSON.stringify(over))
assert.equal(over.headroom, 23 - '称呼主人；结论先行；不用冒号话题标签'.length)

const forced = store.addRule({ short: '别主动道别', force: true })
assert.equal(forced.status, 'ok')
assert.equal(forced.overBudget, true)

const boot = store.bootTextSync()
assert.ok(boot.includes('· 家规：1. 称呼主人\n2. 结论先行'), boot)
assert.ok(boot.includes('…[截断]'), boot)

const truncatedStatus = store.rulesStatus()
assert.equal(truncatedStatus.truncated, true)

console.log('rules tests: ok', JSON.stringify({ before, added: added.status, boot: boot.length }))

// 新装：没有家规页时，boot 要给出主动记录的提示；rule_add 要能自己建页
const emptyRoot = mkdtempSync(path.join(tmpdir(), 'fish-empty-'))
const fresh = new Store(emptyRoot, {
  rulesPage: 'identity/house-rules.md',
  maxRulesChars: 500,
  maxRuleChars: 22,
  rulesHint: true,
  bootMaxChars: 1400,
})
assert.ok(fresh.bootTextSync().includes('· 家规：还没有'), fresh.bootTextSync())
const created = fresh.addRule({ short: '别用话题冒号', raw: '主人说别用冒号分话题' })
assert.equal(created.status, 'ok', JSON.stringify(created))
const createdPage = readFileSync(path.join(emptyRoot, 'identity', 'house-rules.md'), 'utf8')
assert.match(createdPage, /<!-- rules:start -->\n1\. 别用话题冒号\n<!-- rules:end -->/)
assert.ok(fresh.bootTextSync().includes('· 家规：1. 别用话题冒号'), fresh.bootTextSync())
console.log('fresh install test: ok')

