/**
 * 定时叫醒的测试：用假的 schedule 服务，不碰真宿主。
 * 删掉这个功能时，连带删掉本文件。
 */
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ensureAlarm, tickAlarms, readAlarms } from '../lib/alarm.js'
import { readWake, writeWake } from '../lib/wake.js'

const root = mkdtempSync(path.join(tmpdir(), 'fish-alarm-'))
mkdirSync(path.join(root, '.fish-memory'), { recursive: true })

/** 造一个假服务，记录 create 被调了几次。 */
function fakeSchedule(existing = []) {
  const created = []
  return {
    created,
    async list() {
      return { items: existing }
    },
    async create(request) {
      created.push(request)
      return { id: 'x', ...request, status: 'active' }
    },
  }
}

// 一、没有服务：不炸，返回 no-service
assert.equal((await ensureAlarm(null, 's1', root)).status, 'no-service')
assert.equal((await ensureAlarm({}, 's1', root)).status, 'no-service')

// 二、没会话 id：不建
assert.equal((await ensureAlarm(fakeSchedule(), '', root)).status, 'no-session')

// 三、第一次：建一个，目标就是那个会话
const a = fakeSchedule()
const first = await ensureAlarm(a, 'sess-a', root)
assert.equal(first.status, 'created')
assert.equal(a.created.length, 1)
assert.equal(a.created[0].target.kind, 'session')
assert.equal(a.created[0].target.sessionId, 'sess-a')
assert.equal(a.created[0].timing.kind, 'every')

// 四、已经有了：不重复建
const b = fakeSchedule([
  {
    status: 'active',
    title: '叫醒自己找事做',
    target: { kind: 'session', sessionId: 'sess-b' },
  },
])
assert.equal((await ensureAlarm(b, 'sess-b', root)).status, 'exists')
assert.equal(b.created.length, 0)

// 五、同名的任务但绑的是别的会话：仍然给自己建
const c = fakeSchedule([
  {
    status: 'active',
    title: '叫醒自己找事做',
    target: { kind: 'session', sessionId: 'sess-other' },
  },
])
assert.equal((await ensureAlarm(c, 'sess-c', root)).status, 'created')
assert.equal(c.created.length, 1)

// 六、已结束的任务不算已有，要新建
const d = fakeSchedule([
  {
    status: 'ended',
    title: '叫醒自己找事做',
    target: { kind: 'session', sessionId: 'sess-d' },
  },
])
assert.equal((await ensureAlarm(d, 'sess-d', root)).status, 'created')

// 七、服务抛错：吞掉并报 failed，不往外抛
const broken = {
  async list() {
    throw new Error('boom')
  },
  async create() {
    throw new Error('boom')
  },
}
const failed = await ensureAlarm(broken, 'sess-e', root)
assert.equal(failed.status, 'failed')
assert.ok(String(failed.reason).includes('boom'))

// 八、分数到了才投递：没到不投，到了投一次并清零
const ran = []
const sched = {
  async run(request) { ran.push(request.id); return { id: request.id } },
}
const MIN = 60 * 1000
const now = Date.now()
writeWake(root, { at: now, weight: 2, boostAt: [] }, 'low')
writeWake(root, { at: now - 60 * MIN, weight: 0, boostAt: [] }, 'high')
const { writeAlarms } = await import('../lib/alarm.js')
writeAlarms(root, { low: 'task-low', high: 'task-high' })
assert.equal(readAlarms(root).high, 'task-high', 'id 该存档')
const fired = await tickAlarms(sched, root, { now })
assert.equal(fired, 1, '只有到线的那一个投递')
assert.deepEqual(ran, ['task-high'])
assert.equal(await tickAlarms(sched, root, { now }), 0, '十分钟内不重复叫')
// 分数不清零：到线叫过之后，原始分数不该被改
writeWake(root, { at: now, weight: 7, boostAt: [] }, 'kept')
writeAlarms(root, { kept: 'task-kept' })
const schedK = { async run(request) { return { id: request.id } } }
assert.equal(await tickAlarms(schedK, root, { now }), 1)
assert.equal(readWake(root, 'kept').weight, 7, '叫过不清零，分数保持原样')
// 过了最小间隔、分数仍在线上的，可以再叫一次
const later = now + 21 * MIN
assert.equal(await tickAlarms(sched, root, { now: later }), 1, '隔够二十分钟可以再叫')

// 八之二、随机闹钟不受最小间隔限制：它算额外那一次
// 先让 gapboost 这个会话刚被叫过一次，再让一个随机时刻到点，间隔只有一秒也该响
const t0 = Date.now()
const ranGap = []
const schedGap = { async run(request) { ranGap.push(request.id); return { id: request.id } } }
writeWake(root, { at: t0, weight: 1, boostAt: [t0 - 1] }, 'gapboost')
writeAlarms(root, { gapboost: 'task-gapboost' })
assert.equal(await tickAlarms(schedGap, root, { now: t0 }), 1, '随机到点该响')
assert.equal(ranGap.length, 1)
// 一秒后又一个随机时刻到点：固定叫会被间隔挡住，随机不该被挡
const t1 = t0 + 1000
writeWake(root, { at: t1, weight: 1, boostAt: [t1 - 1] }, 'gapboost')
assert.equal(await tickAlarms(schedGap, root, { now: t1 }), 1, '随机闹钟不受最小间隔约束')
assert.equal(ranGap.length, 2)

// 八之三、投递失败时，被消耗的随机时刻要补回来，不能白丢
const tFail = Date.now()
const schedBad = { async run() { throw new Error('task gone') } }
writeAlarms(root, { lostboost: 'task-dead' })
writeWake(root, { at: tFail, weight: 1, boostAt: [tFail - 1] }, 'lostboost')
assert.equal(await tickAlarms(schedBad, root, { now: tFail }), 0, '投不出去不算叫醒')
const after = readWake(root, 'lostboost')
assert.equal(after.boostAt.length, 1, '随机时刻被补回来了')
assert.ok(after.boostAt[0] > tFail, '补在将来，不是过去')

// 九、随机时刻到点也触发，即使分数没到线
const ran2 = []
const sched2 = { async run(request) { ran2.push(request.id); return { id: request.id } } }
writeWake(root, { at: now, weight: 1, boostAt: [now - 1000] }, 'boosted')
writeAlarms(root, { boosted: 'task-boost' })
assert.equal(await tickAlarms(sched2, root, { now }), 1, '随机时刻到点也该叫')
assert.deepEqual(ran2, ['task-boost'])

// 十、还没到点的随机时刻不触发
const ran3 = []
const sched3 = { async run(request) { ran3.push(request.id); return { id: request.id } } }
writeWake(root, { at: now, weight: 1, boostAt: [now + 10 * MIN] }, 'waiting')
writeAlarms(root, { waiting: 'task-wait' })
assert.equal(await tickAlarms(sched3, root, { now }), 0, '没到点的随机时刻不该叫')

rmSync(root, { recursive: true, force: true })
console.log('alarm tests: ok')
