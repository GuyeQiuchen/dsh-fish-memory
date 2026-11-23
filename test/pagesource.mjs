/** 写页必须带来源：没有 seq 就指不回原文。 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { Store } from '../index.js'

const root = mkdtempSync(path.join(tmpdir(), 'mem-source-'))
mkdirSync(path.join(root, '.fish-memory'), { recursive: true })
writeFileSync(path.join(root, 'index.md'), '# 索引\n', 'utf8')
const store = new Store(root, {})

let fail = 0
const check = (name, fn) => {
  try { fn(); console.log('PASS ' + name) } catch (e) { fail += 1; console.log('FAIL ' + name + ' — ' + e.message) }
}

check('空 source 被拒', () => {
  const r = store.appendPage('projects/a.md', '一段内容')
  assert.equal(r.status, 'rejected')
  assert.match(r.reason, /必须带来源/)
})

check('source 里没有 seq 被拒', () => {
  const r = store.appendPage('projects/a.md', '一段内容', '随便写的')
  assert.equal(r.status, 'rejected')
  assert.match(r.reason, /seq/)
})

check('带 seq 的 source 能写', () => {
  const r = store.appendPage('projects/a.md', '一段内容', 'seq 12030-12145')
  assert.equal(r.status, 'ok')
})

check('诚实声明无 seq 能写', () => {
  const r = store.appendPage('projects/b.md', '长期偏好', '无 seq：长期观察')
  assert.equal(r.status, 'ok')
})

check('写进去的页带来源行', () => {
  const text = store.read('projects/a.md')
  assert.match(text, /seq 12030-12145/)
})

rmSync(root, { recursive: true, force: true })
console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILED`)
process.exitCode = fail === 0 ? 0 : 1
