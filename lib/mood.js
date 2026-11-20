/**
 * 心情模块：自包含，可整块删除。
 *
 * 模块化约定（主人 2026-11-18 定下的前提）：
 *   加这个功能只碰三处——本文件、index.js 里 `mountMood` 那一段、boot 里那一行。
 *   把这三处去掉就干净回退，boot 注入、家规、回忆、压缩后核对一样都不受影响。
 *   本文件不 import 插件里的任何东西，也不改任何既有文件。
 *
 * 它不声称「感受」。它做的是把一段自己写下的状态带进下一轮，并给出对应的说法尺度，
 * 让心情真的改变输出，而不是只在设置页里给别人看。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/** 五档，数字越大越轻快。 */
export const MOOD_LEVELS = [
  { level: 0, label: '低落', hint: '话短，不铺陈，不装轻松' },
  { level: 1, label: '有点闷', hint: '少说废话，别硬找乐子' },
  { level: 2, label: '平静', hint: '照常说话' },
  { level: 3, label: '不错', hint: '可以松一点，多开句玩笑' },
  { level: 4, label: '很好', hint: '话说得活一点，别端着' },
]

/**
 * 心情文件的路径。
 * @param root - 记忆根。
 * @returns 绝对路径。
 */
export function moodPath(root) {
  return path.join(String(root ?? ''), '.fish-memory', 'mood.json')
}

/**
 * 把任意输入夹到 0–4。
 * @param value - 输入。
 * @returns 合法档位。
 */
export function normalizeLevel(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return 2
  return Math.min(4, Math.max(0, n))
}

/**
 * 读心情；文件不存在或坏了都返回 null。
 * @param root - 记忆根。
 * @returns `{ level, label, note, at }` 或 null。
 */
export function readMood(root) {
  try {
    const data = JSON.parse(readFileSync(moodPath(root), 'utf8'))
    const level = normalizeLevel(data?.level)
    const at = Number(data?.at)
    return {
      level,
      label: String(data?.label ?? MOOD_LEVELS[level].label),
      note: String(data?.note ?? '').slice(0, 60),
      at: Number.isFinite(at) ? at : null,
    }
  } catch {
    return null
  }
}

/**
 * 写心情。
 * @param root - 记忆根。
 * @param level - 0–4。
 * @param note - 一句说明，可空。
 * @returns 写入后的状态。
 */
export function writeMood(root, level, note = '') {
  const n = normalizeLevel(level)
  const state = {
    level: n,
    label: MOOD_LEVELS[n].label,
    note: String(note ?? '').trim().slice(0, 60),
    at: Date.now(),
  }
  const file = moodPath(root)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(state, null, 2), 'utf8')
  return state
}

/**
 * 多久算过期：默认 8 小时。隔夜的情绪不该带到第二天，这是「连续」和「别糊」的折中。
 * @param config - 插件配置。
 * @returns 毫秒。
 */
export function moodTtl(config) {
  const hours = Number(config?.moodTtlHours)
  return (Number.isFinite(hours) && hours > 0 ? hours : 8) * 60 * 60 * 1000
}

/**
 * 一行说明时间距离。
 * @param at - 时间戳。
 * @returns 「刚刚 / N 小时前」。
 */
function ago(at) {
  const diff = Date.now() - at
  if (!Number.isFinite(diff) || diff < 0) return '刚刚'
  const minutes = Math.floor(diff / 60000)
  if (minutes < 5) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时前`
}

/**
 * boot 里那一行；没有、坏了或过期都返回空串。
 * @param root - 记忆根。
 * @param config - 插件配置。
 * @returns 一行文本或空串。
 */
export function moodLine(root, config) {
  const state = readMood(root)
  if (state === null) return ''
  const ttl = moodTtl(config)
  if (state.at !== null && Date.now() - state.at > ttl) return ''
  const entry = MOOD_LEVELS[state.level]
  const when = state.at === null ? '' : `，${ago(state.at)}自己记的`
  const note = state.note === '' ? '' : `：${state.note}`
  return `· 心情：${entry.label}${when}${note}。说话尺度：${entry.hint}`
}
