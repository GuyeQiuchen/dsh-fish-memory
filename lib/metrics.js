/**
 * 召回度量模块：自包含，可整块删除。
 *
 * 为什么要有它：改召回逻辑之前，唯一的验收标准是"感觉好像不如以前"。
 * 记下调用次数和命中次数，至少能回答"改完是更容易查到，还是更容易查不到"。
 *
 * 模块化约定：删掉本文件、index.js 顶部那一行 import、recall 里那两行
 * bumpMetric、mem_status 里的 metricsLine 即可，其它功能不受影响。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** 计数文件位置。 */
function metricsPath(root) {
  return path.join(root, '.fish-memory', 'metrics.json')
}

/**
 * 读计数。读不到或坏了都当空的，绝不让度量把召回弄挂。
 * @param root - 记忆根。
 * @returns `{ [key]: 次数, at: 最后更新时间 }`。
 */
export function readMetrics(root) {
  try {
    const parsed = JSON.parse(readFileSync(metricsPath(root), 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * 把一个计数加一。
 * @param root - 记忆根。
 * @param key - 计数名，例如 recall / recallHit / hint。
 * @returns 加完之后的次数；写不进去就返回 0。
 */
export function bumpMetric(root, key) {
  const state = readMetrics(root)
  const next = Number(state[key] ?? 0) + 1
  state[key] = next
  state.at = new Date().toISOString()
  try {
    mkdirSync(path.dirname(metricsPath(root)), { recursive: true })
    writeFileSync(metricsPath(root), JSON.stringify(state, null, 2), 'utf8')
  } catch {
    return 0
  }
  return next
}

/**
 * 拼一行给人看的度量。
 * @param root - 记忆根。
 * @returns 一行文字；一次都没记过就是空串。
 */
export function metricsLine(root) {
  const state = readMetrics(root)
  const total = Number(state.recall ?? 0)
  const hint = Number(state.hint ?? 0)
  const used = Number(state.hintUsed ?? 0)
  const idle = Number(state.hintIdle ?? 0)
  const noise = hint > 0 ? `，其中 ${used} 次真去读了、${idle} 次没人碰` : ''
  if (total <= 0 && hint <= 0) return ''
  const hit = Number(state.recallHit ?? 0)
  const head = total > 0 ? `召回 ${total} 次，有结果 ${hit} 次（${Math.round((hit / total) * 100)}%）；` : ''
  return `${head}自动提示 ${hint} 次${noise}`
}
