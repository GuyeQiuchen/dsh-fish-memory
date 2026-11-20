/**
 * 心情模块的独立测试。
 *
 * 这份文件只测 lib/mood.js 与它在 boot / 工具里的挂载点；
 * 删掉心情模块时，连带删掉本文件即可，其他测试不受影响。
 */
import assert from 'node:assert'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store, apply } from '../index.js'
import { moodLine, writeMood } from '../lib/mood.js'

const root = mkdtempSync(path.join(tmpdir(), 'fish-mood-'))
mkdirSync(path.join(root, '.fish-memory'), { recursive: true })
const defaults = {
  bootMaxChars: 1400,
  maxWarnChars: 180,
  warnMaxAgeMs: 2 * 60 * 60 * 1000,
  maxGrowthChars: 220,
  maxRulesChars: 500,
  maxRuleChars: 22,
  rulesHint: false,
  moodTtlHours: 8,
}
const store = new Store(root, defaults)

// 一、没记过心情：boot 里不该多这一行
assert.equal(moodLine(root, defaults), '', '没记过心情时不该有这一行')

// 二、记一次：boot 带状态和说话尺度
const state = writeMood(root, 3, '下午把活干完了')
assert.equal(state.label, '不错')
const boot = store.bootTextSync()
assert.ok(boot.includes('心情：不错'), 'boot 应带心情行')
assert.ok(boot.includes('可以松一点'), 'boot 应带对应的说话尺度')
assert.ok(boot.includes('下午把活干完了'), 'note 应带进那一行')

// 三、过了保质期：隔夜的情绪不再注入
const file = path.join(root, '.fish-memory', 'mood.json')
const saved = JSON.parse(readFileSync(file, 'utf8'))
saved.at = Date.now() - 9 * 60 * 60 * 1000
writeFileSync(file, JSON.stringify(saved), 'utf8')
assert.equal(moodLine(root, defaults), '', '过期的心情不该再注入')

// 四、文件坏了也不能拖垮记忆体
writeFileSync(file, '{oops', 'utf8')
assert.equal(moodLine(root, defaults), '', '坏文件应返回空串')
assert.ok(store.bootTextSync().includes('记忆体'), '坏心情文件不该让 boot 崩掉')

// 五、工具挂载：默认注册，mood:false 时不注册，且不影响别的工具
const registered = []
const makeCtx = (sink) => ({
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : undefined
  },
  on() {
    return () => {}
  },
  systemPrompt: { context: () => () => {} },
  tools: {
    register(definition) {
      sink.push(definition)
      return () => {}
    },
  },
})
apply(makeCtx(registered), { memoryRoot: root })
assert.ok(registered.some((tool) => tool.name === 'mood_set'), '默认应注册 mood_set')
const off = []
apply(makeCtx(off), { memoryRoot: root, mood: false })
assert.ok(!off.some((tool) => tool.name === 'mood_set'), 'mood:false 时不该注册 mood_set')
assert.ok(off.some((tool) => tool.name === 'mem_recall'), '关掉心情不该影响记忆工具')

// 六、工具真的能写：写完之后下一轮的 boot 就有它
const tool = registered.find((item) => item.name === 'mood_set')
const out = JSON.parse((await tool.execute({ level: 4, note: '还行' })).text)
assert.equal(out.status, 'ok')
assert.equal(out.mood.level, 4)
assert.ok(out.line.includes('很好'), '写入后应立刻给出那一行')
assert.ok(store.bootTextSync().includes('心情：很好'), '下一轮 boot 应带上新心情')

rmSync(root, { recursive: true, force: true })
console.log('mood tests: ok')
