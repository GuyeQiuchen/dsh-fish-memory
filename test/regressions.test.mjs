/**
 * 审查回归（2026-11-28）：每条对应一次真实复现过的失败。
 * 全部在临时记忆根上跑，不碰真实记忆。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store } from '../index.js'
import { indexPaths, indexProblems } from '../lib/indexcheck.js'
import { writeDraft, markDraft, pendingDrafts } from '../lib/drafts.js'
import { changeTable } from '../lib/engine/tidy.js'
import { answerable } from '../lib/engine/answerable.js'
import { bootTextSync } from '../lib/boot.js'

const fresh = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fm-reg-'))
  const store = new Store(root, {})
  store.ensureHome()
  return { root, store }
}

test('rule_add 能写进去（today 缺 import 的回归）', () => {
  const { store } = fresh()
  const out = store.addRule({ short: '说错要认', raw: '说错就要认，别绕' })
  assert.equal(out.status, 'ok')
  assert.ok(store.rulesText().includes('说错要认'))
})

test('queryHint 不抛 ReferenceError（answerable / lastCompaction 缺 import）', () => {
  const { store } = fresh()
  writeFileSync(path.join(store.root, 'projects', 'p.md'), '# p\n鲫鱼阈值是 0.5。', 'utf8')
  store.lastQuery = '鲫鱼阈值'
  assert.doesNotThrow(() => store.queryHint())
})

test('草案同日不复用文件名，apply 不会命中旧行', () => {
  const { root } = fresh()
  const a = writeDraft(root, { markdown: '# A', drafts: [{ title: '甲' }] })
  assert.equal(a.created, true)
  assert.equal(markDraft(root, a.file, 'applied').status, 'ok')
  const b = writeDraft(root, { markdown: '# B', drafts: [{ title: '乙' }] })
  assert.equal(b.created, true)
  assert.notEqual(a.file, b.file)
  assert.equal(markDraft(root, b.file, 'applied').status, 'ok')
  assert.equal(pendingDrafts(root).length, 0)
})

test('索引路径含空格也能匹配，不再无限追加重复行', () => {
  const text = '- [带空格](notes/有 空格.md) — 说明（salience: 2）'
  assert.deepEqual(indexPaths(text), ['notes/有 空格.md'])
  const issues = indexProblems(text, ['notes/有 空格.md'])
  assert.equal(issues.length, 0)
})

test('boot 超预算时保住人格与家规，不为情绪行砍掉前缀', () => {
  const { store } = fresh()
  writeFileSync(path.join(store.root, 'identity', 'house-rules.md'), [
    '---', 'title: 家规', '---', '<!-- rules:start -->', '规则一', '规则二', '规则三', '规则四', '<!-- rules:end -->', '',
  ].join('\n'), 'utf8')
  const deps = {
    CORE_PERSONA: '人格基干', wakeLine: () => '', moodLineWithin: () => '· 情绪：平静（可以做事）',
    tidyDue: () => ({ due: false }), tidyLine: () => '', diaryLine: () => '', oldPageLine: () => '',
    compactionLine: () => '', bumpMetric: () => {}, draftLine: () => '',
  }
  const text = bootTextSync(store, { ...deps, clip: (t, n) => String(t).slice(0, n) })
  assert.ok(text.includes('人格基干'))
  assert.ok(text.includes('家规'))
})

test('fitRules 首条就超长时给半句，不只剩省略号', () => {
  const { store } = fresh()
  writeFileSync(path.join(store.root, 'identity', 'house-rules.md'), [
    '---', 'title: 家规', '---', '<!-- rules:start -->', '这是一条特别长的规则'.repeat(6), '<!-- rules:end -->', '',
  ].join('\n'), 'utf8')
  const text = store.fitRules(20)
  assert.ok(text.trim() !== '' && text.trim() !== '…[截断]')
})

test('personaLine 认「名字：」「称呼：」两种写法', () => {
  const { store } = fresh()
  writeFileSync(path.join(store.root, 'SOUL.md'), '# 名字与称呼\n\n名字：阿记\n称呼：主人\n', 'utf8')
  const line = store.personaLine()
  assert.ok(line.includes('名字=阿记'))
  assert.ok(line.includes('称呼对方=主人'))
})

test('status 的 indexEntries 数真实条数，不被展示上限截断', () => {
  const { root, store } = fresh()
  const rows = []
  for (let i = 1; i <= 15; i += 1) {
    const rel = `projects/p${i}.md`
    writeFileSync(path.join(root, rel), `# p${i}\n内容`, 'utf8')
    rows.push(`- [p${i}](${rel}) — 说明（salience: 2）`)
  }
  writeFileSync(path.join(root, 'index.md'), rows.join('\n') + '\n', 'utf8')
  // boot 会把没登记的页自动补进索引，所以这里对「当前索引真实条数」，不是固定 15
  const st = store.status()
  assert.ok(st.indexEntries >= 15)
  assert.equal(st.indexEntries, indexPaths(store.read('index.md')).length)
})

test('缺 CORE_PERSONA 时不往 boot 塞 undefined', () => {
  const { store } = fresh()
  const deps = {
    wakeLine: () => '', moodLineWithin: () => '', tidyDue: () => ({ due: false }), tidyLine: () => '',
    diaryLine: () => '', oldPageLine: () => '', compactionLine: () => '', bumpMetric: () => {}, draftLine: () => '',
  }
  const text = store.bootTextSync(deps)
  assert.ok(!text.includes('· undefined'))
})

test('变更表不输出没有日期的值', () => {
  const entries = [
    { date: '', title: '无日期', body: '版本 9.9.9' },
    { date: '2026-11-20', title: '旧', body: '版本 1.0.0' },
    { date: '2026-11-27', title: '新', body: '版本 1.0.1' },
  ]
  for (const row of changeTable(entries, [[0, 1, 2]])) {
    assert.equal(typeof row.first, 'string')
    assert.equal(typeof row.last, 'string')
    assert.ok(!String(row.first).includes('undefined'))
  }
})

test('strict 拒答：单个实义词精确命中时放行', () => {
  const out = answerable({ terms: ['压缩'], hits: [{ matched: 2, matchedList: ['压缩'] }] }, { mode: 'strict' })
  assert.equal(out.ok, true)
})

test('约束判定：差别 / 别人 / 分别 不算约束，真命令才算', async () => {
  const { looksLikeConstraint } = await import('../lib/survival.js')
  assert.equal(looksLikeConstraint('预估一下，如果是32k的上下文，新旧引擎会有多大的差别'), false)
  assert.equal(looksLikeConstraint('适用性这一环有价值，但如果别人用呢'), false)
  assert.equal(looksLikeConstraint('余量没花掉时，和旧引擎的分别是多少'), false)
  assert.equal(looksLikeConstraint('干脆做成手机APP，别依赖dshgo了'), true)
  assert.equal(looksLikeConstraint('以后都先查 loaded.txt 再说话'), true)
  assert.equal(looksLikeConstraint('你谨慎是好的，但是也不要害怕失败'), false)
})

test('存活核对：行内覆盖不够时，整段摘要里有原话也算 kept', async () => {
  const { survivalCheck } = await import('../lib/survival.js')
  const store = { config: { keywordCoverage: 0.6, survivalCoverage: 0.6 } }
  const summary = [
    '[块 seq 1-10 · 假] 词：无关 内容',
    '',
    '凡引述过去必须带坐标（seq/文件行/工具输出）再开口；不确定明说，绝不编造；',
  ].join('\n')
  const [v] = survivalCheck(store, summary, [{ seq: 5, text: '凡引述过去必须带坐标（seq/文件行/工具输出）再开口；不确定明说，绝不编造；' }])
  assert.equal(v.kept, true)
})

test('压缩钩子会把本次检查点落成回放样本（本地）', () => {
  const { root, store } = fresh()
  const session = { eventAt: () => ({ type: 'user/message', data: { source: { kind: 'user' }, content: '以后都用中文回答，别用英文' } }) }
  store.handleCompaction(session, { data: { summary: '[块 seq 1-10 · 假] 词：中文 回答', shadowedSeqs: [1] } })
  const dir = path.join(root, '.fish-memory', 'replay')
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'))
  assert.equal(files.length, 1)
  const data = JSON.parse(readFileSync(path.join(dir, files[0]), 'utf8'))
  assert.equal(data.constraints.length, 1)
  assert.equal(typeof data.summary, 'string')
})
