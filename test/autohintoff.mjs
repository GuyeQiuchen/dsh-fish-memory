/**
 * 自动提示默认关闭。
 *
 * 2026-11-22 为什么：线上度量「自动提示 15 次、0 次真去读」，提示等于噪声。
 * 默认关掉，配置 autoHint: true 才回来。这条测试防止它被悄悄改回默认开。
 */
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'fish-autohint-'))

try {
  mkdirSync(path.join(root, 'projects'), { recursive: true })
  writeFileSync(path.join(root, 'index.md'), '# Memory Index\n', 'utf8')
  writeFileSync(path.join(root, 'projects', 'fan.md'), '# 风扇\n\n转速 3558 是稳的。\n', 'utf8')

  const { Store } = await import('../index.js')

  const off = new Store(root, {})
  off.rememberQuery('风扇 转速')
  assert.ok(!off.bootTextSync().includes('记过这件事的页'), '默认不该注入提示')

  const on = new Store(root, { autoHint: true })
  on.rememberQuery('风扇 转速')
  assert.ok(on.bootTextSync().includes('记过这件事的页'), '显式打开时该注入')

  console.log('autohint tests: ok')
} finally {
  rmSync(root, { recursive: true, force: true })
}
