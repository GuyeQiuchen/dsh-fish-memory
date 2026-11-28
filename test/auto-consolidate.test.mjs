/**
 * 整理草案的自动生成：到期由 boot 触发，不再要求模型先调 mem_consolidate。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store } from '../app.js'
import { pendingDrafts } from '../lib/drafts.js'
import { markTidy, tidyDue } from '../lib/tidy.js'

const LOG = [
  '## [2026-11-20] 风扇曲线',
  '阈值先放到 3558。',
  '## [2026-11-21] 风扇曲线',
  '3558 还是抖，补了 EC 表。',
  '## [2026-11-22] 风扇曲线',
  '最后定在 3558，温度 80 度再拉高。',
  '## [2026-11-23] 压缩阈值',
  '压缩触发线改到 0.5。',
  '## [2026-11-24] 压缩阈值',
  '0.5 在手机上能压到 94%。',
  '## [2026-11-25] 压缩阈值',
  '定版仍用 0.5。',
].join('\n')

function makeStore(log = LOG) {
  const root = mkdtempSync(path.join(tmpdir(), 'memory-auto-'))
  writeFileSync(path.join(root, 'a.md'), '# 风扇\n\n风扇 3558。\n')
  writeFileSync(path.join(root, 'log.md'), log)
  return new Store(root, {})
}

test('到期自动生成草案，并打点', () => {
  const store = makeStore()
  const result = store.autoConsolidate()
  assert.equal(result.ran, true)
  assert.equal(result.created.created, true)
  assert.equal(pendingDrafts(store.root).length, 1)
  assert.equal(tidyDue(store.root, store.config).due, false, '生成后要打点，不能每轮重复生成')
})

test('未到期不生成', () => {
  const store = makeStore()
  markTidy(store.root)
  const result = store.autoConsolidate()
  assert.equal(result.ran, false)
  assert.equal(result.reason, 'not-due')
  assert.equal(pendingDrafts(store.root).length, 0)
})

test('没有材料也打点，避免每轮重算', () => {
  const store = makeStore('')
  const result = store.autoConsolidate()
  assert.equal(result.ran, true)
  assert.equal(result.created.created, false)
  assert.equal(tidyDue(store.root, store.config).due, false)
})

test('生成失败不打点，下一轮还会重试', () => {
  const store = makeStore()
  store.generateConsolidationDraft = () => { throw new Error('engine boom') }
  const result = store.autoConsolidate()
  assert.equal(result.ran, false)
  assert.equal(result.reason, 'error')
  assert.equal(tidyDue(store.root, store.config).due, true)
})

test('autoConsolidate=false 时不自动生成', () => {
  const store = makeStore()
  store.config.autoConsolidate = false
  const result = store.autoConsolidate()
  assert.equal(result.ran, false)
  assert.equal(result.reason, 'disabled')
  assert.equal(pendingDrafts(store.root).length, 0)
})

test('boot 到期时会自动出草案，只留草案提醒，不再要模型先调工具', () => {
  const store = makeStore()
  const boot = store.bootTextSync()
  assert.match(boot, /整理草案 1 份待处理/)
  assert.doesNotMatch(boot, /【自动整理】/)
  assert.equal(pendingDrafts(store.root).length, 1)
})
