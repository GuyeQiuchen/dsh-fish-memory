/**
 * 草案通道（P4）：落盘、boot 一行、取回、打点、去重。
 * 全部在临时记忆根上跑，不碰真库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { draftConsolidation, draftMarkdown, parseLogEntries } from '../lib/engine/tidy.js'
import { writeDraft, pendingDrafts, readDraft, markDraft, draftLine, readIndex } from '../lib/drafts.js'

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'mem-drafts-'))
  mkdirSync(path.join(root, 'projects'), { recursive: true })
  writeFileSync(path.join(root, 'log.md'), [
    '## [2026-11-20] 鲫鱼状态',
    '鲫鱼版本 0.4.14，记忆体 0.6.11。',
    '## [2026-11-27] 鲫鱼状态',
    '鲫鱼版本 1.0.1，记忆体 0.6.20。',
    '## [2026-11-27] 鲫鱼状态',
    '顺手把阈值调到 0.5。',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(root, 'projects', 'dsh-plugins.md'), '# 插件\n鲫鱼版本记录。', 'utf8')
  return root
}

const makeResult = (root) => {
  const entries = parseLogEntries(readFileSync(path.join(root, 'log.md'), 'utf8'))
  const pages = [{ rel: 'projects/dsh-plugins.md', text: '插件' }]
  const result = draftConsolidation({ entries, pages, minGroup: 3, maxSpanDays: 30, threshold: 0.5 })
  result.markdown = draftMarkdown(result)
  return result
}

test('落盘 → boot 一行 → 取回 → 打点消失', () => {
  const root = fixture()
  try {
    const created = writeDraft(root, makeResult(root))
    assert.equal(created.created, true)
    assert.equal(pendingDrafts(root).length, 1)
    const line = draftLine(root)
    assert.match(line, /整理草案 1 份待处理/)
    const draft = readDraft(root, created.file)
    assert.match(draft.body, /## A\. 变更表/)
    assert.match(draft.body, /1\.0\.1/)
    const marked = markDraft(root, created.file, 'applied')
    assert.equal(marked.status, 'ok')
    assert.equal(pendingDrafts(root).length, 0)
    assert.equal(draftLine(root), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('已有 pending 时不重复生成；同签名 7 天内也不重复', () => {
  const root = fixture()
  try {
    const result = makeResult(root)
    const first = writeDraft(root, result)
    assert.equal(first.created, true)
    const second = writeDraft(root, result)
    assert.equal(second.created, false)
    assert.equal(second.reason, 'pending-exists')
    markDraft(root, first.file, 'applied')
    const third = writeDraft(root, result)
    assert.equal(third.created, false)
    assert.equal(third.reason, 'recently-applied')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('状态表坏了不影响读取（当空的）', () => {
  const root = fixture()
  try {
    mkdirSync(path.join(root, '.drafts'), { recursive: true })
    writeFileSync(path.join(root, '.drafts', 'index.json'), '{oops', 'utf8')
    assert.deepEqual(readIndex(root), { drafts: [] })
    assert.deepEqual(pendingDrafts(root), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
