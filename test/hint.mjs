/**
 * 自动提示的测试：第一次只给一句，提得越多摊得越开；对不上就不出现。
 * 删掉自动提示或热度模块时连带改本文件。
 */
import assert from 'node:assert'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store } from '../index.js'
import { hitCount, bumpHit, readHits } from '../lib/heat.js'

const root = mkdtempSync(path.join(tmpdir(), 'fish-hint-'))

try {
  mkdirSync(path.join(root, 'projects'), { recursive: true })
  writeFileSync(path.join(root, 'index.md'), '# Memory Index\n', 'utf8')
  writeFileSync(
    path.join(root, 'projects', 'fan.md'),
    '# 风扇曲线\n\n风扇曲线用 ITE EC 控制，切电源模式后等两秒再写表。\n转速 3558 是稳的。\n槽 0 恒为 0 等于停转。\n',
    'utf8',
  )
  writeFileSync(
    path.join(root, 'projects', 'zip.md'),
    '# 压缩引擎\n\n压缩每次都从原始日志重新投影，不叠摘要链。\n',
    'utf8',
  )

  const store = new Store(root, {})

  // 一、没有上一句话就什么都不提示
  assert.equal(store.queryHint(), '', '没有 lastQuery 时不该提示')

  // 二、第一次提起：只给一句指针
  store.rememberQuery('风扇转速')
  const first = store.queryHint()
  assert.ok(first.includes('可能有这一页'), `第一次该只给指针，实际：${first}`)
  assert.ok(!first.includes('ITE EC'), `第一次不该带正文，实际：${first}`)
  assert.equal(hitCount(root, 'projects/fan.md'), 1, '第一次要记一次热度')

  // 三、同一句话重复判不会把热度刷上去
  store.queryHint()
  store.queryHint()
  assert.equal(hitCount(root, 'projects/fan.md'), 1, '同一句话重复判不该重复加热度')

  // 四、再提起一次：开始带正文
  store.rememberQuery('风扇转速怎么调')
  const second = store.queryHint()
  assert.ok(second.includes('提过') || second.includes('常聊'), `第二次该报热度，实际：${second}`)
  assert.ok(second.includes('风扇曲线') || second.includes('3558'), `第二次该带正文，实际：${second}`)
  assert.equal(hitCount(root, 'projects/fan.md'), 2)

  // 五、提得多了近乎全文：一直提到六次
  for (let i = 0; i < 4; i += 1) {
    store.rememberQuery(`风扇转速 3558 第${i}次`)
    store.queryHint()
  }
  assert.ok(hitCount(root, 'projects/fan.md') >= 6, `提到六次以上，实际 ${hitCount(root, 'projects/fan.md')}`)
  store.rememberQuery('风扇转速 3558')
  const hot = store.queryHint()
  assert.ok(hot.includes('常聊'), `高频该标常聊，实际：${hot}`)
  assert.ok(hot.includes('槽 0') || hot.includes('停转'), `高频该摊到后面几行，实际：${hot}`)

  // 六、对不上就不出现，也不加热度
  store.rememberQuery('天气 旅行 电影 音乐')
  assert.equal(store.queryHint(), '', '不相关的话不该提示')
  assert.equal(hitCount(root, 'projects/zip.md'), 0)

  // 七、半衰期：七天前提过的，减半
  const old = { 'projects/zip.md': { count: 8, last: Date.now() - 8 * 24 * 60 * 60 * 1000 } }
  mkdirSync(path.join(root, '.fish-memory'), { recursive: true })
  writeFileSync(path.join(root, '.fish-memory', 'hits.json'), JSON.stringify(old), 'utf8')
  assert.equal(readHits(root)['projects/zip.md'].count, 4, '八天前提过的要减半')
  assert.equal(bumpHit(root, 'projects/zip.md'), 5, '减半后再加一')

  // 八、坏文件不能炸
  writeFileSync(path.join(root, '.fish-memory', 'hits.json'), '{oops', 'utf8')
  assert.equal(hitCount(root, 'projects/zip.md'), 0, '坏文件当没有')

  console.log('hint tests: ok')
} finally {
  rmSync(root, { recursive: true, force: true })
}
