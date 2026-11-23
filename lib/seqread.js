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

/**
 * 找出 zstd 文件里每一帧的边界。
 *
 * 2026-11-23 为什么得自己算：真机的会话日志是多帧拼接的（每写一批 flush 一帧），
 * 而 `zlib.zstdDecompressSync` 和流式解压**都只解第一帧**——37 MB 的文件解出来
 * 只有 201 字节，一条都匹配不到。不能靠「找下一个 magic」偷懒，因为块数据里
 * 也可能出现同样的四字节序列，切错就整段读不出来。所以按帧格式自己走一遍：
 * magic(4) + 帧头(可变) + 若干块(每块 3 字节头 + 数据)，直到 Last_Block 置位。
 *
 * @param buf - 整个文件
 * @returns 每帧的起止位置 `[{ start, end }]`
 */
function zstdFrames(buf) {
  const Magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const frames = []
  let offset = 0
  while (offset + 4 <= buf.length) {
    if (!buf.subarray(offset, offset + 4).equals(Magic)) {
      // 不是帧起点（尾部可能有垃圾），往下找一个对齐的 magic
      const next = buf.indexOf(Magic, offset + 1)
      if (next === -1) break
      offset = next
      continue
    }
    let p = offset + 4
    if (p >= buf.length) break
    const descriptor = buf[p]
    p += 1
    const singleSegment = (descriptor >> 5) & 1
    const contentChecksum = (descriptor >> 2) & 1
    const dictFlag = descriptor & 3
    if (!singleSegment) p += 1 // Window_Descriptor
    p += dictFlag === 0 ? 0 : dictFlag === 1 ? 1 : dictFlag === 2 ? 2 : 4
    const contentSizeFlag = descriptor >> 6
    p += contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : contentSizeFlag === 1 ? 2 : contentSizeFlag === 2 ? 4 : 8

    let ok = true
    while (p + 3 <= buf.length) {
      const header = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16)
      const last = header & 1
      const type = (header >> 1) & 3
      const size = header >>> 3
      p += 3
      // type 3 是保留值；遇到就当作坏帧，别把后面整段读乱
      if (type === 3) {
        ok = false
        break
      }
      const payload = type === 1 ? 1 : size // RLE 块只存 1 字节
      p += payload
      if (p > buf.length) {
        ok = false
        break
      }
      if (last === 1) break
    }
    if (contentChecksum === 1) p += 4
    if (!ok || p > buf.length) {
      // 这一帧算不出来：退到下一个 magic 重试，别丢掉后面的好帧
      const next = buf.indexOf(Magic, offset + 1)
      if (next === -1) break
      offset = next
      continue
    }
    frames.push({ start: offset, end: p })
    offset = p
  }
  return frames
}

/**
 * 逐帧解 zstd（按算出来的帧边界切）。
 * @param buf - 整个文件
 * @returns 所有帧解压后拼起来的文本
 */
function zstdMultiFrame(buf) {
  const frames = zstdFrames(buf)
  if (frames.length === 0) return ''
  const parts = []
  for (const { start, end } of frames) {
    try {
      parts.push(zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8'))
    } catch {
      // 单帧坏掉就跳过，别让整个文件读不出来
    }
  }
  return parts.join('')
}

/**
 * 读日志的所有行。
 * @param file - 日志路径
 * @returns `{ lines, error }`——出错时 error 有话说，不再静默返回空
 */
function readLines(file) {
  try {
    const buf = readFileSync(file)
    if (file.endsWith('.zstd')) {
      if (buf.length === 0) return { lines: [], error: '日志是空的' }
      // 2026-11-23 修：原来先试「整段解」，只要解出来里带换行就当成功——可多帧文件
      // 整段解只解出**第一帧**（真机上 188 字节），那一帧里有换行，于是再也不会走
      // 逐帧那条路。表现成「区间里没有事件」，而日志明明有四万多行。
      // 现在一律先算帧边界：一帧就整段解，多帧就逐帧解。
      const frames = zstdFrames(buf)
      let text = ''
      if (frames.length > 1) {
        text = zstdMultiFrame(buf)
      } else {
        try {
          text = zlib.zstdDecompressSync(buf).toString('utf8')
        } catch (error) {
          return { lines: [], error: `zstd 解压失败：${String(error?.message ?? error)}` }
        }
      }
      if (text === '') {
        const has = typeof zlib.zstdDecompressSync === 'function'
        return {
          lines: [],
          error: has ? 'zstd 解压失败（帧格式不认识或文件损坏）' : '这个运行时没有 zlib.zstdDecompressSync',
        }
      }
      return { lines: text.split('\n'), error: '' }
    }
    return { lines: buf.toString('utf8').split('\n'), error: '' }
  } catch (error) {
    return { lines: [], error: `读日志失败：${String(error?.message ?? error)}` }
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
  const { lines, error } = readLines(file)
  if (error !== '') return { status: 'not_found', reason: error, session: path.basename(path.dirname(file)) }
  const rows = []
  for (const line of lines) {
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
