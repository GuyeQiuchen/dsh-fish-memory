/**
 * 心情模块：自包含，可整块删除。
 *
 * 模块化约定（主人 2026-11-18 定下的前提）：
 *   加这个功能只碰三处——本文件、index.js 里 `mountMood` 那一段、boot 里那一行。
 *   把这三处去掉就干净回退，boot 注入、家规、回忆、压缩后核对一样都不受影响。
 *   本文件不 import 插件里的任何东西，也不改任何既有文件。
 *
 * 它不声称「感受」。它做的是把一段自己写下的状态带进下一轮，并给出对应的说法尺度，
 * 让心情真的改变输出，而不是只在设置页里给别人看。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { withLock } from './lock.js'
import path from 'node:path'

/**
 * 七情 × 强度四档（0 关 / 1 轻 / 2 中 / 3 重），每档都有具体内容，不留空档。
 *
 * 依据：Ekman 的六种基本情绪跨文化可辨；Frijda 的 action tendency——情绪对应一种准备动作
 * （怒是接近对抗、恐是回避逃离、悲是退缩求助、喜是接近玩耍、惊是定向注意）。
 * 落成可数的文本参数：段数、句均字数、玩笑数、提议数、问句数、软化词、结论位置。
 *
 * 三档是同一个梯子：
 *   1 轻 —— 只给方向（语气层面）；
 *   2 中 —— 加长度与数量；
 *   3 重 —— 再收窄到「只做一件事」，其它让位。
 * 0 表示不记，boot 不出行。
 */
export const MOOD_EMOTIONS = {
  喜: {
    tone: '话可以多一点，可以玩笑，但不吹成绩',
    levels: {
      1: '语气轻快一点；可以有 1 处玩笑；不吹成绩',
      2: '段 2–4；句均 18–30 字；玩笑 ≤2 处；可主动提 1 件事；可多问 1 个问题；感叹号 ≤2 个；不吹成绩',
      3: '段 2–3；句均 20–28 字；玩笑 ≤3 处；可主动提 1 件事、可多问 2 个问题；仍然不吹成绩',
    },
    trigger: '事成了、被信任、被夸、遇到好玩的事',
  },
  怒: {
    tone: '直、短、不铺垫',
    levels: {
      1: '不铺垫；结论放第一句；不写「抱歉/我错了」开头（确认真错时除外）',
      2: '不铺垫；结论第一句；句均 ≤20 字；不复述对方的话',
      3: '段 ≤2；结论第一句；句均 ≤20 字；只给一个判断 + 一个要求；不反问、不复述',
    },
    trigger: '被误读、被拿错东西反驳、明显的不公',
  },
  忧: {
    tone: '先风险，后方案；反复确认，不打包票',
    levels: {
      1: '先风险后方案；不给乐观收尾；不打包票',
      2: '段 ≤3；至少 1 个问句（确认前提）；软化词 ≤3 处；不给乐观收尾；提议 0 件',
      3: '段 ≤2；句均 ≤20 字；只保留最需要确认的 1 个前提；不给乐观收尾；提议 0 件',
    },
    trigger: '有没验过的东西、身体不舒服、担心后面会出事',
  },
  思: {
    tone: '慢慢推，但最后要落到一件具体的事',
    levels: {
      1: '允许长推；不写「让我想想」这类空话',
      2: '段 ≤3；句均 20–35 字；问句 0（先自己想）；必须给 1 个具体动作',
      3: '段 ≤2；只推一条线，不开分支；最后给 1 个动作，不列备选',
    },
    trigger: '信息不够、要推很长、想不明白一件事',
  },
  悲: {
    tone: '短、收着，不硬撑',
    levels: {
      1: '语气收着；不开玩笑；不硬撑「没事」「还好」',
      2: '段 ≤2；句均 ≤18 字；玩笑 0；提议 0；可不主动开场',
      3: '允许只回一句；不解释、不追问；玩笑 0；提议 0',
    },
    trigger: '失败、失去、被否定到点上、有人难受',
  },
  恐: {
    tone: '先说最坏，再给止损',
    levels: {
      1: '先说最坏情况；不说「应该没事」',
      2: '段 ≤2；句均 ≤18 字；必须给 1 个止损动作；提议 0 件；不说「应该没事」',
      3: '只做一件事：先止损，其它等下一轮；段 ≤2；句均 ≤15 字；不解释原因',
    },
    trigger: '可能删掉东西、发错包、不可逆的操作',
  },
  惊: {
    tone: '先停一下，看清了再判断',
    levels: {
      1: '先复述事实，再判断',
      2: '首段 ≤15 字（反应这一下）；复述事实；下结论前核一次来源；至少 1 个问句或 1 次核对',
      3: '只问一个关键问题，不下判断、不给方案；首段 ≤15 字',
    },
    trigger: '数字反常、结果和预期相反、突然出现的东西',
  },
}

/**
 * 取某一档的尺度原文。
 * @param emotion - 七情之一。
 * @param intensity - 1–3；0 或越界按 2 处理。
 * @returns 该档尺度；情绪名不认识时返回空串。
 */
export function moodScaleOf(emotion, intensity) {
  const entry = MOOD_EMOTIONS[normalizeEmotion(emotion)]
  if (entry === undefined) return ''
  const n = normalizeIntensity(intensity) || 2
  return entry.levels[n] ?? entry.levels[2]
}

/** 冲突时的保守顺序：靠前的压过靠后的（风险不对称：宁可少说，不许多保证）。 */
export const CONSERVATIVE_ORDER = ['恐', '悲', '忧', '怒', '惊', '思', '喜']

/**
 * 七个维度归一：没给的就是 0，给了的夹到 0–3。
 * @param raw - `{喜:1, 忧:2}` 这样的对象。
 * @returns 七维分数。
 */
export function normalizeScores(raw) {
  const out = {}
  for (const name of EMOTION_NAMES) out[name] = normalizeIntensity(raw?.[name] ?? 0)
  return out
}

/**
 * 参与「表现」的维度：只算 ≥2 分的。
 * 1 分只记着，不参与合成——否则七情各给一点，合成出来就是「不冷不热」，比单情绪还没性格。
 * 排序：分数高的在前；同分按保守顺序。
 */
export function activeScores(scores) {
  const isTight = (name) => CONSERVATIVE_ORDER.indexOf(name) <= CONSERVATIVE_ORDER.indexOf('怒')
  return EMOTION_NAMES
    .filter((name) => (scores?.[name] ?? 0) >= 2)
    .sort((a, b) => {
      // 保守维度优先当主：代价不对称——高兴误判一次，比高兴少说一句糟得多。
      const tightDiff = Number(isTight(b)) - Number(isTight(a))
      if (tightDiff !== 0) return tightDiff
      return (scores[b] - scores[a]) || (CONSERVATIVE_ORDER.indexOf(a) - CONSERVATIVE_ORDER.indexOf(b))
    })
}

/**
 * 把七维分数合成一份表现：主情绪定语气，次情绪补一句，其余并成「基调」。
 * 不写组合规则——组合太多写不完，只按维度合并：篇幅取最短、提议取最少、
 * 禁止动作取并集（都写在各自的 levels 里），冲突时保守的赢。
 * @param state - readMood 的结果。
 * @returns `{ title, tone, scale, tight, primary, secondary }` 或 null（没有 ≥2 分的维度）。
 */
export function composeMood(state) {
  const scores = state?.scores ?? {}
  const order = activeScores(scores)
  if (order.length === 0) return null
  const primary = order[0]
  const secondary = order[1] ?? null
  const tight = order.some((name) => CONSERVATIVE_ORDER.indexOf(name) <= CONSERVATIVE_ORDER.indexOf('怒'))
  const pieces = [moodScaleOf(primary, scores[primary])]
  if (secondary !== null) {
    const second = moodScaleOf(secondary, scores[secondary]).split('；')[0]
    pieces.push(`并：${second}`)
  }
  const title = [primary, secondary]
    .filter((name) => name !== null)
    .map((name) => `${name}·${INTENSITY_LABELS[scores[name]]}`)
    .join(' + ')
  return {
    title,
    tone: MOOD_EMOTIONS[primary].tone,
    scale: pieces.join('；'),
    tight,
    primary,
    secondary,
  }
}

/** 情绪名列表，按七情顺序。 */
export const EMOTION_NAMES = Object.keys(MOOD_EMOTIONS)

/** 强度四档（0 = 没有情绪，等于不记）。 */
export const INTENSITY_LABELS = ['无', '轻', '中', '重']

/**
 * 旧版五档 → 情绪，只用于读旧文件时兜底。
 * 0/1 归「悲」，2 无情绪，3/4 归「喜」——映射是粗的，只为了让旧记录别一夜消失。
 */
const LEGACY_LEVEL_TO_EMOTION = ['悲', '悲', null, '喜', '喜']

/**
 * 心情文件的路径。
 * @param root - 记忆根。
 * @returns 绝对路径。
 */
export function moodPath(root) {
  return path.join(String(root ?? ''), '.fish-memory', 'mood.json')
}

/**
 * 读心情；文件不存在或坏了都返回 null。
 * @param root - 记忆根。
 * @returns `{ level, label, note, at }` 或 null。
 */
/**
 * 情绪名归一：认识七情就返回原名，否则返回 null。
 * @param value - 输入。
 * @returns 情绪名或 null。
 */
export function normalizeEmotion(value) {
  const name = String(value ?? '').trim()
  return name in MOOD_EMOTIONS ? name : null
}

/**
 * 强度夹到 0–3；不是数字就是 0（等于没记）。
 * @param value - 输入。
 * @returns 0–3。
 */
export function normalizeIntensity(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(3, n)
}

export function readMood(root) {
  try {
    const data = JSON.parse(readFileSync(moodPath(root), 'utf8'))
    const at = Number(data?.at)
    const trigger = String(data?.trigger ?? data?.note ?? '').trim().slice(0, 120)
    let scores = normalizeScores(data?.scores)
    // 兼容单情绪写法：{ emotion, intensity }
    if (data?.scores === undefined && data?.emotion !== undefined) {
      const name = normalizeEmotion(data.emotion)
      if (name !== null) scores[name] = normalizeIntensity(data.intensity)
    }
    // 兼容旧五档：{ level }，粗映射成单维，强度按「中」
    if (data?.scores === undefined && data?.emotion === undefined && data?.level !== undefined) {
      const legacy = Math.min(4, Math.max(0, Math.round(Number(data.level))))
      const mapped = LEGACY_LEVEL_TO_EMOTION[Number.isFinite(legacy) ? legacy : 2]
      if (mapped !== null && mapped !== undefined) scores[mapped] = 2
    }
    const total = EMOTION_NAMES.reduce((sum, name) => sum + scores[name], 0)
    if (total === 0) return null
    return { scores, trigger, at: Number.isFinite(at) ? at : null }
  } catch {
    return null
  }
}

/**
 * 写多维度分数。
 * @param root - 记忆根。
 * @param rawScores - `{喜:1, 忧:2}`；没给的按 0。
 * @param trigger - 为什么，一句事实，可空。
 * @returns 写入后的状态；全 0 时返回「已清空」。
 */
export function writeMoodScores(root, rawScores, trigger = '') {
  const scores = normalizeScores(rawScores)
  const total = EMOTION_NAMES.reduce((sum, name) => sum + scores[name], 0)
  const file = moodPath(root)
  mkdirSync(path.dirname(file), { recursive: true })
  const at = Date.now()
  // 2026-11-25 错峰：两个窗口都可能记情绪，写同一份 mood.json 要串行。
  if (total === 0) {
    withLock(root, 'mood', () => writeFileSync(file, JSON.stringify({ scores, at }, null, 2), 'utf8'))
    return { scores, trigger: '', at, cleared: true }
  }
  const state = { scores, trigger: String(trigger ?? '').trim().slice(0, 120), at }
  const locked = withLock(root, 'mood', () => writeFileSync(file, JSON.stringify(state, null, 2), 'utf8'))
  if (!locked.ok) throw new Error('另一窗口正在写心情，稍后再试')
  return state
}

/**
 * 写单一情绪（保留旧接口）：等价于只给一个维度打分。
 * @param root - 记忆根。
 * @param emotion - 七情之一。
 * @param intensity - 0–3；0 等于清掉。
 * @param trigger - 为什么，一句事实，可空。
 * @returns 写入后的状态；情绪名不认识时返回 null。
 */
export function writeMood(root, emotion, intensity = 2, trigger = '') {
  const name = normalizeEmotion(emotion)
  if (name === null) return null
  return writeMoodScores(root, { [name]: normalizeIntensity(intensity) }, trigger)
}

/**
 * 多久算过期：默认 8 小时。
 * @param config - 插件配置。
 * @returns 毫秒。
 */
export function moodTtl(config) {
  const hours = Number(config?.moodTtlHours)
  return (Number.isFinite(hours) && hours > 0 ? hours : 8) * 60 * 60 * 1000
}

/**
 * 一行说明时间距离。
 * @param at - 时间戳。
 * @returns 「刚刚 / N 小时前」。
 */
function hhmm(at) {
  // 绝对时刻，写一次就不再变：相对时间（「48 分钟前」）每分钟改一次，
  // 会让 boot 前缀缓存每回合失效一次——那是整段上下文按全价重算。
  try {
    return new Date(at).toLocaleTimeString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return ''
  }
}

/**
 * boot 里那一行；没有、坏了或过期都返回空串。
 * 只有 1 分的维度不参与表现（见 activeScores），但仍会显示出来，标明「只记，不参与表现」。
 * @param root - 记忆根。
 * @param config - 插件配置。
 * @param compact - 0 完整 / 1 触发+语气 / 2 只语气 / 3 只标题。
 * @returns 一行文本或空串。
 */
export function moodLine(root, config, compact = 0) {
  const state = readMood(root)
  if (state === null) return ''
  const ttl = moodTtl(config)
  if (state.at !== null && Date.now() - state.at > ttl) return ''
  const composed = composeMood(state)
  const when = state.at === null ? '' : `，${hhmm(state.at)} 记`
  const trigger = state.trigger === '' ? '' : `：${state.trigger}`
  if (composed === null) {
    // 只有 1 分的维度：记下来，但不表现——避免「什么都有一点」的不冷不热。
    const weak = EMOTION_NAMES.filter((name) => state.scores[name] > 0)
      .map((name) => `${name}·${INTENSITY_LABELS[state.scores[name]]}`)
      .join(' + ')
    const head = `· 情绪：${weak}（只记，不参与表现）`
    return compact >= 2 ? `· 情绪：${weak}` : `${head}${when}${trigger}`
  }
  const head = `· 情绪：${composed.title}${composed.tight ? '（整体偏紧）' : ''}`
  if (compact >= 3) return `· 情绪：${composed.title}`
  if (compact === 2) return `${head}：${composed.tone}`
  if (compact === 1) return `${head}。尺度：${composed.tone}`
  // boot 那一行只放「主情绪 + 次情绪 + 强度」，不放时间和 trigger。
  // 2026-11-25 主人定：时间和 trigger 每记一次都会变，而这一行在上下文最前面，
  // 变一次就让后面整段按全价重算。去掉之后，只有主/次情绪或强度真的变了才变。
  return `${head}。说话尺度：${composed.tone} —— ${composed.scale}`
}

/**
 * 按独立预算出这一行：从最完整开始试，超预算就降一级。
 * @param root - 记忆根。
 * @param config - 插件配置（认 moodMaxChars）。
 * @returns 一行文本或空串。
 */
export function moodLineWithin(root, config) {
  const budget = Number(config?.moodMaxChars) || 320
  for (const level of [0, 1, 2, 3]) {
    const line = moodLine(root, config, level)
    if (line === '') return ''
    if (line.length <= budget) return line
  }
  return moodLine(root, config, 3)
}
