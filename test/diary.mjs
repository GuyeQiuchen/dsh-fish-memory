/**
 * 日记提醒的测试：纯函数 + 一次假的投递。
 * 删掉这个功能时，连带删掉本文件。
 */
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { diaryDue, diaryPageOf, diaryPath, markDiary, readDiary } from '../lib/diary.js'
import { tidyPath } from '../lib/tidy.js'
import { ensureDiaryAlarm, nudgeDiary } from '../lib/alarm.js'

const root = mkdtempSync(path.join(tmpdir(), 'fish-diary-'))
const HOUR = 60 * 60 * 1000
mkdirSync(path.join(root, '.fish-memory'), { recursive: true })

// 一、没写过：到期，且标着首次
let due = diaryDue(root, {})
assert.equal(due.due, true)
assert.equal(due.first, true)

// 二、打完点：不到期
markDiary(root)
assert.equal(diaryDue(root, {}).due, false)
assert.equal(readDiary(root).count, 1)

// 三、超过 24 小时：又到期
const state = readDiary(root)
writeFileSync(diaryPath(root), JSON.stringify({ at: Date.now() - 25 * HOUR, count: state.count }), 'utf8')
due = diaryDue(root, {})
assert.equal(due.due, true)
assert.equal(due.first, false)

// 四、间隔可配
writeFileSync(diaryPath(root), JSON.stringify({ at: Date.now() - 2 * HOUR, count: 1 }), 'utf8')
assert.equal(diaryDue(root, { diaryHours: 1 }).due, true)
assert.equal(diaryDue(root, { diaryHours: 24 }).due, false)

// 五、页名：一天一份，按本地日期
const page = diaryPageOf(new Date(2026, 10, 21, 9, 0, 0).getTime())
assert.equal(page, 'journal/2026-11-21.md')

// 六、整理没做完时不投递
function fakeSchedule() {
  const calls = []
  return {
    calls,
    async list() { return { items: [] } },
    async create(args) { calls.push({ kind: 'create', args }); return { id: 'task-d' } },
    async edit(args) { calls.push({ kind: 'edit', args }); return { id: args.id } },
    // 宿主的 run 只认 id；提示词要先用 edit 写进任务
    async run(args) { calls.push({ kind: 'run', args }); return { id: args.id } },
  }
}

const a = fakeSchedule()
await ensureDiaryAlarm(a, 'sess-a', root)
assert.equal(a.calls[0].kind, 'create')
assert.equal(a.calls[0].args.title.startsWith('写今天的日记'), true)

// 状态：刚清空，该写；但整理也到期 → 让路
writeFileSync(diaryPath(root), JSON.stringify({ at: Date.now() - 25 * HOUR, count: 1 }), 'utf8')
writeFileSync(tidyPath(root), JSON.stringify({ at: Date.now() - 25 * HOUR, count: 1 }), 'utf8')
writeFileSync(path.join(root, '.fish-memory', 'active.json'), JSON.stringify({ session: 'sess-a' }), 'utf8')
const before = a.calls.length
assert.equal(await nudgeDiary(a, root, {}), 0)
assert.equal(a.calls.length, before, '整理没做完不该投递')

// 整理做完了，但刚做完 30 分钟内也算没铺开 → 仍让路
writeFileSync(tidyPath(root), JSON.stringify({ at: Date.now(), count: 2 }), 'utf8')
assert.equal(await nudgeDiary(a, root, {}), 0, '整理刚做完不该立刻写日记')

// 整理落地了（两小时前打完点）→ 投递，且提示里带出当天页名
writeFileSync(tidyPath(root), JSON.stringify({ at: Date.now() - 2 * HOUR, count: 2 }), 'utf8')
assert.equal(await nudgeDiary(a, root, {}), 1)
const run = a.calls[a.calls.length - 1]
assert.equal(run.kind, 'run')
assert.equal(run.args.id, 'task-d')
const edit = a.calls[a.calls.length - 2]
assert.equal(edit.kind, 'edit')
assert.match(edit.args.patch.prompt, /journal\/\d{4}-\d{2}-\d{2}\.md/)

// 七、同一档只催一次
assert.equal(await nudgeDiary(a, root, {}), 0)

// 八、开关关掉就不投递
writeFileSync(diaryPath(root), JSON.stringify({ at: Date.now() - 25 * HOUR, count: 2 }), 'utf8')
assert.equal(await nudgeDiary(a, root, { diary: false }), 0)

rmSync(root, { recursive: true, force: true })
console.log('diary tests: ok')
