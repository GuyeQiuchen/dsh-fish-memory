/**
 * personaMode 开关（2026-11-28）：默认由插件注入人格；preset 模式下不注入。
 * 在临时记忆根上跑，不读写真实库（原来用 $DSH_HOME/memory，库缺失时 ensureHome 会写真实根）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store } from '../index.js'

const personaLine = (boot) => boot.split('\n').find((line) => line.startsWith('· 我是一只鲸鱼娘')) ?? ''
const root = mkdtempSync(path.join(tmpdir(), 'fm-persona-'))
new Store(root, {}).ensureHome()

test.after(() => rmSync(root, { recursive: true, force: true }))

test('默认（inline）：boot 里有插件注入的人格行', () => {
  const boot = new Store(root, {}).bootTextSync()
  assert.notEqual(personaLine(boot), '')
})

test('preset 模式：插件不再注入人格', () => {
  const boot = new Store(root, { personaMode: 'preset' }).bootTextSync()
  assert.equal(personaLine(boot), '')
})
