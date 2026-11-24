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

/**
 * 解析过的日志缓存：同一个文件、同样的 mtime+size，就不再重解。
 *
 * 2026-11-24 为什么加：一次取回要把 39MB 日志解成 1.28 亿字符、占约 700MB，
 * 耗时 2 秒，而且同步跑在宿主主进程里。可宿主的日志是**追加写**，
 * 相邻几次取回之间文件经常一个字都没变——那 2 秒和 700MB 白花了。
 *
 * 只留最近一份：缓存太大反而把内存吃回去。键是路径，值是那一份的行数组。
 */
const lineCache = new Map()
/** 缓存最多留几个文件（正常只会用到当前会话那一个）。 */
const LINE_CACHE_MAX = 2

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
  // 2026-11-24 改：原来 want 为空时 `found.sort().pop()`，那是**按路径名排序取最后一个**，
  // 不是最新——同一台机器上多个会话并行时，取回会静默读到别的会话，还报 ok。
  // 现在按文件 mtime 取最近的。真正的修法是调用方必须带 session（工具层已优先带），
  // 这里只是把「猜错」的风险降到最小。
  if (want === '') return newest(found)
  const exact = found.filter((f) => f.includes(want))
  if (exact.length > 0) return exact.sort().pop() ?? ''
  return ''
}

/** 按修改时间取最新的那个；stat 失败就退回按路径排序，不抛。 */
function newest(files) {
  let best = ''
  let bestTime = -1
  for (const file of files) {
    let t = -1
    try {
      t = statSync(file).mtimeMs
    } catch {
      t = -1
    }
    if (t > bestTime) {
      bestTime = t
      best = file
    }
  }
  return best !== '' ? best : (files.sort().pop() ?? '')
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
 * 逐帧解 zstd，并报出「解了几帧 / 坏了几帧 / 覆盖到第几字节」。
 *
 * 2026-11-24 为什么要把失败数带出来：原来单帧坏掉就空 catch 跳过，读到的内容
 * 少了却和「本来就这么少」长得一样。今晚在同一个形状上栽过两次，这次让它说话。
 * @param buf - 整个文件
 * @param frames - 已算好的帧边界（不传就自己算）
 * @returns `{ text, failed, covered }`
 */
function zstdMultiFrameWithStats(buf, frames) {
  const list = frames ?? zstdFrames(buf)
  const parts = []
  let failed = 0
  let covered = 0
  for (const { start, end } of list) {
    try {
      parts.push(zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8'))
      covered = end
    } catch {
      // 单帧坏掉就跳过，别让整个文件读不出来——但要计数，不能当作没发生
      failed += 1
    }
  }
  return { text: parts.join(''), failed, covered }
}

/** 旧签名保留：只关心文本的调用方还用这个。 */
function zstdMultiFrame(buf) {
  return zstdMultiFrameWithStats(buf).text
}

/**
 * 读日志的所有行。
 * @param file - 日志路径
 * @returns `{ lines, error }`——出错时 error 有话说，不再静默返回空
 */
function readLines(file) {
  // 先看缓存：同一个文件、同样的 mtime+size 就直接用上次解出来的行。
  // 追加写会让 size 变，所以「变没变」这件事 size 就够判——mtime 一起带上更稳。
  let stamp = null
  try {
    const stat = statSync(file)
    stamp = `${stat.mtimeMs}:${stat.size}`
  } catch {
    stamp = null
  }
  if (stamp !== null) {
    const hit = lineCache.get(file)
    if (hit && hit.stamp === stamp) return hit.result
  }
  const result = readLinesUncached(file)
  // 只缓存成功解析出内容的那些：读失败的结果不缓存，否则一次瞬时错误会被记很久
  if (stamp !== null && result.error === '' && result.lines.length > 0) {
    lineCache.set(file, { stamp, result })
    // 只留最近几个，别把内存吃回去
    while (lineCache.size > LINE_CACHE_MAX) {
      const oldest = lineCache.keys().next().value
      if (oldest === undefined) break
      lineCache.delete(oldest)
    }
  }
  return result
}

/** 清空缓存（测试用；正常运行不需要）。 */
export function clearLineCache() {
  lineCache.clear()
}

function readLinesUncached(file) {
  try {
    const buf = readFileSync(file)
    if (file.endsWith('.zstd')) {
      if (buf.length === 0) return { lines: [], error: '日志是空的' }
      // 2026-11-23 修：原来先试「整段解」，只要解出来里带换行就当成功——可多帧文件
      // 整段解只解出**第一帧**（真机上 188 字节），那一帧里有换行，于是再也不会走
      // 逐帧那条路。表现成「区间里没有事件」，而日志明明有四万多行。
      //
      // 2026-11-24 再修：原来按 `frames.length > 1` 分流，可**末帧写到一半**时帧数会
      // 退化成 1，于是又走回整段解、只出第一帧、照样不报错。现在一律逐帧解——
      // 单帧的逐帧解和整段解结果一样，多一层判断只是给自己留了个坑。
      const frames = zstdFrames(buf)
      if (frames.length === 0) {
        return { lines: [], error: '文件里连一个完整的 zstd 帧都没有（可能只写了一半就被读到）' }
      }
      const { text, failed, covered } = zstdMultiFrameWithStats(buf, frames)
      // 覆盖不满：尾部有写了一半的帧，或中间有算不出来的字节点。
      // 这种事分两级：**一个字都解不出来**是致命；解出来一部分只是警告。
      // 2026-11-24 为什么分级：原来任何 error 都让整次取回变成 not_found，
      // 于是「末帧正在写」等于「这个区间读不了」——明明前面几帧都是好的。
      const tail = buf.length - covered
      const notes = []
      if (failed > 0) notes.push(`${failed} 帧解压失败`)
      if (tail > 0) notes.push(`尾部 ${tail} 字节不构成完整帧（可能正在写入）`)
      if (text === '') {
        return { lines: [], error: `zstd 解出的内容是空的（${notes.join('；') || '帧都是空的'}）` }
      }
      return { lines: text.split('\n'), error: '', warning: notes.join('；') }
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
  const { lines, error, warning } = readLines(file)
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
  if (rows.length === 0) {
    return {
      status: 'empty',
      reason: warning ? `这个区间里没有事件（${warning}）` : '这个区间里没有事件',
      session: path.basename(path.dirname(file)),
    }
  }
  const out = []
  let used = 0
  // 2026-11-24 修：原来 `if (used + line.length > MAX_CHARS) break` 在**第一条就超长**时
  // 直接 break，out 为空 → 返回 empty 且连 reason 都没有。真机有 59 条超 8000 字的事件，
  // 最长六十多万字（seq 10904），查它附近的区间会得到「什么都没有」的假象。
  // 现在的规则：第一条放不下也要**截断着放进来**，并明说被截了。
  let truncated = false
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
    let line = `[seq ${event.seq}] ${text}`
    const room = MAX_CHARS - used - 1
    if (line.length > room) {
      if (out.length === 0) {
        // 第一条就放不下：截断着放，别让整个区间变成空
        line = room > 40 ? `${line.slice(0, room - 20)}……[本条另有 ${line.length - room + 20} 字未显示]` : line.slice(0, Math.max(0, room))
        truncated = true
        used += line.length + 1
        out.push(line)
      } else {
        truncated = true
      }
      break
    }
    used += line.length + 1
    out.push(line)
  }
  const extra = [truncated ? '内容超过单次上限，已截断' : '', warning ?? ''].filter(Boolean).join('；')
  return {
    status: out.length === 0 ? 'empty' : 'ok',
    session: path.basename(path.dirname(file)),
    events: rows.length,
    chars: used,
    text: out.join('\n'),
    ...(extra ? { warning: extra } : {}),
  }
}
