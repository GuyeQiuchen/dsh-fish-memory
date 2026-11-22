import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { oldPageLine } from '../lib/oldpage.js'

const root = mkdtempSync(path.join(tmpdir(), 'fish-old-'))

/** 造一页，并把修改时间推到 days 天前。 */
function makePage(rel, title, days, body = '内容') {
  const full = path.join(root, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, `---\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`, 'utf8')
  const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  utimesSync(full, when, when)
}

try {
  writeFileSync(path.join(root, 'index.md'), '# Memory Index\n', 'utf8')

  // 一、都是新页：不提
  makePage('projects/fresh.md', '新页', 1)
  assert.equal(oldPageLine(root, {}, Date.now()), '', '新页不该被当成旧账')

  // 二、有一页很旧：提它
  makePage('projects/old.md', '很久以前的事', 30)
  const line = oldPageLine(root, {}, Date.now())
  assert.ok(line.includes('很久以前的事'), `该提最旧那页，实际：${line}`)
  assert.ok(line.includes('30 天没碰') || line.includes('29 天没碰'), `该报天数，实际：${line}`)

  // 三、同一轮再来：换一页，不重复顶同一张
  makePage('projects/older.md', '更早的事', 60)
  const second = oldPageLine(root, {}, Date.now())
  assert.ok(second.includes('更早的事') || second.includes('很久以前的事'), `该继续提旧页，实际：${second}`)
  assert.ok(!second.includes('很久以前的事') || !line.includes('很久以前的事'), '不该反复顶同一张')

  // 四、刚翻过的页：时间刷新后就不上榜
  const hitsFile = path.join(root, '.fish-memory', 'hits.json')
  mkdirSync(path.join(root, '.fish-memory'), { recursive: true })
  writeFileSync(
    hitsFile,
    JSON.stringify({
      'projects/old.md': { count: 3, last: Date.now() - 60 * 24 * 60 * 60 * 1000 },
      'projects/older.md': { count: 2, last: Date.now() - 61 * 24 * 60 * 60 * 1000 },
    }),
    'utf8',
  )
  const withHits = oldPageLine(root, {}, Date.now())
  assert.ok(withHits.includes('很久没翻过的旧页'), `按热度表也该提旧页，实际：${withHits}`)

  // 五、关掉就不提
  assert.equal(oldPageLine(root, { oldPage: false }, Date.now()), '', '关掉就该零字')

  // 六、轮转指针真的写下来了
  const cursor = JSON.parse(readFileSync(path.join(root, '.fish-memory', 'oldpage.json'), 'utf8'))
  assert.ok(typeof cursor.page === 'string' && cursor.page !== '', '该记下上次顶的页')

  // 七、只有一张够旧时，同一页不该每轮都冒头
  const solo = mkdtempSync(path.join(tmpdir(), 'fish-old-solo-'))
  try {
    writeFileSync(path.join(solo, 'index.md'), '# Memory Index\n', 'utf8')
    mkdirSync(path.join(solo, 'projects'), { recursive: true })
    const only = path.join(solo, 'projects', 'only.md')
    writeFileSync(only, '# 独苗\n\n内容\n', 'utf8')
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    utimesSync(only, old, old)
    const first = oldPageLine(solo, {}, Date.now())
    assert.ok(first.includes('独苗'), `第一次该提，实际：${first}`)
    const again = oldPageLine(solo, {}, Date.now())
    assert.equal(again, '', '同一页刚提过就不该再来')
    const later = oldPageLine(solo, {}, Date.now() + 25 * 60 * 60 * 1000)
    assert.ok(later.includes('独苗'), `隔一天该再提，实际：${later}`)
  } finally {
    rmSync(solo, { recursive: true, force: true })
  }

  console.log('oldpage tests: ok')
} finally {
  rmSync(root, { recursive: true, force: true })
}
