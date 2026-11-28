/**
 * 召回与自动提示的取景（2026-11-28 P3-S5 从 index.js 搬出）。
 *
 * 排序与判据已经由引擎负责；这里只做「取正文/取 seq/拼提示」。
 * 状态（pendingHint / lastHintSig / hintedFor）仍挂在 store 上，搬函数不搬状态。
 */
import { bumpHit } from './heat.js'
import { bumpMetric } from './metrics.js'
import { clip, FRONTMATTER_NOISE } from './text.js'
import { lastCompaction } from './compact.js'

  /**
   * 取一页的开头几行，去掉 frontmatter，够看个大概就停
   * @param rel - 页相对路径
   * @param max - 最多几行
   * @returns 拼好的文本；读不到就是空串
   */
export function headLines(store, rel, max = 6) {
    try {
      const lines = store.read(rel)
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
   * 页里记过的 seq 指回：命中行往上找最近的一行 `seq A-B`。
   *
   * 2026-11-22 为什么：鲫鱼压完已经给每个块留了 `[块 seq a-b]` 和「原文按 seq 取回」，
   * 记忆体再贴一段正文，等于给同一件事第二套坐标。这里只回答「哪一页记过」，
   * 原文一律走 seq——两条通路合成一条：页 → seq → jiyu_recall。
   * @param rel - 页相对路径。
   * @param terms - 命中的词。
   * @returns 形如 `10740-10770` 的区间；找不到就是空串。
   */
export function seqNear(store, rel, terms) {
    try {
      const lines = store.read(rel).split(/\r?\n/)
      const SEQ = /seq\s+(\d{2,})(?:\s*[-–]\s*(\d{2,}))?/
      const SESSION = /会话\s+(session-[A-Za-z0-9-]+|[A-Za-z0-9-]{6,})/
      for (let i = 0; i < lines.length; i += 1) {
        if (!terms.some((term) => lines[i].includes(term))) continue
        for (let j = i; j >= Math.max(0, i - 8); j -= 1) {
          const m = SEQ.exec(lines[j])
          if (!m) continue
          const sess = SESSION.exec(lines[j])
          return {
            seq: m[2] ? `${m[1]}-${m[2]}` : m[1],
            session: sess ? String(sess[1]) : '',
          }
        }
      }
      return { seq: '', session: '' }
    } catch {
      return ''
    }
  }

  /**
   * 挑出页里真正命中的那几行，带页上日期，最多三行。
   *
   * 为什么不再整段贴：整页贴进来噪音大、占 token，更糟的是模型容易把
   * 页里别的内容也当成这轮的证据。只给命中的行，反而更该去看原文。
   *
   * @param rel - 页相对路径。
   * @param terms - 命中的词。
   * @param max - 最多几行，默认三行。
   * @returns 带日期的几行文本；挑不出就是空串。
   */
export function hitLines(store, rel, terms, max = 3) {
    try {
      const raw = store.read(rel)
      const date = (raw.match(/^date:\s*(.+)$/m) ?? [])[1] ?? ''
      const body = raw
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '' && !FRONTMATTER_NOISE.test(line.trim()))
      const picked = []
      for (const line of body) {
        if (picked.length >= max) break
        if (!terms.some((term) => line.includes(term))) continue
        picked.push(`  ${line.trim().slice(0, 90)}`)
      }
      if (picked.length === 0) return ''
      const head = date === '' ? '' : `（页上日期 ${String(date).trim()}）`
      return head + (head === '' ? '' : '\n') + picked.join('\n')
    } catch {
      return ''
    }
  }

  /**
   * 按「提过几次」给旧记忆：提一次给指针，提得越多给得越足，提多了近乎全文
   * 命中拿不准仍然闭嘴——自动注错比不注更糟
   * @returns 一行（或几行）注入文本；不该注入时是空串
   */
export function queryHint(store) {
    const text = String(store.lastQuery ?? '').trim()
    if (text === '') return ''
    const { terms, hits } = store.searchHits(text)
    if (!hits.length || terms.length === 0) return ''
    const top = hits[0]
    // 2026-11-28 P3：判「够不够答」交给引擎；默认 strict，引擎抛错时由 store 回退 legacy。
    const verdict = store.answerVerdict(terms, hits)
    if (!verdict.ok) return ''
    // 同一句话只记一次热度，不然一轮刷一次，热度就假了
    const key = `${text}\u0000${top.rel}`
    if (store.hintedFor !== key) {
      store.hintedFor = key
      bumpHit(store.root, top.rel)
    }
    // 2026-11-22 为什么不再贴正文：鲫鱼的检查点里每个块都带 `[块 seq a-b]` 和
    // 「原文按 seq 取回」，记忆体再贴一段，等于给同一件事第二套坐标。这里只负责
    // 「哪一页记过这件事」；原文走 jiyu_recall(seq)，没有 seq 才退回 mem_recall。
    const near = store.seqNear(top.rel, terms)
    const seq = near.seq
    const where = seq === '' ? top.rel : `${top.rel}，seq ${seq}${near.session === '' ? '' : `（会话 ${near.session}）`}`
    // 签名里带上最近一次压缩的时间——那段历史被折掉了，就得重新给一次。
    let compactedAt = ''
    try {
      compactedAt = lastCompaction()?.at ?? ''
    } catch {
      /* 读不到压缩时间就当没压过 */
    }
    const sig = `${top.rel}\u0000${seq}\u0000${compactedAt}`
    if (store.lastHintSig === sig) return ''
    store.lastHintSig = sig
    bumpMetric(store.root, 'hint')
    // 记下发出去的这一条：下一轮要么被召回用掉，要么记一次空转
    store.pendingHint = top.rel
    // 取回走自带的 mem_seq：不认哪个压缩引擎在跑，日志在就能取。
    const tail = seq === '' ? '要看细节用 mem_recall' : '原文用 mem_seq 按这个 seq 取回'
    return `· 记过这件事的页：${where}（命中 ${top.matched}/${terms.length} 词）；${tail}`
  }

export function recall(store, query) {
    // —— 度量模块（可删）：删掉这两行和 mem_status 里那行即可
    bumpMetric(store.root, 'recall')
    const { terms, hits } = store.searchHits(query)
    const warning = typeof store.engineWarningText === 'function' ? store.engineWarningText() : ''
    if (!terms.length) return { status: 'rejected', reason: 'query 不能为空', ...(warning === '' ? {} : { warning }) }
    const chosen = hits.slice(0, store.config.maxRecallResults)
    if (!chosen.length) return { status: 'empty', hint: '换关键词，或用 mem_status 看有哪些页', ...(warning === '' ? {} : { warning }) }
    bumpMetric(store.root, 'recallHit')
    // 上一轮提示的那页真被读了：算它有用，不再计空转
    if (store.pendingHint !== null && chosen.some((h) => h.rel === store.pendingHint)) {
      bumpMetric(store.root, 'hintUsed')
      store.pendingHint = null
    }
    const body = chosen.map((h) => `## ${h.rel}（${h.count} 处）\n${h.picked.join('\n')}`).join('\n\n')
    const text = clip(body, store.config.recallMaxChars)
    return {
      status: 'ok',
      result: warning === '' ? text : `⚠ ${warning}\n\n${text}`,
      more: hits.length > chosen.length,
      ...(warning === '' ? {} : { engineFallback: true }),
    }
  }

  /**
   * 把来源（seq 区间或文件行号）收拾成一行尾巴。空串就是没有
   * 有了它，记忆页和会话日志之间才有线：看到 seq 就能按编号翻回原话
   * @param source - 调用方给的来源描述
   * @returns 形如 ` · seq 13946-13981` 的尾巴，或空串
   */
export function sourceTag(store, source) {
    const clean = String(source ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)
    if (clean === '') return ''
    // 2026-11-22 为什么补会话：seq 是按会话编号的，同一个数字在别的对话里是别的内容。
    // 页里只写 seq 不写会话，换一个会话就会指到无关原文——比没有指针更糟。
    const hasSeq = /seq/i.test(clean)
    const hasSession = /会话/.test(clean)
    const session = String(store.activeSession ?? '').trim()
    if (!hasSeq || hasSession || session === '') return ` · ${clean}`
    return ` · ${clean} · 会话 ${session}`
  }

