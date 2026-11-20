/**
 * 整条链路的演练：攒分 → 到点 → 投递 → 失败补回 → 扣分，一次跑完。
 *
 * 单元测试各测一段，这个文件把它们串起来走一遍真实的时间顺序。
 * 删掉叫醒功能时，连带删掉本文件。
 */
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readWake, writeWake, tickWake, dropWake } from '../lib/wake.js'
import { readAlarms, tickAlarms, writeAlarms } from '../lib/alarm.js'

const root = mkdtempSync(path.join(tmpdir(), 'fish-drill-'))
mkdirSync(path.join(root, '.fish-memory'), { recursive: true })

const MIN = 60 * 1000
const t0 = new Date('2026-11-20T09:00:00+08:00').getTime()
const ran = []
const sched = {
  async run(request) {
    ran.push(request.id)
    return { id: request.id }
  },
}

// 一、安静六小时，分数涨满封顶，闹钟按档位排满
writeWake(root, { at: t0, weight: 0, boostAt: [] }, 'S')
const sixHours = t0 + 360 * MIN
const full = tickWake(root, sixHours, 'S')
assert.equal(full.weight, 7, '六小时攒到封顶')
assert.equal(readWake(root, 'S').boostAt.length, 2, '满档排两个闹钟')

// 二、分数到线，叫醒一次
writeAlarms(root, { S: 'task-S' })
assert.equal(await tickAlarms(sched, root, { now: sixHours }), 1, '到线叫醒')
assert.deepEqual(ran, ['task-S'])

// 三、被叫醒的那一轮扣两分，分数照旧在线
assert.equal(dropWake(root, 'wake', 'S').weight, 5, '叫醒扣两分')

// 四、任务失效时，随机到点不白丢：不叫、闹钟补回、记账清掉
writeAlarms(root, { S: 'task-dead' })
writeWake(root, { at: sixHours, weight: 1, boostAt: [sixHours - 1] }, 'S')
const bad = {
  async run() {
    throw new Error('task gone')
  },
}
assert.equal(await tickAlarms(bad, root, { now: sixHours }), 0, '投不出去不算叫醒')
assert.equal(readWake(root, 'S').boostAt.length, 1, '随机时刻补回来了')
assert.deepEqual(readAlarms(root), {}, '失效记账已清')

// 五、任务重建后，补回的那个闹钟到点照响
writeAlarms(root, { S: 'task-new' })
const later = readWake(root, 'S').boostAt[0] + MIN
ran.length = 0
assert.equal(await tickAlarms(sched, root, { now: later }), 1, '重建后到点该响')
assert.deepEqual(ran, ['task-new'])

rmSync(root, { recursive: true, force: true })
console.log('drill tests: ok')
