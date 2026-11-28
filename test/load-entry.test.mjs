/**
 * 加载护栏（P2-4）：主体缺文件时必须先落盘再抛，不许静默。
 * 用临时副本跑，不碰真安装。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, renameSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const pkg = path.join(import.meta.dirname, '..')

test('缺模块时：写 load-error.txt 并抛出', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mem-load-'))
  const home = path.join(dir, 'home')
  const copy = path.join(dir, 'pkg')
  cpSync(pkg, copy, { recursive: true, filter: (src) => !src.includes('node_modules') })
  renameSync(path.join(copy, 'lib', 'survival.js'), path.join(copy, 'lib', 'survival.off'))
  const before = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    await assert.rejects(() => import(path.join(copy, 'index.js')), /ERR_MODULE_NOT_FOUND|Cannot find module/)
    const file = path.join(home, 'fish-memory', 'load-error.txt')
    assert.ok(existsSync(file), 'load-error.txt 没写出来')
    assert.match(readFileSync(file, 'utf8'), /survival\.js/)
  } finally {
    if (before === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = before
    rmSync(dir, { recursive: true, force: true })
  }
})
