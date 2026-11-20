/**
 * 记忆热度模块：自包含，可整块删除。
 *
 * 模块化约定（主人 2026-11-18 定下的前提）：
 *   加这个功能只碰三处——本文件、index.js 里 queryHint 那一段、boot 里那段 try。
 *   把三处去掉就干净回退，检索、心情、家规一样都不受影响。
 *   本文件不 import 插件里的任何东西，只读写 .fish-memory/hits.json。
 *
 * 它解决什么：注入多少要看主人提过几次。第一次提起只给一句指针，提得越多给得越足，
 * 提到多次就近乎全文——常用的页自己会涨出来，冷门的页始终只占一行。
 *
 * 半衰期：七天没提起，热度减半。免得三个月前问过一次的东西一直按「常聊」对待。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/** 七天没提就减半。 */
const DECAY_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 热度文件的路径。
 * @param root - 记忆根。
 * @returns 绝对路径。
 */
export function hitsPath(root) {
  return path.join(String(root ?? ''), '.fish-memory', 'hits.json')
}

/**
 * 读热度表；文件不存在或坏了都当空的。
 * @param root - 记忆根。
 * @param now - 当前时间戳，测试用。
 * @returns `{ [页]: { count, last } }`。
 */
export function readHits(root, now = Date.now()) {
  let data = null
  try {
    data = JSON.parse(readFileSync(hitsPath(root), 'utf8'))
  } catch {
    return {}
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return {}
  const out = {}
  for (const [rel, raw] of Object.entries(data)) {
    const count = Number(raw?.count)
    const last = Number(raw?.last)
    if (!Number.isFinite(count) || count <= 0) continue
    if (!Number.isFinite(last)) continue
    // 超过半衰期就减半，最低到 1：冷却但不至于忘干净。
    const decay = last > 0 && now - last > DECAY_MS ? Math.max(1, Math.floor(count / 2)) : count
    out[rel] = { count: decay, last }
  }
  return out
}

/**
 * 记一次「提起」。
 * @param root - 记忆根。
 * @param rel - 页相对路径。
 * @param now - 当前时间戳。
 * @returns 记完之后这一页的热度。
 */
export function bumpHit(root, rel, now = Date.now()) {
  const key = String(rel ?? '').trim()
  if (key === '') return 0
  const table = readHits(root, now)
  const prev = table[key]?.count ?? 0
  const next = prev + 1
  table[key] = { count: next, last: now }
  try {
    mkdirSync(path.dirname(hitsPath(root)), { recursive: true })
    writeFileSync(hitsPath(root), JSON.stringify(table, null, 2), 'utf8')
  } catch {
    /* 写不出就当没热度，提示照样出，只是不涨 */
  }
  return next
}

/**
 * 某一页现在的热度（不记新的一次）。
 * @param root - 记忆根。
 * @param rel - 页相对路径。
 * @param now - 当前时间戳。
 * @returns 次数，没有就是 0。
 */
export function hitCount(root, rel, now = Date.now()) {
  const table = readHits(root, now)
  return table[String(rel ?? '').trim()]?.count ?? 0
}
