/**
 * 家规（2026-11-28 P3-S2 从 index.js 搬出）。
 *
 * 读写都经 store 传进来；模块自己不读配置，也不碰 ctx。
 * 注入区的格式见 identity/house-rules.md：`<!-- rules:start --> … <!-- rules:end -->`。
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { writeAtomic } from './fs-atomic.js'
import { today } from './day.js'
import { clip } from './text.js'

  /**
   * 家规条目：一行一条，也兼容老写法（一行里用「；」连好几条）。
   * 2026-11-24 为什么拆出来：以前 addRule 用「；」把条目拼回一行，
   * 新加的规矩没有编号，看着像挤进上一条里；主人指出应分行加编号。
   * @returns 去掉编号后的条目数组。
   */
export function ruleItems(store) {
    const rel = typeof store.config.rulesPage === 'string' ? store.config.rulesPage.trim() : ''
    if (!rel) return []
    const raw = store.read(rel)
    if (!raw) return []
    const marked = raw.match(/<!--\s*rules:start\s*-->([\s\S]*?)<!--\s*rules:end\s*-->/i)
    const body = marked ? marked[1] : raw.replace(/^\uFEFF?---[\s\S]*?\n---\s*/, '')
    const out = []
    for (const line of body.split(/\r?\n/)) {
      for (const part of line.split('；')) {
        const item = part.trim().replace(/^\d+[.、)]\s*/, '').replace(/[；;。]\s*$/u, '').trim()
        if (item && !item.startsWith('#')) out.push(item)
      }
    }
    return out
  }

export function rulesText(store) {
    // 一条一行、带编号：挤成一句时，第 3 条以后就分不清哪句是哪条。
    return store.ruleItems().map((item, i) => `${i + 1}. ${item}`).join('\n')
  }

  /**
   * 家规是「；」连成的一长句，几十条糊成一片谁也看不见
   * 每 N 条折一行，缩进对齐，字一个不少，只是排开
   * @param text - rulesText 的结果
   * @param perLine - 每行几条
   * @returns 折好行的文本
   */
export function wrapRules(text, perLine = 6) {
    if (String(text ?? '').includes('\n')) return String(text)
    const items = String(text ?? '')
      .split('；')
      .map((item) => item.trim())
      .filter(Boolean)
    if (items.length <= perLine) return items.join('；')
    const lines = []
    for (let i = 0; i < items.length; i += perLine) lines.push(items.slice(i, i + perLine).join('；'))
    return `\n  ${lines.join('\n  ')}`
  }

  /**
   * 按行装家规：装不下就停，补一句省略，不切断单条。
   * @param max - 字符上限。
   * @returns 多行文本。
   */
export function fitRules(store, max) {
    const lines = store.rulesText().split('\n').filter((line) => line.trim() !== '')
    const out = []
    let used = 0
    for (const line of lines) {
      if (used + line.length + 1 > max) {
        // 首条就装不下：至少给半句；后面装不下才用省略号，别把家规整段吞掉
        if (out.length === 0) out.push(clip(line, Math.max(1, max)))
        else out.push('…[截断]')
        break
      }
      out.push(line)
      used += line.length + 1
    }
    return out.join('\n')
  }

export function rulesStatus(store) {
    const chars = store.ruleItems().join('；').replace(/\s+/g, '').length
    const max = store.config.maxRulesChars
    return {
      status: 'ok',
      page: store.config.rulesPage,
      chars,
      max,
      headroom: max - chars,
      entries: store.ruleItems().length,
      truncated: chars > max,
    }
  }

export function addRule(store, input = {}) {
    const short = String(input.short ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[；;。]+$/u, '')
    const raw = String(input.raw ?? '').trim().slice(0, 300)
    if (!short) return { status: 'rejected', reason: 'short 不能为空' }
    const maxLen = store.config.maxRuleChars
    if (short.length > maxLen) {
      return { status: 'rejected', reason: `short 有 ${short.length} 字，超过 ${maxLen}，先压成短语` }
    }
    const rel = store.config.rulesPage
    let text = store.read(rel)
    if (!text) {
      const skeleton = [
        '---',
        'title: 家规',
        `date: ${today()}`,
        'type: identity',
        'salience: 1',
        'tags: [rules, speech]',
        'summary: 主人纠正过的说话规矩；rules 区每轮注入，修正记录留档。',
        '---',
        '',
        '# 家规',
        '',
        '<!-- rules:start -->',
        '',
        '<!-- rules:end -->',
        '',
        '## 口癖修正记录（append-only）',
        '',
        '| 日期 | 被纠正的 | 改成 |',
        '|---|---|---|',
        '',
      ].join('\n')
      mkdirSync(path.dirname(store.file(rel)), { recursive: true })
      writeAtomic(store.file(rel), skeleton)
      store.cache.delete(store.file(rel))
      text = skeleton
    }
    const marked = text.match(/<!--\s*rules:start\s*-->([\s\S]*?)<!--\s*rules:end\s*-->/i)
    if (!marked) return { status: 'rejected', reason: '缺少 rules:start / rules:end 标记' }
    const entries = store.ruleItems()
    if (entries.includes(short)) return { status: 'duplicate', rule: short, chars: entries.join('；').length }
    const items = entries.length ? [...entries, short] : [short]
    const nextBody = items.map((item, i) => `${i + 1}. ${item}`).join('\n')
    // 预算按「条目文字 + 分隔符」算，不把编号算进去——编号是排版，不是内容。
    const chars = items.join('；').replace(/\s+/g, '').length
    const over = chars > store.config.maxRulesChars
    if (over && !input.force) {
      return {
        status: 'over_budget',
        reason: '注入区会超预算，先合并旧条目或调大 maxRulesChars',
        wouldBe: chars,
        max: store.config.maxRulesChars,
        headroom: store.config.maxRulesChars - entries.join('；').length,
      }
    }
    let next = text.replace(marked[0], `<!-- rules:start -->\n${nextBody}\n<!-- rules:end -->`)
    next = pushRuleRow(next, short, raw)
    writeAtomic(store.file(rel), next)
    store.cache.delete(store.file(rel))
    return {
      status: 'ok',
      rule: short,
      chars,
      max: store.config.maxRulesChars,
      headroom: store.config.maxRulesChars - chars,
      overBudget: over,
    }
  }

export function pushRuleRow(text, short, raw) {
    const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
    const row = `| ${today()} | ${cell(raw || short)} | ${cell(short)} |`
    const lines = text.split(/\r?\n/)
    let headingAt = -1
    for (let i = 0; i < lines.length; i++) {
      if (/^##\s*口癖修正记录/.test(lines[i].trim())) {
        headingAt = i
        break
      }
    }
    if (headingAt < 0) {
      return `${text.replace(/\s*$/, '')}\n\n## 口癖修正记录（append-only）\n\n| 日期 | 被纠正的 | 改成 |\n|---|---|---|\n${row}\n`
    }
    let last = -1
    for (let i = headingAt + 1; i < lines.length && !/^##\s/.test(lines[i].trim()); i++) {
      if (lines[i].trim().startsWith('|')) last = i
    }
    if (last < 0) return text
    lines.splice(last + 1, 0, row)
    return lines.join('\n')
  }

