/**
 * 整理工作单（可删的小模块）。
 *
 * 整理记忆这件事，判断只能由模型做：哪两条是同一件事、哪条过时了、哪句该并进哪页。
 * 所以这里不替它做决定，只把要判断的材料一次摆齐：最近的 log 条目、现有页面、
 * 索引里有和没有的对照。这样整理就不再靠"哪天想起来翻一翻"。
 *
 * 只读：不写任何文件。
 * 模块化：删掉本文件、index.js 里 mem_consolidate 那一段、test/consolidate.mjs 即可回退。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'

const FRONT = /^---[\s\S]*?\n---\s*/

/**
 * 把 log.md 按日期切成条目。
 * @param raw - log.md 全文。
 * @returns `{ date, title, body }[]`。
 */
export function parseLog(raw) {
  const out = []
  const lines = String(raw ?? '').split(/\r?\n/)
  let current = null
  for (const line of lines) {
    const head = /^##\s+(.+)$/.exec(line)
    if (head !== null) {
      if (current !== null) out.push(current)
      const title = head[1].trim()
      const dateMatch = /^\[?(\d{4}-\d{2}-\d{2})\]?/.exec(title)
      current = { date: dateMatch === null ? '' : dateMatch[1], title, body: [] }
      continue
    }
    if (current !== null) current.body.push(line)
  }
  if (current !== null) out.push(current)
  return out.map((item) => ({ date: item.date, title: item.title, body: item.body.join('\n').trim() }))
}

/**
 * 递归列出记忆根里的 .md 页面（不含根部的几个大文件）。
 * @param root - 记忆根。
 * @returns `{ path, mtime, chars }[]`。
 */
export function listPages(root) {
  const out = []
  const skipRoot = new Set(['index.md', 'log.md', 'SOUL.md', 'MEMORY.md', 'BOOTSTRAP.md'])
  const walk = (dir, rel) => {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        walk(full, relPath)
        continue
      }
      if (!entry.name.endsWith('.md')) continue
      if (rel === '' && skipRoot.has(entry.name)) continue
      try {
        const stat = statSync(full)
        out.push({ path: relPath, mtime: stat.mtimeMs, chars: readFileSync(full, 'utf8').length })
      } catch {
        /* 读不到就跳过 */
      }
    }
  }
  walk(String(root ?? ''), '')
  return out.sort((a, b) => b.mtime - a.mtime)
}

/**
 * 读索引里登记过的页面路径。
 * @param root - 记忆根。
 * @returns 路径集合。
 */
export function indexedPaths(root) {
  const file = path.join(String(root ?? ''), 'index.md')
  if (!existsSync(file)) return new Set()
  const text = readFileSync(file, 'utf8')
  const out = new Set()
  for (const match of text.matchAll(/\]\(([^)\s]+\.md)\)/g)) {
    const cleaned = String(match[1]).replace(/^\.\//, '')
    if (!cleaned.startsWith('http')) out.add(cleaned)
  }
  return out
}

/**
 * 生成整理工作单。
 * @param root - 记忆根。
 * @param options - `{ days, maxLog }`。
 * @returns `{ window, logEntries, pages, unindexed, stale, hints }`。
 */
export function buildWorklist(root, options = {}) {
  const days = Math.max(1, Number(options.days) || 7)
  const maxLog = Math.max(1, Number(options.maxLog) || 60)
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  let logRaw = ''
  try {
    logRaw = readFileSync(path.join(String(root ?? ''), 'log.md'), 'utf8')
  } catch {
    logRaw = ''
  }
  const entries = parseLog(logRaw.replace(FRONT, ''))
  const inWindow = entries.filter((item) => {
    if (item.date === '') return false
    const at = Date.parse(`${item.date}T23:59:59`)
    return Number.isFinite(at) && at >= since
  })
  const logEntries = (inWindow.length > 0 ? inWindow : entries.slice(-maxLog)).slice(-maxLog).map((item) => ({
    date: item.date,
    title: item.title.replace(/^\[[^\]]*\]\s*/, ''),
    chars: item.body.length,
  }))
  const pages = listPages(root)
  const indexed = indexedPaths(root)
  const unindexed = pages.filter((page) => !indexed.has(page.path)).map((page) => page.path)
  const staleDays = 30
  const stale = pages
    .filter((page) => Date.now() - page.mtime > staleDays * 24 * 60 * 60 * 1000)
    .map((page) => page.path)
  const hints = []
  if (logEntries.length >= 20) hints.push(`这段时间 log 有 ${logEntries.length} 条，先合并同类再写`)
  if (unindexed.length > 0) hints.push(`有 ${unindexed.length} 个页面没进索引，值得的补进 index.md`)
  if (stale.length > 0) hints.push(`有 ${stale.length} 个页面超过 ${staleDays} 天没动，确认还要不要留`)
  return {
    window: { days, since: new Date(since).toISOString() },
    logEntries,
    pages: pages.map((page) => ({ path: page.path, chars: page.chars })),
    unindexed,
    stale,
    hints,
  }
}
