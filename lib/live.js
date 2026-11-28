/**
 * 共享流水：多个会话（窗口）之间「刚才在干什么」的横向通道。
 *
 * 2026-11-25 为什么要有：主人会同时开两个窗口交替说话，各自看不到对方——
 * 一个窗口刚装完插件，另一个窗口毫不知情。记忆页是纵向的（按天写），
 * 这里要的是横向的（同一时刻，别的会话在做什么）。
 *
 * 三条约定：
 *   1. 一轮一行，只写在 turn/end；不记工具调用，否则文件会变成第二份日志；
 *   2. 只留最近 200 行，老的滚掉；
 *   3. **不进 boot**。这行会随对方每轮变化，放进前缀就是按别人的节奏打断缓存；
 *      要读就用 mem_live 主动读，结果落在当前轮尾部。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { withLock } from './lock.js'

/** 流水文件名（放在记忆根的 .fish-memory 下，和 mood.json 做邻居）。 */
export const LIVE_FILE = 'live.jsonl'
/** 最多留多少行。 */
export const MAX_LINES = 200
/** 话题最多多少字。 */
export const TOPIC_CHARS = 60
/** 这些开头的不是主人真正说的话：定时提醒、系统注入，写进流水只会添噪声。 */
const NOISE = /^\s*\[(?:SCHEDULE|schedule|SCHEDULE CHANGE|记忆体|dsh-ui reply?\.)/

/** 这段文字是不是系统注入（不是主人说的）。外面记「这一轮在说什么」时也要用。 */
export function isNoiseTopic(text) {
  return NOISE.test(String(text ?? ''))
}

/** 流水文件路径；root 为空时返回空串（调用方自己判断，别写到一个猜出来的地方）。 */
export function livePath(root) {
  const base = String(root ?? '').trim()
  if (base === '') return ''
  return path.join(base, '.fish-memory', LIVE_FILE)
}

/** 会话 id 取前 8 位，够区分又不会让每行变长。 */
export function shortSession(session) {
  return String(session ?? '').replace(/^session-/, '').slice(0, 8)
}

/** 把一行话题压成一句：折掉换行和多余空白，超长截断。 */
export function clipTopic(text, max = TOPIC_CHARS) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (clean === '') return ''
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/**
 * 追加一行。
 * @param root - 记忆根。
 * @param entry - `{ session, seq, topic, at? }`。
 * @param max - 保留多少行。
 * @returns 写入的行，或 null（没内容就不写）。
 */
export function appendLive(root, entry, max = MAX_LINES) {
  const file = livePath(root)
  if (file === '') return null
  const raw = String(entry?.topic ?? '')
  if (isNoiseTopic(raw)) return null
  const topic = clipTopic(raw)
  if (topic === '') return null
  const row = {
    at: Number(entry?.at ?? Date.now()),
    session: shortSession(entry?.session),
    seq: Math.max(0, Number(entry?.seq ?? 0)),
    topic,
  }
  mkdirSync(path.dirname(file), { recursive: true })
  // 2026-11-25 错峰：以前每轮重写整份文件，两个窗口同时写就可能互相覆盖。
  // 现在只做追加（追加是原子的），只有行数超上限时才在锁内重写一次。
  return withLock(root, 'live', () => {
    const rows = readLiveRows(file)
    const last = rows[rows.length - 1]
    if (last !== undefined && shortSession(last.session) === row.session && last.topic === row.topic) return null
    if (rows.length + 1 > Math.max(1, max)) {
      const trimmed = rows.slice(-(Math.max(1, max) - 1))
      trimmed.push(row)
      writeFileSync(file, `${trimmed.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8')
      return row
    }
    appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8')
    return row
  }).result ?? null
}

/** 读原始行；坏行跳过，不让一行手写的脏数据毁掉整份流水。 */
function readLiveRows(file) {
  if (!existsSync(file)) return []
  const out = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      const row = JSON.parse(line)
      // 读的时候也滤一遍：旧版本把系统提醒写进来过，那些行还躺在文件里
      if (typeof row?.topic === 'string' && row.topic !== '' && !NOISE.test(row.topic)) out.push(row)
    } catch {
      /* 坏行跳过 */
    }
  }
  return out
}

/**
 * 读流水，最新的在前。
 * @param root - 记忆根。
 * @param options - `{ exclude, limit }`：exclude 是要过滤掉的会话 id。
 * @returns `{ session, seq, topic, at }[]`。
 */
export function readLive(root, { exclude = '', limit = 8 } = {}) {
  const file = livePath(root)
  if (file === '') return []
  const skip = shortSession(exclude)
  const rows = readLiveRows(file)
  const filtered = skip === '' ? rows : rows.filter((row) => shortSession(row.session) !== skip)
  return filtered.slice(-Math.max(1, limit)).reverse()
}
