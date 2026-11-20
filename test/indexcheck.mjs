/**
 * 索引体检的测试：纯函数为主，不碰真实记忆库。
 * 删掉索引体检时，连带删掉本文件。
 */
import assert from 'node:assert'
import { indexPaths, indexProblems, pageHint } from '../lib/indexcheck.js'

const indexText = [
  '# 索引',
  '',
  '- [家规](identity/house-rules.md) — 说话规矩',
  '- [鲫鱼](projects/jiyu.md) — 投影压缩',
  '- [鲫鱼2](./projects/jiyu.md) — 重复登记',
  '- [旧页](projects/gone.md) — 已经没有这个文件',
].join('\n')

// 一、路径解析：去 ./，去 http
const paths = indexPaths(indexText)
assert.ok(paths.includes('identity/house-rules.md'))
assert.ok(paths.includes('projects/jiyu.md'))
assert.ok(!paths.some((p) => p.includes('./')))
assert.ok(!indexPaths('- [x](https://a.md)').length, 'http 链接不算本次文件')

// 二、三类问题：重复、死链、未索引
const pages = ['identity/house-rules.md', 'projects/jiyu.md', 'user/preferences.md']
const issues = indexProblems(indexText, pages)
const kinds = issues.map((item) => item.kind).sort()
assert.deepEqual(kinds, ['dead', 'duplicate', 'unindexed'], `问题类型不对：${kinds}`)
assert.ok(issues.some((item) => item.kind === 'dead' && item.path === 'projects/gone.md'))
assert.ok(issues.some((item) => item.kind === 'unindexed' && item.path === 'user/preferences.md'))
assert.ok(issues.some((item) => item.kind === 'duplicate' && item.path === 'projects/jiyu.md'))

// 三、写页后的当场提示
assert.equal(pageHint(indexText, 'identity/house-rules.md'), null)
assert.equal(pageHint(indexText, './projects/jiyu.md'), null)
assert.ok(String(pageHint(indexText, 'user/preferences.md')).includes('还没进索引'))

// 四、空索引：所有页面都算未索引，不报错；索引页自身不算漏
const empty = indexProblems('', ['a.md'])
assert.equal(empty.length, 1)
assert.equal(empty[0].kind, 'unindexed')
const self = indexProblems('', ['index.md', 'a.md'])
assert.equal(self.length, 1, '索引页自己不该被报成未索引')

console.log('indexcheck tests: ok')
