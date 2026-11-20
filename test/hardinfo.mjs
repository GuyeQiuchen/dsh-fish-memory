/**
 * 硬信息判定的测试：不碰真实记忆库。
 * 删掉这个功能时，连带删掉本文件。
 */
import assert from 'node:assert'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hasHardInfo } from '../lib/hardinfo.js'
import { Store } from '../index.js'

// 一、四类硬信息都认
assert.equal(hasHardInfo('转速 3400 rpm'), true, '带单位的数字该认')
assert.equal(hasHardInfo('占 37%'), true, '百分比该认')
assert.equal(hasHardInfo('C:\\Users\\someone\\.memory'), true, '盘符路径该认')
assert.equal(hasHardInfo('pnpm install --frozen-lockfile'), true, '命令该认')
assert.equal(hasHardInfo('ERR_MODULE_NOT_FOUND'), true, '错误码该认')
assert.equal(hasHardInfo('写到 0x4E 端口'), true, '十六进制该认')

// 二、纯判断和闲聊不该被认
assert.equal(hasHardInfo('先给结论再给细节'), false, '没有硬信息时不该误报')
assert.equal(hasHardInfo(''), false, '空文本不算')
assert.equal(hasHardInfo('今天就到这里'), false, '闲聊不算')

// 三、命中硬信息的页：自动提示直接摊正文，不只给页码
const root = mkdtempSync(path.join(tmpdir(), 'fish-hardinfo-'))
try {
  mkdirSync(path.join(root, 'projects'), { recursive: true })
  writeFileSync(
    path.join(root, 'projects', 'fan.md'),
    '# 风扇\n\n转速写 3400 rpm，用 pnpm 装的。\n第二行也有内容。\n第三行。\n',
    'utf8',
  )
  writeFileSync(path.join(root, 'projects', 'mood.md'), '# 心情\n\n今天有点沉。\n第二行。\n', 'utf8')

  const store = new Store(root, {})
  store.rememberQuery('风扇 转速')
  const hint = store.queryHint()
  assert.ok(hint.includes('风扇') || hint.includes('projects/fan.md'), `该命中硬信息页，实际：${hint}`)
  assert.ok(hint.includes('3400'), `该把正文带出来，实际：${hint}`)

  const quiet = new Store(root, {})
  quiet.rememberQuery('今天有点沉 心情')
  const hint2 = quiet.queryHint()
  assert.ok(!hint2.includes('第二行'), `没有硬信息的页不该摊正文，实际：${hint2}`)
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('hardinfo tests: ok')
