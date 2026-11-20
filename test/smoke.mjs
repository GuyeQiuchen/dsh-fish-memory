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

apply(ctx, { memoryRoot: process.argv[2], bootMaxChars: 1400 })

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
