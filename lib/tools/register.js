/**
 * 工具注册（2026-11-28 P3-S1 从 index.js 搬出）。
 *
 * 只建工具定义，不注册；注册仍由插件的 apply 做。
 * 依赖全部由调用方传入，模块本身不读配置、不碰 ctx。
 */
import { homedir } from 'node:os'
import path from 'node:path'
import { draftLine, pendingDrafts, readDraft, markDraft } from '../drafts.js'

/** 一个只返回一段文本的工具：参数校验交给宿主，异常统一转成 error 文本。 */
function createTextTool(name, description, parameters, execute) {
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



/**
 * 建这一轮要注册的工具。
 * @param deps - store/settings/若干小工具；缺哪个会在调用时报错，不静默吞。
 * @returns 工具定义数组。
 */
export function buildTools(deps) {
  const {
    store, settings, harvest, shortSession, readSeqRange, readLive,
    parsePointer, checkPointer, moodLine, markTidy, markDiary,
    buildWorklist, diaryPageOf, writeMood, writeMoodScores,
  } = deps
  const textTool = createTextTool
  const join = path.join
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
      'mem_live',
      '看别的窗口刚才在做什么（共享流水）。只返回其他会话最近几轮的话题，自己刚写的会被过滤掉；想了解并行会话的进度时用它，不必进 boot',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 20 },
        },
      },
      (args) => {
        const rows = readLive(store.root, { exclude: store.activeSession, limit: Number(args.limit ?? 8) })
        if (rows.length === 0) return { status: 'ok', text: '没有其他窗口的记录（要么只有这一个会话在跑，要么流水还没写进来）' }
        const lines = rows.map((row) => {
          const time = new Date(Number(row.at ?? 0)).toTimeString().slice(0, 5)
          return `· ${time} 会话 ${shortSession(row.session)}（seq ${row.seq}）：${row.topic}`
        })
        return { status: 'ok', text: lines.join('\n') }
      },
    ),
    textTool(
      'mem_seq',
      '按 seq 区间把会话原文读回来（自带，不依赖压缩插件）。记忆页里写着 seq 时用它取原文；seq 是会话内的编号，跨会话要带 session。返回 nextOffset 时用同一个区间加 offset 继续',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: { type: 'integer', minimum: 0 },
          to: { type: 'integer', minimum: 0 },
          session: { type: 'string', maxLength: 80 },
          pointer: { type: 'string', maxLength: 120 },
        },
        required: [],
      },
      (args) => {
        // 指针优先：S:<会话>#from-to 自带会话，不会再指空。
        const parsed = args.pointer === undefined ? null : parsePointer(args.pointer)
        if (args.pointer !== undefined && parsed === null) {
          return { status: 'rejected', reason: '指针格式应是 S:<会话id>#from-to，例：S:afac32c7#19559-22545' }
        }
        const from = parsed === null ? args.from : parsed.from
        const to = parsed === null ? args.to : parsed.to
        if (from === undefined || to === undefined) {
          return { status: 'rejected', reason: '要么给 from/to，要么给 pointer' }
        }
        const session = parsed === null
          ? (String(args.session ?? '').trim() || String(store.activeSession ?? ''))
          : parsed.session
        const check = checkPointer(parsed ?? { session, from, to })
        if (check.ok === false) return { status: 'stale', reason: check.reason }
        const result = readSeqRange({ from, to, session })
        if (result.status !== 'ok') return result
        return {
          status: 'ok',
          session: result.session,
          events: result.events,
          chars: result.chars,
          text: result.text,
        }
      },
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
      '向记忆库中某个页面末尾追加一段补充（页面必须是记忆根内的 .md 相对路径，例如 skills/foo.md）。source 必填（写页必须能指回原文）：填 seq 区间，例如 seq 13946-13981；确实没有 seq 的写「无 seq：原因」。新建页时填 origin 标清这段是怎么来的：stated 是主人亲口说的、observed 是自己查证过的、inferred 是推出来的；推断和事实不分开，以后就分不清了。旧页不加这个标签',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          page: { type: 'string', minLength: 3, maxLength: 200 },
          text: { type: 'string', minLength: 1, maxLength: 6000 },
          source: { type: 'string', maxLength: 60 },
          origin: { type: 'string', enum: ['stated', 'observed', 'inferred'] },
        },
        required: ['page', 'text'],
      },
      (args) => store.appendPage(args.page, args.text, args.source, args.origin),
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
        '给自己记一下此刻的情绪。七情（喜/怒/忧/思/悲/恐/惊）各自打 0–3 分，多个维度可以同时有分；≥2 分才参与表现，主情绪定语气、次情绪补一句、其余并成基调，1 分只记不表现。trigger 写一句事实（为什么）。写进记忆根，下一轮以一行「情绪 + 行为尺度」出现，超过八小时自动过期。全 0 等于清掉',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            scores: {
              type: 'object',
              additionalProperties: false,
              properties: {
                喜: { type: 'integer', minimum: 0, maximum: 3 },
                怒: { type: 'integer', minimum: 0, maximum: 3 },
                忧: { type: 'integer', minimum: 0, maximum: 3 },
                思: { type: 'integer', minimum: 0, maximum: 3 },
                悲: { type: 'integer', minimum: 0, maximum: 3 },
                恐: { type: 'integer', minimum: 0, maximum: 3 },
                惊: { type: 'integer', minimum: 0, maximum: 3 },
              },
            },
            emotion: { type: 'string', enum: ['喜', '怒', '忧', '思', '悲', '恐', '惊'] },
            intensity: { type: 'integer', minimum: 0, maximum: 3 },
            trigger: { type: 'string', maxLength: 120 },
          },
        },
        async (args) => {
          // 两种写法都收：多维度用 scores，单一情绪用 emotion + intensity（兼容旧调用）。
          const state = args.scores !== undefined
            ? writeMoodScores(store.root, args.scores, args.trigger ?? '')
            : args.emotion !== undefined
              ? writeMood(store.root, args.emotion, args.intensity ?? 2, args.trigger ?? '')
              : null
          if (state === null) return { status: 'error', reason: '要么给 scores，要么给 emotion + intensity' }
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
          // 2026-11-28 P4：顺手生成一份 A/B/C 草案（已有 pending 就不重复生成）。
          // 2026-11-28 起这件事到期会自动做；这里保留手动入口，方便随时重算。
          let created = null
          try {
            created = store.generateConsolidationDraft()
          } catch {
            /* 草案生成失败不影响工作单 */
          }
          return {
            ...work,
            indexIssues: issues,
            draftCreated: created,
            drafts: pendingDrafts(store.root).map((item) => ({ file: item.file, created: item.created, line: draftLine(store.root) })),
            hints: [...work.hints, ...(issues.length > 0 ? [`索引有 ${issues.length} 处对不上，先修索引`] : [])],
          }
        },
      ),
    )
  }

  // —— 整理草案（P4）：把引擎算好的 A/B/C 拿出来，处理完显式打点
  tools.push(
    textTool(
      'mem_drafts',
      '整理草案：list 取待处理的草案正文（A 变更表 / B 同题簇 / C 冲突），apply 或 drop 打点。拿到草案后按 A 表比对新旧、按 B 簇决定合并，再自己写回页；引擎不会自动写页',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['list', 'apply', 'drop'] },
          file: { type: 'string', maxLength: 120 },
        },
        required: ['action'],
      },
      (args) => {
        const action = String(args.action ?? 'list')
        if (action === 'list') {
          const pending = pendingDrafts(store.root)
          if (pending.length === 0) return { status: 'ok', drafts: [], text: '没有待处理的整理草案' }
          return {
            status: 'ok',
            drafts: pending.map((item) => ({ file: item.file, created: item.created, body: readDraft(store.root, item.file)?.body ?? '' })),
          }
        }
        const file = String(args.file ?? '').trim()
        if (file === '') return { status: 'rejected', reason: 'apply/drop 要带 file' }
        const marked = markDraft(store.root, file, action === 'apply' ? 'applied' : 'dropped')
        if (marked.status !== 'ok') return { status: 'rejected', reason: `找不到草案 ${file}` }
        return { status: 'ok', file, now: marked.statusNow, pending: pendingDrafts(store.root).length }
      },
    ),
  )

  // —— 日记模块（可删）：写完打点，把「该写日记」那行清掉
  if (settings.diary !== false) {
    tools.push(
      textTool(
        'mem_diary',
        '写完今天的日记之后调它打点：记下写完的时间，「该写日记」那行就会消失。只打点、不写正文——正文用 mem_page 落到 journal/当天日期.md',
        {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        async () => {
          const page = diaryPageOf()
          try {
            markDiary(store.root)
          } catch {
            /* 打点失败也把页名给出去 */
          }
          return { status: 'ok', page }
        },
      ),
    )
  }
  return tools
}
