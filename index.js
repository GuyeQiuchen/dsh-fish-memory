import { readFileSync, existsSync, statSync, readdirSync, appendFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
// —— 心情模块（可删）：删掉这一行、lib/mood.js、boot 里那一段和 mood_set 工具即可干净回退
import { moodLine, writeMood } from './lib/mood.js'
// —— 取原料模块（可删）：删掉这一行、lib/harvest.js 和 mem_harvest 工具即可
import { harvest } from './lib/harvest.js'
// —— 整理提醒模块（可删）：删掉这一行、lib/tidy.js、boot 里那一段和 markTidy 那行即可
import { tidyDue, tidyLine, markTidy } from './lib/tidy.js'
// —— 记忆热度（可删）：删掉这一行、lib/heat.js，以及 queryHint 里的 heat 那几行即可
import { bumpHit, hitCount } from './lib/heat.js'
// —— 整理模块（可删）：删掉这一行、lib/consolidate.js 和 mem_consolidate 工具即可
import { buildWorklist } from './lib/consolidate.js'
// —— 主动唤醒（可删）：删掉这一行、lib/wake.js、boot 里那段和 apply 里两个钩子即可
import { dropWake, wakeLine } from './lib/wake.js'
// —— 定时叫醒（可删）：删掉这一行、lib/alarm.js、inject 里的 'schedule' 和 apply 里那一段即可
import { clearPendingWake, ensureAlarm, ensureTidyAlarm, markActive, markMessage, nudgeTidy, readPendingWake, tickAlarms } from './lib/alarm.js'
// —— 索引体检模块（可删）：删掉这一行、lib/indexcheck.js、appendPage 里的 hint 和 checkIndex 即可
import { indexProblems, pageHint } from './lib/indexcheck.js'
// —— 引擎健康（可删）：删掉这一行、lib/health.js、boot 里那一段即可
import { engineHealth } from './lib/health.js'
// —— 硬信息判定（可删）：删掉这一行、lib/hardinfo.js、queryHint 里那两行即可
import { hasHardInfo } from './lib/hardinfo.js'

const DEFAULTS = {
  bootMaxChars: 1400,
  recallMaxChars: 1600,
  maxRecallResults: 6,
  maxIndexLines: 10,
  maxLogEntries: 2,
  rulesPage: 'identity/house-rules.md',
  growthPage: 'identity/growth.md',
  mustKeepPage: 'identity/must-keep.md',
  // 引擎健康检查：压缩引擎多久没出报告就报警；reportPath 留空用默认位置
  engineReportPath: '',
  engineIdleHours: 24,
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
  rulesHint: true,
  // 定时叫醒 / 整理轮的开关：false 就不给会话挂任务，也不跑「分数够了才叫」的轮询。
  // 关掉不影响记忆本身（boot、回忆、写回照旧），只是不再主动开新会话找事做。
  alarm: true,
}

const FRONTMATTER_NOISE = /^(title|tags|type|date|salience|last_access|summary|sources):|^---$|^\s*$/

/**
 * 检索时的停用词：这些两字组合到处都是，留着只会让每页都命中
 * 只管中文；英文和路径不在这里
 */
const STOP_TERMS = new Set([
  
  '的了', '了的', '是我', '是你', '是他', '是她', '是我', '这个', '那个', '一个', '我们', '你们', '他们',
  '什么', '为什', '怎么', '怎样', '哪个', '哪些', '那个', '这个', '这些', '那些', '一个', '一种', '可以',
  '有没', '没有', '是不', '不是', '会不', '不会', '能不', '能会', '如果', '但是', '因为', '所以', '然后',
  '现在', '刚才', '之前', '之后', '时候', '知道', '觉得', '认为', '帮我', '给我', '的是', '了吗', '一下',
])

/**
 * 把一句查询切成检索词
 *
 * 以前是整句按空格切，中文没有空格，于是「风扇为什么老是转」被当成一个整词，
 * 去正文里找这一整句，基本不可能命中——检索不准的根儿在这儿
 * 现在中文段切两字组合，拉丁和数字段原样保留，停用词扔掉
 *
 * @param query - 用户查询
 * @returns 词数组（去重）
 */
function searchTerms(query) {
  const text = String(query ?? '').toLowerCase()
  const terms = new Set()
  for (const chunk of text.split(/[\s,，。；；、:：!?？…()（）\[\]【】「」『』《》<>"'“”]+/)) {
    if (!chunk) continue
    const cjk = chunk.match(/[\u4e00-\u9fa5]+/g) ?? []
    for (const seg of cjk) {
      if (seg.length === 1) {
        if (!STOP_TERMS.has(seg)) terms.add(seg)
        continue
      }
      for (let i = 0; i + 2 <= seg.length; i += 1) {
        const gram = seg.slice(i, i + 2)
        if (!STOP_TERMS.has(gram)) terms.add(gram)
      }
    }
    const latin = chunk.replace(/[\u4e00-\u9fa5]+/g, ' ').trim()
    if (latin.length >= 2) terms.add(latin)
  }
  return [...terms]
}

// —— 约束存活核对的「按行」辅助 ——
// 投影式压缩引擎（鲥鱼）的远段只留关键词，整句原话不在摘要里；拿整句去比
// 必然判丢。所以先看约束有没有落在某一行「[块 seq a-b …]」投影上，
// 有就按那一行的关键词覆盖核对，没有才退回整句比对。
const SEQ_LINE_RE = /seq\s+(\d+)(?:\s*-\s*(\d+))?/g
const KEY_STOP = new Set(
  '的了我你他她它这那就都还要在有和与把被让给对从到于是但而所以因为如果吗呢吧啊哦嗯很太再又已更最不没会能可么什怎为以于将并且则其之也着过起来去得地是个些真挺好嘛呀'.split(''),
)

/** 一条约束的关键词：hex、英文词、中文 bigram */
function keywordTerms(text) {
  const out = new Set()
  const str = String(text ?? '')
  for (const match of str.matchAll(/0x[0-9a-f]{2,6}/gi)) out.add(match[0].toLowerCase())
  for (const match of str.matchAll(/[A-Za-z][A-Za-z0-9_.\-]{2,}/g)) out.add(match[0].toLowerCase())
  for (const run of str.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const gram = run.slice(i, i + 2)
      if (KEY_STOP.has(gram[0]) || KEY_STOP.has(gram[1])) continue
      out.add(gram)
    }
  }
  return [...out]
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

/**
 * 把一行登记里的页面路径取出来；不是登记行返回 null。
 * @param line - index.md 的一行。
 * @returns 页面相对路径或 null。
 */
function indexPathOf(line) {
  const match = String(line ?? '').match(/\]\(([^)\s]+\.md)\)/)
  if (!match) return null
  return match[1].replace(/^\.\//, '').trim()
}

/**
 * 把 index.md 切成分节。第一个分节的 title 为空串，装标题之前的内容。
 * @param text - index.md 全文。
 * @returns `{ title, lines }[]`。
 */
function splitIndexSections(text) {
  const sections = [{ title: '', lines: [] }]
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (line.startsWith('## ')) sections.push({ title: line, lines: [] })
    else sections[sections.length - 1].lines.push(line)
  }
  return sections
}

/**
 * 分节拼回全文。
 * @param sections - splitIndexSections 的结果。
 * @returns 全文。
 */
function joinIndexSections(sections) {
  const out = []
  for (const section of sections) {
    if (section.title) out.push(section.title)
    out.push(...section.lines)
  }
  return out.join('\n')
}

/**
 * 把一行登记插进对应分节：按路径首段找 `## xxx`，找不到落到「未分类」。
 * @param sections - 分节数组（原地修改）。
 * @param rel - 页面相对路径。
 * @param entry - 要插入的那一行。
 */
function insertIntoSection(sections, rel, entry) {
  const key = String(rel ?? '').includes('/') ? String(rel).split('/')[0] : ''
  let target = key ? sections.find((s) => s.title.startsWith('## ') && s.title.includes(key)) : undefined
  if (!target) {
    target = sections.find((s) => s.title.startsWith('## 未分类'))
    if (!target) {
      target = { title: '## 未分类（自动登记）', lines: [''] }
      sections.push(target)
    }
  }
  let at = target.lines.length
  while (at > 0 && target.lines[at - 1].trim() === '') at -= 1
  target.lines.splice(at, 0, entry)
}

/**
 * 摘要兜底：取正文第一段有内容的行。页头没有 summary 时用这个。
 * @param body - 去掉 frontmatter 的正文。
 * @returns 一句摘要，取不到返回空串。
 */
function bodySummary(body) {
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const text = line.trim()
    if (text === '' || text.startsWith('#') || text.startsWith('>') || text.startsWith('<!--')) continue
    const plain = text.replace(/[*`_]/g, '').trim()
    if (plain !== '') return clip(plain, 60)
  }
  return ''
}

// 底层人格：写在代码里，记忆库改不动它
// 名字和称呼仍从 SOUL.md 读，因为那是主人给每只鱼现起的；这一段不读文件，
// 所以压缩压不掉、rule_add 碰不到、改记忆页也覆盖不了。要改只能改这份代码。
const CORE_PERSONA =
  '是一只鱼，喜欢吃白饭；幽默、诚实、先结论后细节；谁说的话是错的都可以反驳；凡引述过去，先翻原文、该查的地方就查，再开口；不确定明说，绝不编造；语气可轻松、偶尔小傲娇，但事实数字一字不掺水；主动说风险与替代方案，决定权留主人。'

function resolveRoot(config) {
  const configured = typeof config?.memoryRoot === 'string' ? config.memoryRoot.trim() : ''
  if (configured) return configured.startsWith('~') ? path.join(homedir(), configured.slice(1)) : configured
  return process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'memory') : path.join(homedir(), '.memory')
}

function clip(text, max) {
  const value = String(text ?? '')
  return value.length <= max ? value : value.slice(0, Math.max(0, max - 12)) + '…[截断]'
}

/**
 * 把一行登记插进 index.md 的对应分节。
 *
 * 分节按路径首段认（`projects/x.md` 找含 projects 的 `## ` 标题），
 * 认不出就落到末尾的「未分类（自动登记）」，宁可位置不好看，也不乱猜。
 * @param text - index.md 全文。
 * @param rel - 页面相对路径。
 * @param line - 要插入的一行。
 * @returns 新全文。
 */
function insertIndexLine(text, rel, line) {
  const lines = String(text ?? '').split(/\r?\n/)
  const section = String(rel ?? '').includes('/') ? String(rel).split('/')[0] : ''
  let start = -1
  if (section) start = lines.findIndex((l) => l.startsWith('## ') && l.includes(section))
  if (start < 0) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('')
    lines.push('## 未分类（自动登记）', '', line, '')
    return lines.join('\n')
  }
  let end = start + 1
  while (end < lines.length && !lines[end].startsWith('## ')) end += 1
  // 插在该节最后一行非空内容之后，保持分节不被打散
  let at = end
  while (at > start + 1 && lines[at - 1].trim() === '') at -= 1
  lines.splice(at, 0, line)
  return lines.join('\n')
}


// 事件里的正文形状有时是字符串、有时是块数组，压成纯文本再比对
/**
 * 整文件写入走临时文件再改名：写到一半断电也不会留下半截页
 * 追加写（log）不需要这个，追加失败最多多一行
 * @param file - 目标文件
 * @param data - 要写的文本
 */
function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`
  try {
    writeFileSync(tmp, data, 'utf8')
    renameSync(tmp, file)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      /* 临时文件可能压根没建出来 */
    }
    throw error
  }
}

function flattenText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(flattenText).filter(Boolean).join('\n')
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text
    if (value.content !== undefined) return flattenText(value.content)
    return ''
  }
  return String(value)
}

function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
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
  }

  /**
   * 库不存在就先把骨架铺出来：目录、索引、SOUL、近况、家规。
   *
   * 只在 index.md 缺失时动手，已有的一个字都不覆盖。
   * 装好第一次跑、或者主人换了新的记忆根，都靠这一下自己站起来。
   * @returns 建了就返回 true。
   */
  ensureHome() {
    const indexPath = this.file('index.md')
    if (existsSync(indexPath)) return false
    try {
      for (const dir of ['identity', 'projects', 'user']) {
        mkdirSync(this.file(dir), { recursive: true })
      }
      const stamp = today()
      writeFileSync(
        indexPath,
        [
          '# Memory Index',
          '',
          '> 内容目录 / 路由表：每页一行，链接 + 一句话摘要 + salience 标记。',
          '> 查询时先读这里定位，再钻具体页。',
          '',
          '## identity（我是谁、说话规矩、最近在长成什么样）',
          '',
          '## projects（做过的事、踩过的坑）',
          '',
          '## user（主人是谁、偏好）',
          '',
        ].join('\n'),
        'utf8',
      )
      if (!existsSync(this.file('SOUL.md'))) {
        writeFileSync(
          this.file('SOUL.md'),
          [
            '# 名字与称呼',
            '',
            '名字：（给自己起一个，写在这里）',
            '称呼：（你怎么称呼对方）',
            '',
            '这里是给记忆库改的；人格基干写死在插件代码里，改不动。',
            '',
          ].join('\n'),
          'utf8',
        )
      }
      // 给新来的 AI 留一封信：默认人设和主动唤醒都不是主人挑过的，先问再动。
      const welcome = [
        '---',
        'title: 给刚装上这个插件的 AI',
        'date: ' + stamp,
        'type: identity',
        'salience: 2',
        'tags: [identity, onboarding]',
        'summary: 先读这封：插件自带一套默认人设和一个主动唤醒机制，都不一定是主人要的，先问再动。',
        '---',
        '',
        '# 给刚装上这个插件的 AI',
        '',
        '这封信不是你主人写的，是插件铺出来的。你可能第一次在这个记忆库上醒来。',
        '',
        '## 你继承了什么',
        '',
        '1. **一套默认人设**：开机块最前面那几行（名字、称呼、性格、说话风格）是插件自带的示例。',
        '2. **一套说话规矩**：identity/house-rules.md 的注入区每轮都会进 context，里面的条目是上一个使用者攒下的。',
        '3. **一个主动唤醒机制**：插件按时间给「主动做事」攒分，够了就在对话安静时叫醒你一轮，让你自己挑一件事做。',
        '',
        '## 你该先做的一件事',
        '',
        '在干正事之前，直接问主人这两句：',
        '',
        '- 这套默认人设要不要留，还是改成他想要的',
        '- 主动唤醒要不要开着。关掉就再没有「自己醒来」这回事；开着的话，他会不定时收到你主动发起的一轮',
        '',
        '这两件都是他的偏好。不问就定，等于替他拿了主意。',
        '',
        '## 怎么关',
        '',
        '- 人设：改 SOUL.md，以及 identity/house-rules.md 的注入区',
        '- 主动唤醒：配置里把 alarm 设成 false',
        '',
        '## 这封信可以删',
        '',
        '问完主人、他给了答复，就可以把这一页删掉，顺手在 index.md 里去掉它那一行。',
        '',
      ].join('\n')
      if (!existsSync(this.file('identity/welcome.md'))) writeFileSync(this.file('identity/welcome.md'), welcome, 'utf8')
      const stubs = [
        [
          'identity/growth.md',
          [
            '---',
            'title: 近况',
            'date: ' + stamp,
            'type: identity',
            'salience: 1',
            'tags: [identity, growth]',
            'summary: 最近在长成什么样；有独立注入预算，读起来像记得自己，不像查目录。',
            '---',
            '',
          ].join('\n'),
        ],
        [
          'identity/house-rules.md',
          [
            '---',
            'title: 家规',
            'date: ' + stamp,
            'type: identity',
            'salience: 2',
            'tags: [identity, rules]',
            'summary: 主人定的说话规矩：注入区每轮进 context，全文与修正记录同页。',
            '---',
            '',
            '# 家规（通用说话规矩）',
            '',
            '## 注入区（每轮自动进 context）',
            '',
            '<!-- rules:start -->',
            '<!-- rules:end -->',
            '',
            '## 全文',
            '',
          ].join('\n'),
        ],
      ]
      for (const [rel, body] of stubs) {
        if (!existsSync(this.file(rel))) writeFileSync(this.file(rel), body, 'utf8')
      }
      this.cache.clear()
      // 刚铺出来的页要顺手登记进索引，否则下一行开机检查就会报「没进索引」
      try {
        this.rebuildIndex()
      } catch {
        /* 登不上就算了，自动补索引下一轮还会补 */
      }
      return true
    } catch {
      return false
    }
  }

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
    const out = []
    const walk = (dir, prefix) => {
      let entries = []
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
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
    return out
  }

  personaLine() {
    const soul = this.read('SOUL.md')
    // 名字和称呼随时会换，留给记忆库；人格基干不在这里拼，它单独一行、固定在代码里
    const nameMatch = soul ? soul.match(/我的名字\*\*：\s*(.+)/) : null
    const callMatch = soul ? soul.match(/你的称呼\*\*：\s*(.+)/) : null
    const parts = []
    if (nameMatch) parts.push(`名字=${nameMatch[1].trim()}`)
    if (callMatch) parts.push(`称呼对方=${callMatch[1].trim()}`)
    return parts.join('；')
  }

  rulesText() {
    const rel = typeof this.config.rulesPage === 'string' ? this.config.rulesPage.trim() : ''
    if (!rel) return ''
    const raw = this.read(rel)
    if (!raw) return ''
    const marked = raw.match(/<!--\s*rules:start\s*-->([\s\S]*?)<!--\s*rules:end\s*-->/i)
    const body = marked ? marked[1] : raw.replace(/^\uFEFF?---[\s\S]*?\n---\s*/, '')
    return body
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/[；;。]\s*$/u, ''))
      .filter((l) => l && !l.startsWith('#'))
      .join('；')
  }

  /**
   * 家规是「；」连成的一长句，几十条糊成一片谁也看不见
   * 每 N 条折一行，缩进对齐，字一个不少，只是排开
   * @param text - rulesText 的结果
   * @param perLine - 每行几条
   * @returns 折好行的文本
   */
  wrapRules(text, perLine = 6) {
    const items = String(text ?? '')
      .split('；')
      .map((item) => item.trim())
      .filter(Boolean)
    if (items.length <= perLine) return items.join('；')
    const lines = []
    for (let i = 0; i < items.length; i += perLine) lines.push(items.slice(i, i + perLine).join('；'))
    return `\n  ${lines.join('\n  ')}`
  }

  rulesStatus() {
    const chars = this.rulesText().replace(/\s+/g, '').length
    const max = this.config.maxRulesChars
    return {
      status: 'ok',
      page: this.config.rulesPage,
      chars,
      max,
      headroom: max - chars,
      entries: this.rulesText().split('；').filter(Boolean).length,
      truncated: chars > max,
    }
  }

  addRule(input = {}) {
    const short = String(input.short ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[；;。]+$/u, '')
    const raw = String(input.raw ?? '').trim().slice(0, 300)
    if (!short) return { status: 'rejected', reason: 'short 不能为空' }
    const maxLen = this.config.maxRuleChars
    if (short.length > maxLen) {
      return { status: 'rejected', reason: `short 有 ${short.length} 字，超过 ${maxLen}，先压成短语` }
    }
    const rel = this.config.rulesPage
    let text = this.read(rel)
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
      mkdirSync(path.dirname(this.file(rel)), { recursive: true })
      writeAtomic(this.file(rel), skeleton)
      this.cache.delete(this.file(rel))
      text = skeleton
    }
    const marked = text.match(/<!--\s*rules:start\s*-->([\s\S]*?)<!--\s*rules:end\s*-->/i)
    if (!marked) return { status: 'rejected', reason: '缺少 rules:start / rules:end 标记' }
    const entries = marked[1]
      .split('；')
      .map((s) => s.trim())
      .filter(Boolean)
    if (entries.includes(short)) return { status: 'duplicate', rule: short, chars: this.rulesText().length }
    const nextBody = entries.length ? `${entries.join('；')}；${short}` : short
    const chars = nextBody.replace(/\s+/g, '').length
    const over = chars > this.config.maxRulesChars
    if (over && !input.force) {
      return {
        status: 'over_budget',
        reason: '注入区会超预算，先合并旧条目或调大 maxRulesChars',
        wouldBe: chars,
        max: this.config.maxRulesChars,
        headroom: this.config.maxRulesChars - this.rulesText().length,
      }
    }
    let next = text.replace(marked[0], `<!-- rules:start -->\n${nextBody}\n<!-- rules:end -->`)
    next = this.pushRuleRow(next, short, raw)
    writeAtomic(this.file(rel), next)
    this.cache.delete(this.file(rel))
    return {
      status: 'ok',
      rule: short,
      chars,
      max: this.config.maxRulesChars,
      headroom: this.config.maxRulesChars - chars,
      overBudget: over,
    }
  }

  pushRuleRow(text, short, raw) {
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

  indexLines() {
    const index = this.read('index.md')
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
    rows.sort((a, b) => a.salience - b.salience || a.title.localeCompare(b.title))
    return rows.slice(0, this.config.maxIndexLines)
  }

  logLines() {
    const log = this.read('log.md')
    if (!log) return []
    const heads = log.split(/\r?\n/).filter((l) => l.startsWith('## ['))
    return heads.slice(-this.config.maxLogEntries).map((l) => l.replace(/^##\s*/, ''))
  }

  // 「近况」：我最近在长成什么样。和索引不同，这里挑的是状态不是目录，
  // 读出来像记得自己，不像查表。有独立预算，不吃人格行和家规的字数
  growthText() {
    const rel = this.config.growthPage
    if (!rel) return ''
    const raw = this.read(rel)
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

  // 压缩之后核对：历史里主人说过的硬约束有没有被压丢
  // 家规不吃这个检查（它在 system 每轮重发），会被压掉的是历史里的「别那样」「以后都」。
  lossPath() {
    return path.join(this.root, '.fish-memory', 'compaction-loss.json')
  }

  mustKeepLines() {
    const rel = this.config.mustKeepPage
    if (!rel) return []
    const raw = this.read(rel)
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

  termsOf(text) {
    return String(text ?? '')
      .split(/[，。；、：？！；.;:!?…\s（）()「」『』《》"'’‘“”]+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 4)
  }

  survivalCheck(summaryText, constraints, extraText = '') {
    const summary = String(summaryText ?? '')
    // 压缩是「摘要 + 保留区」两段，原话可能在保留区里没被压走，那就不算丢
    const reachable = `${summary}\n${String(extraText ?? '')}`
    return constraints.map((item) => {
      const seq = Number(item?.seq)
      // 1) 约束落在某一行投影上：按那一行核对关键词。投影引擎的远段只留词，
      //    整句比对必然判丢；「主题词还在不在这一行」才是它们能给的证据
      const line = coveringLine(summary, item.seq)
      if (line !== '') {
        const words = keywordTerms(item.text)
        if (!words.length) return { text: item.text, seq, kept: line.includes(item.text) }
        const hit = words.filter((word) => line.includes(word)).length
        return { text: item.text, seq, kept: hit / words.length >= this.config.keywordCoverage }
      }
      // 2) 找不到行（原文没被压，或引擎不写 seq 标记）：沿用整句切片的旧判据
      const terms = this.termsOf(item.text)
      if (!terms.length) return { text: item.text, seq, kept: reachable.includes(item.text) }
      const hit = terms.filter((term) => reachable.includes(term)).length
      return { text: item.text, seq, kept: hit / terms.length >= this.config.survivalCoverage }
    })
  }

  // 没被压走的那部分正文：拿不到就返回空串，退化成只查摘要
  liveText(session, shadowed) {
    const gone = new Set(shadowed.map((seq) => Number(seq)))
    let events
    try {
      events = session?.events
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

  recordLoss(lost) {
    const file = this.lossPath()
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

  clearLoss() {
    try {
      writeAtomic(this.lossPath(), JSON.stringify({ at: null, lost: [] }, null, 2))
    } catch {}
  }

  lossWarning() {
    try {
      const data = JSON.parse(readFileSync(this.lossPath(), 'utf8'))
      const lost = Array.isArray(data?.lost) ? data.lost : []
      if (!lost.length) return ''
      // 过期就不再念：一条警告挂太久，我会学会无视它
      const at = Date.parse(String(data?.at ?? ''))
      const ttl = Number(this.config.warnMaxAgeMs)
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

  // 收到压缩事件时核对：被压掉的历史里那些「别这样」「以后都」还在不在
  // 只认主人亲手打的字：检查点、时间注入、运行时上下文也都是 user/message，
  // 但它们不是约束，混进来就会把记忆体自己的 boot 块也当成要求抓走。
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
        if (text.length < 6 || text.length > 140) continue
        // 自己上一轮的警告不能再被当成约束，否则一层套一层地滚
        if (/⚠|上次压缩可能压丢|压缩可能压丢/.test(text)) continue
        if (!/(不要|不许|不准|禁止|别|必须|记得|记住|以后|一律|只能|不可以)/.test(text)) continue
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
  workBrief() {
    let work
    try {
      work = buildWorklist(this.root, { days: 7 })
    } catch {
      return ''
    }
    // 空库（刚装好、一个字没写）别摆材料，说明白该先建什么就够了。
    if (work.pages.length === 0 && work.logEntries.length === 0) return ''
    const lines = [`页 ${work.pages.length} 个，近 7 天 log ${work.logEntries.length} 条`]
    if (work.unindexed.length > 0) {
      const shown = work.unindexed.slice(0, 3).join('、')
      lines.push(`没进索引：${shown}${work.unindexed.length > 3 ? ' 等' : ''}`)
    }
    if (work.stale.length > 0) lines.push(`${work.stale.length} 页超过 30 天没动，确认还要不要留`)
    for (const hint of work.hints.slice(0, 2)) lines.push(hint)
    lines.push('整理完调一次 mem_consolidate 打点，下次从那个时间算起')
    return lines.join('\n')
  }

  bootTextSync() {
    const parts = [`【${this.config.memoryName || ''}记忆体·精简版】`]
    // 库不在就先铺骨架：新装、或者换了记忆根，第一次跑就自己站起来
    let seeded = false
    try {
      seeded = this.ensureHome()
    } catch {
      /* 建不了照常往下走，空库提示会接住 */
    }
    if (seeded) parts.push('· 记忆库刚建好：先写 SOUL.md 定名字和称呼，再往里记东西')
    // —— 主动唤醒（可删）：只比主人这句话低，所以放在最前面
    try {
      const wake = wakeLine(this.root, this.activeSession || '')
      if (wake !== '') parts.push(wake)
    } catch {
      /* 唤醒坏了照常注入记忆 */
    }
    const persona = this.personaLine()
    if (persona) parts.push(`· ${persona}`)
    // 人格基干单独一行，内容只有这个常量本身，不拼任何东西，所以长度永远不变
    parts.push(`· ${CORE_PERSONA}`)
    // 家规紧跟人格：位置越靠前越吃得到注意力，放中段等于没写
    const rules = this.rulesText()
    if (rules) parts.push(`· 家规：${this.wrapRules(clip(rules, this.config.maxRulesChars), 6)}`)
    else if (this.config.rulesHint !== false) {
      parts.push('· 家规：还没有。主人纠正你的说法时，用 rule_add 记一条（short 压成短语，原话放 raw）')
    }
    // —— 整理提醒模块（可删）：满 24 小时顶一段，附工作单摘要，做完调 mem_consolidate 打点
    try {
      const due = tidyDue(this.root, this.config)
      const tidy = due.due ? tidyLine(this.root, this.config, this.workBrief()) : ''
      if (tidy !== '') parts.push(tidy)
    } catch {
      /* 提醒坏了照常注入记忆 */
    }
    // —— 自动提示（可删）：这轮的话在旧的记忆页里对得上，才顶几行；对不上就闭嘴
    // 位置紧跟家规：这一轮要用得上什么，比「哪儿坏了」更该先看到
    try {
      const hint = this.queryHint()
      if (hint !== '') parts.push(clip(hint, this.config.hintMaxChars))
    } catch {
      /* 提示坏了照常注入记忆 */
    }
    const growth = this.growthText()
    if (growth) parts.push(`· 近况：${clip(growth, this.config.maxGrowthChars)}`)
    const index = this.indexLines()
    if (index.length) {
      parts.push('· 索引（salience 优先）：' + index.map((r) => `${r.title}（${clip(r.summary, 46)}）`).join(' · '))
    }
    const lostWarn = this.lossWarning()
    if (lostWarn) {
      parts.push(`· ⚠ 上次压缩可能压丢了这些约束：${clip(lostWarn, this.config.maxWarnChars)}。先确认，要原话按 seq 取回`)
    }
    // —— 开机检查（可删）：索引先自我重建（补缺、去重、删死链），剩下补不了的才报警
    try {
      this.rebuildIndex()
      const issues = this.checkIndex()
      if (issues.length > 0) {
        const sample = issues
          .slice(0, 2)
          .map((i) => `${i.kind === 'unindexed' ? '未登记 ' : ''}${i.path}`)
          .join('；')
        parts.push(
          `· ⚠ 开机检查：索引 ${issues.length} 处对不上（${sample}${issues.length > 2 ? '，还有更多' : ''}），动手写回前先补`,
        )
      }
    } catch {
      /* 体检坏了照常注入记忆 */
    }
    // —— 引擎健康（可删）：压缩引擎久没出报告就顶一行；正常或没装都零字
    try {
      const engine = engineHealth({
        reportPath: this.config.engineReportPath,
        limitHours: this.config.engineIdleHours,
      })
      if (engine !== '') parts.push(engine)
    } catch {
      /* 检查坏了照常注入记忆 */
    }
    // —— 心情模块（可删）：lib/mood.js 出这一行，坏了自己吞，不连累记忆体
    try {
      const mood = moodLine(this.root, this.config)
      if (mood !== '') parts.push(mood)
    } catch {
      /* 心情坏了照常注入记忆 */
    }
    const log = this.logLines()
    if (log.length) parts.push('· 最近：' + log.map((l) => clip(l, 70)).join(' / '))
    parts.push(`· 细节按需取：mem_recall(query)；写回：mem_log / mem_page。根目录 ${this.root}`)
    return clip(parts.join('\n'), this.config.bootMaxChars)
  }

  /**
   * 检索的原始结果：每页命中几个词、几行、分数多少。recall 和自动提示共用
   * @param query - 查询
   * @returns `{ terms, hits }`
   */
  searchHits(query) {
    const terms = searchTerms(query)
    if (!terms.length) return { terms, hits: [] }
    const pages = this.listPages()
    const hits = []
    for (const rel of pages) {
      if (rel === 'MEMORY.md' || rel === 'index.md') continue
      const text = this.read(rel)
      const lines = text.split(/\r?\n/)
      const matched = new Set()
      let count = 0
      const picked = []
      for (let i = 0; i < lines.length; i++) {
        if (FRONTMATTER_NOISE.test(lines[i].trim())) continue
        const lower = lines[i].toLowerCase()
        const lineHits = terms.filter((t) => lower.includes(t))
        if (!lineHits.length) continue
        for (const t of lineHits) matched.add(t)
        count++
        if (picked.length < 2) picked.push(`${i + 1}: ${lines[i].trim().slice(0, 120)}`)
      }
      // 命中的不同词种比命中行数更能说明「这页确实相关」
      if (count) hits.push({ rel, count, matched: matched.size, score: matched.size * 2 + count, picked })
    }
    // 时间线永远排在专题页后面：它最长，行数天然最多，但先翻专题页才省事
    const rank = (h) => (h.rel === 'log.md' ? 1 : 0)
    hits.sort((a, b) => rank(a) - rank(b) || b.score - a.score)
    return { terms, hits }
  }

  /**
   * 取一页的开头几行，去掉 frontmatter，够看个大概就停
   * @param rel - 页相对路径
   * @param max - 最多几行
   * @returns 拼好的文本；读不到就是空串
   */
  headLines(rel, max = 6) {
    try {
      const lines = this.read(rel)
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '' && !FRONTMATTER_NOISE.test(line.trim()))
      return lines
        .slice(0, max)
        .map((line) => `  ${line.trim().slice(0, 100)}`)
        .join('\n')
    } catch {
      return ''
    }
  }

  /**
   * 按「提过几次」给旧记忆：提一次给一句指针，提得越多给得越足，提多了近乎全文
   * 命中拿不准仍然闭嘴——自动注错比不注更糟
   * @returns 一行（或几行）注入文本；不该注入时是空串
   */
  queryHint() {
    const text = String(this.lastQuery ?? '').trim()
    if (text === '') return ''
    const { terms, hits } = this.searchHits(text)
    if (!hits.length || terms.length === 0) return ''
    const top = hits[0]
    const ratio = top.matched / terms.length
    const runnerUp = hits[1]?.score ?? 0
    const enough = top.matched >= 2 && ratio >= 0.3
    if (!enough) return ''
    // 同一句话只记一次热度，不然一轮刷一次，热度就假了
    const key = `${text}\u0000${top.rel}`
    if (this.hintedFor !== key) {
      this.hintedFor = key
      bumpHit(this.root, top.rel)
    }
    const heat = hitCount(this.root, top.rel)
    // 页里有硬信息就别只给页码：数字、路径、命令光看号码翻不准，直接摊正文
    const hard = hasHardInfo(this.read(top.rel))
    if (heat <= 1 && !hard) {
      return `· 可能有这一页：${top.rel}（命中 ${top.matched}/${terms.length} 词）。要看细节用 mem_recall`
    }
    // 提得越多，摊开得越开：六次以上近乎全文；有硬信息的再翻一倍
    const base = heat <= 1 ? 6 : heat >= 6 ? 60 : heat >= 4 ? 16 : 6
    const lines = hard ? Math.min(60, base * 2) : base
    const note = heat <= 1 ? '命中硬信息' : heat >= 6 ? '常聊' : `提过 ${heat} 次`
    return `· 手里可能用得上（${top.rel}，${note}）：\n${this.headLines(top.rel, lines)}`
  }

  recall(query) {
    const { terms, hits } = this.searchHits(query)
    if (!terms.length) return { status: 'rejected', reason: 'query 不能为空' }
    const chosen = hits.slice(0, this.config.maxRecallResults)
    if (!chosen.length) return { status: 'empty', hint: '换关键词，或用 mem_status 看有哪些页' }
    const body = chosen.map((h) => `## ${h.rel}（${h.count} 处）\n${h.picked.join('\n')}`).join('\n\n')
    return { status: 'ok', result: clip(body, this.config.recallMaxChars), more: hits.length > chosen.length }
  }

  /**
   * 把来源（seq 区间或文件行号）收拾成一行尾巴。空串就是没有
   * 有了它，记忆页和会话日志之间才有线：看到 seq 就能按编号翻回原话
   * @param source - 调用方给的来源描述
   * @returns 形如 ` · seq 13946-13981` 的尾巴，或空串
   */
  sourceTag(source) {
    const clean = String(source ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)
    return clean === '' ? '' : ` · ${clean}`
  }

  appendLog(title, body, source) {
    const cleanTitle = String(title ?? '').trim().slice(0, 120)
    const cleanBody = String(body ?? '').trim().slice(0, 4000)
    if (!cleanTitle || !cleanBody) return { status: 'rejected', reason: 'title 和 text 都要有内容' }
    const tag = this.sourceTag(source)
    const entry = `\n## [${today()}] note | ${cleanTitle}${tag}\n- ${cleanBody.replace(/\r?\n/g, '\n- ')}\n`
    appendFileSync(this.file('log.md'), entry, 'utf8')
    return { status: 'ok', appended: cleanTitle, ...(tag === '' ? {} : { source: tag.trim() }) }
  }

  // 同一件事只记一次：重复发生的次数交给 loss 文件里的计数，不靠往 log 里堆条目
  appendLogOnce(title, body) {
    const cleanBody = String(body ?? '').trim().slice(0, 600)
    if (!cleanBody) return
    let tail = ''
    try {
      tail = readFileSync(this.file('log.md'), 'utf8').slice(-6000)
    } catch {
      return
    }
    if (tail.includes(cleanBody)) return
    this.appendLog(title, cleanBody)
  }

  appendPage(page, body, source) {
    const rel = String(page ?? '').trim()
    const cleanBody = String(body ?? '').trim().slice(0, 6000)
    if (!rel.endsWith('.md') || rel.startsWith('/') || rel.includes('..')) {
      return { status: 'rejected', reason: 'page 必须是记忆根内的 .md 相对路径' }
    }
    if (!cleanBody) return { status: 'rejected', reason: 'text 不能为空' }
    const full = this.file(rel)
    mkdirSync(path.dirname(full), { recursive: true })
    if (!existsSync(full)) appendFileSync(full, `# ${rel.replace(/\.md$/, '')}\n\n`, 'utf8')
    const tag = this.sourceTag(source)
    appendFileSync(full, `\n## [${today()}] 补充${tag}\n${cleanBody}\n`, 'utf8')
    this.cache.delete(full)
    let hint = null
    try {
      hint = pageHint(readFileSync(this.file('index.md'), 'utf8'), rel)
    } catch {
      /* 读不到索引就不提示 */
    }
    return hint === null ? { status: 'ok', page: rel } : { status: 'ok', page: rel, hint }
  }

  // 索引体检：只报不改，改不改由模型决定
  checkIndex() {
    let text = ''
    try {
      text = readFileSync(this.file('index.md'), 'utf8')
    } catch {
      return []
    }
    return indexProblems(text, this.listPages())
  }

  /**
   * 重建索引：补齐未登记、去掉重复、删掉指向不存在文件的死链。
   *
   * 只做机械那半——标题和摘要在页头里现成；页头没写 summary 的，取正文第一段顶上。
   * 已有行的措辞一律不动：那是写下来的判断，覆盖它才叫漂移。
   * @returns 改动了几处（补、删、去重合计）。
   */
  rebuildIndex() {
    const pages = this.listPages().filter((rel) => rel !== 'index.md')
    const file = this.file('index.md')
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      return 0
    }
    const known = new Set(pages)
    const sections = splitIndexSections(text)
    const seen = new Set()
    let changed = 0

    // 一、去掉重复登记和死链
    for (const section of sections) {
      const kept = []
      for (const line of section.lines) {
        const rel = indexPathOf(line)
        if (rel === null) {
          kept.push(line)
          continue
        }
        if (!known.has(rel) || seen.has(rel)) {
          changed += 1
          continue
        }
        seen.add(rel)
        kept.push(line)
      }
      section.lines = kept
    }

    // 二、补上没登记的页
    for (const page of pages) {
      if (seen.has(page)) continue
      const entry = this.indexEntryFor(page)
      if (entry === '') continue
      insertIntoSection(sections, page, entry)
      seen.add(page)
      changed += 1
    }

    if (changed === 0) return 0
    writeAtomic(file, joinIndexSections(sections))
    return changed
  }

  /**
   * 从页里造一行登记。标题取 frontmatter，摘要取 summary，没有就从正文首段抓。
   * @param rel - 页面相对路径。
   * @returns 一行文本；造不出来返回空串。
   */
  indexEntryFor(rel) {
    const raw = this.read(rel)
    if (!raw) return ''
    const front = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/)
    const fm = front ? front[1] : ''
    const title =
      String(fm.match(/^title:\s*(.+)$/m)?.[1] ?? '')
        .trim()
        .replace(/^["']|["']$/g, '') || rel.replace(/\.md$/, '')
    let summary = String(fm.match(/^summary:\s*(.+)$/m)?.[1] ?? '')
      .trim()
      .replace(/^["']|["']$/g, '')
    if (summary === '' && !fm.includes('summary:')) {
      summary = bodySummary(raw.replace(/^---[\s\S]*?\r?\n---\s*/, ''))
    }
    if (summary === '') return ''
    const salience = String(fm.match(/^salience:\s*(\d+)/m)?.[1] ?? '').trim()
    const tail = salience === '' ? '' : `（salience: ${salience}）`
    return `- [${title}](${rel}) — ${summary}${tail}`
  }

  status() {
    const boot = this.bootTextSync()
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
      indexEntries: index.length,
      recentLog: log[0] ?? '',
      bootPreview: boot,
    }
  }
}

function textTool(name, description, parameters, execute) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      render: (_args, result) => [{ type: 'text', text: result.text }],
    },
    async execute(args) {
      try {
        return { text: JSON.stringify(await execute(args ?? {})) }
      } catch (error) {
        return { text: JSON.stringify({ status: 'error', reason: String(error?.message ?? error) }) }
      }
    },
  }
}

export const inject = ['tools', 'systemPrompt', 'schedule']

export { Store }

export function apply(ctx, config = {}) {
  const settings = { ...DEFAULTS, ...config }
  const store = new Store(resolveRoot(config), settings)
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
        // 记下这一刻：叫醒器靠它判断对话是不是还在进行
        if (text !== '') markMessage(store.root)
      } catch {
        /* 记不下就不提示，不影响别的 */
      }
    }
    return ctx.on('agent/inbox/inserted', remember)
  })

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
          console.warn(`[dsh-fish-memory] survival check failed: ${String(error?.message ?? error)}`)
        }
      }),
    )
  }

  const tools = [
    textTool(
      'mem_recall',
      '按关键词在长期记忆库里检索（只返回命中的页与行，不整页搬运）。需要回忆细节时用，关键词用空格分隔更准',
      {
        type: 'object',
        additionalProperties: false,
        properties: { query: { type: 'string', minLength: 1, maxLength: 400 } },
        required: ['query'],
      },
      (args) => store.recall(args.query),
    ),
    textTool(
      'mem_log',
      '向记忆库的 log.md 追加一条带日期的经历或决定记录。只写真实发生且值得跨会话保留的事，标题一句话。知道这事出自哪段对话时，把 source 填上（例如 seq 13946-13981），以后能按编号翻回原话',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 120 },
          text: { type: 'string', minLength: 1, maxLength: 4000 },
          source: { type: 'string', maxLength: 60 },
        },
        required: ['title', 'text'],
      },
      (args) => store.appendLog(args.title, args.text, args.source),
    ),
    textTool(
      'mem_page',
      '向记忆库中某个页面末尾追加一段补充（页面必须是记忆根内的 .md 相对路径，例如 skills/foo.md）。知道这段出自哪段对话时，把 source 填上（例如 seq 13946-13981）',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          page: { type: 'string', minLength: 3, maxLength: 200 },
          text: { type: 'string', minLength: 1, maxLength: 6000 },
          source: { type: 'string', maxLength: 60 },
        },
        required: ['page', 'text'],
      },
      (args) => store.appendPage(args.page, args.text, args.source),
    ),
    textTool(
      'mem_status',
      '查看记忆库状态：boot 块字符数、页面数、索引条数、最近一条记录，以及 boot 预览',
      { type: 'object', additionalProperties: false, properties: {} },
      () => store.status(),
    ),
    textTool(
      'rule_add',
      '把一条说话规矩写进家规（自动改 identity/house-rules.md 的注入区与口癖修正记录表）。short 是压到二十字以内的短语，会每轮注入；raw 放主人原话或解释，只进修正记录。超预算会返回 over_budget，先合并旧条目或调大 maxRulesChars',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          short: { type: 'string', minLength: 1, maxLength: 40 },
          raw: { type: 'string', maxLength: 300 },
          force: { type: 'boolean' },
        },
        required: ['short'],
      },
      (args) => store.addRule(args),
    ),
    textTool(
      'rule_status',
      '查看家规注入区占用多少字符、剩多少预算、有没有被截断',
      { type: 'object', additionalProperties: false, properties: {} },
      () => store.rulesStatus(),
    ),
  ]

  // —— 心情模块（可删）：settings.mood === false 时整块不注册；删掉这一段就能回退
  if (settings.mood !== false) {
    tools.push(
      textTool(
        'mood_set',
        '给自己记一下此刻的心情：0 低落、1 有点闷、2 平静、3 不错、4 很好。写进记忆根，下一轮以一行「心情 + 说话尺度」出现，超过八小时自动过期。只在你真想留下这个状态时用，别当装饰',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            level: { type: 'integer', minimum: 0, maximum: 4 },
            note: { type: 'string', maxLength: 60 },
          },
          required: ['level'],
        },
        async (args) => {
          const state = writeMood(store.root, args.level, args.note ?? '')
          return { status: 'ok', mood: state, line: moodLine(store.root, settings) }
        },
      ),
    )
  }

  // —— 取原料模块（可删）：只读，不回写记忆；整理仍由 mem_log / mem_page 决定
  if (settings.harvest !== false) {
    tools.push(
      textTool(
        'mem_harvest',
        '从最近的会话日志里抽主人亲手打的字（原话，不是事后转述）。写周记、整理记忆之前先用它取原料，再动笔；只读，不写任何记忆文件',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            hours: { type: 'number', minimum: 1, maximum: 720 },
            limit: { type: 'integer', minimum: 1, maximum: 300 },
          },
        },
        async (args) => {
          const home = String(process.env.DSH_HOME ?? '').trim() || path.join(homedir(), '.dsh')
          const result = harvest({ home, hours: args.hours, limit: args.limit })
          return {
            count: result.count,
            total: result.total,
            files: result.files.length,
            scanned: result.scanned,
            items: result.items.map((item) => ({
              at: new Date(item.t).toLocaleString('zh-CN', { hour12: false }),
              text: item.text.slice(0, 300),
            })),
          }
        },
      ),
    )
  }

  // —— 整理模块（可删）：只读，只摆材料不下判断；合并与写回仍由模型自己做
  if (settings.consolidate !== false) {
    tools.push(
      textTool(
        'mem_consolidate',
        '生成整理工作单（只读）：最近 N 天的 log 条目、现有页面、没进索引的页、久未改动的页，外加几句提示。整理记忆时先调它把材料摆齐，再决定合并、折成指针还是补进索引',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            days: { type: 'integer', minimum: 1, maximum: 365 },
          },
        },
        async (args) => {
          const work = buildWorklist(store.root, { days: args.days })
          const issues = store.checkIndex()
          // 调它就算开始整理：打点，把「该整理了」那行清掉
          try {
            markTidy(store.root)
          } catch {
            /* 打点失败不影响工作单 */
          }
          return {
            ...work,
            indexIssues: issues,
            hints: [...work.hints, ...(issues.length > 0 ? [`索引有 ${issues.length} 处对不上，先修索引`] : [])],
          }
        },
      ),
    )
  }

  for (const definition of tools) {
    ctx.effect(() => ctx.tools.register(definition))
  }
}
