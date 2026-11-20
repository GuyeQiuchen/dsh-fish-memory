/**
 * 取原料（可删的小模块）。
 *
 * 为什么要它：整理记忆最怕凭印象写。写周记、写整理页之前，先把那一周主人
 * 真正打的字从会话日志里抽出来，再动笔——抽出来的是原话，不是我事后转述的结论。
 *
 * 只读不写：本模块不回写任何记忆文件，整理的事仍由 mem_log / mem_page 决定。
 *
 * 模块化：删掉本文件、index.js 里 mem_harvest 那一段、test/harvest.mjs 即可回退。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import zlib from 'node:zlib'
import path from 'node:path'

/** 一次最多抽多少条，防止把一整周灌进上下文。 */
export const DEFAULT_LIMIT = 120

/**
 * 找最近被写过的会话日志文件。
 * @param home - DSH 主目录（含 sessions/）。
 * @param limit - 最多几个文件。
 * @returns 文件路径数组，最新的在前。
 */
export function findSessionLogs(home, limit = 2) {
  // 宿主进程里的 DSH_HOME 和 homedir() 都可能被改过（沙箱、便携目录），
  // 所以把几个候选根都扫一遍，按 mtime 合并，免得抽出一片空。
  const candidateHome = [
    String(home ?? ''),
    process.env.DSH_HOME ?? '',
    path.join(homedir(), '.dsh'),
    process.env.USERPROFILE === undefined ? '' : path.join(process.env.USERPROFILE, '.dsh'),
    path.join(process.cwd(), '.dsh'),
  ]
  const roots = []
  for (const candidate of candidateHome) {
    const trimmed = candidate.trim()
    if (trimmed !== '' && !roots.includes(trimmed)) roots.push(trimmed)
  }
  const out = []
  const walk = (dir) => {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.name.endsWith('.zstd')) continue
      try {
        out.push({ file: full, mtime: statSync(full).mtimeMs })
      } catch {
        /* 读不到就跳过 */
      }
    }
  }
  for (const root of roots) walk(path.join(root, 'sessions'))
  return out
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, Math.max(1, Number(limit) || 1))
    .map((item) => item.file)
}

/**
 * 把一条消息事件压成纯文本。
 * @param data - 事件 data。
 * @returns 文本。
 */
function textOf(data) {
  const content = data?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => (block !== null && typeof block === 'object' && typeof block.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/**
 * 从一段日志文本里抽主人手打的消息。
 * @param raw - 解压后的 jsonl 文本。
 * @param since - 起始时间戳（毫秒）。
 * @param until - 结束时间戳（毫秒）。
 * @returns `{ t, text }[]`（按时间升序）。
 */
export function pickUserLines(raw, since, until) {
  const out = []
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    if (line === '' || !line.includes('user/message')) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event?.type !== 'user/message') continue
    const kind = event?.data?.source?.kind
    // 只认人打的字：时间注入、运行时上下文、检查点都不是主人说的。
    if (kind !== undefined && kind !== 'user') continue
    const time = Number(event?.time)
    if (Number.isFinite(since) && time < since) continue
    if (Number.isFinite(until) && time > until) continue
    const text = textOf(event?.data).trim()
    if (text === '') continue
    out.push({ t: time, seq: Number(event?.seq ?? 0), text })
  }
  return out.sort((a, b) => a.t - b.t)
}

/**
 * 解压整份会话日志。
 *
 * DSH 的日志是**追加式多帧 zstd**：每 flush 一次就往后接一帧。宿主里那份 zlib
 * 只解第一帧（实测只出一个 session 头，两行），本地 Node 26 却能解全部。
 * 所以先整体解一次，再按帧魔数切开逐帧解一次，取行数多的那份。
 *
 * @param buf - 文件字节。
 * @returns 解压后的 jsonl 文本。
 */
export function decompressLog(buf) {
  let whole = ''
  try {
    whole = zlib.zstdDecompressSync(buf).toString('utf8')
  } catch {
    whole = ''
  }
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const offsets = []
  let index = buf.indexOf(magic)
  while (index !== -1) {
    offsets.push(index)
    index = buf.indexOf(magic, index + 4)
  }
  if (offsets.length <= 1) return whole
  const parts = []
  for (let i = 0; i < offsets.length; i += 1) {
    const start = offsets[i]
    const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length
    try {
      parts.push(zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8'))
    } catch {
      /* 魔数撞进压缩数据里会切错，解不开就跳过 */
    }
  }
  const byFrame = parts.join('')
  return byFrame.split(/\r?\n/).length > whole.split(/\r?\n/).length ? byFrame : whole
}

/**
 * 抽原料：最近 N 小时的会话日志里，主人手打的消息。
 * @param options - `{ home, hours, limit, files }`。
 * @returns `{ files, count, items }`。
 */
export function harvest(options = {}) {
  const home = String(options.home ?? '')
  const hours = Number(options.hours)
  const span = (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000
  const limit = Math.max(1, Math.min(500, Number(options.limit) || DEFAULT_LIMIT))
  const until = Date.now()
  const since = until - span
  const files = Array.isArray(options.files) && options.files.length > 0
    ? options.files.slice(0, 3)
    : findSessionLogs(home, 2)
  const items = []
  const scanned = []
  for (const file of files) {
    let raw = ''
    try {
      raw = decompressLog(readFileSync(file))
    } catch (error) {
      scanned.push({ file, error: String(error?.message ?? error) })
      continue
    }
    const picked = pickUserLines(raw, since, until)
    scanned.push({ file, lines: raw.split(/\r?\n/).length, picked: picked.length })
    for (const line of picked) items.push(line)
  }
  items.sort((a, b) => a.t - b.t)
  // 两个根可能扫到同一条会话的副本，按时间加原文去重，不然同一句话会出现两遍。
  const unique = []
  const seen = new Set()
  for (const item of items) {
    const key = `${item.t}|${item.text}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }
  const trimmed = unique.length > limit ? unique.slice(unique.length - limit) : unique
  return { files, scanned, count: trimmed.length, total: unique.length, items: trimmed }
}
