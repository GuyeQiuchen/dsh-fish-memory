/**
 * boot 里的展示行（2026-11-28 P3-S3a 从 index.js 搬出）。
 *
 * 只读：索引前 N 行、log 最近 N 条标题、近况页正文。
 * 不读配置以外的状态；`growthText` 目前不进 boot（见 index.js 的说明），
 * 只给 mem_status 报字数用。
 */
export function indexLines(store) {
    const index = store.read('index.md')
    if (!index) return []
    const rows = []
    for (const raw of index.split(/\r?\n/)) {
      const line = raw.trim()
      const m = line.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)\s*[—–-]+\s*(.*)$/)
      if (!m) continue
      if (/^(index|log|SOUL|MEMORY|BOOTSTRAP)\.md$/i.test(m[2])) continue
      const salience = Number((m[3].match(/salience:\s*(\d+)/) || [])[1] ?? 2)
      const summary = m[3].replace(/[（(]?salience:\s*\d+[)）]?/g, '').trim()
      rows.push({ title: m[1], path: m[2], summary, salience })
    }
    // 2026-11-28：同 salience 时**专题页优先于日记页**。
    // 原因：索引只有 10 行，日记页 salience 也是 2，按标题排会把 7 个位置全给 journal/*，
    // 把 projects/memory-engine、user/master 这些真正当路由用的页挤掉。
    const isJournal = (row) => String(row.path).startsWith('journal/')
    // 2026-11-28 主人定：10 行里 9 行给专题、1 行给最新的日记；
    // 专题页不够时用日记补满，没日记就全给专题，不让位置空着。
    const journalSlots = Math.max(0, Number(store.config.indexJournalSlots ?? 1))
    const sorted = [...rows].sort((a, b) => b.salience - a.salience || a.title.localeCompare(b.title))
    const topics = sorted.filter((row) => !isJournal(row))
    const journals = sorted
      .filter((row) => isJournal(row))
      .sort((a, b) => String(b.path).localeCompare(String(a.path)))
    const topicSlots = Math.max(0, store.config.maxIndexLines - journalSlots)
    const picked = [...topics.slice(0, topicSlots), ...journals.slice(0, journalSlots)]
    if (picked.length < store.config.maxIndexLines) {
      for (const row of [...topics.slice(topicSlots), ...journals.slice(journalSlots)]) {
        if (picked.length >= store.config.maxIndexLines) break
        picked.push(row)
      }
    }
    return picked
  }

export function logLines(store) {
    const log = store.read('log.md')
    if (!log) return []
    const heads = log.split(/\r?\n/).filter((l) => l.startsWith('## ['))
    return heads.slice(-store.config.maxLogEntries).map((l) => l.replace(/^##\s*/, ''))
  }

  // 「近况」：我最近在长成什么样。和索引不同，这里挑的是状态不是目录，
  // 读出来像记得自己，不像查表。有独立预算，不吃人格行和家规的字数
export function growthText(store) {
    const rel = store.config.growthPage
    if (!rel) return ''
    const raw = store.read(rel)
    if (!raw) return ''
    const body = raw.replace(/^---[\s\S]*?\n---\s*/, '').replace(/<!--[\s\S]*?-->/g, '')
    return body
      .split(/\r?\n/)
      .map((line) => (/^#{1,6}\s/.test(line.trim()) ? '' : line.replace(/^[-*]\s*/, '').trim()))
      .filter((line) => line && !/^相关[:：]/.test(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s+$/, '')
  }

