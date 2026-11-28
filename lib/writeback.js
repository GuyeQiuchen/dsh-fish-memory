/**
 * 写回（2026-11-28 P3-S6 从 index.js 搬出）。
 *
 * log 追加、页追加、来源标签。参数校验与截断仍在这里，
 * 「写到哪」由 store.file/read 决定，模块不自己拼根目录。
 */
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { today } from './day.js'
import { pageHint } from './indexcheck.js'

export function appendLog(store, title, body, source) {
    const cleanTitle = String(title ?? '').trim().slice(0, 120)
    const cleanBody = String(body ?? '').trim().slice(0, 4000)
    if (!cleanTitle || !cleanBody) return { status: 'rejected', reason: 'title 和 text 都要有内容' }
    const tag = store.sourceTag(source)
    const entry = `\n## [${today()}] note | ${cleanTitle}${tag}\n- ${cleanBody.replace(/\r?\n/g, '\n- ')}\n`
    appendFileSync(store.file('log.md'), entry, 'utf8')
    return { status: 'ok', appended: cleanTitle, ...(tag === '' ? {} : { source: tag.trim() }) }
  }

  // 同一件事只记一次：重复发生的次数交给 loss 文件里的计数，不靠往 log 里堆条目
export function appendLogOnce(store, title, body) {
    const cleanBody = String(body ?? '').trim().slice(0, 600)
    if (!cleanBody) return
    let tail = ''
    try {
      tail = readFileSync(store.file('log.md'), 'utf8').slice(-6000)
    } catch {
      return
    }
    if (tail.includes(cleanBody)) return
    store.appendLog(title, cleanBody)
  }

  /**
   * 来源标签：只在新建页时写一行，旧页一律不动。
   *
   * 为什么不给旧页补：批量重判等于把所有旧记忆重写一遍，
   * 而且旧页里哪些是推断已经无从查证了，硬标反而更假。
   * @param origin - stated / observed / inferred，其它值一律当没给。
   * @returns 形如 `> 来源：推断（未经核实）` 的一行；没给就是空串。
   */
export function originLine(origin) {
    const label = { stated: '主人亲口说的', observed: '自己查证过的', inferred: '推断，未经核实' }[origin]
    return label === undefined ? '' : `> 来源：${label}\n\n`
  }

export function appendPage(store, page, body, source, origin) {
    const rel = String(page ?? '').trim()
    const cleanBody = String(body ?? '').trim().slice(0, 6000)
    // 2026-11-23 为什么：页里没有 seq，就指不回原文（实测 10 页里 6 页如此）。
    // 强制来源，但允许诚实声明「无 seq：原因」——不许的是空着。
    const cleanSource = String(source ?? '').trim()
    if (cleanSource === '') {
      return {
        status: 'rejected',
        reason: '写页必须带来源：传 source，例如 "seq 12030-12145"。整段偏好/人生这类确实没有 seq 的，写 "无 seq：原因"，不要空着',
      }
    }
    if (!/seq\s*\d/i.test(cleanSource) && !/^无\s*seq/.test(cleanSource)) {
      return { status: 'rejected', reason: 'source 里要能看出 seq（如 seq 12030-12145）；实在没有，写 "无 seq：原因"' }
    }
    if (!rel.endsWith('.md') || rel.startsWith('/') || rel.includes('..')) {
      return { status: 'rejected', reason: 'page 必须是记忆根内的 .md 相对路径' }
    }
    // 索引、日志、人格这些是结构文件，用专门工具写；mem_page 只写内容页
    if (/^(index|log|SOUL|MEMORY|BOOTSTRAP|AGENTS)\.md$/i.test(rel)) {
      return { status: 'rejected', reason: '这是结构文件，用对应工具或直接编辑，不要用 mem_page 追加' }
    }
    if (!cleanBody) return { status: 'rejected', reason: 'text 不能为空' }
    const full = store.file(rel)
    mkdirSync(path.dirname(full), { recursive: true })
    if (!existsSync(full)) {
      appendFileSync(full, `# ${rel.replace(/\.md$/, '')}\n\n${originLine(origin)}`, 'utf8')
    }
    const tag = store.sourceTag(source)
    appendFileSync(full, `\n## [${today()}] 补充${tag}\n${cleanBody}\n`, 'utf8')
    store.cache.delete(full)
    let hint = null
    try {
      hint = pageHint(readFileSync(store.file('index.md'), 'utf8'), rel)
    } catch {
      /* 读不到索引就不提示 */
    }
    return hint === null ? { status: 'ok', page: rel } : { status: 'ok', page: rel, hint }
  }

  // 索引体检：只报不改，改不改由模型决定
