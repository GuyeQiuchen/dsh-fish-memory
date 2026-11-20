/**
 * 索引重建的测试：不碰真实记忆库。
 * 删掉索引重建时，连带删掉本文件。
 */
import assert from 'node:assert'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store } from '../index.js'

const root = mkdtempSync(path.join(tmpdir(), 'fish-rebuild-'))
const indexPath = path.join(root, 'index.md')

try {
  writeFileSync(indexPath, '# Memory Index\n\n## projects（项目）\n\n- [甲](projects/a.md) — 甲页\n\n## identity（自我）\n', 'utf8')
  mkdirSync(path.join(root, 'projects'), { recursive: true })
  writeFileSync(path.join(root, 'projects', 'a.md'), '# A\n\n内容\n', 'utf8')

  // 一、页头有 summary：直接搬，插在对应分节
  writeFileSync(
    path.join(root, 'projects', 'new.md'),
    '---\ntitle: 新页\nsummary: 一句话摘要\ntype: project\n---\n\n# 新页\n',
    'utf8',
  )
  const boot = new Store(root, {}).bootTextSync()
  let index = readFileSync(indexPath, 'utf8')
  assert.ok(index.includes('projects/new.md'), `该自动补登记，实际：${index}`)
  assert.ok(index.includes('一句话摘要'), '该带上页头的摘要')
  assert.ok(!boot.includes('开机检查'), `补完就不该再报警，实际：${boot}`)

  const projAt = index.indexOf('## projects')
  const idAt = index.indexOf('## identity')
  const newAt = index.indexOf('projects/new.md')
  assert.ok(newAt > projAt && newAt < idAt, '该插在 projects 分节里，不串到下一节')

  // 二、页头没 summary：从正文第一段抓一句顶上
  writeFileSync(path.join(root, 'projects', 'nosum.md'), '---\ntitle: 无摘要\n---\n\n这一页的第一段话，拿来做摘要。\n', 'utf8')
  new Store(root, {}).bootTextSync()
  index = readFileSync(indexPath, 'utf8')
  assert.ok(index.includes('projects/nosum.md'), '没写 summary 的页也该登记')
  assert.ok(index.includes('这一页的第一段话'), `该从正文取摘要，实际：${index}`)

  // 三、整页都空：补不出来，留报警，不瞎编
  writeFileSync(path.join(root, 'projects', 'empty.md'), '# 空页\n', 'utf8')
  const boot2 = new Store(root, {}).bootTextSync()
  index = readFileSync(indexPath, 'utf8')
  assert.ok(!index.includes('projects/empty.md'), '补不出摘要的页不登记')
  assert.ok(boot2.includes('开机检查'), '补不了的仍要报警')

  // 四、重复登记只留一行，死链删掉
  writeFileSync(
    indexPath,
    [
      '# Memory Index',
      '',
      '## projects（项目）',
      '',
      '- [甲](projects/a.md) — 甲页',
      '- [甲又一遍](projects/a.md) — 重复',
      '- [鬼](projects/ghost.md) — 不存在',
      '',
      '## identity（自我）',
      '',
    ].join('\n'),
    'utf8',
  )
  new Store(root, {}).bootTextSync()
  index = readFileSync(indexPath, 'utf8')
  const dupLines = index.split('\n').filter((line) => line.includes('(projects/a.md)')).length
  assert.equal(dupLines, 1, `重复登记该只剩一行，实际 ${dupLines} 行`)
  assert.ok(!index.includes('ghost.md'), `死链该删掉，实际：${index}`)
  assert.ok(index.includes('甲页'), '保留的是原来那行的措辞，不该被重写')

  // 五、跑第二遍不再改动
  const before = readFileSync(indexPath, 'utf8')
  new Store(root, {}).bootTextSync()
  assert.equal(readFileSync(indexPath, 'utf8'), before, '稳定后不该再动索引')
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('rebuild index tests: ok')
