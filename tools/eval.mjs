#!/usr/bin/env node
/**
 * 引擎评测（唯一一把尺子）：100 正例 + 15 负例 + 10 跨页。
 *
 * 用法：node tools/eval.mjs
 * 读 DSH_HOME（默认 ~/.dsh）下的 memory 根；数据在 tools/eval-*.json。
 * 只读，不写任何页。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rank } from '../lib/engine/rank.js'
import { answerable } from '../lib/engine/answerable.js'

const home = String(process.env.DSH_HOME ?? '').trim() || path.join(os.homedir(), '.dsh')
const root = path.join(home, 'memory')
const here = import.meta.dirname

function pageFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) { pageFiles(full, out); continue }
    if (!name.endsWith('.md')) continue
    if (/^(index|log|MEMORY|SOUL|BOOTSTRAP|AGENTS)\.md$/i.test(name)) continue
    out.push(full)
  }
  return out
}

const pages = pageFiles(root).map((file) => ({ rel: path.relative(root, file), text: fs.readFileSync(file, 'utf8') }))
function loadEvalSet(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, file), 'utf8'))
  } catch {
    console.error(`缺少评测集 ${file}：它含个人问题与页路径，不随包发布，只在开发机上存在。`)
    process.exit(2)
  }
}
const questions = loadEvalSet('eval-questions.json')
const extra = loadEvalSet('eval-extra.json')

function positive(mode) {
  let at1 = 0, at3 = 0, mrr = 0
  for (const item of questions) {
    const { hits } = rank(item.q, pages, { mode })
    const at = hits.findIndex((hit) => hit.rel === item.a)
    if (at === 0) at1 += 1
    if (at >= 0 && at < 3) at3 += 1
    if (at >= 0) mrr += 1 / (at + 1)
  }
  const n = questions.length
  return { at1: at1 / n, at3: at3 / n, mrr: mrr / n }
}

function negative(answerMode, rankMode = 'legacy') {
  let abstain = 0
  for (const query of extra.negatives) {
    const ranked = rank(query, pages, { mode: rankMode })
    if (!answerable(ranked, { mode: answerMode }).ok) abstain += 1
  }
  return abstain / extra.negatives.length
}

function crossAt3(mode) {
  let hit = 0
  for (const [query, expected] of extra.cross) {
    const { hits } = rank(query, pages, { mode })
    const top3 = hits.slice(0, 3).map((item) => item.rel)
    if (expected.some((rel) => top3.includes(rel))) hit += 1
  }
  return hit / extra.cross.length
}

const negLegacy = negative('legacy')
const negStrict = negative('strict')
const scores = {}
for (const mode of ['legacy', 'bm25']) {
  const p = positive(mode)
  scores[mode] = { ...p, cross: crossAt3(mode) }
  console.log(`${mode.padEnd(6)} 正例 @1 ${(p.at1 * 100).toFixed(0)}% | @3 ${(p.at3 * 100).toFixed(0)}% | MRR ${p.mrr.toFixed(3)} | 跨页@3 ${(scores[mode].cross * 100).toFixed(0)}%`)
}
console.log(`拒答   legacy ${(negLegacy * 100).toFixed(0)}% | strict ${(negStrict * 100).toFixed(0)}%（${extra.negatives.length} 个负例里判「查不到」的比例）`)

// 阈值：数字掉了就让脚本失败，别让「只打印」的评测看起来永远是绿的
const gates = [
  ['bm25 @1', scores.bm25.at1, 0.70],
  ['bm25 @3', scores.bm25.at3, 0.85],
  ['bm25 跨页@3', scores.bm25.cross, 0.85],
  ['strict 拒答', negStrict, 0.90],
]
let failed = 0
for (const [name, value, floor] of gates) {
  const ok = value >= floor
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${(value * 100).toFixed(0)}%（下限 ${(floor * 100).toFixed(0)}%）`)
}
if (failed > 0) {
  console.error(`\n${failed} 项低于下限`)
  process.exitCode = 1
}
