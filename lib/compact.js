/**
 * 压缩线模块：自包含，可整块删除。
 *
 * 解决的问题：压缩把原文折掉了，记忆体却不知道；两头各记各的，追溯要靠人找。
 * 这里只做一件事——去读压缩引擎留下的报告，把「上次压掉了哪段 seq」翻成一行。
 *
 * 为什么不反过来让引擎写进记忆库：两个包互相调用，任一边改名就静默失效。
 * 各写各的、这边只读那边已经写好的文件，坏了最多是这行不出现。
 *
 * 模块化约定：删掉本文件、index.js 顶部那一行 import、boot 里那一段即可。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/** 这条线只在压缩发生后这段时间内提；再久就该去翻记忆页了。 */
const FRESH_MS = 12 * 60 * 60 * 1000

/**
 * 压缩引擎的报告文件位置。没装引擎就没有这个文件。
 * @returns 绝对路径。
 */
function reportPath() {
  const home = String(process.env.DSH_HOME ?? '').trim() || path.join(homedir(), '.dsh')
  return path.join(home, 'fish-jiyu', 'last-report.json')
}

/**
 * 读最近一次压缩。读不到、坏了、引擎没装，都返回 null。
 * @returns `{ at, before, after, seqFrom, seqTo }` 或 null。
 */
export function lastCompaction() {
  try {
    const file = reportPath()
    if (!existsSync(file)) return null
    const list = JSON.parse(readFileSync(file, 'utf8'))
    const last = Array.isArray(list) ? list[0] : list
    if (last === null || typeof last !== 'object') return null
    return {
      at: String(last.at ?? ''),
      before: Number(last.before ?? 0),
      after: Number(last.after ?? 0),
      seqFrom: Number(last.seqFrom ?? 0),
      seqTo: Number(last.seqTo ?? 0),
    }
  } catch {
    return null
  }
}

/**
 * 拼成一行注入文本。
 * @returns 一行；没压过、刚压缩还没发生、或者太久了，都是空串。
 */
export function compactionLine() {
  const last = lastCompaction()
  if (last === null) return ''
  const when = Date.parse(last.at)
  if (!Number.isFinite(when)) return ''
  const age = Date.now() - when
  if (age < 0 || age > FRESH_MS) return ''
  const hours = Math.max(1, Math.round(age / 3600000))
  const about = hours < 2 ? '刚才' : `${hours} 小时前`
  const range = last.seqFrom > 0 && last.seqTo >= last.seqFrom ? `，盖住 seq ${last.seqFrom}-${last.seqTo}` : ''
  return `· 上次压缩在${about}${range}；那段是折过的，要原话按 seq 或 search 取回`
}
