/**
 * boot 拼装（2026-11-28 P3-S4 从 index.js 搬出）。
 *
 * 只负责「按固定顺序拼出一段文本」，各段的来源仍由调用方传入（deps）：
 * CORE_PERSONA / wakeLine / moodLineWithin / tidyDue / tidyLine / diaryLine /
 * oldPageLine / compactionLine / bumpMetric / clip。
 * 顺序有讲究：人格与家规靠前，索引与最近在尾巴，被截也只截尾巴。
 */
import { buildWorklist } from './consolidate.js'

// deps 漏传时的兜底：宁可截得粗一点，也不要整段 boot 抛错
const defaultClip = (text, max) => {
  const value = String(text ?? '')
  return value.length <= max ? value : value.slice(0, Math.max(0, max - 12)) + '…[截断]'
}

export function workBrief(store) {
    let work
    try {
      work = buildWorklist(store.root, { days: 7 })
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
    lines.push('处理完用 mem_drafts apply/drop 打点；想重算草案再调 mem_consolidate')
    return lines.join('\n')
  }

export function bootTextSync(store, deps = {}) {
  const {
    CORE_PERSONA, wakeLine, moodLineWithin, tidyDue, tidyLine,
    diaryLine, oldPageLine, compactionLine, bumpMetric, draftLine, personaMode,
    autoConsolidate = true, clip = defaultClip,
  } = deps
    const parts = [`【${store.config.memoryName || ''}记忆体·精简版】`]
    // —— 度量模块（可删）：上一轮给的提示，整整一轮没人碰，记一次空转
    if (store.pendingHint !== null) {
      bumpMetric(store.root, 'hintIdle')
      store.pendingHint = null
    }
    // 库不在就先铺骨架：新装、或者换了记忆根，第一次跑就自己站起来
    let seeded = false
    try {
      seeded = store.ensureHome()
    } catch {
      /* 建不了照常往下走，空库提示会接住 */
    }
    if (seeded) parts.push('· 记忆库刚建好：先写 SOUL.md 定名字和称呼，再往里记东西')
    // —— 主动唤醒（可删）：只比主人这句话低，所以放在最前面
    try {
      const wake = wakeLine(store.root, store.activeSession || '')
      if (wake !== '') parts.push(wake)
    } catch {
      /* 唤醒坏了照常注入记忆 */
    }
    const persona = store.personaLine()
    if (persona) parts.push(`· ${persona}`)
    // 人格基干单独一行，内容只有这个常量本身，不拼任何东西，所以长度永远不变。
    // personaMode='preset' 时不注入：人格交给 agent preset（2026-11-28 为搬家留的开关）。
    // 漏传 CORE_PERSONA 时宁可少一行，也不要往 boot 里塞「· undefined」
    if (personaMode !== 'preset' && CORE_PERSONA) parts.push(`· ${CORE_PERSONA}`)
    // —— 会话身份（2026-11-25）：以前 boot 里没有「我是谁」，换个窗口醒来分不清
    // 刚才那句话是自己说的还是另一个窗口说的。这行在一个会话内不变，不会打断缓存；
    // 新会话本来要重建前缀，跟着一起写进去就行。
    const sid = String(store.activeSession ?? '').trim()
    if (sid !== '') {
      parts.push(`· 会话：${sid.replace(/^session-/, '').slice(0, 8)}（自己；mem_live 会自动过滤这个 id）`)
    }
    // 家规紧跟人格：位置越靠前越吃得到注意力，放中段等于没写
    const rules = store.rulesText()
    // 整行地放：一行一条，超预算就整条省略，不把一条规矩切成半句。
    if (rules) parts.push(`· 家规：${store.fitRules(store.config.maxRulesChars)}`)
    else if (store.config.rulesHint !== false) {
      parts.push('· 家规：还没有。主人纠正你的说法时，用 rule_add 记一条（short 压成短语，原话放 raw）')
    }
    // —— 心情模块（可删）：紧跟家规，单独预算。它跟家规一样是每轮都要看到的行，
    // 但不能因为索引/近况变长就被截掉半句——2026-11-25 主人定：情绪要有自己的位置。
    try {
      const mood = moodLineWithin(store.root, store.config)
      if (mood !== '') parts.push(mood)
    } catch {
      /* 心情坏了照常注入记忆 */
    }
    // —— 整理提醒（可删）：满 24 小时先自动出草案并打点；模型只处理 mem_drafts
    try {
      let due = tidyDue(store.root, store.config)
      // 2026-11-28：到期先自动出草案，不再要求模型先调 mem_consolidate。
      // 生成成功会打点，due 立刻变 false；这一轮只留下面的「草案待处理」一行。
      if (autoConsolidate && due.due && typeof store.autoConsolidate === 'function') {
        const auto = store.autoConsolidate()
        if (auto?.ran) due = tidyDue(store.root, store.config)
      }
      const tidy = due.due ? tidyLine(store.root, store.config, store.workBrief()) : ''
      if (tidy !== '') parts.push(tidy)
    } catch {
      /* 提醒坏了照常注入记忆 */
    }
    // —— 日记提醒模块（可删）：满 diaryHours 顶一行，写着今天该落在哪页
    try {
      const diary = diaryLine(store.root, store.config)
      if (diary !== '') parts.push(diary)
    } catch {
      /* 提醒坏了照常注入记忆 */
    }
    // —— 自动提示（可删）：这轮的话在旧的记忆页里对得上，才顶几行；对不上就闭嘴
    // 位置紧跟家规：这一轮要用得上什么，比「哪儿坏了」更该先看到
    try {
      const hint = store.config.autoHint === false ? '' : store.queryHint()
      if (hint !== '') parts.push(clip(hint, store.config.hintMaxChars))
    } catch {
      /* 提示坏了照常注入记忆 */
    }
    // 2026-11-28 P4：有待处理草案就报一行；数量与最旧天数都来自磁盘状态，不靠模型记。
    try {
      const drafts = typeof draftLine === 'function' ? draftLine(store.root) : ''
      if (drafts !== '') parts.push(drafts)
    } catch {
      /* 草案状态读不出来照常注入记忆 */
    }
    // —— 时态声明（可删）：它下面这些是历史记录，不是此刻的状态。
    // 少了这句，推断出来的东西和亲眼见过的长得一样，一旦推错就一直错下去。
    parts.push('· 下面这些是过去的记录，不是此刻的状态；和现在对不上，以现在为准')
    // —— 压缩线模块（可删）：压缩引擎刚压完的那段，把 seq 范围接上来
    try {
      const compacted = compactionLine()
      if (compacted !== '') parts.push(compacted)
    } catch {
      /* 读不到压缩报告照常注入记忆 */
    }
    // —— 旧页提醒模块（可删）：给最久没被碰过的那页一个固定位置，一次一条
    try {
      const old = oldPageLine(store.root, store.config)
      if (old !== '') parts.push(old)
    } catch {
      /* 挑不出旧页照常注入记忆 */
    }
    // 2026-11-28：近况不再进 boot。
    // 原因：这一行是「latest 一条」，代码没法判断里面的**事实**新不新鲜——
    // 实测 boot 里写着「鲫鱼 0.4.14 / 记忆体 0.6.11」，而当天是 1.0.1 / 0.6.20。
    // 按日期过期也不够：11-25 那条在 7 天内，版本号却早过期了。
    // 页仍然保留（`identity/growth.md`），要看用 mem_recall；boot 里不再用它占位。
    const index = store.indexLines()
    if (index.length) {
      parts.push('· 索引（salience 优先）：' + index.map((r) => `${r.title}（${clip(r.summary, 20)}）`).join(' · '))
    }
    const lostWarn = store.lossWarning()
    if (lostWarn) {
      parts.push(`· ⚠ 上次压缩可能压丢了这些约束：${clip(lostWarn, store.config.maxWarnChars)}。先确认，要原话按 seq 取回`)
    }
    // —— 引擎兜底告警：只在 bm25 / strict 真的抛错、临时退回 legacy 时出现
    try {
      const engineWarn = store.engineWarningLine()
      if (engineWarn) parts.push(engineWarn)
    } catch {
      /* 读不到兜底状态照常注入记忆 */
    }
    // —— 开机检查（可删）：索引先自我重建（补缺、去重、删死链），剩下补不了的才报警
    try {
      store.rebuildIndex()
      const issues = store.checkIndex()
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
    const log = store.logLines()
    // 只留最近一条：这一行在预算尾巴上，多了必被截，截一半比不给更糟
    if (log.length) parts.push('· 最近：' + clip(log[log.length - 1], 50))
    parts.push(`· 细节按需取：mem_recall(query)；写回：mem_log / mem_page。根目录 ${store.root}`)
    const max = Number(store.config.bootMaxChars) || 2000
    const body = parts.join('\n')
    if (body.length <= max) return body
    // 顺序就是优先级：人格、家规在前，索引、最近在尾巴。
    // 情绪行能保住就保住，但绝不为它把前面整段砍掉——那样人格和家规会一起消失。
    const moodIdx = parts.findIndex((line) => line.startsWith('· 情绪：'))
    if (moodIdx >= 0) {
      const before = parts.slice(0, moodIdx + 1).join('\n')
      if (before.length < max) {
        const rest = parts.slice(moodIdx + 1).join('\n')
        return `${before}\n${clip(rest, max - before.length - 1)}`
      }
    }
    return clip(body, max)
  }
