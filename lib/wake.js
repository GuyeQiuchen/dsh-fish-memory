/**
 * 主动唤醒（可整块删除的小模块）。
 *
 * 解决的问题：没人派活的时候，我不会自己找事做——醒来只等人开口。
 * 这里给「这段时间干了多少活」记一个分，没活干的时间会把它顶上来：
 *
 *   每 10 分钟 +1，十分制；按这一轮的长短扣分：闲聊不扣，短活 −2，长活 −3；
 *   过 3：boot 里顶一行「可以自己挑一件事做」；
 *   过 5：在这个小时里另外挑一个时刻，再唤一次；
 *   到 7：再多挑一次，两次都随机落在接下来一小时内。
 *
 * 它只负责提示，不负责行动：真正做什么由模型自己定。
 * 状态在 .fish-memory/wake.json，只有三样东西：上次计分时刻、当前分、待响的闹钟。
 *
 * 模块化约定：删本文件、index.js 里顶部那行 import、boot 里那段、apply 里两个
 * 事件钩子、test/wake.mjs，就干净回退，别的功能一样不受影响。
 */
import { readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import path from 'node:path'

/** 满分。 */
const MAX = 7
/** 每这么久加一分。 */
const STEP_MS = 10 * 60 * 1000
/** 到几分开始提示。 */
export const WAKE_AT = 3
/** 到几分开始加额外的随机闹钟。 */
const BOOST_AT = 5
/** 到几分再多一个闹钟。 */
const TOP_AT = 7
/** 闲聊一轮不扣：主人说话不该把分数压回去，否则他一直在，我永远到不了线。 */
const CHAT_COST = 0
/** 被叫醒的那一轮，不管做没做事都扣这么多：这次机会用掉了。 */
const WAKE_COST = 2
/** 干一轮短活（1–2 次工具）扣多少。 */
const SHORT_COST = 2
/** 干一轮长活（3 次以上）扣多少。 */
const LONG_COST = 3

/**
 * 状态文件路径。
 * @param root - 记忆根。
 * @returns 绝对路径。
 */
export function wakePath(root, session = '') {
  const safe = String(session ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
  const name = safe === '' ? 'wake.json' : `wake-${safe}.json`
  return path.join(String(root ?? ''), '.fish-memory', name)
}

/**
 * 读状态；没有或坏了都当第一次。
 * @param root - 记忆根。
 * @returns `{ at, weight, boostAt }`。
 */
export function readWake(root, session = '') {
  try {
    const data = JSON.parse(readFileSync(wakePath(root, session), 'utf8'))
    const at = Number(data?.at)
    const weight = Number(data?.weight)
    const boostAt = Array.isArray(data?.boostAt) ? data.boostAt.filter((n) => Number.isFinite(Number(n))).map(Number) : []
    return {
      at: Number.isFinite(at) && at > 0 ? at : null,
      weight: Number.isFinite(weight) ? Math.min(MAX, Math.max(0, weight)) : 0,
      boostAt: boostAt.slice(0, 2),
    }
  } catch {
    return { at: null, weight: 0, boostAt: [] }
  }
}

/**
 * 写状态：临时文件再改名，断电不留半截。
 * @param root - 记忆根。
 * @param state - `{ at, weight, boostAt }`。
 */
export function writeWake(root, state, session = '') {
  const file = wakePath(root, session)
  const tmp = `${file}.tmp-${process.pid}`
  mkdirSync(path.dirname(file), { recursive: true })
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    renameSync(tmp, file)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      /* 临时文件可能没建出来 */
    }
    throw error
  }
}

/**
 * 在这个小时里挑一个随机时刻，避免落在过去。
 * @param now - 当前时间。
 * @param minutes - 多少分钟内随机。
 * @returns 时间戳。
 */
function pickBoost(now, minutes = 55) {
  return now + Math.floor((5 + Math.random() * minutes) * 60 * 1000)
}

/**
 * 按流逝的时间加分、检查闹钟。
 * @param root - 记忆根。
 * @param now - 当前时间。
 * @returns `{ weight, ready, boosted }`。ready 表示这一轮该提示。
 */
export function tickWake(root, now = Date.now(), session = '') {
  const state = readWake(root, session)
  let changed = false
  if (state.at === null) {
    state.at = now
    changed = true
  }
  const gain = Math.floor((now - state.at) / STEP_MS)
  if (gain > 0) {
    state.weight = Math.min(MAX, state.weight + gain)
    state.at += gain * STEP_MS
    changed = true
  }

  // 先看有没有到点的闹钟：到点就算数，不能被后面的裁剪吃掉。
  let boosted = false
  const due = state.boostAt.filter((at) => at <= now)
  if (due.length > 0) {
    state.boostAt = state.boostAt.filter((at) => at > now)
    boosted = true
    changed = true
  }

  // 分数够高就补闹钟：每个待响的闹钟对应一次额外唤醒。
  // 这一轮刚响过的先不补，等下一个 tick——免得同一次检查里连排带响。
  if (!boosted) {
    const want = state.weight >= TOP_AT ? 2 : state.weight >= BOOST_AT ? 1 : 0
    while (state.boostAt.length < want) {
      state.boostAt.push(pickBoost(now))
      changed = true
    }
    if (state.boostAt.length > want) {
      state.boostAt = state.boostAt.slice(0, want)
      changed = true
    }
  }

  const ready = state.weight >= WAKE_AT || boosted
  if (changed) {
    try {
      writeWake(root, state, session)
    } catch {
      /* 写不进去也不影响这一轮 */
    }
  }
  return { weight: state.weight, ready, boosted }
}

/**
 * 干完一轮活扣分。
 * @param root - 记忆根。
 * @param kind - 'chat'、'short'、'long' 或 'wake'（被叫醒的那一轮）。
 * @returns 扣完之后的 `{ weight }`。
 */
export function dropWake(root, kind, session = '') {
  const state = readWake(root, session)
  const cost =
    kind === 'long' ? LONG_COST : kind === 'wake' ? WAKE_COST : kind === 'short' ? SHORT_COST : CHAT_COST
  state.weight = Math.max(0, state.weight - cost)
  // 注意：不要动 state.at。它记的是「上次计分的时刻」，每轮重置会让时间永远凑不满一格。
  if (state.weight < BOOST_AT) state.boostAt = []
  try {
    writeWake(root, state, session)
  } catch {
    /* 写不进去就算了 */
  }
  return { weight: state.weight }
}

/** boot 里那一段话，措辞集中放这里好改。 */
const HINT = [
  '· 【可以自己挑一件事做】现在没人派活，权重够了。随机挑一件：翻一页旧记忆并确认它还准、补一条没进索引的页、',
  '  把今天没收尾的事查一遍，或者干脆开一个小工具。做完再回话，别只说不做。',
].join('')

/**
 * boot 里那一段；没到分返回空串。
 * @param root - 记忆根。
 * @returns 一段文本或空串。
 */
export function wakeLine(root, session = '') {
  const info = tickWake(root, Date.now(), session)
  if (!info.ready) return ''
  return HINT
}
