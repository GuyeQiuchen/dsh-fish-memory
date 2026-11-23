/**
 * 工具注册与调用的冒烟测试。
 *
 * 2026-11-22 为什么加这组：0.5.5 装上去之后 mem_seq 报「readSeqRange is not defined」，
 * 原因是 import 没跟上而单测只测了 lib，没测工具这一层。这里把「注册得上、调得动」
 * 钉住，缺 import 会在测试里直接炸，不会等到线上调用。
 */
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(tmpdir(), 'fish-tools-'))
process.env.DSH_HOME = home

const { apply } = await import('../index.js')

try {
  const defs = new Map()
  const ctx = {
    systemPrompt: { context: () => {} },
    tools: { register: (d) => defs.set(d.name, d) },
    effect: (fn) => {
      fn()
    },
    on: () => () => {},
    get: () => null,
    logger: { warn() {}, info() {} },
    sessions: { flush: async () => {} },
  }
  const root = path.join(home, 'memory')
  mkdirSync(root, { recursive: true })
  apply(ctx, { root })

  assert.ok(defs.has('mem_seq'), '该注册 mem_seq')
  assert.ok(defs.has('mem_recall'), '该注册 mem_recall')
  assert.ok(defs.has('mem_page'), '该注册 mem_page')

  // 造一份会话日志，验证 mem_seq 真的能取回
  const dir = path.join(home, 'sessions', '--root-workspace--', 'session-tool0001-0000')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, 'session.v4.jsonl'),
    [
      { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: '第一条原话' }] } },
      { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '第二条回答' }] } } },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n'),
    'utf8',
  )
  // textTool 把结果包成 { text: JSON }，这里解开再断言
  const unwrap = (r) => (typeof r?.text === 'string' ? JSON.parse(r.text) : r)
  const got = unwrap(await defs.get('mem_seq').execute({ from: 1, to: 2, session: 'tool0001' }))
  assert.equal(got.status, 'ok', `mem_seq 该能取回，实际：${JSON.stringify(got).slice(0, 120)}`)
  assert.ok(got.text.includes('第一条原话'), `该有原文，实际：${got.text}`)

  const miss = unwrap(await defs.get('mem_seq').execute({ from: 1, to: 2, session: 'nope999' }))
  assert.equal(miss.status, 'not_found', '找不到会话该明说')

  console.log('tools tests: ok')
} finally {
  rmSync(home, { recursive: true, force: true })
}
