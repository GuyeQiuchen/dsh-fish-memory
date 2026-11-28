/**
 * 整理提醒模块：自包含，可整块删除。
 *
 * 模块化约定（主人 2026-11-18 定下的前提）：
 *   加这个功能只碰三处——本文件、index.js 里 boot 的那两行、mem_consolidate 里的 markTidy。
 *   把这三处去掉就干净回退，心情、家规、回忆、索引体检一样都不受影响。
 *   本文件不 import 插件里的任何东西，只读写 .fish-memory/tidy.json。
 *
 * 它解决什么：整理机制本身没有触发器——没人叫就不会整理。这里把「上次整理」
 * 记成一个时间点，每轮算一次是否到期，到期才在 boot 里顶一行。平时的常驻开销是零。
 *
 * 它不自己开分支（插件没有派子代理的能力，也不该有）：那一行是给模型的指令，
 * 由它决定要不要派、什么时候派。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/** 到期文案里的措辞，放一处好改。 */
const HINT = '先看 mem_drafts 有没有待处理草案；有就按 A/B/C 处理，没有就翻最近的记忆页'

/**
 * 状态文件的路径。
 * @param root - 记忆根。
 * @returns 绝对路径。
 */
export function tidyPath(root) {
  return path.join(String(root ?? ''), '.fish-memory', 'tidy.json')
}

/**
 * 读状态；文件不存在或坏了都返回 null。
 * @param root - 记忆根。
 * @returns `{ at, count }` 或 null。
 */
export function readTidy(root) {
  try {
    const data = JSON.parse(readFileSync(tidyPath(root), 'utf8'))
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
 * 打点：记下这次整理。
 * @param root - 记忆根。
 * @returns 写入后的状态。
 */
export function markTidy(root) {
  const previous = readTidy(root)
  const state = { at: Date.now(), count: (previous?.count ?? 0) + 1 }
  const file = tidyPath(root)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(state, null, 2), 'utf8')
  return state
}

/**
 * 多久算该整理一次：默认 24 小时。
 * @param config - 插件配置。
 * @returns 毫秒。
 */
export function tidyInterval(config) {
  const hours = Number(config?.tidyHours)
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000
}

/**
 * 是否到期。没整理过也算到期（新装的一直没整理，更该提）。
 * @param root - 记忆根。
 * @param config - 插件配置。
 * @returns `{ due, first, hoursSince, count }`。
 */
export function tidyDue(root, config) {
  const state = readTidy(root)
  const span = tidyInterval(config)
  if (state === null || state.at === null) return { due: true, first: true, hoursSince: null, count: 0 }
  const gap = Date.now() - state.at
  return { due: gap >= span, first: false, hoursSince: Math.floor(gap / 3600000), count: state.count }
}

/**
 * boot 里那一段；没到期返回空串。
 *
 * 到期时不再只说一句「该整理了」，而是把工作单的摘要一起带出来：
 * 材料就在眼前，模型这一轮就能直接动手，不用先调一次工具再等下一轮。
 * 下次到期以「上次自动生成草案 / mem_consolidate 打点」的时间算。
 *
 * @param root - 记忆根。
 * @param config - 插件配置。
 * @param brief - 工作单摘要（可空，空就只给一句怎么做）。
 * @returns 多行文本或空串。
 */
export function tidyLine(root, config, brief = '') {
  const info = tidyDue(root, config)
  if (!info.due) return ''
  const hours = Math.round(tidyInterval(config) / 3600000)
  const body = String(brief ?? '').trim()
  const lines = []
  if (info.first) {
    // 刚装好、还没整理过：第一次先把骨架立稳，别急着往里堆东西。
    lines.push('· 【自动整理·首次】装好记忆体先做这一次：立索引、定页的边界，之后才是往里填')
  } else {
    lines.push(`· 【自动整理】距上次整理 ${info.hoursSince} 小时，满 ${hours} 小时要做一次。这一轮先整理，再干别的`)
  }
  if (body === '') lines.push(`  ${HINT}`)
  else for (const line of body.split(/\r?\n/)) lines.push(`  ${line.trim()}`)
  return lines.join('\n')
}
