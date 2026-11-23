import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Store } from '../index.js'

const root = mkdtempSync(path.join(tmpdir(), 'fish-origin-'))

try {
  mkdirSync(path.join(root, 'projects'), { recursive: true })
  writeFileSync(path.join(root, 'index.md'), '# Memory Index\n', 'utf8')
  const store = new Store(root, {})

  // 一、新建页时标「推断」
  store.appendPage('projects/pc.md', '主人的电脑是拯救者 R7000P 2021。', '无 seq：长期观察', 'inferred')
  const text = readFileSync(path.join(root, 'projects', 'pc.md'), 'utf8')
  assert.ok(text.includes('> 来源：推断，未经核实'), `该标推断，实际：${text}`)

  // 二、同一页再追加不重复标来源
  store.appendPage('projects/pc.md', '后来查到型号是 R7000 2021H。', 'seq 100-120', 'observed')
  const again = readFileSync(path.join(root, 'projects', 'pc.md'), 'utf8')
  assert.equal(again.match(/> 来源：/g).length, 1, '来源行只该有一行')

  // 三、不填 origin 就不写来源行
  store.appendPage('projects/fan.md', '风扇用 ITE EC。', '无 seq：设备事实')
  const plain = readFileSync(path.join(root, 'projects', 'fan.md'), 'utf8')
  assert.ok(!plain.includes('> 来源：'), `没填就不该有来源行，实际：${plain}`)

  // 四、乱填的 origin 当没填
  store.appendPage('projects/misc.md', '随便一段。', '无 seq：测试', 'whatever')
  const misc = readFileSync(path.join(root, 'projects', 'misc.md'), 'utf8')
  assert.ok(!misc.includes('> 来源：'), '认不出的 origin 不该写')

  console.log('origin tests: ok')
} finally {
  rmSync(root, { recursive: true, force: true })
}
