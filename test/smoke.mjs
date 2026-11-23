import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply, inject } from '../index.js'

const contexts = []
const tools = []
const disposers = []
const ctx = {
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
  on() { return () => {} },
  systemPrompt: { context(def) { contexts.push(def); return () => {} } },
  tools: { register(def) { tools.push(def); return () => {} } },
}

// 2026-11-22 为什么：原来把 process.argv[2] 直接当记忆根，node --test 下它是测试文件名，
// 解析后落到真实记忆根；实测会改 metrics/mood，并把「刚整理过 / 刚写过日记」的提醒冲掉。
// 现在默认 mkdtemp，只有显式传入 tmp 路径时才用（便于手工指定）。
// 验：node --test（smoke.mjs 不再触碰 ~/.dsh/memory）
// 冒烟测试必须写临时目录：node --test 下 argv[2] 是测试文件名，
// 直接传给 apply 会落到真实记忆根，把「刚整理过 / 刚写过日记」的提醒冲掉。
const root = process.argv[2] && process.argv[2].includes('tmp') ? process.argv[2] : mkdtempSync(path.join(tmpdir(), 'fish-memory-smoke-'))
apply(ctx, { memoryRoot: root, bootMaxChars: 1400 })

console.log('inject:', JSON.stringify(inject))
console.log('contexts:', contexts.map((c) => c.name))
const boot = contexts[0]?.text?.() ?? ''
console.log('bootChars:', boot.length)
console.log('--- boot ---')
console.log(boot)

for (const tool of tools) {
  console.log('\n--- tool:', tool.name, '---')
  const args = tool.name === 'mem_recall' ? { query: '风扇 EC' } : {}
  const result = await tool.execute(args)
  console.log(result.text.slice(0, 700))
}

try {
  rmSync(root, { recursive: true, force: true })
} catch {}
