/**
 * alarm 开关的测试：alarm:false 时不该碰 schedule 服务；alarm:true 时才挂任务。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === '' ? '' : `  ${detail}`}`)
  if (!ok) failures += 1
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fishmem-alarm-'))

function makeCtx(state) {
  return {
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') state.disposers.push(dispose)
    },
    on(event, cb) {
      state.listeners.push({ event, cb })
      return () => {}
    },
    get(name) {
      state.gets.push(name)
      if (name === 'schedule') return state.schedule
      return undefined
    },
    systemPrompt: { context() { return () => {} } },
    tools: { register() { return () => {} } },
  }
}

function makeSchedule(state) {
  return {
    list: async () => ({ items: [] }),
    create: async (arg) => {
      state.created.push(arg)
      return { id: `task-${state.created.length}` }
    },
    update: async () => ({}),
    run: async () => ({}),
  }
}

// 1) alarm:false —— 不碰 schedule，也不该注册任何会去建任务的监听
{
  const state = { gets: [], created: [], listeners: [], disposers: [] }
  state.schedule = makeSchedule(state)
  apply(makeCtx(state), { memoryRoot: root, alarm: false })
  const touched = state.gets.filter((name) => name === 'schedule').length
  check('alarm:false 不取 schedule 服务', touched === 0, `实际取了 ${touched} 次`)
  // 即便真收到会话事件，也不该建任务
  for (const { event, cb } of state.listeners) {
    if (event === 'session/event') {
      try {
        cb({ id: 'session-fake', eventAt: () => undefined }, { type: 'turn/end' })
      } catch {
        /* 缺字段的假会话允许抛 */
      }
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 60))
  check('alarm:false 没有建任务', state.created.length === 0, `建了 ${state.created.length} 条`)
}

// 2) alarm:true —— 收到第一个会话事件时挂任务
{
  const state = { gets: [], created: [], listeners: [], disposers: [] }
  state.schedule = makeSchedule(state)
  apply(makeCtx(state), { memoryRoot: root, alarm: true })
  for (const { event, cb } of state.listeners) {
    if (event === 'session/event') {
      try {
        cb({ id: 'session-fake', eventAt: () => undefined }, { type: 'turn/start' })
      } catch {
        /* 缺字段的假会话允许抛 */
      }
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 80))
  check('alarm:true 会挂任务', state.created.length > 0, `建了 ${state.created.length} 条`)
  const titles = state.created.map((item) => String(item?.title ?? ''))
  check('挂的是叫醒/整理两条', titles.length >= 2, JSON.stringify(titles))
}

try {
  fs.rmSync(root, { recursive: true, force: true })
} catch {
  /* 清不掉不影响结论 */
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`)
process.exitCode = failures === 0 ? 0 : 1
