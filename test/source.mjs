/**
 * 来源标记的测试：写记忆时带上 seq，记忆页才和会话日志接上。
 * 删掉来源标记时，连带删掉本文件。
 */
import assert from 'node:assert'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store } from '../index.js'

const root = mkdtempSync(path.join(tmpdir(), 'fish-source-'))
writeFileSync(path.join(root, 'index.md'), '# 索引\n\n- [甲](a.md) — 甲页\n', 'utf8')
const store = new Store(root, {})

// 一、log 带来源：标题后跟 seq，还能被 logLines 正常读出来
store.appendLog('换了压缩引擎', '从 vcc 切到鲫鱼。', 'seq 13946-13981')
const log = readFileSync(path.join(root, 'log.md'), 'utf8')
assert.ok(log.includes('note | 换了压缩引擎 · seq 13946-13981'), 'log 条目应带来源')
assert.ok(store.logLines().some((line) => line.includes('换了压缩引擎')), '带来源的条目仍要能读')

// 二、不给来源就不加尾巴，别在标题后面留个空点
store.appendLog('没来源的一条', '正文。')
const log2 = readFileSync(path.join(root, 'log.md'), 'utf8')
assert.ok(log2.includes('note | 没来源的一条\n'), '无来源时标题不该有尾巴')
assert.ok(!log2.includes('没来源的一条 ·'), '无来源时不该出现分隔点')

// 三、页面补充也带来源
store.appendPage('a.md', '甲页的补充。', 'seq 200-260')
const page = readFileSync(path.join(root, 'a.md'), 'utf8')
assert.ok(page.includes('补充 · seq 200-260'), '页面补充应带来源')

// 四、来源太长会截断，不撑破行
store.appendPage('a.md', '又一段。', 'x'.repeat(200))
const page2 = readFileSync(path.join(root, 'a.md'), 'utf8')
const tagLine = page2.split('\n').find((line) => line.includes('补充 · '))
assert.ok(tagLine !== undefined)
assert.ok(tagLine.length < 120, `来源尾巴应被截短，实际 ${tagLine.length}`)

rmSync(root, { recursive: true, force: true })
console.log('source tests: ok')
