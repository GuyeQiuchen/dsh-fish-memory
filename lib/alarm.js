/**
 * 叫醒器（可整块删除的小模块）。
 *
 * 要解决的语义：分数够了才叫，不是到点就叫。
 *
 * 做法分两半——
 *   代码这半：每几分钟读一次分数文件（纯读盘，不调模型、不花钱），
 *             某会话到 6 分就把它那条叫醒任务立刻投递一次，然后把分数清零；
 *   宿主那半：每条任务只在创建时投递一次「保底」，之后靠上面那步按需触发。
 *
 * 只给「有事件发生过的会话」建任务——没进过的对话不会被叫醒。
 *
 * 模块化：删本文件、index.js 顶部那行 import、inject 里的 'schedule'、
 * apply 里那两段即可回退；已经建好的定时任务要手动删。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { WAKE_AT, readWake, tickWake, writeWake } from './wake.js'
import { tidyDue } from './tidy.js'
import { diaryDue, diaryPageOf } from './diary.js'
import { readTidy } from './tidy.js'

/** 整理刚开始的那些分钟不算铺开：日记要等它落地。 */
const DIARY_AFTER_TIDY_MS = 30 * 60 * 1000

/** 只取上次整理的时间戳，取不到就是 0。 */
function readTidyState(root) {
  try {
    const state = readTidy(root)
    return state !== null && Number.isFinite(state.at) ? Number(state.at) : 0
  } catch {
    return 0
  }
}

/** 任务标题前缀，用来认自己建过哪些。 */
const TITLE = '叫醒自己找事做'

/** 任务只当投递通道用；这个频率几乎不会自己到点，触发全靠分数。 */
const FALLBACK_SECONDS = 365 * 24 * 60 * 60

/** 同一会话两次叫醒之间至少隔这么久：睡一晚分数会涨满，不拉开间隔就会连着响。 */
const MIN_GAP_MS = 20 * 60 * 1000

/** 只保证不在同一个回合里插进来；聊天中途被叫起来也没关系。 */
const QUIET_MS = 60 * 1000

/** 投递进来的那句话。 */
const PROMPT = '这一轮是叫醒，不是主人在说话。醒了就自己做一件想做的事，做完简短说一句做了什么。'

/** 上次叫醒时刻的存档路径。 */
function firedPath(root) {
  return path.join(String(root ?? ''), '.fish-memory', 'fired.json')
}

/**
 * 读上次叫醒时刻。
 * @param root - 记忆根。
 * @returns `{ [sessionId]: 毫秒时间戳 }`。
 */
export function readFiredAt(root) {
  try {
    const data = JSON.parse(readFileSync(firedPath(root), 'utf8'))
    const out = {}
    for (const [key, value] of Object.entries(data ?? {})) {
      const at = Number(value)
      if (typeof key === 'string' && key !== '' && Number.isFinite(at) && at > 0) out[key] = at
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 写上次叫醒时刻。
 * @param root - 记忆根。
 * @param map - `{ [sessionId]: 毫秒时间戳 }`。
 */
function saveFiredAt(root, map) {
  try {
    mkdirSync(path.dirname(firedPath(root)), { recursive: true })
    writeFileSync(firedPath(root), JSON.stringify(map ?? {}, null, 2), 'utf8')
  } catch {
    /* 存不下最多多叫一次 */
  }
}

/** 整理任务的标题前缀，用来认出自己建的那条。 */
const TIDY_TITLE = '整理一轮记忆'
/** 整理任务也只要一个投递通道，靠代码触发，不按时间响。 */
const TIDY_FALLBACK_SECONDS = 31536000
/** 整理任务的提示：说清这是一轮什么活，别只说「该整理了」。 */
const TIDY_PROMPT =
  '这一轮是整理轮，不是主人在说话。先看 mem_drafts 有没有待处理草案：有就按 A/B/C 处理并写回页；没有就翻最近的记忆页和流水，把值得留的提炼成判断写进页。最后简短说一句处理了什么，不做完不算结束。'
/** 整理催告的记账 key，和叫醒共用 fired.json。 */
const TIDY_KEY = '__tidy__'

/** 会话 id → 整理任务 id 的存档路径。 */
function tidyTaskPath(root) {
  return path.join(String(root ?? ''), '.fish-memory', 'tidy-task.json')
}

/**
 * 读整理任务 id。
 * @param root - 记忆根。
 * @returns 会话 id → 任务 id。
 */
function readTidyTask(root) {
  try {
    const data = JSON.parse(readFileSync(tidyTaskPath(root), 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

/**
 * 写整理任务 id。
 * @param root - 记忆根。
 * @param map - 会话 id → 任务 id。
 */
function writeTidyTask(root, map) {
  try {
    mkdirSync(path.dirname(tidyTaskPath(root)), { recursive: true })
    writeFileSync(tidyTaskPath(root), JSON.stringify(map), 'utf8')
  } catch {
    /* 存不下最多下次重建 */
  }
}

/**
 * 给一个会话确保有整理任务。
 * @param schedule - 宿主的 schedule 服务。
 * @param sessionId - 会话 id。
 * @param root - 记忆根。
 * @returns `{ status, taskId? }`。
 */
export async function ensureTidyAlarm(schedule, sessionId, root) {
  if (!schedule || typeof schedule.create !== 'function' || typeof schedule.list !== 'function') {
    return { status: 'no-service' }
  }
  const id = String(sessionId ?? '')
  if (id === '') return { status: 'no-session' }
  const known = readTidyTask(root)
  try {
    const page = await schedule.list({ limit: 200 })
    const items = Array.isArray(page?.items) ? page.items : []
    const mine = items.find(
      (item) =>
        item?.status === 'active' &&
        item?.target?.kind === 'session' &&
        String(item.target.sessionId ?? '') === id &&
        String(item.title ?? '').startsWith(TIDY_TITLE),
    )
    if (mine) {
      const taskId = String(mine.id ?? '')
      if (taskId !== '') {
        known[id] = taskId
        writeTidyTask(root, known)
      }
      return { status: 'exists', taskId }
    }
    const created = await schedule.create({
      title: TIDY_TITLE,
      prompt: TIDY_PROMPT,
      timing: { kind: 'every', every_seconds: TIDY_FALLBACK_SECONDS },
      target: { kind: 'session', sessionId: id },
    })
    const taskId = String(created?.id ?? '')
    if (taskId !== '') {
      known[id] = taskId
      writeTidyTask(root, known)
    }
    return { status: 'created', taskId }
  } catch (error) {
    return { status: 'failed', reason: String(error?.message ?? error) }
  }
}

/**
 * 整理到期就在轮末投一条消息，下一轮一睁眼就是整理。
 *
 * 走轮末而不是轮初：正在做的事不被打断，但下一轮不会忘了。
 * @param schedule - 宿主的 schedule 服务。
 * @param root - 记忆根。
 * @param config - 插件配置（读 tidyHours）。
 * @returns 投递了就返回 1。
 */
/**
 * 投递一次任务。
 * 宿主的 run 在任务不存在、或上一次还在排队时**不抛错**，而是返回 { code }；
 * 不检查就会把「没投出去」记成「投过了」，接下来 20 小时都不再催。
 * @param schedule - 宿主的 schedule 服务。
 * @param id - 任务 id。
 */
async function runTask(schedule, id) {
  const result = await schedule.run({ id })
  if (result !== null && typeof result === 'object' && typeof result.code === 'string') {
    throw new Error(`schedule run failed: ${result.code}`)
  }
  return result
}

export async function nudgeTidy(schedule, root, config = {}) {
  if (!schedule || typeof schedule.run !== 'function') return 0
  let due
  try {
    due = tidyDue(root, config)
  } catch {
    return 0
  }
  if (!due.due) return 0
  const firedAt = readFiredAt(root)
  const last = Number(firedAt[TIDY_KEY] ?? 0)
  // 同一档到期只催一次；真整理完会打点，due 自然变 false
  if (last > 0 && Date.now() - last < 20 * 60 * 60 * 1000) return 0
  const known = readTidyTask(root)
  const active = readActive(root)
  const sessionId = active !== '' && known[active] ? active : Object.keys(known)[0]
  if (!sessionId) return 0
  try {
    await runTask(schedule, known[sessionId])
    firedAt[TIDY_KEY] = Date.now()
    saveFiredAt(root, firedAt)
    return 1
  } catch {
    return 0
  }
}

/** 日记任务的标题前缀，用来认出自己建的那条。 */
const DIARY_TITLE = '写今天的日记'
/** 日记任务也只要一个投递通道，靠代码触发，不按时间响。 */
const DIARY_FALLBACK_SECONDS = 31536000
/** 日记任务的提示：只交代这是一轮什么活，具体写哪天由 nudgeDiary 现填。 */
const DIARY_PROMPT_PREFIX = '这一轮是写日记，不是主人在说话。可以先跟主人说一句「我写日记去了」，然后继续做自己的事，不用等他回。'
/** 日记催告的记账 key，和叫醒、整理共用 fired.json。 */
const DIARY_KEY = '__diary__'

/** 会话 id → 日记任务 id 的存档路径。 */
function diaryTaskPath(root) {
  return path.join(String(root ?? ''), '.fish-memory', 'diary-task.json')
}

/**
 * 读日记任务 id。
 * @param root - 记忆根。
 * @returns 会话 id → 任务 id。
 */
function readDiaryTask(root) {
  try {
    const data = JSON.parse(readFileSync(diaryTaskPath(root), 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

/**
 * 写日记任务 id。
 * @param root - 记忆根。
 * @param map - 会话 id → 任务 id。
 */
function writeDiaryTask(root, map) {
  try {
    mkdirSync(path.dirname(diaryTaskPath(root)), { recursive: true })
    writeFileSync(diaryTaskPath(root), JSON.stringify(map), 'utf8')
  } catch {
    /* 存不下最多下次重建 */
  }
}

/**
 * 给一个会话确保有日记任务。和 ensureTidyAlarm 同构，只是标题不同。
 * @param schedule - 宿主的 schedule 服务。
 * @param sessionId - 会话 id。
 * @param root - 记忆根。
 * @returns `{ status, taskId? }`。
 */
export async function ensureDiaryAlarm(schedule, sessionId, root) {
  if (!schedule || typeof schedule.create !== 'function' || typeof schedule.list !== 'function') {
    return { status: 'no-service' }
  }
  const id = String(sessionId ?? '')
  if (id === '') return { status: 'no-session' }
  const known = readDiaryTask(root)
  try {
    const page = await schedule.list({ limit: 200 })
    const items = Array.isArray(page?.items) ? page.items : []
    const mine = items.find(
      (item) =>
        item?.status === 'active' &&
        item?.target?.kind === 'session' &&
        String(item.target.sessionId ?? '') === id &&
        String(item.title ?? '').startsWith(DIARY_TITLE),
    )
    if (mine) {
      const taskId = String(mine.id ?? '')
      if (taskId !== '') {
        known[id] = taskId
        writeDiaryTask(root, known)
      }
      return { status: 'exists', taskId }
    }
    const created = await schedule.create({
      title: DIARY_TITLE,
      prompt: DIARY_PROMPT_PREFIX,
      timing: { kind: 'every', every_seconds: DIARY_FALLBACK_SECONDS },
      target: { kind: 'session', sessionId: id },
    })
    const taskId = String(created?.id ?? '')
    if (taskId !== '') {
      known[id] = taskId
      writeDiaryTask(root, known)
    }
    return { status: 'created', taskId }
  } catch (error) {
    return { status: 'failed', reason: String(error?.message ?? error) }
  }
}

/**
 * 日记到期就在轮末投一条，下一轮一睁眼就写。
 *
 * 和 tidy 有两个差别（主人 2026-11-21 定）：
 *   1. **整理没做完就不写**：tidyDue 还是真的时候直接让路，等下一轮检查。
 *      不排延时队列，避免整理跨轮、日记在整理中途插进来。
 *   2. 投递时把「今天写在哪一页」现填进提示，页名按投递当天算。
 *
 * @param schedule - 宿主的 schedule 服务。
 * @param root - 记忆根。
 * @param config - 插件配置（读 diaryHours、diary 开关）。
 * @returns 投递了就返回 1。
 */
export async function nudgeDiary(schedule, root, config = {}) {
  if (config?.diary === false) return 0
  if (!schedule || typeof schedule.run !== 'function') return 0
  let due
  try {
    due = diaryDue(root, config)
  } catch {
    return 0
  }
  if (!due.due) return 0
  // 整理还没做完就往后让：日记要写在归位之后的材料上。
  // 判两件事：①还没到期的下一轮整理（due）②刚开始整理、还没铺开（距打点不足 QUIET 分钟）。
  // 后者是因为自动生成草案 / mem_consolidate 一打点，due 立刻变 false，
  // 光看 due 会把日记放进整理中途。
  try {
    if (tidyDue(root, config).due) return 0
    const state = readTidyState(root)
    if (state !== null && state > 0 && Date.now() - state < DIARY_AFTER_TIDY_MS) return 0
  } catch {
    /* 判断不了整理状态就按可以写处理 */
  }
  const firedAt = readFiredAt(root)
  const last = Number(firedAt[DIARY_KEY] ?? 0)
  // 同一档到期只催一次；写完会打点，due 自然变 false
  if (last > 0 && Date.now() - last < 20 * 60 * 60 * 1000) return 0
  const known = readDiaryTask(root)
  const active = readActive(root)
  const sessionId = active !== '' && known[active] ? active : Object.keys(known)[0]
  if (!sessionId) return 0
  const page = diaryPageOf()
  const prompt =
    `${DIARY_PROMPT_PREFIX}今天这一篇写到 ${page}（一天一份，新的一天就是新的一页）。` +
    '写这一天实际发生了什么、你当时怎么想的，别写成纪要；' +
    '写完调 mem_diary 打点就行，不用再向主人汇报写了哪页。'
  try {
    // run 只认 id，prompt 只能先写进任务本身
    if (typeof schedule.edit === 'function') {
      const edited = await schedule.edit({
        id: known[sessionId],
        action: 'update',
        patch: { prompt },
      })
      if (edited !== null && typeof edited === 'object' && typeof edited.code === 'string') {
        throw new Error(`schedule edit failed: ${edited.code}`)
      }
    }
    await runTask(schedule, known[sessionId])
    firedAt[DIARY_KEY] = Date.now()
    saveFiredAt(root, firedAt)
    return 1
  } catch {
    return 0
  }
}

/** 待结算的叫醒标记：被叫醒的那一轮结束时要扣分。 */
function pendingPath(root) {
  return path.join(String(root ?? ''), '.fish-memory', 'pending-wake.json')
}

/**
 * 读「这一轮是不是被叫醒的」。
 * @param root - 记忆根。
 * @returns 毫秒时间戳；没有或太久以前就是 0。
 */
export function readPendingWake(root) {
  try {
    const at = Number(JSON.parse(readFileSync(pendingPath(root), 'utf8'))?.at)
    if (!Number.isFinite(at) || at <= 0) return 0
    // 超过半小时的标记作废，免得下次结算时误扣
    return Date.now() - at < 30 * 60 * 1000 ? at : 0
  } catch {
    return 0
  }
}

/**
 * 清掉叫醒标记。
 * @param root - 记忆根。
 */
export function clearPendingWake(root) {
  try {
    writeFileSync(pendingPath(root), JSON.stringify({ at: 0 }), 'utf8')
  } catch {
    /* 清不掉最多多扣一次 */
  }
}

/** 当前醒着的会话：只有它会被叫醒，别的窗口一律静音。 */
function activePath(root) {
  return path.join(String(root ?? ''), '.fish-memory', 'active.json')
}

/**
 * 记下现在醒着的是哪个会话。
 * @param root - 记忆根。
 * @param sessionId - 会话 id。
 */
export function markActive(root, sessionId) {
  const id = String(sessionId ?? '')
  if (id === '') return
  try {
    mkdirSync(path.dirname(activePath(root)), { recursive: true })
    writeFileSync(activePath(root), JSON.stringify({ session: id }), 'utf8')
  } catch {
    /* 记不下就谁都不醒，比全醒好 */
  }
}

/**
 * 读当前醒着的会话。
 * @param root - 记忆根。
 * @returns 会话 id；没有就是空串。
 */
export function readActive(root) {
  try {
    return String(JSON.parse(readFileSync(activePath(root), 'utf8'))?.session ?? '')
  } catch {
    return ''
  }
}

/** 上一次有人说话的时刻，用来避免在对话中间插话。 */
function lastMsgPath(root) {
  return path.join(String(root ?? ''), '.fish-memory', 'last-msg.json')
}

/**
 * 记下这次主人说话的时刻。
 * @param root - 记忆根。
 * @param at - 毫秒时间戳。
 */
export function markMessage(root, at = Date.now()) {
  try {
    mkdirSync(path.dirname(lastMsgPath(root)), { recursive: true })
    writeFileSync(lastMsgPath(root), JSON.stringify({ at: Number(at) }), 'utf8')
  } catch {
    /* 记不下最多插一句嘴 */
  }
}

/**
 * 最近一次说话的時刻；没有就是 0。
 * @param root - 记忆根。
 * @returns 毫秒时间戳。
 */
function lastMessageAt(root) {
  try {
    const at = Number(JSON.parse(readFileSync(lastMsgPath(root), 'utf8'))?.at)
    return Number.isFinite(at) && at > 0 ? at : 0
  } catch {
    return 0
  }
}

/** 会话 id → 任务 id 的存档路径。 */
function alarmsPath(root) {
  return path.join(String(root ?? ''), '.fish-memory', 'alarms.json')
}

/**
 * 读存档；没有或坏了都当空。
 * @param root - 记忆根。
 * @returns `{ [sessionId]: taskId }`。
 */
export function readAlarms(root) {
  try {
    const data = JSON.parse(readFileSync(alarmsPath(root), 'utf8'))
    const out = {}
    for (const [key, value] of Object.entries(data ?? {})) {
      if (typeof key === 'string' && typeof value === 'string' && key !== '' && value !== '') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 写存档；写不进去也不抛。
 * @param root - 记忆根。
 * @param map - `{ [sessionId]: taskId }`。
 */
export function writeAlarms(root, map) {
  try {
    mkdirSync(path.dirname(alarmsPath(root)), { recursive: true })
    writeFileSync(alarmsPath(root), JSON.stringify(map ?? {}, null, 2), 'utf8')
  } catch {
    /* 存不下下次会重建，不影响这一轮 */
  }
}

/**
 * 给一个会话确保有叫醒任务，并记下它的 id。
 * @param schedule - 宿主的 schedule 服务，没有就传 null。
 * @param sessionId - 会话 id。
 * @param root - 记忆根，用来存 id。
 * @returns `{ status, taskId? }`。
 */
export async function ensureAlarm(schedule, sessionId, root) {
  if (!schedule || typeof schedule.create !== 'function' || typeof schedule.list !== 'function') {
    return { status: 'no-service' }
  }
  const id = String(sessionId ?? '')
  if (id === '') return { status: 'no-session' }
  const known = readAlarms(root)
  try {
    const page = await schedule.list({ limit: 200 })
    const items = Array.isArray(page?.items) ? page.items : []
    const mine = items.find(
      (item) =>
        item?.status === 'active' &&
        item?.target?.kind === 'session' &&
        String(item.target.sessionId ?? '') === id &&
        String(item.title ?? '').startsWith(TITLE),
    )
    if (mine) {
      const taskId = String(mine.id ?? '')
      if (taskId !== '') {
        known[id] = taskId
        writeAlarms(root, known)
        // 文案改过就顺手更新老任务，免得升级后还留着旧说法
        if (String(mine.prompt ?? '') !== PROMPT && typeof schedule.edit === 'function') {
          try {
            await schedule.edit({ id: taskId, action: 'update', patch: { prompt: PROMPT } })
          } catch {
            /* 改不动就留着旧的，不影响叫醒 */
          }
        }
      }
      return { status: 'exists', taskId }
    }
    const created = await schedule.create({
      title: TITLE,
      prompt: PROMPT,
      timing: { kind: 'every', every_seconds: FALLBACK_SECONDS },
      target: { kind: 'session', sessionId: id },
    })
    const taskId = String(created?.id ?? '')
    if (taskId !== '') {
      known[id] = taskId
      writeAlarms(root, known)
    }
    return { status: 'created', taskId }
  } catch (error) {
    return { status: 'failed', reason: String(error?.message ?? error) }
  }
}

/**
 * 分数够了就投递：读各会话的分数，到线的立刻触发那条任务，并把分数清零。
 *
 * 这是整套机制里唯一「读分数、做决定」的代码路径；它不调模型，
 * 只有真要叫醒时才让宿主起一轮。
 * @param schedule - 宿主的 schedule 服务。
 * @param root - 记忆根。
 * @param options - `{ now?, threshold? }`。
 * @returns 触发了几次。
 */
export async function tickAlarms(schedule, root, options = {}) {
  if (!schedule || typeof schedule.run !== 'function') return 0
  const now = Number(options.now ?? Date.now())
  const threshold = Number(options.threshold ?? WAKE_AT)
  const known = readAlarms(root)
  const firedAt = readFiredAt(root)
  // 对话正在进行就别插一句：等安静下来再说
  const lastMsg = lastMessageAt(root)
  if (lastMsg > 0 && now - lastMsg < QUIET_MS) return 0
  // 只叫醒当前醒着的那个会话：多开几个窗口不该一起响
  const active = readActive(root)
  let fired = 0
  for (const [sessionId, taskId] of Object.entries(known)) {
    if (taskId === '') continue
    if (active !== '' && sessionId !== active) continue
    let state
    let info
    try {
      state = readWake(root, sessionId)
      // 走 tickWake 结算：分数写回，过 8/10 分该排的随机时刻也一起补上
      info = tickWake(root, now, sessionId)
    } catch {
      continue
    }
    const weight = Number(info?.weight ?? state.weight)
    // 到线的分数、或者过 8/10 分时排的那个随机时刻到点，都算该叫
    const boostDue = Boolean(info?.boosted) || (state.boostAt ?? []).some((at) => Number(at) <= now)
    if (weight < threshold && !boostDue) continue
    // 同一个会话刚叫过就先不叫：分数靠干活自己往下掉，不人为清零。
    // 随机闹钟是「额外一次」，不排这个队——否则它跟固定叫就没区别了。
    const lastAt = Number(firedAt[sessionId] ?? 0)
    if (!boostDue && lastAt > 0 && now - lastAt < MIN_GAP_MS) continue
    try {
      await runTask(schedule, taskId)
      firedAt[sessionId] = now
      saveFiredAt(root, firedAt)
      // 留个标记：这一轮是被叫醒的，结束时无论做没做事都要扣
      try {
        mkdirSync(path.dirname(pendingPath(root)), { recursive: true })
        writeFileSync(pendingPath(root), JSON.stringify({ at: now }), 'utf8')
      } catch {
        /* 标不上就当普通一轮 */
      }
      fired += 1
    } catch {
      // 任务在外面被删掉了：清掉记账，下一轮会重新建一条。
      // 但这次叫醒已经没送出去——如果正好消耗掉一个随机时刻，就把它补回来，
      // 否则重建之后那一次额外唤醒就白白丢了。分数到线的补不回来，等下一格。
      delete known[sessionId]
      writeAlarms(root, known)
      if (info?.boosted) {
        try {
          const back = readWake(root, sessionId)
          if (back.boostAt.length === 0) {
            back.boostAt = [now + 60 * 1000]
            writeWake(root, back, sessionId)
          }
        } catch {
          /* 补不回去就认了 */
        }
      }
    }
  }
  return fired
}
