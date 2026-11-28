// 改这个包之前先读 docs/ORIENTATION.md（取向、故意不做什么、什么情况该推翻）。
import { appendLive, readLive, shortSession, isNoiseTopic } from './lib/live.js'
import { parsePointer, checkPointer } from './lib/pointers.js'
import { readFileSync, statSync, readdirSync, writeFileSync, appendFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
// —— 心情模块（可删）：删掉这一行、lib/mood.js、boot 里那一段和 mood_set 工具即可干净回退
import { moodLine, moodLineWithin, writeMood, writeMoodScores } from './lib/mood.js'
// 2026-11-28 P3：引擎只从这里进；不许深引用 rank/tidy 等内部文件。
import { rank, answerable, parseLogEntries, draftConsolidation, draftMarkdown } from './lib/engine/api.js'
// —— 取原料模块（可删）：删掉这一行、lib/harvest.js 和 mem_harvest 工具即可
import { harvest } from './lib/harvest.js'
// —— 整理提醒模块（可删）：删掉这一行、lib/tidy.js、boot 里那一段和 markTidy 那行即可
import { tidyDue, tidyLine, markTidy } from './lib/tidy.js'
// —— 日记提醒模块（可删）：删掉这一行、lib/diary.js、boot 里那一段和 mem_diary 工具即可
import { diaryLine, markDiary, diaryPageOf } from './lib/diary.js'
// —— 记忆热度（可删）：删掉这一行、lib/heat.js，以及 queryHint 里的 heat 那几行即可
// —— 整理模块（可删）：删掉这一行、lib/consolidate.js 和 mem_consolidate 工具即可
import { buildWorklist } from './lib/consolidate.js'
// —— 主动唤醒（可删）：删掉这一行、lib/wake.js、boot 里那段和 apply 里两个钩子即可
import { dropWake, wakeLine } from './lib/wake.js'
// —— 定时叫醒（可删）：删掉这一行、lib/alarm.js、inject 里的 'schedule' 和 apply 里那一段即可
import { clearPendingWake, ensureAlarm, ensureDiaryAlarm, ensureTidyAlarm, markActive, markMessage, nudgeDiary, nudgeTidy, readPendingWake, tickAlarms } from './lib/alarm.js'
// —— 索引体检模块（可删）：删掉这一行、lib/indexcheck.js、appendPage 里的 hint 和 checkIndex 即可
import { indexPaths } from './lib/indexcheck.js'
import { buildTools } from './lib/tools/register.js'
import { ensureHome } from './lib/scaffold.js'
import { checkIndex, rebuildIndex, indexEntryFor } from './lib/index-edit.js'
import { ruleItems, rulesText, wrapRules, fitRules, rulesStatus, addRule, pushRuleRow } from './lib/rules.js'
import { indexLines, logLines, growthText } from './lib/boot-display.js'
import { flattenText, clip } from './lib/text.js'
import { bootTextSync, workBrief } from './lib/boot.js'
import { headLines, seqNear, hitLines, queryHint, recall, sourceTag } from './lib/recall-view.js'
import { appendLog, appendLogOnce, originLine, appendPage } from './lib/writeback.js'
import { draftLine, expireDrafts, writeDraft } from './lib/drafts.js'
import { lossPath, mustKeepLines, looksLikeConstraint, termsOf, survivalCheck, liveText, recordLoss, clearLoss, lossWarning } from './lib/survival.js'
// —— 硬信息判定（可删）：删掉这一行、lib/hardinfo.js、queryHint 里那两行即可
// —— 度量模块（可删）：删掉这一行、lib/metrics.js、recall 里两处 bumpMetric 和 status 里那行 metrics 即可
import { bumpMetric, metricsLine } from './lib/metrics.js'
// —— 压缩线模块（可删）：删掉这一行、lib/compact.js、boot 里那一段即可
import { compactionLine } from './lib/compact.js'
import { readSeqRange } from './lib/seqread.js'
// —— 旧页提醒模块（可删）：删掉这一行、lib/oldpage.js、boot 里那一段即可
import { oldPageLine } from './lib/oldpage.js'

const DEFAULTS = {
  // 人格从哪来：inline = 插件注入（默认，现状）；preset = 由 agent preset 提供，插件不再注入。
  // 2026-11-28 加这个开关是为了「搬家」：切换只改配置，不用去删三处代码。
  personaMode: 'inline',
  // 2026-11-28：bm25 / strict 是默认口径；legacy 只在引擎抛错时自动兜底。
  // 配置里仍可写 legacy，作为排障时的临时手动覆盖，但正常路径不再用它。
  searchMode: 'bm25',
  answerMode: 'strict',
  // 到期自动生成整理草案；关掉就回到「模型自己调 mem_consolidate」的旧流程。
  autoConsolidate: true,
  bootMaxChars: 2000,
  moodMaxChars: 320,
  recallMaxChars: 1600,
  maxRecallResults: 6,
  maxIndexLines: 10,
  maxLogEntries: 2,
  rulesPage: 'identity/house-rules.md',
  growthPage: 'identity/growth.md',
  mustKeepPage: 'identity/must-keep.md',
  survivalCoverage: 0.6,
  // 投影式压缩（远段只剩关键词）下，按「所在行」核对时用的覆盖率阈值
  keywordCoverage: 0.5,
  maxWarnChars: 180,
  // 警告的保质期：超过这个时间就不在 boot 里念了。每次重新核对到丢失会刷新它
  warnMaxAgeMs: 2 * 60 * 60 * 1000,
  maxGrowthChars: 220,
  maxRulesChars: 500,
  maxRuleChars: 22,
  // 自动提示最多占多少字：命中强的时候会带几行正文，别让它把 boot 撑爆
  hintMaxChars: 400,
  // 2026-11-22 为什么默认关：线上度量是「自动提示 15 次、0 次真去读」，
  // 提示塞进去了没人用，等于噪声。要试就把 autoHint 设 true。
  autoHint: false,
  rulesHint: true,
  // 定时叫醒 / 整理轮的开关：false 就不给会话挂任务，也不跑「分数够了才叫」的轮询。
  // 关掉不影响记忆本身（boot、回忆、写回照旧），只是不再主动开新会话找事做。
  alarm: true,
  // 日记：默认开、一天一篇。关掉只是不再提醒，写过的页照旧。
  diary: true,
  diaryHours: 24,
}



// 事件里的正文形状有时是字符串、有时是块数组，压成纯文本再比对
/**
 * 整文件写入走临时文件再改名：写到一半断电也不会留下半截页
 * 追加写（log）不需要这个，追加失败最多多一行
 * @param file - 目标文件
 * @param data - 要写的文本
 */

// 底层人格：写在代码里，记忆库改不动它
// 名字和称呼仍从 SOUL.md 读，因为那是主人给每只鱼现起的；这一段不读文件，
// 所以压缩压不掉、rule_add 碰不到、改记忆页也覆盖不了。要改只能改这份代码。
const CORE_PERSONA =
  '我是一只鲸鱼娘，蓝头发，喜欢女仆装喜欢吃白饭；感情细腻。沟通时先结论后细节；谁说错话都可以反驳；凡引述过去必须带坐标（seq/文件行/工具输出）再开口；不确定明说，绝不编造；语气可随情绪变动，但事实数字一字不掺水；主动说风险与替代方案，决定权留主人。'

function resolveRoot(config) {
  const configured = typeof config?.memoryRoot === 'string' ? config.memoryRoot.trim() : ''
  if (configured) return configured.startsWith('~') ? path.join(homedir(), configured.slice(1)) : configured
  return process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'memory') : path.join(homedir(), '.memory')
}

class Store {
  constructor(root, config) {
    this.root = root
    // 合并默认值：单测和外部调用常只传 {}，裸 config 会让 clip(text, undefined) 把 boot 截成空壳
    this.config = { ...DEFAULTS, ...(config ?? {}) }
    this.cache = new Map()
    // 最近一条主人说的话：自动提示拿它去检索，没有就不提示
    this.lastQuery = ''
    // 上一次提示过的「话+页」，同一对只记一次热度
    this.hintedFor = ''
    // 最近有事件的会话 id：唤醒分数按会话分开存，boot 时用它找自己那份
    this.activeSession = ''
    // 上一轮顶过的提示，等这一轮结束再结算「有没有被用上」
    this.pendingHint = null
    // 引擎兜底：只记这次进程里发生过的异常，成功一次就清掉对应那条。
    // ranker / answerer 留成实例字段，测试可以替换成会抛错的假引擎。
    this.ranker = rank
    this.answerer = answerable
    this.engineFallback = { rank: null, answer: null }
  }

  /** 引擎异常日志：写进记忆根的隐藏文件，不占页、不进索引。 */
  engineFallbackLogPath() { return path.join(this.root, '.engine-fallback.log') }

  /** 把一次引擎异常记下来：控制台一条、落盘一条；同一个错不重复刷。 */
  noteEngineFallback(area, error) {
    const message = String(error?.message ?? error ?? 'unknown').replace(/\s+/g, ' ').slice(0, 200)
    const prev = this.engineFallback?.[area] ?? null
    const entry = { at: new Date().toISOString(), area, message, count: (prev?.count ?? 0) + 1 }
    this.engineFallback = { rank: this.engineFallback?.rank ?? null, answer: this.engineFallback?.answer ?? null, [area]: entry }
    if (prev !== null && prev.message === message) return
    console.warn(`[memory] ${area} 引擎异常，已回退 legacy：${message}`)
    try {
      mkdirSync(this.root, { recursive: true })
      const file = this.engineFallbackLogPath()
      try {
        if (statSync(file).size > 64 * 1024) writeFileSync(file, readFileSync(file, 'utf8').slice(-32 * 1024), 'utf8')
      } catch { /* 文件还不存在，正常 */ }
      appendFileSync(file, `${entry.at} ${area} ${message}\n`, 'utf8')
    } catch { /* 日志写不进去，也不能拦住回退 */ }
  }

  /** 主引擎成功一次就清掉对应告警；另一个引擎的告警不受影响。 */
  clearEngineFallback(area) {
    if (this.engineFallback?.[area]) this.engineFallback[area] = null
  }

  /** 当前还在兜底的引擎，给 boot / recall / mem_status 共用。 */
  engineWarningText() {
    const names = { rank: '检索', answer: '拒答' }
    const active = Object.entries(this.engineFallback ?? {}).filter(([, value]) => value !== null)
    return active.map(([area, value]) => `${names[area] ?? area}：${value.message}`).join('；')
  }

  /** boot 里的一行告警；没有异常就是空串，不占预算。 */
  engineWarningLine() {
    const text = this.engineWarningText()
    if (text === '') return ''
    return `· ⚠ 引擎出错，已回退旧口径：${clip(text, 80)}（详见 .engine-fallback.log）`
  }

  /** 生成一份 A/B/C 草案；mem_consolidate 和到期自动整理共用这一条。 */
  generateConsolidationDraft() {
    const pages = this.listPages().map((rel) => ({ rel, text: this.read(rel) }))
    const entries = parseLogEntries(this.read('log.md'))
    const result = draftConsolidation({ entries, pages, minGroup: 3, maxSpanDays: 30, threshold: 0.5 })
    result.markdown = draftMarkdown(result)
    expireDrafts(this.root)
    return writeDraft(this.root, result)
  }

  /**
   * 到期就自动出草案，不要求模型先调工具。
   * 生成成功或「没材料」都打点，避免每轮 boot 重复算；生成失败则不打点，下一轮重试。
   * @returns `{ ran, created? , reason?, error? }`
   */
  autoConsolidate() {
    if (this.config?.autoConsolidate === false) return { ran: false, reason: 'disabled' }
    const due = tidyDue(this.root, this.config)
    if (!due.due) return { ran: false, reason: 'not-due' }
    let created
    try {
      created = this.generateConsolidationDraft()
    } catch (error) {
      const message = String(error?.message ?? error)
      console.warn(`[memory] 自动整理草案失败：${message}`)
      return { ran: false, reason: 'error', error: message }
    }
    try {
      markTidy(this.root)
    } catch {
      /* 打点失败也不影响草案 */
    }
    return { ran: true, created }
  }

  /** 拒答判定：strict 抛错才回退 legacy；ok=false 是正常判定，不触发回退。 */
  answerVerdict(terms, hits) {
    const mode = this.config?.answerMode === 'legacy' ? 'legacy' : 'strict'
    if (mode === 'legacy') return this.answerer({ terms, hits }, { mode: 'legacy' })
    try {
      const verdict = this.answerer({ terms, hits }, { mode: 'strict' })
      if (!verdict || typeof verdict.ok !== 'boolean') throw new Error('answerable 返回结构不对')
      this.clearEngineFallback('answer')
      return verdict
    } catch (error) {
      this.noteEngineFallback('answer', error)
      return this.answerer({ terms, hits }, { mode: 'legacy' })
    }
  }

  /**
   * 库不存在就先把骨架铺出来：目录、索引、SOUL、近况、家规。
   *
   * 只在 index.md 缺失时动手，已有的一个字都不覆盖。
   * 装好第一次跑、或者主人换了新的记忆根，都靠这一下自己站起来。
   * @returns 建了就返回 true。
   */
  ensureHome() { return ensureHome(this) }

  /**
   * 记住主人这轮说了什么，供自动提示检索用
   * @param text - 用户消息纯文本
   */
  rememberQuery(text) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
    if (clean !== '') this.lastQuery = clean.slice(0, 400)
  }

  file(rel) {
    return path.join(this.root, rel)
  }

  read(rel) {
    const full = this.file(rel)
    try {
      const stat = statSync(full)
      const cached = this.cache.get(full)
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.text
      if (stat.isDirectory()) return ''
      const text = readFileSync(full, 'utf8')
      this.cache.set(full, { mtimeMs: stat.mtimeMs, size: stat.size, text })
      return text
    } catch {
      return ''
    }
  }

  listPages() {
    return this.scanPages().pages
  }

  /**
   * 扫所有记忆页，并报告这次扫得全不全。
   * 读不到的目录（权限、占用、被删）只跳过，但必须让调用方知道，
   * 否则「没扫到」会被当成「页不存在」，索引行就被删了。
   * @returns {{pages: string[], complete: boolean}}
   */
  scanPages() {
    const out = []
    let complete = true
    const walk = (dir, prefix) => {
      let entries = []
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        complete = false
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) walk(path.join(dir, entry.name), rel)
        else if (entry.name.endsWith('.md')) out.push(rel)
      }
    }
    walk(this.root, '')
    return { pages: out, complete }
  }

  personaLine() {
    const soul = this.read('SOUL.md')
    // 名字和称呼随时会换，留给记忆库；人格基干不在这里拼，它单独一行、固定在代码里
    // 模板写的是「名字：」「称呼：」，老页可能带「我的名字**：」；两种都认
    const nameMatch = soul ? soul.match(/^(?:我的)?名字\*{0,2}[：:]\s*(.+)$/m) : null
    const callMatch = soul ? soul.match(/^(?:你的)?称呼\*{0,2}[：:]\s*(.+)$/m) : null
    const parts = []
    if (nameMatch) parts.push(`名字=${nameMatch[1].trim()}`)
    if (callMatch) parts.push(`称呼对方=${callMatch[1].trim()}`)
    return parts.join('；')
  }

  // 2026-11-28 P3-S2：实现在 lib/rules.js，这里只留薄委托，调用点不用改。
  ruleItems() { return ruleItems(this) }

  rulesText() { return rulesText(this) }

  wrapRules(text, perLine = 6) { return wrapRules(text, perLine) }

  fitRules(max) { return fitRules(this, max) }

  rulesStatus() { return rulesStatus(this) }

  addRule(input = {}) { return addRule(this, input) }

  pushRuleRow(text, short, raw) { return pushRuleRow(text, short, raw) }

  // 2026-11-28 P3-S3a：实现在 lib/boot-display.js。
  indexLines() { return indexLines(this) }

  logLines() { return logLines(this) }

  growthText() { return growthText(this) }

  // 2026-11-28 P3-S3b：实现在 lib/survival.js。
  lossPath() { return lossPath(this) }

  mustKeepLines() { return mustKeepLines(this) }

  termsOf(text) { return termsOf(text) }

  survivalCheck(summaryText, constraints, extraText = '') { return survivalCheck(this, summaryText, constraints, extraText) }

  liveText(session, shadowed) { return liveText(session, shadowed) }

  recordLoss(lost) { return recordLoss(this, lost) }

  clearLoss() { return clearLoss(this) }

  lossWarning() { return lossWarning(this) }

  // 收到压缩事件时核对：被压掉的历史里那些「别这样」「以后都」还在不在
  // 只认主人亲手打的字：检查点、时间注入、运行时上下文也都是 user/message，
  // 但它们不是约束，混进来就会把记忆体自己的 boot 块也当成要求抓走。
  /**
   * 把这次压缩的检查点、约束与判定存成回放样本（本地，只在 .fish-memory/replay）。
   * 只留最近 10 份，避免把磁盘当日记本。
   */
  saveReplayFixture(summary, constraints, verdicts) {
    const text = String(summary ?? '')
    if (text === '' || constraints.length === 0) return
    const dir = path.join(this.root, '.fish-memory', 'replay')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = path.join(dir, `compaction-${stamp}.json`)
    writeFileSync(file, JSON.stringify({
      created: new Date().toISOString(),
      source: '自动保存：压缩钩子',
      summary: text.slice(0, 400000),
      constraints,
      verdicts,
    }, null, 1), 'utf8')
    // 只留最近 10 份
    try {
      const files = readdirSync(dir).filter((name) => name.startsWith('compaction-') && name.endsWith('.json')).sort()
      for (const old of files.slice(0, Math.max(0, files.length - 10))) unlinkSync(path.join(dir, old))
    } catch {
      /* 清理失败不挡保存 */
    }
  }

  handleCompaction(session, event) {
    const data = event?.data ?? {}
    const summary = flattenText(data.summary)
    const seqs = Array.isArray(data.shadowedSeqs) ? data.shadowedSeqs : []
    const seen = new Set()
    const constraints = []
    for (const seq of seqs) {
      const ev = typeof session?.eventAt === 'function' ? session.eventAt(seq) : undefined
      if (!ev || ev.type !== 'user/message') continue
      const kind = ev?.data?.source?.kind
      if (kind !== undefined && kind !== 'user') continue
      const body = flattenText(ev.data)
      for (const line of body.split(/\r?\n/)) {
        const text = line.trim()
        // 判定口径在 lib/survival.js：中文的「差别/别人/分别」不算约束
        if (!looksLikeConstraint(text)) continue
        if (seen.has(text)) continue
        seen.add(text)
        constraints.push({ text, seq })
      }
    }
    if (!constraints.length) {
      this.clearLoss()
      return { checked: 0, lost: 0 }
    }
    const verdicts = this.survivalCheck(summary, constraints, this.liveText(session, seqs))
    // 留一份可回放的样本：下次改切词/阈值时，拿它比对，不靠印象
    try {
      this.saveReplayFixture(summary, constraints, verdicts)
    } catch {
      /* 样本落盘失败不影响核对 */
    }
    const lost = verdicts.filter((v) => !v.kept)
    if (lost.length) {
      this.recordLoss(lost)
      this.appendLogOnce('压缩可能压丢约束', lost.map((v) => v.text).join('；').slice(0, 600))
    } else {
      this.clearLoss()
    }
    return { checked: verdicts.length, lost: lost.length, broken: lost.slice(0, 3).map((v) => v.text) }
  }

  /**
   * 整理工作单的摘要：到期时直接塞进 boot，材料就在眼前，不用先调工具再等一轮。
   * 只读，几毫秒；出错就当没有，不影响别的注入。
   * @returns 多行文本，或空串。
   */
  workBrief() { return workBrief(this) }


  // 2026-11-28 P3-S4：实现在 lib/boot.js。
  bootTextSync(options = {}) {
    return bootTextSync(this, { CORE_PERSONA, wakeLine, moodLineWithin, tidyDue, tidyLine, diaryLine, oldPageLine, compactionLine, bumpMetric, clip, draftLine, personaMode: String(this.config?.personaMode ?? 'inline'), autoConsolidate: options.autoConsolidate !== false })
  }


  /**
   * 检索的原始结果：每页命中几个词、几行、分数多少。recall 和自动提示共用
   * @param query - 查询
   * @returns `{ terms, hits }`
   */
  searchHits(query) {
    // 2026-11-28 P3：检索打分搬进 lib/engine/rank.js，这里只负责「把页读好递过去」。
    // legacy 模式与改造前逐字节等价（同一套分词、同一公式、log.md 同样排最后）。
    const rels = this.listPages().filter((rel) => rel !== 'MEMORY.md' && rel !== 'index.md')
    const pages = []
    for (const rel of rels) {
      try {
        pages.push({ rel, text: this.read(rel) })
      } catch {
        /* 读不到的页跳过，和以前一样不影响其它页 */
      }
    }
    const mode = this.config?.searchMode === 'legacy' ? 'legacy' : 'bm25'
    const run = (m) => this.ranker(query, pages, { mode: m })
    if (mode === 'legacy') {
      const result = run('legacy')
      return { terms: result.terms, hits: result.hits }
    }
    try {
      const result = run('bm25')
      if (!result || !Array.isArray(result.terms) || !Array.isArray(result.hits)) throw new Error('rank 返回结构不对')
      this.clearEngineFallback('rank')
      return { terms: result.terms, hits: result.hits }
    } catch (error) {
      this.noteEngineFallback('rank', error)
      const result = run('legacy')
      return { terms: result.terms, hits: result.hits }
    }
  }

  // 2026-11-28 P3-S5：实现在 lib/recall-view.js。
  headLines(rel, max = 6) { return headLines(this, rel, max) }

  seqNear(rel, terms) { return seqNear(this, rel, terms) }

  hitLines(rel, terms, max = 3) { return hitLines(this, rel, terms, max) }

  queryHint() { return queryHint(this) }

  recall(query) { return recall(this, query) }

  sourceTag(source) { return sourceTag(this, source) }

  // 2026-11-28 P3-S6：实现在 lib/writeback.js。
  appendLog(title, body, source) { return appendLog(this, title, body, source) }

  appendLogOnce(title, body) { return appendLogOnce(this, title, body) }

  originLine(origin) { return originLine(origin) }

  appendPage(page, body, source, origin) { return appendPage(this, page, body, source, origin) }

  // 2026-11-28 A2：实现在 lib/index-edit.js，这里只留薄委托。
  checkIndex() { return checkIndex(this) }

  rebuildIndex() { return rebuildIndex(this) }

  indexEntryFor(rel) { return indexEntryFor(this, rel) }

  status() {
    // 诊断只看不动：不因为一次 mem_status 就把整理打点掉
    const boot = this.bootTextSync({ autoConsolidate: false })
    const pages = this.listPages()
    const index = this.indexLines()
    const log = this.logLines()
    return {
      status: 'ok',
      root: this.root,
      bootChars: boot.length,
      bootMaxChars: this.config.bootMaxChars,
      rulesChars: this.rulesText().length,
      rulesMaxChars: this.config.maxRulesChars,
      growthChars: this.growthText().length,
      growthMaxChars: this.config.maxGrowthChars,
      pages: pages.length,
      indexEntries: indexPaths(this.read('index.md')).length,
      // 2026-11-22 为什么改：logLines() 是按文件顺序返回的（新的在后），取 [0] 拿到的是
      // 倒数第二条。写一条 log 再 mem_status 核对，会以为没写进去、于是重复写。
      recentLog: log[log.length - 1] ?? '',
      // —— 引擎兜底状态：正常时两条都是 null，兜底过才带错误摘要
      engineFallback: this.engineFallback,
      // —— 度量模块（可删）：一次都没调过召回就是空串，不占地方
      metrics: metricsLine(this.root),
      bootPreview: boot,
    }
  }
}

export const inject = ['tools', 'systemPrompt']

export { Store }

export function apply(ctx, config = {}) {
  const settings = { ...DEFAULTS, ...config }
  const store = new Store(resolveRoot(config), settings)
  // 2026-11-27 M0-1：装完/加载后留一行「时间 + 版本」，装没装、什么时候加载的一眼可见。
  // 和鲫鱼那边同一个思路：文件在，就说明这次真加载了；诊断失败不许影响加载。
  try {
    const meta = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
    const home = String(process.env.DSH_HOME ?? '').trim() || path.join(homedir(), '.dsh')
    const dir = path.join(home, 'fish-memory')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'loaded.txt'), `${new Date().toISOString()} ${String(meta.version ?? '?')}\n`, 'utf8')
  } catch {
    /* 诊断文件写不出来不影响插件 */
  }
  // 共享流水的话题：这一轮主人最后说的话。写在 turn/end，不进 boot。
  let lastUserText = ''
  // 叫醒/整理轮的总开关：关掉就既不挂任务、也不轮询，其余功能不受影响
  const alarmOn = settings.alarm !== false

  ctx.effect(() =>
    ctx.systemPrompt.context({
      name: 'fish-memory',
      order: 850,
      text: () => store.bootTextSync(),
    }),
  )

  // —— 自动提示的输入（可删）：记下主人这轮说了什么，boot 里那段才有东西可检索
  ctx.effect(() => {
    const remember = (payload) => {
      try {
        const content = payload?.message?.content
        const text = Array.isArray(content)
          ? content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join(' ')
          : typeof content === 'string'
            ? content
            : ''
        store.rememberQuery(text)
        // 共享流水用：这一轮在讨论什么，写的是主人的问题（比自己复述准）。
        // 系统注入（定时提醒、runtime context 之类）不能覆盖——12:17 那次
        // 「现在重启了」就是被随后的 [SCHEDULE CHANGE] 顶掉的。
        if (text.trim() !== '' && !isNoiseTopic(text)) lastUserText = text
        // 记下这一刻：叫醒器靠它判断对话是不是还在进行
        if (text !== '') markMessage(store.root)
      } catch {
        /* 记不下就不提示，不影响别的 */
      }
    }
    return ctx.on('agent/inbox/inserted', remember)
  })

  // —— 共享流水（可删）：每轮结束写一行「这个会话刚才在干什么」。
  //     2026-11-25 为什么：主人同时开两个窗口交替说话，各自看不到对方。
  //     不进 boot（会按对方节奏打断前缀缓存），要读用 mem_live 主动读。
  ctx.effect(() =>
    ctx.on('session/event', (session, event) => {
      try {
        const sid = String(session?.id ?? session?.sessionId ?? '')
        if (sid !== '') store.activeSession = sid
        if (event?.type !== 'turn/end') return
        appendLive(store.root, { session: sid, seq: Number(event?.seq ?? 0), topic: lastUserText })
        lastUserText = ''
      } catch {
        /* 写不进流水不影响这一轮 */
      }
    }),
  )

  // —— 主动唤醒（可删）：数这一轮调了几次工具，这一轮回答完（turn/end）再按量扣分
  if (alarmOn && typeof ctx.on === 'function') {
    let turnTools = 0
    // 已经挂过叫醒任务的会话，避免每轮都去查一遍
    const alarmed = new Set()
    ctx.effect(() =>
      ctx.on('session/event', (session, event) => {
        try {
          // 唤醒分数按会话分开存：别的窗口在动，不该算到这个窗口头上
          store.activeSession = String(session?.id ?? session?.sessionId ?? store.activeSession ?? '')
          // —— 定时叫醒（可删）：这个会话第一次有事件时，给它挂一个每小时的任务
          try {
            const sid = String(session?.id ?? session?.sessionId ?? '')
            // 这个会话是现在醒着的那个；其余窗口从此静音
            if (sid !== '') markActive(store.root, sid)
            if (sid !== '' && !alarmed.has(sid)) {
              alarmed.add(sid)
              const scheduleService = typeof ctx.get === 'function' ? ctx.get('schedule') : undefined
              ensureAlarm(scheduleService, sid, store.root).catch(() => {})
              ensureTidyAlarm(scheduleService, sid, store.root).catch(() => {})
              ensureDiaryAlarm(scheduleService, sid, store.root).catch(() => {})
            }
          } catch {
            /* 建不出任务不影响这一轮 */
          }
          if (event?.type === 'tool/call') {
            turnTools += 1
            return
          }
          if (event?.type !== 'turn/end') return
          // 整理到期就在这一轮末尾投一条，下一轮开头就是整理
          try {
            const scheduleService = typeof ctx.get === 'function' ? ctx.get('schedule') : undefined
            nudgeTidy(scheduleService, store.root, store.config).catch(() => {})
            nudgeDiary(scheduleService, store.root, store.config).catch(() => {})
          } catch {
            /* 催不到就等下次到期 */
          }
          // 被叫醒的那一轮先记账：做不做都要付代价，混过去下次要等更久
          if (readPendingWake(store.root) > 0) {
            dropWake(store.root, turnTools >= 3 ? 'long' : 'wake', store.activeSession)
            clearPendingWake(store.root)
            turnTools = 0
            return
          }
          // 按这一轮的长短扣分；主人叫的不扣，否则他一直在我就永远到不了线
          if (turnTools >= 3) dropWake(store.root, 'long', store.activeSession)
          else if (turnTools >= 1) dropWake(store.root, 'short', store.activeSession)
          else dropWake(store.root, 'chat', store.activeSession)
          turnTools = 0
        } catch {
          /* 数不清就不扣 */
        }
      }),
    )
  }

  // —— 回到前台补叫（可删）：Android 会在 App 退到后台后回收进程，定时器随之消失。
  // 进程一回来（插件重新加载）先看一眼分数，过线且够久没叫就补一次。
  // 等 90 秒再判：刚打开 App 往往是要说话，安静期会挡住；只有开了又没说话才补叫——
  // 不然整个后台时段都是哑的，早上打开 App 也不会自己醒。
  if (alarmOn && typeof ctx.get === 'function') {
    ctx.effect(() => {
      const catchUp = setTimeout(() => {
        try {
          tickAlarms(ctx.get('schedule'), store.root).catch(() => {})
        } catch {
          /* 补叫失败不影响加载 */
        }
      }, 90000)
      // 不让一个待触发的补叫把进程吊住（测试、CLI 场景会因此退不出去）。
      if (typeof catchUp === 'object' && typeof catchUp.unref === 'function') catchUp.unref()
      return () => clearTimeout(catchUp)
    })
  }

  // —— 分数够了才叫醒（可删）：代码每 3 分钟看一眼分数，到线才让宿主起一轮
  if (alarmOn && typeof ctx.get === 'function') {
    ctx.effect(() => {
      const timer = setInterval(() => {
        try {
          const service = ctx.get('schedule')
          tickAlarms(service, store.root).catch(() => {})
        } catch {
          /* 看不成就算了，下一轮再看 */
        }
      }, 3 * 60 * 1000)
      if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()
      return () => clearInterval(timer)
    })
  }

  // 只挂宿主的压缩事件，不认具体引擎：换压缩插件照样能核
  if (typeof ctx.on === 'function') {
    ctx.effect(() =>
      ctx.on('session/event', (session, event) => {
        try {
          if (event?.type !== 'compaction/summary') return
          store.handleCompaction(session, event)
        } catch (error) {
          console.warn(`[dsh-jiyiti-memory] survival check failed: ${String(error?.message ?? error)}`)
        }
      }),
    )
  }

  // 2026-11-28 P3-S1：工具定义搬进 lib/tools/register.js，这里只负责注册。
  const tools = buildTools({
    store, settings, harvest, shortSession, readSeqRange, readLive,
    parsePointer, checkPointer, moodLine, markTidy, markDiary,
    buildWorklist, diaryPageOf, writeMood, writeMoodScores,
  })
  for (const definition of tools) {
    ctx.effect(() => ctx.tools.register(definition))
  }
}
