/**
 * 按 seq 区间把会话原文读回来（自带，不依赖压缩插件）。
 *
 * 2026-11-22 为什么自带：记忆页里存的是「页 + 会话 + seq」，取原文这一步以前
 * 借的是鲫鱼的 jiyu_recall。可记忆体不该绑定某个压缩引擎——换成 basic、vcc 或者
 * 干脆不压缩，seq 仍然存在于宿主的 append-only 会话日志里。这层只认日志文件，
 * 谁在压缩都不影响。
 *
 * 另一个必须一起带的：seq 是**按会话**编号的。同一个数字在别的会话里是别的内容，
 * 所以取回时要带会话 id，页里也要一起记。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

/** 一次最多取回多少字符，防止一次把整段日志摊进上下文。 */
export const MAX_CHARS = 8000
/** 一次最多跨多少 seq，防止 from/to 写错把整个会话拉出来。 */
export const MAX_SPAN = 4000

function sessionsRoot() {
  const home = String(process.env.DSH_HOME ?? '').trim() || path.join(homedir(), '.dsh')
  return path.join(home, 'sessions')
}

/**
 * 找出某个会话的日志文件。
 * @param session - 会话 id（可以只给前几位）。
 * @returns 绝对路径；找不到就是空串。
 */
export function findSessionFile(session = '') {
  const root = sessionsRoot()
  if (!existsSync(root)) return ''
  const want = String(session ?? '').trim()
  const found = []
  const walk = (dir, depth) => {
    if (depth > 3) return
    let entries = []
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = path.join(dir, name)
      let stat = null
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!/\.jsonl(\.zstd)?$/.test(name)) continue
      found.push(full)
    }
  }
  walk(root, 0)
  if (found.length === 0) return ''
  if (want === '') return found.sort().pop() ?? ''
  const exact = found.filter((f) => f.includes(want))
  if (exact.length > 0) return exact.sort().pop() ?? ''
  return ''
}

function readLines(file) {
  try {
    const buf = readFileSync(file)
    const text = file.endsWith('.zstd') ? zlib.zstdDecompressSync(buf).toString('utf8') : buf.toString('utf8')
    return text.split('\n')
  } catch {
    return []
  }
}

function textOfContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join(' ')
}

function clip(text, max) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/**
 * 读 seq 区间原文。
 * @param options - `{ from, to, session }`
 * @returns `{ status, text, events, session, chars }`
 */
export function readSeqRange({ from = 0, to = 0, session = '' } = {}) {
  const start = Math.max(0, Number(from) || 0)
  const end = Math.max(start, Number(to) || 0)
  if (end - start > MAX_SPAN) {
    return { status: 'rejected', reason: `区间太大了（最多 ${MAX_SPAN} 条），缩小 from/to` }
  }
  const file = findSessionFile(session)
  if (file === '') {
    return { status: 'not_found', reason: session === '' ? '没找到会话日志（不能确定是哪个会话）' : `没找到会话 ${session} 的日志` }
  }
  const rows = []
  for (const line of readLines(file)) {
    if (!line.trim()) continue
    let event = null
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const seq = Number(event?.seq)
    if (!Number.isFinite(seq) || seq < start || seq > end) continue
    rows.push(event)
  }
  if (rows.length === 0) return { status: 'empty', reason: '这个区间里没有事件', session: path.basename(path.dirname(file)) }
  const out = []
  let used = 0
  for (const event of rows) {
    let text = ''
    if (event.type === 'user/message' || event.type === 'assistant/message') {
      const data = event.data ?? {}
      text = textOfContent(data.content ?? data.message?.content)
    } else if (event.type === 'tool/call') {
      const data = event.data ?? {}
      text = `[调用 ${data.name ?? '?'}] ${clip(JSON.stringify(data.arguments ?? {}), 300)}`
    } else if (event.type === 'tool/result') {
      const data = event.data ?? {}
      text = `[结果] ${clip(textOfContent(data.message?.content ?? data.content), 400)}`
    }
    if (text === '') continue
    const line = `[seq ${event.seq}] ${text}`
    if (used + line.length > MAX_CHARS) break
    used += line.length + 1
    out.push(line)
  }
  return {
    status: out.length === 0 ? 'empty' : 'ok',
    session: path.basename(path.dirname(file)),
    events: rows.length,
    chars: used,
    text: out.join('\n'),
  }
}
