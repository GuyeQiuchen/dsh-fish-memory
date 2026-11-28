/**
 * 整理草案的落盘与状态（2026-11-28 P4）。
 *
 * 引擎（lib/engine/tidy.js）只算，不碰盘；这里负责：
 *   `.drafts/consolidate-<日期>.md`   草案正文（A/B/C 三块）
 *   `.drafts/index.json`             状态：pending / applied / dropped + 时间
 * 状态在文件里，不在模型记忆里——这是「草案不会沉底」的前提。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import path from 'node:path'
import { withLock } from './lock.js'

const DIR = '.drafts'
const INDEX = 'index.json'

/** 草案目录。 */
export function draftsDir(root) {
  return path.join(root, DIR)
}

function indexPath(root) {
  return path.join(draftsDir(root), INDEX)
}

/** 读状态表；坏了当空的，不让它挡住整理。 */
export function readIndex(root) {
  try {
    const data = JSON.parse(readFileSync(indexPath(root), 'utf8'))
    return Array.isArray(data?.drafts) ? data : { drafts: [] }
  } catch {
    return { drafts: [] }
  }
}

function writeIndex(root, data) {
  mkdirSync(draftsDir(root), { recursive: true })
  const file = indexPath(root)
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file)
}

/** 待处理草案（按创建时间倒序）。 */
export function pendingDrafts(root) {
  const rows = readIndex(root).drafts.filter((item) => item?.status === 'pending')
  return rows.sort((a, b) => String(b.created).localeCompare(String(a.created)))
}

/** 待处理草案的 boot 行：一句，只报数量和最旧的天数。 */
export function draftLine(root, now = Date.now()) {
  const pending = pendingDrafts(root)
  if (pending.length === 0) return ''
  const oldest = pending.map((item) => Date.parse(String(item.created))).filter(Number.isFinite).sort((a, b) => a - b)[0]
  const days = olderDays(oldest, now)
  return `· 整理草案 ${pending.length} 份待处理${days === null ? '' : `（最旧 ${days} 天）`}，用 mem_drafts 取`
}

function olderDays(at, now) {
  if (!Number.isFinite(at)) return null
  return Math.max(0, Math.floor((now - at) / 86400000))
}

/** 同一批标题的签名：用来做「7 天内不重复出草案」。 */
export function draftSignature(result) {
  const titles = (result?.drafts ?? []).map((draft) => String(draft.title ?? '').trim()).filter(Boolean)
  return titles.sort().join('|')
}

/**
 * 落一份草案。已有 pending 时不重复生成；同签名 7 天内出过也不再生成。
 * @returns `{ created: boolean, reason?, file? }`
 */
function writeDraftLocked(root, result, now) {
  const pending = pendingDrafts(root)
  if (pending.length > 0) return { created: false, reason: 'pending-exists', file: pending[0].file }
  const signature = draftSignature(result)
  if (signature === '') return { created: false, reason: 'empty' }
  const recent = readIndex(root).drafts.find(
    (item) => item.signature === signature && item.status !== 'pending' && now - Date.parse(String(item.updated ?? item.created)) < 7 * 86400000,
  )
  if (recent !== undefined) return { created: false, reason: 'recently-applied', file: recent.file }
  // 文件名带到秒：同一天第二次整理不能复用同一份文件，否则 apply 会命中旧状态
  const d = new Date(now)
  const p2 = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
  let file = `consolidate-${stamp}.md`
  mkdirSync(draftsDir(root), { recursive: true })
  // 同一秒内仍撞名时加序号，绝不覆盖已有草案
  for (let n = 2; existsSync(path.join(draftsDir(root), file)); n += 1) file = `consolidate-${stamp}-${n}.md`
  writeFileSync(path.join(draftsDir(root), file), result.markdown, 'utf8')
  const data = readIndex(root)
  data.drafts.push({ file, created: new Date(now).toISOString(), updated: new Date(now).toISOString(), status: 'pending', signature })
  writeIndex(root, data)
  return { created: true, file }
}

/** 落草案：加锁，避免两个进程同时读改写状态表。 */
export function writeDraft(root, result, now = Date.now()) {
  const got = withLock(root, 'drafts', () => writeDraftLocked(root, result, now))
  if (got.ok) return got.result
  return { created: false, reason: 'busy' }
}

/**
 * 改一份草案的状态（applied / dropped / pending）。
 * @returns `{ status: 'ok'|'not-found', file, statusNow? }`
 */
function markDraftLocked(root, file, status) {
  if (!['applied', 'dropped', 'pending'].includes(status)) return { status: 'not-found' }
  const data = readIndex(root)
  const row = data.drafts.find((item) => item.file === file)
  if (row === undefined) return { status: 'not-found' }
  row.status = status
  row.updated = new Date().toISOString()
  writeIndex(root, data)
  return { status: 'ok', file, statusNow: status }
}

/** 改状态：加锁读改写，避免两个进程互相覆盖（后写盖先写会丢一条状态）。 */
export function markDraft(root, file, status) {
  const got = withLock(root, 'drafts', () => markDraftLocked(root, file, status))
  if (got.ok) return got.result
  return { status: 'busy', file }
}

/** 读一份草案正文（只给 pending 的读，applied 的不再回放）。 */
export function readDraft(root, file) {
  const row = readIndex(root).drafts.find((item) => item.file === file)
  if (row === undefined) return null
  try {
    return { ...row, body: readFileSync(path.join(draftsDir(root), file), 'utf8') }
  } catch {
    return { ...row, body: '' }
  }
}

/** 清理：把 30 天前的 pending 标成 dropped，避免永远挂着。 */
function expireDraftsLocked(root, now, maxAgeDays) {
  const data = readIndex(root)
  let changed = 0
  for (const row of data.drafts) {
    if (row.status !== 'pending') continue
    const at = Date.parse(String(row.created))
    if (Number.isFinite(at) && now - at > maxAgeDays * 86400000) {
      row.status = 'dropped'
      row.updated = new Date(now).toISOString()
      changed += 1
    }
  }
  if (changed > 0) writeIndex(root, data)
  return changed
}

/** 过期清理：同样加锁，别和 markDraft 抢着写。 */
export function expireDrafts(root, now = Date.now(), maxAgeDays = 30) {
  const got = withLock(root, 'drafts', () => expireDraftsLocked(root, now, maxAgeDays))
  return got.ok ? got.result : 0
}
