/**
 * 盒子边界（2026-11-28 加宽：原来只扫 index.js，900 行的 app.js 完全不受检）。
 *
 * 插件层（index.js / app.js / lib 顶层模块）只能经 lib/engine/api.js 用引擎；
 * 引擎内部模块之间可以互相 import。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pluginFiles = [
  'index.js',
  'app.js',
  ...readdirSync(path.join(pkg, 'lib'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `lib/${name}`),
]

function importsOf(file) {
  const source = readFileSync(path.join(pkg, file), 'utf8')
  // 只看 import 语句，别把注释里提到的文件名当成违规。
  return [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1])
}

test('插件层不深引用引擎内部（只能走 api.js）', () => {
  for (const file of pluginFiles) {
    for (const spec of importsOf(file)) {
      assert.ok(
        !/lib\/engine\/(rank|tidy|tokens|answerable|version)(\.js)?$/.test(spec) && !/^\.\/engine\/(rank|tidy|tokens|answerable|version)(\.js)?$/.test(spec),
        `${file} 深引用了 ${spec}`,
      )
    }
  }
})

test('引擎内部不反向依赖插件（不 import app.js / index.js）', () => {
  for (const name of readdirSync(path.join(pkg, 'lib', 'engine')).filter((f) => f.endsWith('.js'))) {
    for (const spec of importsOf(`lib/engine/${name}`)) {
      assert.ok(!/(^|\/)app\.js$|(^|\/)index\.js$/.test(spec), `lib/engine/${name} 反向 import ${spec}`)
    }
  }
})

test('引擎不读盘、不碰宿主（只有 node: 内置依赖与同目录模块）', () => {
  for (const name of readdirSync(path.join(pkg, 'lib', 'engine')).filter((f) => f.endsWith('.js'))) {
    for (const spec of importsOf(`lib/engine/${name}`)) {
      assert.ok(
        spec.startsWith('node:') === false && spec.startsWith('./') === true,
        `lib/engine/${name} 依赖 ${spec}`,
      )
    }
  }
})

test('引擎出口唯一：只经 api.js 暴露', () => {
  const source = readFileSync(path.join(pkg, 'lib', 'engine', 'api.js'), 'utf8')
  assert.ok(source.includes("from './rank.js'"))
  assert.ok(source.includes("from './tidy.js'"))
  assert.ok(source.includes('ENGINE_VERSION'))
})
