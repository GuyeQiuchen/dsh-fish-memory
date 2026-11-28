/**
 * 引擎默认值与兜底：bm25 / strict 为主，legacy 只在主引擎抛错时顶上来。
 * 这里故意把实例里的 ranker / answerer 换成会抛错的假实现，验证回退和告警。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store } from '../app.js'
import { rank, answerable } from '../lib/engine/api.js'

function makeStore() {
  const root = mkdtempSync(path.join(tmpdir(), 'memory-fallback-'))
  writeFileSync(path.join(root, 'a.md'), '# 风扇\n\n风扇转速 3558，温度到 80 度再拉高。\n')
  return new Store(root, {})
}

test('默认口径：检索 bm25、拒答 strict', () => {
  const store = makeStore()
  assert.equal(store.config.searchMode, 'bm25')
  assert.equal(store.config.answerMode, 'strict')
})

test('bm25 抛错：回退 legacy 并给出告警', () => {
  const store = makeStore()
  const real = store.ranker
  store.ranker = (query, pages, options) => {
    if (options.mode === 'bm25') throw new Error('bm25 boom')
    return rank(query, pages, options)
  }
  const { terms, hits } = store.searchHits('风扇')
  assert.ok(terms.length > 0)
  assert.ok(hits.length > 0, 'legacy 应该还能找到页')
  assert.match(store.engineWarningText(), /检索.*bm25 boom/)
  assert.ok(existsSync(store.engineFallbackLogPath()), '异常要落盘')
  assert.match(readFileSync(store.engineFallbackLogPath(), 'utf8'), /bm25 boom/)

  // 下一次 bm25 成功，告警自动消失
  store.ranker = real
  store.searchHits('风扇')
  assert.equal(store.engineWarningText(), '')
})

test('bm25 返回结构不对：按异常处理，回退 legacy', () => {
  const store = makeStore()
  const real = store.ranker
  store.ranker = (query, pages, options) => {
    if (options.mode === 'bm25') return { terms: [] }
    return rank(query, pages, options)
  }
  const { hits } = store.searchHits('风扇')
  assert.ok(hits.length > 0)
  assert.match(store.engineWarningText(), /返回结构不对/)
  store.ranker = real
})

test('strict 抛错：回退 legacy 判据并给出拒答告警', () => {
  const store = makeStore()
  const real = store.answerer
  store.answerer = (ranked, options) => {
    if (options.mode === 'strict') throw new Error('strict boom')
    return answerable(ranked, options)
  }
  const verdict = store.answerVerdict(['风扇', '转速'], [{ matched: 2, matchedList: ['风扇', '转速'] }])
  assert.equal(verdict.ok, true)
  assert.match(store.engineWarningText(), /拒答.*strict boom/)
  store.answerer = real
  store.answerVerdict(['风扇', '转速'], [{ matched: 2, matchedList: ['风扇', '转速'] }])
  assert.equal(store.engineWarningText(), '')
})

test('判定 ok=false 是正常结论，不触发兜底', () => {
  const store = makeStore()
  const verdict = store.answerVerdict(['完全不存在的词'], [{ matched: 0, matchedList: [] }])
  assert.equal(verdict.ok, false)
  assert.equal(store.engineWarningText(), '')
})

test('mem_recall 的结果前缀带告警，且带 engineFallback 标记', () => {
  const store = makeStore()
  const real = store.ranker
  store.ranker = (query, pages, options) => {
    if (options.mode === 'bm25') throw new Error('recall boom')
    return rank(query, pages, options)
  }
  const result = store.recall('风扇')
  assert.equal(result.status, 'ok')
  assert.equal(result.engineFallback, true)
  assert.match(result.result, /^⚠ 检索：recall boom/)
  store.ranker = real
})
