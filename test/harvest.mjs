/**
 * 取原料模块的测试：纯函数 + 一次真实日志抽查。
 * 删掉取原料功能时，连带删掉本文件。
 */
import assert from 'node:assert'
import { homedir } from 'node:os'
import { pickUserLines, harvest, findSessionLogs } from '../lib/harvest.js'

const now = Date.now()

// 一、只认主人手打的字：注入的 runtime-context、检查点、助手消息都不算
const raw = [
  JSON.stringify({ seq: 1, type: 'user/message', time: now - 1000, data: { content: [{ type: 'text', text: '你就按这个做' }] } }),
  JSON.stringify({ seq: 2, type: 'user/message', time: now - 900, data: { source: { kind: 'runtime-context' }, content: [{ text: '【系统注入】' }] } }),
  JSON.stringify({ seq: 3, type: 'assistant/message', time: now - 800, data: { content: [{ type: 'text', text: '好' }] } }),
  JSON.stringify({ seq: 4, type: 'user/message', time: now - 700, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '这句是我打的' }] } }),
  JSON.stringify({ seq: 5, type: 'user/message', time: now - 70000, data: { content: [{ type: 'text', text: '太早的那条' }] } }),
].join('\n')

const picked = pickUserLines(raw, now - 5000, now)
assert.equal(picked.length, 2, `应只留两条真原话，实际 ${picked.length}`)
assert.ok(picked.some((item) => item.text === '你就按这个做'))
assert.ok(picked.some((item) => item.text === '这句是我打的'))
assert.ok(!picked.some((item) => item.text.includes('系统注入')), '注入内容不该被当成原话')
assert.ok(!picked.some((item) => item.text === '太早的那条'), '时间窗外的内容应被过滤')

// 二、时间窗：给一个很窄的窗口，只留落在里面的
const narrow = pickUserLines(raw, now - 850, now - 750)
assert.ok(narrow.every((item) => item.t >= now - 850 && item.t <= now - 750))

// 三、真实日志抽查：本机有会话日志时，抽最近一天应能拿到东西
const home = process.env.DSH_HOME ?? path.join(homedir(), '.dsh')
const files = findSessionLogs(home, 1)
if (files.length === 0) {
  console.log('harvest tests: ok（本机没有会话日志，跳过真实抽查）')
} else {
  const result = harvest({ home, hours: 24, limit: 50 })
  assert.ok(result.count > 0, '最近一天应该抽得到原话')
  assert.ok(result.items.every((item) => typeof item.text === 'string' && item.text.length > 0))
  assert.ok(result.items.every((item, i, arr) => i === 0 || arr[i - 1].t <= item.t), '应按时间升序')
  console.log(`harvest tests: ok（真实抽查 ${result.count} 条，来自 ${result.files} 个日志）`)
}
