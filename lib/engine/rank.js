/**
 * 检索引擎：给查询与页，排个序（纯函数，不读盘、不看配置）。
 *
 * 两种打分并存：bm25 是调用方默认，legacy 只在 bm25 抛错时兜底：
 *   legacy —— 与改造前逐字节一致（词种×2 + 命中行数，log.md 永远排最后）；
 *   bm25   —— idf + tf 饱和 + 长度归一 + 标题/小标题/整句加权（先验默认 1.0）。
 * 评测脚本调同一个入口；两种模式保留，是为了兜底可回退，不是让日常配置二选一。
 */
import { searchTerms } from './tokens.js'

/** frontmatter 与空行不算内容行。 */
const FRONTMATTER_NOISE = /^(title|tags|type|date|salience|last_access|summary|sources):|^---$|^\s*$/

/** 默认参数：k1/b 取常见值，boost 取评测里用过的那组。 */
export const DEFAULT_OPTIONS = {
  mode: 'legacy',
  k1: 1.2,
  b: 0.75,
  titleBoost: 3,
  headingBoost: 1.5,
  phraseBoost: 2,
  // 2026-11-28 实测：旧记忆页里「journal×0.8 最好」是旧分词下的结论；
  // 换成插件自己的分词、统一尺子重跑后，×0.8 反而把 @1 从 72 压到 70，
  // 所以默认不压低任何页，先验只留参数位。
  priors: { journal: 1, log: 1 },
  pickedLines: 2,
}

const isJournal = (rel) => rel.startsWith('journal/')
const isLog = (rel) => rel === 'log.md'

/** 一页的正文行（去掉 frontmatter 与空行）。 */
export function contentLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => !FRONTMATTER_NOISE.test(line.trim()))
}

/** 页标题与各级小标题，用于字段加权。 */
function headingsOf(text) {
  const out = { title: '', headings: [] }
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading === null) continue
    if (heading[1].length === 1) out.title = heading[2].trim()
    else out.headings.push(heading[2].trim())
  }
  return out
}

/**
 * 检索：返回命中的页（未排序的细节都在里面）。
 * @param query - 查询。
 * @param pages - `{ rel, text }[]`，由调用方读好传进来。
 * @param options - 见 DEFAULT_OPTIONS。
 * @returns `{ terms, hits }`；hits 已排序。
 */
export function rank(query, pages, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options, priors: { ...DEFAULT_OPTIONS.priors, ...(options.priors ?? {}) } }
  const terms = searchTerms(query)
  const list = Array.isArray(pages) ? pages : []
  if (terms.length === 0 || list.length === 0) return { terms, hits: [] }

  const hits = []
  for (const page of list) {
    const rel = String(page?.rel ?? '')
    if (rel === '' || rel === 'MEMORY.md' || rel === 'index.md') continue
    const text = String(page?.text ?? '')
    const lines = contentLines(text)
    const picked = []
    const matched = new Set()
    let count = 0
    for (let i = 0; i < lines.length; i += 1) {
      const lower = lines[i].toLowerCase()
      const lineHits = terms.filter((term) => lower.includes(term))
      if (lineHits.length === 0) continue
      for (const term of lineHits) matched.add(term)
      count += 1
      if (picked.length < config.pickedLines) picked.push(`${i + 1}: ${lines[i].trim().slice(0, 120)}`)
    }
    if (count === 0) continue
    const hit = { rel, count, matched: matched.size, matchedList: [...matched], score: matched.size * 2 + count, picked, text, lines }
    hits.push(hit)
  }

  if (config.mode === 'bm25') scoreBm25(hits, terms, config, String(query ?? '').toLowerCase())
  else for (const hit of hits) hit.score = hit.matched * 2 + hit.count

  // 时间线永远排在专题页后面（legacy 的老行为；bm25 靠 prior 压低但仍排最后）。
  hits.sort((a, b) => Number(isLog(a.rel)) - Number(isLog(b.rel)) || b.score - a.score || (a.rel < b.rel ? -1 : 1))
  for (const hit of hits) delete hit.text
  for (const hit of hits) delete hit.lines
  return { terms, hits }
}

/** 就地给 hits 打 BM25 分：idf + tf 饱和 + 长度归一 + 字段加权 + 先验。 */
function scoreBm25(hits, terms, config, phrase) {
  const total = hits.length
  const avgLen = hits.reduce((sum, hit) => sum + hit.lines.length, 0) / Math.max(1, total)
  const df = new Map()
  for (const term of terms) {
    let n = 0
    for (const hit of hits) if (hit.lines.some((line) => line.toLowerCase().includes(term))) n += 1
    df.set(term, n)
  }
  for (const hit of hits) {
    const length = hit.lines.length
    const norm = config.b === 1 ? 1 : 1 - config.b + config.b * (length / Math.max(1, avgLen))
    let score = 0
    for (const term of terms) {
      const n = df.get(term) ?? 0
      if (n === 0) continue
      const tf = hit.lines.filter((line) => line.toLowerCase().includes(term)).length
      if (tf === 0) continue
      const idf = Math.log(1 + total / (1 + n))
      score += idf * ((tf * (config.k1 + 1)) / (tf + config.k1 * norm))
    }
    const { title, headings } = headingsOf(hit.lines.join('\n'))
    const lowerTitle = title.toLowerCase()
    const lowerHeads = headings.map((heading) => heading.toLowerCase())
    const body = hit.lines.join('\n').toLowerCase()
    for (const term of hit.matchedList) {
      if (lowerTitle.includes(term)) score += config.titleBoost
      if (lowerHeads.some((heading) => heading.includes(term))) score += config.headingBoost
    }
    // 整句命中：查询原样出现在正文里，说明这页就是在讲这件事。
    if (phrase.length >= 2 && body.includes(phrase)) score += config.phraseBoost
    let prior = 1
    if (isJournal(hit.rel)) prior *= config.priors.journal
    if (isLog(hit.rel)) prior *= config.priors.log
    hit.score = score * prior
  }
}
