/**
 * 指针：跨会话引用原文的唯一可靠写法。
 *
 * 2026-11-25 为什么加：记忆页里一直写「seq 19559-22545」，可 seq 是**按会话**编号的，
 * 换一个会话这个数字指的就是别的内容。今天主人点出来：「你说指针只是指单会话，
 * 那么跨会话不就指空了」。所以定死格式，并且读不到时要报失效，不许静默返回空。
 *
 * 格式：S:<会话 id 前 8 位>#<from>-<to>
 *   例：S:afac32c7#19559-22545
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/** 指针前缀，换格式时一起改。 */
export const POINTER_PREFIX = 'S:'
/** 会话 id 用前几位就够定位（日志文件名里带全 id）。 */
export const SESSION_SHORT = 8

/**
 * 生成指针。
 * @param session - 会话 id（全或前几位都行）。
 * @param from - 起始 seq。
 * @param to - 结束 seq。
 * @returns 形如 `S:afac32c7#19559-22545`；参数不够时返回空串。
 */
export function formatPointer(session, from, to) {
  const id = String(session ?? '').trim()
  if (id === '') return ''
  const short = id.replace(/^session-/, '').slice(0, SESSION_SHORT)
  const a = Math.max(0, Number(from) || 0)
  const b = Math.max(a, Number(to) || 0)
  if (short === '') return ''
  return `${POINTER_PREFIX}${short}#${a}-${b}`
}

/**
 * 解析指针；不接受没有会话的裸 seq（那正是会指空的写法）。
 * @param text - 指针或含指针的整句。
 * @returns `{ session, from, to }`；认不出返回 null。
 */
export function parsePointer(text) {
  const raw = String(text ?? '')
  const m = /S:([0-9a-zA-Z-]+)#(\d+)-(\d+)/.exec(raw)
  if (m === null) return null
  return { session: m[1], from: Number(m[2]), to: Number(m[3]) }
}

/**
 * 会话目录：id → 日志文件。用来判断指针还有没有落脚点。
 * @returns `{ root, entries }`，entries 是 `{ id, short, file, bytes, mtime }[]`。
 */
export function sessionDirectory() {
  const home = String(process.env.DSH_HOME ?? '').trim() || path.join(homedir(), '.dsh')
  const root = path.join(home, 'sessions')
  const entries = []
  if (!existsSync(root)) return { root, entries }
  const walk = (dir, depth) => {
    if (depth > 3) return
    let names = []
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
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
      // 两种真实布局都要认（2026-11-25 实测踩过）：
      //   sessions/<工作区>/<会话 id>/session.v4.jsonl.zstd   ← 现在默认是这种
      //   sessions/<工作区>/session-<会话 id>.jsonl.zstd       ← 早期是这种
      // 只按文件名匹配 session-* 会一条都找不到，指针全报失效。
      if (!/\.jsonl(\.zstd)?$/.test(name)) continue
      const fromName = /^session-(.+?)\.jsonl(?:\.zstd)?$/.exec(name)
      const dirName = path.basename(dir)
      const id = fromName !== null ? fromName[1] : dirName.replace(/^session-/, '')
      if (id === '' || id === dirName && dirName === 'sessions') continue
      if (!/^[0-9a-zA-Z_-]+$/.test(id)) continue
      entries.push({ id, short: id.slice(0, SESSION_SHORT), file: full, bytes: stat.size, mtime: stat.mtimeMs })
    }
  }
  walk(root, 0)
  entries.sort((a, b) => b.mtime - a.mtime)
  return { root, entries }
}

/**
 * 检查指针还有没有落脚点。
 * @param pointer - `{ session, from, to }`。
 * @returns `{ ok, file?, reason? }`；失效时给出人能看懂的原因，调用方必须把它报出来。
 */
export function checkPointer(pointer) {
  if (pointer === null || typeof pointer !== 'object' || !pointer.session) {
    return { ok: false, reason: '这不是带会话的指针（S:<id>#from-to），跨会话会指空' }
  }
  const { entries } = sessionDirectory()
  const hit = entries.find((entry) => entry.id.startsWith(String(pointer.session)))
  if (hit === undefined) {
    return { ok: false, reason: `会话 ${pointer.session} 的日志不在了（被清理或分卷挪走），这个指针已失效` }
  }
  return { ok: true, file: hit.file }
}
