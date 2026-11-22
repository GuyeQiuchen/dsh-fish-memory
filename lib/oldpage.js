/**
 * 旧页提醒模块：自包含，可整块删除。
 *
 * 解决的问题：页越存越多，开机块只塞得下十来条索引，越久远的东西越靠运气——
 * 除非当轮的话正好撞上关键词，否则想不起来去翻它。
 *
 * 这里给旧页一个固定的位置：每轮挑一张「最久没被碰过」的页，顶一行指针。
 * 只给指针不给正文——要看细节仍然调 mem_recall。
 *
 * 为什么不随机：随机会让同一张页反复冒头、另一些永远不冒。
 * 按「最久没碰」轮转，一直没翻就一直提醒；翻一次它就沉到后面。
 *
 * 模块化约定：删掉本文件、index.js 顶部那一行 import、boot 里那一段即可。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { readHits } from './heat.js'

/** 低于这个天数就不提，免得新页也被当成旧账。 */
const MIN_DAYS = 7

/** 只有一张够旧时，同一页两次提醒之间至少隔这么久。 */
const SPACING_MS = 24 * 60 * 60 * 1000

/** 轮转指针：记住上次顶过哪页，这次让开。 */
function cursorPath(root) {
  return path.join(String(root ?? ''), '.fish-memory', 'oldpage.json')
}

function readCursor(root) {
  try {
    const data = JSON.parse(readFileSync(cursorPath(root), 'utf8'))
    return { page: String(data?.page ?? ''), at: Number(data?.at ?? 0) }
  } catch {
    return { page: '', at: 0 }
  }
}

function writeCursor(root, page, now) {
  try {
    mkdirSync(path.dirname(cursorPath(root)), { recursive: true })
    writeFileSync(cursorPath(root), JSON.stringify({ page, at: now }), 'utf8')
  } catch {
    /* 记不下就下次可能重复，不算错 */
  }
}

/**
 * 列出记忆根里所有「记忆页」的相对路径。
 *
 * 只收子目录里的页。根目录那几个是元记忆——`SOUL.md` 是人设、`MEMORY.md` 是协议、
 * `index.md` 是目录、`log.md` 是流水，它们不是「久没翻过的旧记忆」，不该上榜。
 *
 * @param root - 记忆根。
 * @returns 相对路径数组。
 */
function listPages(root) {
  const out = []
  const walk = (dir, prefix) => {
    let items = []
    try {
      items = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items) {
      if (item.name.startsWith('.')) continue
      const rel = prefix === '' ? item.name : `${prefix}/${item.name}`
      if (item.isDirectory()) walk(path.join(dir, item.name), rel)
      else if (prefix !== '' && item.name.endsWith('.md')) out.push(rel)
    }
  }
  walk(String(root ?? ''), '')
  return out
}

/**
 * 一页的标题：取页头 title，没有就用文件名。
 * @param root - 记忆根。
 * @param rel - 页相对路径。
 * @returns 标题。
 */
function titleOf(root, rel) {
  try {
    const text = readFileSync(path.join(String(root ?? ''), rel), 'utf8')
    const match = /^title:\s*(.+)$/m.exec(text)
    if (match !== null) return String(match[1]).trim().slice(0, 30)
    const head = /^#\s+(.+)$/m.exec(text)
    if (head !== null) return String(head[1]).trim().slice(0, 30)
  } catch {
    /* 读不到就用文件名 */
  }
  return rel.replace(/\.md$/, '').split('/').pop().slice(0, 30)
}

/**
 * 拼一行旧页提醒。
 *
 * @param root - 记忆根。
 * @param config - 插件配置（读 oldPageDays）。
 * @param now - 当前时间戳，测试用。
 * @returns 一行文本；没有够旧的页、或者关掉了，都是空串。
 */
export function oldPageLine(root, config = {}, now = Date.now()) {
  if (config.oldPage === false) return ''
  const days = Number(config.oldPageDays ?? MIN_DAYS)
  if (!Number.isFinite(days) || days < 1) return ''
  const pages = listPages(root)
  if (pages.length === 0) return ''
  const hits = readHits(root, now)
  const cursor = readCursor(root)
  const ranked = []
  for (const rel of pages) {
    let when = Number(hits[rel]?.last ?? 0)
    if (!Number.isFinite(when) || when <= 0) {
      // 从没被翻过：拿文件最后修改时间兜底，别让新页一写出来就上榜
      try {
        when = statSync(path.join(String(root ?? ''), rel)).mtimeMs
      } catch {
        continue
      }
    }
    const age = now - when
    if (age < days * 24 * 60 * 60 * 1000) continue
    ranked.push({ rel, age })
  }
  if (ranked.length === 0) return ''
  ranked.sort((a, b) => b.age - a.age)
  // 只有一张够旧、而且刚顶过它：这一轮就不提，免得同一页每轮都冒头
  if (ranked.length === 1 && ranked[0].rel === cursor.page && now - cursor.at < SPACING_MS) return ''
  const pick = ranked.find((item) => item.rel !== cursor.page) ?? ranked[0]
  writeCursor(root, pick.rel, now)
  const ago = Math.max(1, Math.round(pick.age / (24 * 60 * 60 * 1000)))
  return `· 很久没翻过的旧页：${titleOf(root, pick.rel)}（${pick.rel}，${ago} 天没碰）——想起来就翻它一眼`
}
