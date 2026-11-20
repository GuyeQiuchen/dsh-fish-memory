/**
 * 主动唤醒的测试：只在临时目录里跑，不碰真实记忆库。
 * 删掉唤醒功能时，连带删掉本文件。
 */
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { wakeLine, wakePath, readWake, tickWake, dropWake, writeWake } from '../lib/wake.js'

const root = mkdtempSync(path.join(tmpdir(), 'fish-wake-'))
mkdirSync(path.join(root, '.fish-memory'), { recursive: true })
const MIN = 60 * 1000
const t0 = Date.now()

// 一、刚开始：权重 0，不提示
writeWake(root, { at: t0, weight: 0, boostAt: [] })
assert.equal(wakeLine(root), '')

// 二、过 60 分钟：每 10 分钟一分，早已过提示线
writeWake(root, { at: t0 - 60 * MIN, weight: 0, boostAt: [] })
const six = tickWake(root, t0)
assert.equal(six.weight, 6)
assert.equal(six.ready, true)
assert.ok(wakeLine(root).includes('自己挑一件事'))

// 三、过 4 小时也只到 7 分，不会溢出
writeWake(root, { at: t0 - 240 * MIN, weight: 0, boostAt: [] })
const capped = tickWake(root, t0)
assert.equal(capped.weight, 7)

// 四、按这一轮的长短扣：闲聊不扣、短活 2、长活 3（上限 7）
writeWake(root, { at: t0, weight: 7, boostAt: [] })
assert.equal(dropWake(root, 'chat').weight, 7)
writeWake(root, { at: t0, weight: 7, boostAt: [] })
assert.equal(dropWake(root, 'short').weight, 5)
writeWake(root, { at: t0, weight: 7, boostAt: [] })
assert.equal(dropWake(root, 'long').weight, 4)

// 四之二、被叫醒的那一轮固定扣 2
writeWake(root, { at: t0, weight: 7, boostAt: [] })
assert.equal(dropWake(root, 'wake').weight, 5)

// 五、扣到 5 分以下就不留闹钟
writeWake(root, { at: t0, weight: 7, boostAt: [t0 + 5 * MIN] })
const afterLong = dropWake(root, 'long')
assert.equal(afterLong.weight, 4)
assert.deepEqual(readWake(root).boostAt, [])

// 六、过 5 分会排一个未来的闹钟；到 7 分会有两个
writeWake(root, { at: t0, weight: 5, boostAt: [] })
const eight = tickWake(root, t0)
assert.equal(eight.weight, 5)
assert.equal(readWake(root).boostAt.length, 1)
assert.ok(readWake(root).boostAt[0] > t0)

// 七、闹钟到点就触发一次，触发后清掉
writeWake(root, { at: t0, weight: 5, boostAt: [t0 - MIN] })
const rang = tickWake(root, t0)
assert.equal(rang.boosted, true)
assert.equal(rang.ready, true)
assert.equal(readWake(root).boostAt.length, 0)

// 八、到 7 分排两个闹钟
writeWake(root, { at: t0 - 200 * MIN, weight: 0, boostAt: [] })
tickWake(root, t0)
assert.equal(readWake(root).boostAt.length, 2)

// 九、状态文件坏了当第一次，不抛
writeFileSync(wakePath(root), 'not json', 'utf8')
assert.deepEqual(readWake(root), { at: null, weight: 0, boostAt: [] })
assert.equal(wakeLine(root), '')

// 十、按会话分开：各存一份，互不影响
writeWake(root, { at: t0, weight: 2, boostAt: [] }, 'sess-a')
writeWake(root, { at: t0, weight: 7, boostAt: [] }, 'sess-b')
assert.equal(readWake(root, 'sess-a').weight, 2)
assert.equal(readWake(root, 'sess-b').weight, 7)
assert.notEqual(wakePath(root, 'sess-a'), wakePath(root, 'sess-b'), '两个会话不能共用一个文件')
assert.equal(wakeLine(root, 'sess-a'), '', '没到分的会话不该被提示')
assert.ok(wakeLine(root, 'sess-b').includes('自己挑一件事'), '到分的会话才提示')

rmSync(root, { recursive: true, force: true })
console.log('wake tests: ok')
