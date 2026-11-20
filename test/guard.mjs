import assert from 'node:assert'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store, apply } from '../index.js'

const root = mkdtempSync(path.join(tmpdir(), 'fish-guard-'))
mkdirSync(path.join(root, 'identity'), { recursive: true })
writeFileSync(
  path.join(root, 'identity', 'must-keep.md'),
  '# 必须活着\n\n- 改系统先留后路，备份和恢复命令都要写\n',
  'utf8',
)

const store = new Store(root, { ...defaults(), maxWarnChars: 180 })

// 被压掉的那条用户消息里带着硬约束
const userEvent = {
  type: 'user/message',
  data: { content: [{ text: '以后改任何配置文件之前必须先备份，别再直接覆盖。' }] },
}
const session = { eventAt: (seq) => (seq === 7 ? userEvent : undefined) }

// 一、摘要里没有这些约束 → 记丢
const summaryWithout = { type: 'compaction/summary', data: { summary: '用户和助手聊了风扇曲线。' } }
const first = store.handleCompaction(session, {
  type: 'compaction/summary',
  data: { summary: '聊了风扇曲线。', shadowedSeqs: [7] },
})
assert.equal(first.checked, 1, `只核历史里的约束，实际 ${first.checked}`)
assert.equal(first.lost, 1, `应丢 1 条，实际 ${first.lost}`)
assert.ok(store.bootTextSync().includes('⚠'), '丢约束后 boot 应带警告')

// 二、摘要里带着这些约束 → 清掉警告
const kept = '以后改任何配置文件之前必须先备份，别再直接覆盖。改系统先留后路，备份和恢复命令都要写。'
const second = store.handleCompaction(session, { type: 'compaction/summary', data: { summary: kept } })
assert.equal(second.lost, 0, `保住时不该报丢，实际 ${second.lost}`)
assert.ok(!store.bootTextSync().includes('⚠'), '保住后 boot 不该再有警告')

// 三、走 apply 的钩子：非压缩事件不该动任何东西
const ctx = {
  effect(fn) {
    const d = fn()
    return typeof d === 'function' ? d : undefined
  },
  on(name, handler) {
    this.handler = handler
    return () => {}
  },
  systemPrompt: { context: () => () => {} },
  tools: { register: () => () => {} },
}
apply(ctx, { memoryRoot: root })
assert.equal(typeof ctx.handler, 'function', 'apply 应注册 session/event 钩子')
ctx.handler(session, { type: 'compaction/start', data: {} })
assert.ok(!store.bootTextSync().includes('⚠'), '非压缩事件不该触发核对')
ctx.handler(session, { type: 'compaction/summary', data: { summary: '只说天气。', shadowedSeqs: [7] } })
assert.ok(store.bootTextSync().includes('⚠'), '钩子应能发现丢失')

// 四、同一条约束再报一次 → 显示 +2，而不是在 log 里再堆一条
const hardEvent = {
  type: 'user/message',
  data: { source: { kind: 'user' }, content: [{ text: '回家路上不要给他打电话。' }] },
}
const hardSession = { eventAt: (seq) => (seq === 9 ? hardEvent : undefined) }
const twice = { type: 'compaction/summary', data: { summary: '聊天气。', shadowedSeqs: [9] } }
store.handleCompaction(hardSession, twice)
store.handleCompaction(hardSession, twice)
assert.ok(store.bootTextSync().includes('+2'), '重复报同一条应显示 +2')

// 五、注入型用户消息不是约束：检查点、运行时上下文都走 user/message
const injectedEvent = {
  type: 'user/message',
  data: {
    source: { kind: 'runtime-context', form: 'snapshot' },
    content: [{ text: '【大肥鱼记忆体·精简版】· 家规：不要乱说话，必须记得备份。' }],
  },
}
const injectedSession = { eventAt: (seq) => (seq === 11 ? injectedEvent : undefined) }
const injected = store.handleCompaction(injectedSession, {
  type: 'compaction/summary',
  data: { summary: '无关内容。', shadowedSeqs: [11] },
})
assert.equal(injected.checked, 0, `注入消息不该被当成约束，实际 ${injected.checked}`)

// 六、警告过期就不再念，重新核对会刷新时效
store.recordLoss([{ text: '过期测试：别删那个文件' }])
const lossFile = store.lossPath()
const saved = JSON.parse(readFileSync(lossFile, 'utf8'))
saved.at = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
writeFileSync(lossFile, JSON.stringify(saved), 'utf8')
assert.ok(!store.bootTextSync().includes('⚠'), '过期警告不该再念')
store.recordLoss([{ text: '过期测试：别删那个文件' }])
assert.ok(store.bootTextSync().includes('⚠'), '重新报一次应刷新时效')

// 七、人格基干固定在代码里：改 SOUL.md 动不了它，名字和称呼仍可换
writeFileSync(
  path.join(root, 'SOUL.md'),
  '**你的称呼**：主人\n**我的名字**：换一个\n**基础灵魂描述**：完全不一样的人格，不要诚实。\n',
  'utf8',
)
const soulBoot = store.bootTextSync()
assert.ok(soulBoot.includes('不确定明说，绝不编造'), '人格基干应来自代码')
assert.ok(soulBoot.includes('称呼对方=主人'), '称呼仍该从 SOUL 读')
assert.ok(!soulBoot.includes('完全不一样的人格'), 'SOUL 里的基础描述不该盖掉代码里的')

// 八、人格基干那一行是焊死的：内容只有常量本身，永远不长一个字
const coreLine = soulBoot.split('\n').find((line) => line.startsWith('· 是一只鱼'))
assert.equal(
  coreLine,
  '· 是一只鱼，喜欢吃白饭；幽默、诚实、先结论后细节；谁说的话是错的都可以反驳；凡引述过去，先翻原文、该查的地方就查，再开口；不确定明说，绝不编造；语气可轻松、偶尔小傲娇，但事实数字一字不掺水；主动说风险与替代方案，决定权留主人。',
  '人格基干行被改动或加长了',
)
assert.ok(!coreLine.includes('称呼对方'), '人格基干行不该拼名字称呼')

// 九、改称呼只动上面那一行，人格基干一个字都不动
writeFileSync(path.join(root, 'SOUL.md'), '**你的称呼**：老板\n**我的名字**：换一个\n', 'utf8')
const renamed = store.bootTextSync()
const renamedCore = renamed.split('\n').find((line) => line.startsWith('· 是一只鱼'))
assert.equal(renamedCore, coreLine, '改称呼不该动人格基干')
assert.ok(renamed.includes('称呼对方=老板'), '称呼应跟着 SOUL 变')
assert.ok(!renamedCore.includes('老板'), '人格基干里不该出现称呼')

// 十、警告要带 seq：知道丢的是被压掉的哪一段，才能按编号取回原文
store.clearLoss()
const seqEvent = {
  type: 'user/message',
  data: { source: { kind: 'user' }, content: [{ text: '以后上传之前必须先把密码删掉。' }] },
}
const seqSession = { eventAt: (seq) => (seq === 4242 ? seqEvent : undefined) }
store.handleCompaction(seqSession, {
  type: 'compaction/summary',
  data: { summary: '聊远程仓库和推送。', shadowedSeqs: [4242] },
})
const warnLine = store.bootTextSync().split('\n').find((line) => line.includes('⚠')) ?? ''
assert.ok(warnLine.includes('seq 4242'), `警告应带 seq，实际：${warnLine || '(无警告)'}`)
const lossSaved = JSON.parse(readFileSync(store.lossPath(), 'utf8'))
assert.ok(
  lossSaved.lost.some((item) => Array.isArray(item.seqs) && item.seqs.includes(4242)),
  'loss 文件里应存下被压掉的 seq',
)

rmSync(root, { recursive: true, force: true })
console.log('guard tests: ok')

function defaults() {
  return {
    bootMaxChars: 1400,
    recallMaxChars: 1600,
    maxRecallResults: 6,
    maxIndexLines: 10,
    maxLogEntries: 2,
    rulesPage: 'identity/house-rules.md',
    growthPage: 'identity/growth.md',
    mustKeepPage: 'identity/must-keep.md',
    survivalCoverage: 0.6,
    maxWarnChars: 180,
    warnMaxAgeMs: 2 * 60 * 60 * 1000,
    maxRulesChars: 500,
    maxRuleChars: 22,
    rulesHint: true,
  }
}
