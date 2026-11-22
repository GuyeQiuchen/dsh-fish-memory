/**
 * 日记提醒模块：自包含，可整块删除。
 *
 * 模块化约定（跟 tidy.js 一样）：
 *   加它只碰几处——本文件、index.js 里 boot 一行和建任务一行、alarm.js 里的
 *   ensureDiaryAlarm / nudgeDiary 两段。
 *   把这几处去掉就干净回退，整理、心情、家规、回忆都不受影响。
 *   本文件不 import 插件里的任何东西，只读写 .fish-memory/diary.json。
 *
 * 和整理的区别（主人 2026-11-21 定）：
 *   - 到期判定和整理同构：距上次写完满 diaryHours（默认 24）就到期。
 *   - 每天一份、每天新写一页，页名按当天日期。
 *   - **整理没做完就不写**：日记要写在整理完之后，不然会写到还没归位的材料上。
 *     所以投递前先问一次 tidyDue，该整理还没整理就往后让，下一次检查再说。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/** 状态文件：上次写完的时间。 */
export function diaryPath(root) {
  return path.join(String(root ?? ''), '.fish-memory', 'diary.json')
}

/**
 * 读状态；没有或坏了都返回 null。
 * @param root - 记忆根。
 * @returns `{ at, count }` 或 null。
 */
export function readDiary(root) {
  try {
    const data = JSON.parse(readFileSync(diaryPath(root), 'utf8'))
    const at = Number(data?.at)
    const count = Number(data?.count)
    return {
      at: Number.isFinite(at) ? at : null,
      count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
    }
  } catch {
    return null
  }
}

/**
 * 打点：记下这篇日记写完了。
 * @param root - 记忆根。
 * @returns 写入后的状态。
 */
export function markDiary(root) {
  const previous = readDiary(root)
  const state = { at: Date.now(), count: (previous?.count ?? 0) + 1 }
  const file = diaryPath(root)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(state, null, 2), 'utf8')
  return state
}

/**
 * 多久算该写一篇：默认 24 小时。
 * @param config - 插件配置。
 * @returns 毫秒。
 */
export function diaryInterval(config) {
  const hours = Number(config?.diaryHours)
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000
}

/**
 * 是否到期。没写过也算到期。
 * @param root - 记忆根。
 * @param config - 插件配置。
 * @returns `{ due, first, hoursSince, count }`。
 */
export function diaryDue(root, config) {
  const state = readDiary(root)
  const span = diaryInterval(config)
  if (state === null || state.at === null) return { due: true, first: true, hoursSince: null, count: 0 }
  const gap = Date.now() - state.at
  return { due: gap >= span, first: false, hoursSince: Math.floor(gap / 3600000), count: state.count }
}

/**
 * 今天这篇日记该写在哪个页：`journal/YYYY-MM-DD.md`，一天一份。
 * @param now - 毫秒时间戳，默认此刻。
 * @returns 记忆根下的相对路径。
 */
export function diaryPageOf(now = Date.now()) {
  const d = new Date(now)
  const pad = (n) => String(n).padStart(2, '0')
  return `journal/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`
}

/**
 * boot 里那一段；没到期返回空串。
 * @param root - 记忆根。
 * @param config - 插件配置。
 * @returns 一行文本或空串。
 */
export function diaryLine(root, config) {
  const info = diaryDue(root, config)
  if (!info.due) return ''
  const hours = Math.round(diaryInterval(config) / 3600000)
  const page = diaryPageOf()
  if (info.first) {
    return `· 【日记·首次】还没写过日记。等这次记忆整理做完再写第一篇，落在 ${page}；先跟主人说一句「我写日记去了」，写完调 mem_diary`
  }
  return `· 【日记】距上一篇 ${info.hoursSince} 小时，满 ${hours} 小时写一篇。今天这篇落在 ${page}，写完调 mem_diary`
}
