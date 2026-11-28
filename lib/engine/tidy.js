/**
 * 整理引擎：把零散 log 条目归组，产出一份「草案」（纯函数，不写页）。
 *
 * 铁律：只出草案，不写页。判断归模型，引擎只把「像同一件事的几条」摆到一起，
 * 每条都带原 seq，方便点回去核。写盘由调用方做。
 */

/** 把 log.md 按 `## 标题` 切成条目。 */
export function parseLogEntries(raw) {
  const out = []
  let current = null
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const head = /^##\s+(.+)$/.exec(line)
    if (head !== null) {
      if (current !== null) out.push(current)
      const rawTitle = head[1].trim()
      const dateMatch = /^\[?(\d{4}-\d{2}-\d{2})\]?/.exec(rawTitle)
      // 2026-11-28：标题里要的是「话题」，不是日期和 note 前缀。
      // 不清掉的话所有条目都带 「note |」，相似度全被这词拉高，51 条会并成 1 组。
      const title = rawTitle.replace(/^\[?\d{4}-\d{2}-\d{2}\]?\s*/, '').replace(/^note\s*[|｜]\s*/i, '').trim()
      current = { date: dateMatch === null ? '' : dateMatch[1], title, rawTitle, body: [] }
      continue
    }
    if (current !== null) current.body.push(line)
  }
  if (current !== null) out.push(current)
  return out.map((item) => ({ date: item.date, title: item.title, body: item.body.join('\n').trim() }))
}

/** 标题的词集合（二元组），用于算相似度。 */
/** 标题里的通用词：出现在几乎每条上，参与相似度只会把不相干的条目并在一起。 */
const GENERIC_TITLE_WORDS = new Set(['note', '补充', '记录', '备注', '日志'])

export function titleGrams(title) {
  const out = new Set()
  for (const run of String(title ?? '').toLowerCase().match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const gram = run.slice(i, i + 2)
      if (GENERIC_TITLE_WORDS.has(gram)) continue
      out.add(gram)
    }
  }
  for (const word of String(title ?? '').toLowerCase().match(/[a-z][a-z0-9_.-]{1,}/g) ?? []) {
    if (GENERIC_TITLE_WORDS.has(word)) continue
    out.add(word)
  }
  return out
}

/** Jaccard 相似度。 */
export function jaccard(a, b) {
  const left = a instanceof Set ? a : titleGrams(a)
  const right = b instanceof Set ? b : titleGrams(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const item of left) if (right.has(item)) shared += 1
  return shared / (left.size + right.size - shared)
}

/**
 * 归组并出力草案。
 * @param input - `{ entries, pages, now, minGroup, maxSpanDays, threshold }`
 *   entries: parseLogEntries 的结果；pages: `{ rel, text }[]`（可选，用于找归属页）；
 *   now: 毫秒时间戳（默认 Date.now，测试可注入）。
 * @returns `{ groups, drafts, conflicts, unowned }`
 */
export function draftConsolidation(input = {}) {
  const entries = Array.isArray(input.entries) ? input.entries : []
  const pages = Array.isArray(input.pages) ? input.pages : []
  const minGroup = Math.max(1, Number(input.minGroup ?? 3))
  const maxSpanDays = Math.max(1, Number(input.maxSpanDays ?? 30))
  const threshold = Math.min(1, Math.max(0, Number(input.threshold ?? 0.5)))
  const grams = entries.map((entry) => titleGrams(entry.title))

  // 1) 按标题相似度连通（并查集），同一主题的条目聚在一起
  const parent = entries.map((_, index) => index)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[rb] = ra }
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      if (jaccard(grams[i], grams[j]) >= threshold) union(i, j)
    }
  }
  const buckets = new Map()
  for (let i = 0; i < entries.length; i += 1) {
    const root = find(i)
    if (!buckets.has(root)) buckets.set(root, [])
    buckets.get(root).push(i)
  }

  // 2) 够格才出草案：一组 ≥ minGroup 条，且首尾日期跨度不超过 maxSpanDays
  const groups = []
  const unowned = []
  for (const indices of buckets.values()) {
    const dates = indices.map((i) => entries[i].date).filter(Boolean).sort()
    const spanDays = dates.length === 0 ? 0 : Math.round((Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86400000)
    const items = indices.map((i) => ({ index: i, ...entries[i] }))
    if (items.length < minGroup || spanDays > maxSpanDays) unowned.push(...items)
    else groups.push({ items, spanDays })
  }

  // 3) 草案：同题只留最新（标 ×N），其余并进去；冲突（同标题不同正文）单独列
  const drafts = []
  const conflicts = []
  for (const group of groups) {
    const byTitle = new Map()
    for (const item of group.items) {
      const key = item.title.replace(/^\[?\d{4}-\d{2}-\d{2}\]?\s*/, '')
      if (!byTitle.has(key)) byTitle.set(key, [])
      byTitle.get(key).push(item)
    }
    for (const [title, list] of byTitle) {
      const sorted = [...list].sort((a, b) => String(b.date).localeCompare(String(a.date)))
      const latest = sorted[0]
      const bodies = new Set(sorted.map((item) => item.body.trim()))
      if (bodies.size > 1) conflicts.push({ title, dates: sorted.map((item) => item.date), bodies: sorted.map((item) => item.body.trim()) })
      drafts.push({
        title,
        date: latest.date,
        count: sorted.length,
        body: latest.body,
        sources: sorted.map((item) => ({ date: item.date, title: item.title })),
        page: bestPage(title, pages),
      })
    }
  }
  const changes = changeTable(entries, groups.map((group) => group.items.map((item) => item.index)))
  return { groups: groups.length, drafts, conflicts, changes, unowned }
}

/**
 * 「事实令牌」：版本号、十六进制、4 位以上的数字（年份除外）。
 * 只收「会随时间被替换」的值——路径/URL 多半是一次性引用，列进变更表只会变成噪声
 * （实测真实 log 里第一条变更就是一条 URL）。
 */
export function factTokens(text) {
  const out = new Set()
  const str = String(text ?? '')
  for (const m of str.matchAll(/\b\d+(?:\.\d+){1,3}\b/g)) out.add(m[0])
  for (const m of str.matchAll(/\b0x[0-9a-f]{2,}\b/gi)) out.add(m[0].toLowerCase())
  for (const m of str.matchAll(/\b\d{4,}\b/g)) {
    // 4 位数字多半是年份或计数，不当「事实值」；日期里已经带过了
    if (/^(19|20)\d{2}$/.test(m[0])) continue
    out.add(m[0])
  }
  return [...out]
}

/**
 * 变更表（区块 A）：同一个令牌在组里出现过几次、最后一次是哪天。
 * 只报告「值变过」的位置；不判断哪条对——那是模型的事。
 * @param entries - `{ date, title, body }[]`
 * @param groups - draftConsolidation 里归好的组（元素是 index 数组）
 * @returns `{ title, token, first, last, dates, sources }[]`，按 last 倒序。
 */
export function changeTable(entries, groups) {
  const rows = []
  for (const indices of groups) {
    const items = indices.map((i) => entries[i]).filter(Boolean)
    const dates = [...new Set(items.map((item) => item.date).filter(Boolean))].sort()
    // 组里只有一天，说明没有「新旧可比」，不列
    if (dates.length < 2) continue
    const newest = dates[dates.length - 1]
    const byToken = new Map()
    for (const item of items) {
      for (const token of factTokens(`${item.title}\n${item.body}`)) {
        if (!byToken.has(token)) byToken.set(token, [])
        byToken.get(token).push({ date: item.date, title: item.title })
      }
    }
    for (const [token, hits] of byToken) {
      // 每条都出现的值没变过，不算变更
      if (hits.length >= items.length && items.length > 1) continue
      const seen = [...new Set(hits.map((hit) => hit.date).filter(Boolean))].sort()
      // 没有日期的值说不清「什么时候变的」，列出来只会渲染成 undefined
      if (seen.length === 0) continue
      const last = seen[seen.length - 1]
      rows.push({
        title: items.map((item) => item.title).sort((a, b) => String(b).localeCompare(String(a)))[0],
        token,
        times: hits.length,
        first: seen[0],
        last,
        // 最新那天还在用的值标 latest；只在旧日期出现的标 stale（可能已过期）
        status: last === newest ? 'latest' : 'stale',
        sources: hits.map((hit) => `${hit.date} ${hit.title}`),
      })
    }
  }
  return rows.sort((a, b) => (a.status === b.status ? String(b.last).localeCompare(String(a.last)) : a.status === 'latest' ? -1 : 1))
}

/** 粗归属：标题二元组与页正文交集最多的那一页（没有就空串）。 */
function bestPage(title, pages) {
  const grams = titleGrams(title)
  let best = ''
  let bestScore = 0
  for (const page of pages) {
    const text = String(page?.text ?? '').toLowerCase()
    let score = 0
    for (const gram of grams) if (text.includes(gram)) score += 1
    if (score > bestScore) { bestScore = score; best = String(page?.rel ?? '') }
  }
  return best
}

/**
 * 草案转成 markdown：A 变更表（引擎算的，不判断对错）、B 同题簇、C 冲突。
 * 模型只负责在 A/B/C 之上写结论与取舍；写页仍由调用方做。
 */
export function draftMarkdown(result) {
  const lines = ['# 整理草案', '']
  const changes = Array.isArray(result?.changes) ? result.changes : []
  lines.push('## A. 变更表（引擎算的；只说明「哪个值在什么时候变过」，不判断对错）')
  if (changes.length === 0) lines.push('（没有跨日期变化的版本号/路径/数字）')
  else {
    lines.push('| 话题 | 值 | 位置 | 首次 | 最近 | 出现 |')
    lines.push('|---|---|---|---|---|---|')
    for (const row of changes) {
      lines.push(`| ${row.title} | ${row.token} | ${row.status === 'latest' ? '最新' : '旧值'} | ${row.first} | ${row.last} | ${row.times} |`)
    }
  }
  lines.push('')
  lines.push('## B. 同题簇（同题只留最新；旧值请折成指针而不是删掉）')
  for (const draft of result?.drafts ?? []) {
    lines.push(`### ${draft.title}${draft.count > 1 ? ` ×${draft.count}` : ''}`)
    lines.push(`- 归属页：${draft.page === '' ? '（未定）' : draft.page}`)
    lines.push(`- 来源：${draft.sources.map((source) => `${source.date} ${source.title}`).join('；')}`)
    lines.push('')
    lines.push(draft.body)
    lines.push('')
  }
  lines.push('## C. 需人工判断（同题不同正文）')
  if ((result?.conflicts ?? []).length === 0) lines.push('（无）')
  for (const conflict of result?.conflicts ?? []) {
    lines.push(`- ${conflict.title}：${conflict.dates.join('、')}`)
  }
  return lines.join('\n')
}
