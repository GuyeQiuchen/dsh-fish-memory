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

  // 二、第一次提起：给命中的那几行，并标明是旧记录
  store.rememberQuery('风扇转速')
  const first = store.queryHint()
  assert.ok(first.includes('旧记录'), `第一次该标明是旧记录，实际：${first}`)
  assert.ok(first.includes('ITE EC') || first.includes('3558'), `第一次该带命中的行，实际：${first}`)
  assert.equal(hitCount(root, 'projects/fan.md'), 1, '第一次要记一次热度')

  // 三、同一句话重复判不会把热度刷上去
  store.queryHint()
  store.queryHint()
  assert.equal(hitCount(root, 'projects/fan.md'), 1, '同一句话重复判不该重复加热度')

  // 四、同样的几行再判一次：不重贴（内容没变就是噪音）
  store.rememberQuery('风扇转速怎么调')
  assert.equal(store.queryHint(), '', '同样几行不该连着重贴')
  assert.equal(hitCount(root, 'projects/fan.md'), 2, '不重贴也要记热度')

  // 五、换一页就是新内容：照常贴
  store.rememberQuery('压缩每次都从原始日志重新投影吗')
  const other = store.queryHint()
  assert.ok(other.includes('zip.md') || other.includes('压缩'), `换话题该继续给，实际：${other}`)

  // 六、提得多了标常聊，但仍然只给命中的行，不整段贴
  for (let i = 0; i < 4; i += 1) {
    store.rememberQuery(`风扇转速 3558 第${i}次`)
    store.queryHint()
  }
  assert.ok(hitCount(root, 'projects/fan.md') >= 6, `提到六次以上，实际 ${hitCount(root, 'projects/fan.md')}`)
  store.rememberQuery('风扇转速 3558 现在')
  const hot = store.queryHint()
  assert.ok(hot === '' || hot.includes('常聊') || hot.includes('提过'), `要么去重要么标热度，实际：${hot}`)

  // 七、对不上就不出现，也不加热度
  store.lastHintSig = ''
  store.rememberQuery('天气 旅行 电影 音乐')
  assert.equal(store.queryHint(), '', '不相关的话不该提示')

  // 八、半衰期：七天前提过的，减半
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
