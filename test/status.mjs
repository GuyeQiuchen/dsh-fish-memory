/**
 * mem_status 的「最近」必须是最后一条。
 *
 * 2026-11-22 为什么加：原来读 log[0]，拿到的是倒数第二条。写完一条立刻核对会看不到，
 * 然后重复写一条——这行是最容易被“看起来没生效”骗到的地方。
 */
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'fish-status-'))

try {
  mkdirSync(path.join(root, 'projects'), { recursive: true })
  writeFileSync(path.join(root, 'index.md'), '# Memory Index\n', 'utf8')
  writeFileSync(path.join(root, 'log.md'), '# Memory Log\n', 'utf8')

  const { Store } = await import('../index.js')
  const store = new Store(root, {})
  store.appendLog('第一条', '正文一')
  store.appendLog('第二条', '正文二')
  store.appendLog('第三条', '正文三')

  const st = store.status()
  assert.ok(String(st.recentLog).includes('第三条'), `「最近」该是最后一条，实际：${st.recentLog}`)
  assert.ok(!String(st.recentLog).includes('第二条'), '不该是倒数第二条')

  console.log('status tests: ok')
} finally {
  rmSync(root, { recursive: true, force: true })
}
