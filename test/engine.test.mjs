/**
 * 引擎内核（P1）离线测试：不 import 插件、不碰 fs、不读配置。
 * 先证明 legacy 打分与改造前一致，再看新判据和整理草案。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { searchTerms, contentTerms } from '../lib/engine/tokens.js'
import { rank, contentLines } from '../lib/engine/rank.js'
import { answerable } from '../lib/engine/answerable.js'
import { parseLogEntries, jaccard, draftConsolidation, draftMarkdown } from '../lib/engine/tidy.js'

const pages = [
  { rel: 'projects/fan.md', text: '# 风扇曲线\n\n风扇用 ITE EC 控制，转速 3558 是稳的。\n温度到 80 度再拉高。' },
  { rel: 'projects/zip.md', text: '# 压缩引擎\n\n压缩每次都从原始日志重新投影，不叠摘要链。' },
  { rel: 'journal/2026-11-20.md', text: '# 2026-11-20\n\n今天调了风扇，3558 转。' },
  { rel: 'log.md', text: '## 2026-11-20 风扇\n\n风扇转速 3558。\n## 2026-11-21 压缩\n\n压缩改了一版。' },
]

test('分词：中文切二元组，停用词扔掉', () => {
  const terms = searchTerms('风扇为什么老是转')
  assert.ok(terms.includes('风扇'))
  assert.ok(terms.includes('3558') === false)
  assert.ok(!terms.includes('为什'))
})

test('legacy 打分与改造前一致：词种×2 + 命中行数，log 最后', () => {
  const { terms, hits } = rank('风扇 3558', pages, { mode: 'legacy' })
  assert.ok(terms.length > 0)
  for (const hit of hits) assert.equal(hit.score, hit.matched * 2 + hit.count)
  const last = hits[hits.length - 1]
  assert.equal(last.rel, 'log.md')
})

test('bm25 打分：同查询下分数不再等于旧公式，且 log 仍排最后', () => {
  const { hits } = rank('风扇 3558', pages, { mode: 'bm25' })
  assert.ok(hits.length >= 2)
  assert.notEqual(hits[0].score, hits[0].matched * 2 + hits[0].count)
  assert.equal(hits[hits.length - 1].rel, 'log.md')
})

test('拒答：legacy 放过的负例，strict 能拦住', () => {
  // 「在哪/怎么」这类功能词把覆盖度抬满：旧口径判定「查得到」，实际这页没讲这个问题。
  const pages2 = [{ rel: 'projects/misc.md', text: '# 备忘\n\n先问在哪改，再实现。' }]
  const ranked = rank('在哪实现', pages2, { mode: 'legacy' })
  const legacy = answerable(ranked, { mode: 'legacy' })
  const strict = answerable(ranked, { mode: 'strict' })
  assert.equal(legacy.ok, true, '这个负例在旧口径下应该被放过（已知缺陷）')
  assert.equal(strict.ok, false, 'strict 应该拦住')
})

test('整理：相似标题归组、同题只留最新、冲突单列', () => {
  const log = [
    '## [2026-11-01] 风扇曲线调整',
    '把阈值改到 3558。',
    '## [2026-11-03] 风扇曲线调整',
    '阈值改成 3558 并记下 EC 表。',
    '## [2026-11-05] 风扇曲线调整',
    '模式切换后要等两秒。',
    '## [2026-11-06] 压缩引擎重写',
    '投影改成四档。',
    '## [2026-11-07] 压缩引擎重写',
    'plan 路径接上了。',
    '## [2026-11-08] 压缩引擎重写',
    '边界提到 1.0.1。',
  ].join('\n')
  const entries = parseLogEntries(log)
  assert.equal(entries.length, 6)
  const result = draftConsolidation({ entries, pages, minGroup: 3, maxSpanDays: 30, threshold: 0.5 })
  assert.ok(result.drafts.length >= 1)
  const fan = result.drafts.find((draft) => draft.title.includes('风扇'))
  assert.ok(fan, '风扇那组应该出草案')
  assert.equal(fan.count, 3)
  assert.equal(fan.date, '2026-11-05')
  assert.equal(fan.sources.length, 3)
  assert.ok(result.conflicts.length >= 1, '正文不同的同题要列冲突')
})

test('整理：不足三条或跨度太大不出草案', () => {
  const entries = parseLogEntries([
    '## [2026-01-01] 同一个话题',
    'a',
    '## [2026-06-01] 同一个话题',
    'b',
    '## [2026-06-02] 同一个话题',
    'c',
  ].join('\n'))
  const result = draftConsolidation({ entries, minGroup: 3, maxSpanDays: 30 })
  assert.equal(result.drafts.length, 0)
  assert.equal(result.unowned.length, 3)
})

test('引擎层不碰宿主、不读盘', () => {
  const dir = path.join(import.meta.dirname, '..', 'lib', 'engine')
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(path.join(dir, file), 'utf8')
    assert.ok(!/@deepseek-ai\//.test(source), `${file} 不许 import 宿主包`)
    assert.ok(!/from 'node:fs'|require\('node:fs'\)|from "node:fs"/.test(source), `${file} 不许读盘`)
    assert.ok(!/from '\.\.\/\.\.\/index/.test(source), `${file} 不许反向依赖插件`)
  }
})

test('稿件渲染：带来源，冲突单列', () => {
  const result = {
    drafts: [{ title: '风扇曲线', count: 2, date: '2026-11-03', page: 'projects/fan.md', body: '正文', sources: [{ date: '2026-11-01', title: '风扇曲线调整' }, { date: '2026-11-03', title: '风扇曲线调整' }] }],
    conflicts: [{ title: '风扇曲线', dates: ['2026-11-01', '2026-11-03'] }],
  }
  const text = draftMarkdown(result)
  assert.match(text, /风扇曲线 ×2/)
  assert.match(text, /来源：2026-11-01/)
  assert.match(text, /需人工判断/)
})

test('变更表：同一事实的旧值标 stale、新值标 latest', () => {
  const log = [
    '## [2026-11-20] 鲫鱼状态',
    '鲫鱼版本 0.4.14，记忆体 0.6.11。',
    '## [2026-11-27] 鲫鱼状态',
    '鲫鱼版本 1.0.1，记忆体 0.6.20。',
    '## [2026-11-27] 鲫鱼状态',
    '顺手把阈值调到 0.5。',
  ].join('\n')
  const result = draftConsolidation({ entries: parseLogEntries(log), minGroup: 3, maxSpanDays: 30 })
  const byToken = new Map(result.changes.map((row) => [row.token, row.status]))
  assert.equal(byToken.get('0.4.14'), 'stale')
  assert.equal(byToken.get('0.6.11'), 'stale')
  assert.equal(byToken.get('1.0.1'), 'latest')
  assert.equal(byToken.get('0.6.20'), 'latest')
  // 年份不当事实值
  assert.equal(byToken.has('2026'), false)
})

test('草案分三块：A 变更表 / B 同题簇 / C 冲突', () => {
  const result = {
    changes: [{ title: '鲫鱼状态', token: '1.0.1', status: 'latest', first: '2026-11-27', last: '2026-11-27', times: 1, sources: ['2026-11-27 鲫鱼状态'] }],
    drafts: [{ title: '鲫鱼状态', count: 2, date: '2026-11-27', page: 'projects/dsh-plugins.md', body: '正文', sources: [{ date: '2026-11-20', title: '鲫鱼状态' }, { date: '2026-11-27', title: '鲫鱼状态' }] }],
    conflicts: [],
  }
  const text = draftMarkdown(result)
  assert.match(text, /## A\. 变更表/)
  assert.match(text, /## B\. 同题簇/)
  assert.match(text, /## C\. 需人工判断/)
  assert.match(text, /\| 1\.0\.1 \| 最新 \|/)
})
