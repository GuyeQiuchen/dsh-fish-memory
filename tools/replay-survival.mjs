#!/usr/bin/env node
/**
 * 约束存活核对 · 回放（只读）。
 *
 * 拿真实压缩的检查点做样本，比较「旧的 survival 切词」与「引擎切词」的判定。
 * 0.7.3 已按这批样本统一到引擎；legacy 实现留在本文件里只作对照，防以后回归。
 *
 * 用法：node tools/replay-survival.mjs --fixture ~/.dsh/fish-memory/replay/xxx.json
 * fixture 形如：{ source, summary, constraints: [{ seq, text, expected: 'kept'|'lost' }] }
 * expected 为人工标注；负例可用 summary 里不存在的词自造。
 */
import { readFileSync } from 'node:fs'
import { searchTerms, contentTerms } from '../lib/engine/api.js'
import { survivalCheck } from '../lib/survival.js'

const args = process.argv.slice(2)
const at = args.indexOf('--fixture')
const file = at >= 0 ? args[at + 1] : ''
if (!file) {
  console.error('用法：node tools/replay-survival.mjs --fixture <fixture.json>')
  process.exit(2)
}
const fixture = JSON.parse(readFileSync(file, 'utf8'))
const store = { config: { keywordCoverage: 0.6, survivalCoverage: 0.6 } }

// 已删除的旧实现：单字停用词 + 自切二元组。留着只当对照。
const LEGACY_STOP = new Set('的了我你他她它这那就都还要在有和与把被让给对从到于是但而所以因为如果吗呢吧啊哦嗯很太再又已更最不没会能可么什怎为以于将并且则其之也着过起来去得地是个些真挺好嘛呀'.split(''))
const legacyTerms = (text) => {
  const out = new Set()
  const str = String(text ?? '')
  for (const m of str.matchAll(/0x[0-9a-f]{2,6}/gi)) out.add(m[0].toLowerCase())
  for (const m of str.matchAll(/[A-Za-z][A-Za-z0-9_.\-]{2,}/g)) out.add(m[0].toLowerCase())
  for (const run of str.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const gram = run.slice(i, i + 2)
      if (LEGACY_STOP.has(gram[0]) || LEGACY_STOP.has(gram[1])) continue
      out.add(gram)
    }
  }
  return [...out]
}

const tokenizers = {
  'legacy（已删，仅对照）': legacyTerms,
  '现行（引擎 searchTerms）': (text) => searchTerms(text),
  '引擎 实义词': (text) => contentTerms(searchTerms(text)),
}

// 负例：把约束的投影行换成一串无关词，正确判定应为「丢了」
const negatives = fixture.constraints.map((item) => ({
  ...item,
  expected: 'lost',
  summary: `[块 seq ${item.seq}-${Number(item.seq) + 50} · 假] 词：天气 心情 无关 内容`,
}))

let bad = 0
for (const [name, tokenize] of Object.entries(tokenizers)) {
  const run = (summary, items) => survivalCheck(store, summary, items, '', tokenize ? { keywordTerms: tokenize } : {})
  const kept = run(fixture.summary, fixture.constraints)
  const lost = negatives.map((item) => run(item.summary, [item])[0])
  const keptOk = kept.filter((v) => v.kept).length
  const lostOk = lost.filter((v) => !v.kept).length
  const wrong = kept.filter((v) => !v.kept).length + lost.filter((v) => v.kept).length
  if (wrong > 0) bad += 1
  console.log(`${name.padEnd(18)} 正例判活 ${keptOk}/${kept.length} | 负例判丢 ${lostOk}/${lost.length} | 错 ${wrong}`)
  for (const v of kept.filter((x) => !x.kept)) console.log(`   ✗ 正例被判丢 seq ${v.seq}: ${String(v.text).slice(0, 40)}`)
  for (const v of lost.filter((x) => x.kept)) console.log(`   ✗ 负例被判活 seq ${v.seq}: ${String(v.text).slice(0, 40)}`)
}

console.log(`\n样本来源：${fixture.source}`)
console.log(`约束 ${fixture.constraints.length} 条（真实检查点） + ${negatives.length} 条（同位置假词负例）`)
if (bad === 0) console.log('三种切词在这批样本上完全一致。')
