/**
 * personaLine 要认三种 SOUL 写法（2026-11-28 回归：
 * 正则加了行首锚点后，`- **我的名字**：` 这种旧格式匹配不到，boot 里名字行整个消失）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store } from '../app.js'

function lineOf(soul) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mem-persona-'))
  try {
    writeFileSync(path.join(dir, 'SOUL.md'), soul, 'utf8')
    return new Store(dir, {}).personaLine()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('新模板格式：名字：X / 称呼：X', () => {
  const r = lineOf('<!-- dsh-memory:soul:start -->\n名字：溯\n称呼：主人\n<!-- dsh-memory:soul:end -->')
  assert.equal(r, '名字=溯；称呼对方=主人')
})

test('旧格式：- **我的名字**：X（列表符号 + 粗体）', () => {
  const r = lineOf('<!-- dsh-memory:soul:start -->\n- **我的名字**：溯\n- **你的称呼**：主人\n<!-- dsh-memory:soul:end -->')
  assert.equal(r, '名字=溯；称呼对方=主人')
})

test('半旧格式：我的名字**：X（无列表符号）', () => {
  const r = lineOf('我的名字**：溯\n你的称呼**：主人')
  assert.equal(r, '名字=溯；称呼对方=主人')
})
