/**
 * 压缩后核对（2026-11-28 P3-S3b 从 index.js 搬出）。
 *
 * 「压缩会不会把主人的硬约束挤丢」这一整套：读 must-keep 页、逐条核对
 * 检查点里的落点、记丢失、过期前在 boot 里念一次。
 * 只经 store 读写；阈值仍来自 store.config。
 */
import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { writeAtomic } from './fs-atomic.js'
import { flattenText } from './text.js'
import { searchTerms, contentTerms } from './engine/api.js'

const SEQ_LINE_RE = /seq\s+(\d+)(?:\s*-\s*(\d+))?/g
/**
 * 一条约束的关键词：直接用引擎的切词（2026-11-28 统一）。
 *
 * 原来这里另写了一套「二元组 + 单字停用词」，和 lib/engine/tokens.js 重复；
 * 用真实压缩样本（11 条真实约束 + 11 条假词负例）回放，两套判定完全一致，
 * 于是只留引擎这一份。回放工具：tools/replay-survival.mjs。
 */
function keywordTerms(text) {
  return contentTerms(searchTerms(text))
}

/** 摘要里覆盖某 seq 的那一行投影（区间最小的优先）；没有就返回空串 */
function coveringLine(summary, seq) {
  const target = Number(seq)
  if (!Number.isFinite(target)) return ''
  let best = ''
  let bestSpan = Infinity
  for (const line of String(summary ?? '').split(/\r?\n/)) {
    if (!line.includes('seq')) continue
    for (const match of line.matchAll(SEQ_LINE_RE)) {
      const start = Number(match[1])
      const end = match[2] === undefined ? start : Number(match[2])
      if (target < start || target > end) continue
      const span = end - start
      if (span < bestSpan) {
        bestSpan = span
        best = line
      }
    }
  }
  return best
}

  // 压缩之后核对：历史里主人说过的硬约束有没有被压丢
  // 家规不吃这个检查（它在 system 每轮重发），会被压掉的是历史里的「别那样」「以后都」。
export function lossPath(store) {
    return path.join(store.root, '.fish-memory', 'compaction-loss.json')
  }

export function mustKeepLines(store) {
    const rel = store.config.mustKeepPage
    if (!rel) return []
    const raw = store.read(rel)
    if (!raw) return []
    const body = raw.replace(/^---[\s\S]*?\n---\s*/, '').replace(/<!--[\s\S]*?-->/g, '')
    // 只认列表项：正文里的说明段不算约束
    return body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line))
      .map((line) => line.replace(/^[-*]\s+/, '').trim())
      .filter((line) => line && !/^相关[:：]/.test(line))
  }

/**
 * 这一行像不像「约束」：主人亲手打的、6–140 字、带命令口气。
 *
 * 2026-11-28 为什么精确到「别」：中文里 差别 / 别人 / 分别 / 特别 / 区别 都含「别」，
 * 旧正则把它们全当约束抓走，核对时自然判「丢了」——那是假警报，不是真丢。
 * 「不要害怕 / 别紧张」这类鼓励也不是约束。
 */
const CONSTRAINT_RE = /(不要|不许|不准|禁止|必须|记得|记住|以后|一律|只能|不可以|(?<![差别分特区域识个性])别(?!人))/
const ENCOURAGE_RE = /(?:不要|别)(?:害怕|紧张|担心|着急|灰心)/

export function looksLikeConstraint(text) {
  const value = String(text ?? '').trim()
  if (value.length < 6 || value.length > 140) return false
  if (/⚠|上次压缩可能压丢|压缩可能压丢/.test(value)) return false
  if (ENCOURAGE_RE.test(value)) return false
  return CONSTRAINT_RE.test(value)
}

export function termsOf(text) {
    return String(text ?? '')
      .split(/[，。；、：？！；.;:!?…\s（）()「」『』《》"'’‘“”]+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 4)
  }

export function survivalCheck(store, summaryText, constraints, extraText = '', options = {}) {
    const summary = String(summaryText ?? '')
    // 压缩是「摘要 + 保留区」两段，原话可能在保留区里没被压走，那就不算丢
    const reachable = `${summary}\n${String(extraText ?? '')}`
    return constraints.map((item) => {
      const seq = Number(item?.seq)
      // 1) 约束落在某一行投影上：按那一行核对关键词。投影引擎的远段只留词，
      //    整句比对必然判丢；「主题词还在不在这一行」才是它们能给的证据
      const line = coveringLine(summary, item.seq)
      if (line !== '') {
        const words = (typeof options.keywordTerms === 'function' ? options.keywordTerms : keywordTerms)(item.text)
        if (!words.length) return { text: item.text, seq, kept: line.includes(item.text) }
        const hit = words.filter((word) => line.includes(word)).length
        if (hit / words.length >= store.config.keywordCoverage) return { text: item.text, seq, kept: true }
        // 行内不够，不代表整段摘要没有：约束可能原样落在别的行（例如约束区）
        const slice = termsOf(item.text)
        if (slice.length) {
          const whole = slice.filter((term) => reachable.includes(term)).length
          if (whole / slice.length >= store.config.survivalCoverage) return { text: item.text, seq, kept: true }
        }
        return { text: item.text, seq, kept: false }
      }
      // 2) 找不到行（原文没被压，或引擎不写 seq 标记）：沿用整句切片的旧判据
      const terms = termsOf(item.text)
      if (!terms.length) return { text: item.text, seq, kept: reachable.includes(item.text) }
      const hit = terms.filter((term) => reachable.includes(term)).length
      return { text: item.text, seq, kept: hit / terms.length >= store.config.survivalCoverage }
    })
  }

  // 没被压走的那部分正文：拿不到就返回空串，退化成只查摘要
export function liveText(session, shadowed) {
    const gone = new Set(shadowed.map((seq) => Number(seq)))
    let events
    try {
      events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : session?.events
    } catch {
      return ''
    }
    if (!Array.isArray(events)) return ''
    const parts = []
    for (const ev of events) {
      if (gone.has(Number(ev?.seq))) continue
      if (ev?.type !== 'user/message') continue
      const kind = ev?.data?.source?.kind
      if (kind !== undefined && kind !== 'user') continue
      parts.push(flattenText(ev?.data))
    }
    return parts.join('\n')
  }

export function recordLoss(store, lost) {
    const file = store.lossPath()
    // 同一条约束再被报一次就 +1，不新增条目：次数本身就是信息
    const byText = new Map()
    try {
      const prev = JSON.parse(readFileSync(file, 'utf8'))
      for (const item of Array.isArray(prev?.lost) ? prev.lost : []) {
        const text = String(item?.text ?? '').trim()
        if (!text) continue
        const seqs = (Array.isArray(item?.seqs) ? item.seqs : []).map(Number).filter(Number.isFinite).slice(-3)
        byText.set(text, { text, count: Math.max(1, Number(item?.count) || 1), seqs })
      }
    } catch {}
    for (const item of lost) {
      const text = String(item?.text ?? '').trim().slice(0, 60)
      if (!text) continue
      const seq = Number(item?.seq)
      const row = byText.get(text)
      if (row) {
        row.count += 1
        if (Number.isFinite(seq) && !row.seqs.includes(seq)) row.seqs = [...row.seqs, seq].slice(-3)
      } else {
        byText.set(text, { text, count: 1, seqs: Number.isFinite(seq) ? [seq] : [] })
      }
    }
    const kept = [...byText.values()].sort((a, b) => b.count - a.count).slice(0, 5)
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeAtomic(file, JSON.stringify({ at: new Date().toISOString(), lost: kept }, null, 2))
    } catch {
      return 0
    }
    return kept.length
  }

export function clearLoss(store) {
    try {
      writeAtomic(store.lossPath(), JSON.stringify({ at: null, lost: [] }, null, 2))
    } catch {}
  }

export function lossWarning(store) {
    try {
      const data = JSON.parse(readFileSync(store.lossPath(), 'utf8'))
      const lost = Array.isArray(data?.lost) ? data.lost : []
      if (!lost.length) return ''
      // 过期就不再念：一条警告挂太久，我会学会无视它
      const at = Date.parse(String(data?.at ?? ''))
      const ttl = Number(store.config.warnMaxAgeMs)
      if (Number.isFinite(at) && Number.isFinite(ttl) && ttl > 0 && Date.now() - at > ttl) return ''
      return lost
        .map((item) => {
          const text = String(item?.text ?? '').trim()
          if (!text) return ''
          const count = Math.max(1, Number(item?.count) || 1)
          const seqs = (Array.isArray(item?.seqs) ? item.seqs : [])
            .map(Number)
            .filter(Number.isFinite)
            .slice(-2)
          const where = seqs.length ? `（seq ${seqs.join(',')}）` : ''
          return count > 1 ? `${text} +${count}${where}` : `${text}${where}`
        })
        .filter(Boolean)
        .join('；')
    } catch {
      return ''
    }
  }

