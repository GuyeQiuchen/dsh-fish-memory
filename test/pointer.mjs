/**
 * 页指针 + seq 的测试。
 *
 * 2026-11-22 为什么加这组：自动提示从「贴一段正文」改成「只说哪一页记过、
 * 原文走 seq」。这条契约如果不钉住，下次改回贴正文也没人发现。
 */
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'fish-pointer-'))
const home = mkdtempSync(path.join(tmpdir(), 'fish-pointer-home-'))
process.env.DSH_HOME = home

const { Store } = await import('../index.js')

try {
  mkdirSync(path.join(root, 'projects'), { recursive: true })
  writeFileSync(path.join(root, 'index.md'), '# Memory Index\n', 'utf8')
  writeFileSync(
    path.join(root, 'projects', 'fan.md'),
    '# 风扇曲线\n\n## [2026-11-22] 补充 · seq 3558-3600\n风扇曲线用 ITE EC 控制，转速 3558 是稳的。\n',
    'utf8',
  )
  writeFileSync(path.join(root, 'projects', 'plain.md'), '# 纯记录\n\n压缩每次都从原始日志重新投影，不叠摘要链。\n', 'utf8')

  const store = new Store(root, {})

  // 一、页里有 seq：给页 + seq，指回 jiyu_recall
  store.rememberQuery('风扇 转速')
  const first = store.queryHint()
  assert.ok(first.includes('projects/fan.md'), `该给页名，实际：${first}`)
  assert.ok(first.includes('seq 3558-3600'), `该给页里记过的 seq，实际：${first}`)
  // 2026-11-22 契约变了：取回走自带的 mem_seq，不再依赖鲫鱼的 jiyu_recall。
  assert.ok(first.includes('mem_seq'), `该指向 mem_seq，实际：${first}`)
  assert.ok(!first.includes('ITE EC'), `不该再贴正文，实际：${first}`)

  // 二、同一页同一 seq 不重复给
  store.rememberQuery('风扇 转速 现在呢')
  assert.equal(store.queryHint(), '', '同一页同一 seq 不该重复')

  // 三、页里没有 seq：退回 mem_recall
  store.rememberQuery('压缩 原始日志 投影')
  const plain = store.queryHint()
  assert.ok(plain.includes('projects/plain.md'), `该给页名，实际：${plain}`)
  assert.ok(plain.includes('mem_recall'), `没有 seq 时该退回 mem_recall，实际：${plain}`)

  // 四、压缩之后重新给一次（那段历史被折掉了，指针要重新出现）
  mkdirSync(path.join(home, 'fish-jiyu'), { recursive: true })
  writeFileSync(
    path.join(home, 'fish-jiyu', 'last-report.json'),
    JSON.stringify([{ at: new Date().toISOString(), before: 1, after: 1, seqFrom: 10, seqTo: 20 }]),
    'utf8',
  )
  store.rememberQuery('风扇 转速 又来了')
  const again = store.queryHint()
  assert.ok(again.includes('projects/fan.md'), `压缩后该重新给，实际：${again}`)

  console.log('pointer tests: ok')
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
}
