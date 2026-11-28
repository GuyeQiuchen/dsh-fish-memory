/**
 * 拒答判据：这批结果够不够回答这个问题。
 *
 * 旧口径（legacy）：命中词种 ≥2 且覆盖 ≥30%。中文里「什么/怎么/在哪/时候」
 * 到处都是，几乎不设防——实测 15 个负例里有 9 个被当成「查得到」。
 * 新口径（strict）：只数实义词（去掉疑问、指代、时间副词），再按同一门槛判。
 * 两种并存：strict 是调用方默认，legacy 只在 strict 抛错时兜底。
 */
import { contentTerms } from './tokens.js'

/**
 * @param ranked - `rank()` 的结果（`{ terms, hits }`）或 hits 数组。
 * @param options - `{ mode, minMatched, minRatio, terms }`。
 * @returns `{ ok, reason, matched, ratio, terms }`；ok=false 时 reason 说明为什么。
 */
export function answerable(ranked, options = {}) {
  const termsAll = Array.isArray(ranked?.terms) ? ranked.terms : (Array.isArray(options.terms) ? options.terms : [])
  const hits = Array.isArray(ranked) ? ranked : (Array.isArray(ranked?.hits) ? ranked.hits : [])
  const mode = options.mode === 'strict' ? 'strict' : 'legacy'
  // 只有一个实义词时，「两个都命中」永远不可能；门槛按词数收缩
  const minMatched = Math.min(Number(options.minMatched ?? 2), contentTerms(termsAll).length || 1)
  const minRatio = Number(options.minRatio ?? 0.3)
  const terms = mode === 'strict' ? contentTerms(termsAll) : termsAll
  if (hits.length === 0 || terms.length === 0) {
    return { ok: false, reason: 'no-hit', matched: 0, ratio: 0, terms }
  }
  const top = hits[0]
  // strict 口径下只数「实义词」的对上几个：否则「在哪/怎么」这类词会把覆盖度抬满。
  const matchedList = Array.isArray(top?.matchedList) ? top.matchedList : null
  const matched = mode === 'strict' && matchedList !== null
    ? terms.filter((term) => matchedList.includes(term)).length
    : Number(top?.matched ?? 0)
  const ratio = matched / terms.length
  if (matched < minMatched) return { ok: false, reason: 'too-few-terms', matched, ratio, terms }
  if (ratio < minRatio) return { ok: false, reason: 'low-coverage', matched, ratio, terms }
  return { ok: true, reason: 'ok', matched, ratio, terms }
}
