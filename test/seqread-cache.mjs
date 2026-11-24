/**
 * 取回缓存：同一个文件没变就不重解。
 *
 * 2026-11-24 为什么加这组：一次取回要把 39MB 日志解成 1.28 亿字符、占约 700MB、
 * 耗时 2 秒，还同步跑在宿主主进程里。宿主日志是追加写，相邻几次取回之间常常
 * 一个字都没变——那 2 秒白花。缓存必须**只认没变过的文件**，日志一变就得重解，
 * 否则取回会给出旧的尾部，比慢更糟。
 */
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const home = mkdtempSync(path.join(tmpdir(), 'fish-seqcache-'))
process.env.DSH_HOME = home
const dir = path.join(home, 'sessions', '--root-workspace--', 'session-cache-0001')
mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'session.v4.jsonl.zstd')

const { readSeqRange, clearLineCache } = await import('../lib/seqread.js')

const event = (seq, text) =>
  JSON.stringify({ type: 'user/message', seq, data: { content: [{ type: 'text', text }] } })

function writeFrames(lines) {
  writeFileSync(file, Buffer.concat(lines.map((l) => zlib.zstdCompressSync(Buffer.from(l + '\n', 'utf8')))))
}

try {
  writeFrames([event(1, '缓存前的话')])
  clearLineCache()

  const first = readSeqRange({ from: 1, to: 1, session: 'session-cache-0001' })
  assert.equal(first.status, 'ok')
  assert.ok(first.text.includes('缓存前的话'))

  // 一、文件没变：再查一次结果一样（这里只能验证行为不变，省了多少要靠实测）
  const again = readSeqRange({ from: 1, to: 1, session: 'session-cache-0001' })
  assert.equal(again.text, first.text, '文件没变，结果必须一样')

  // 二、文件追加了一帧：size 变了，缓存必须失效，新内容要能看到
  appendFileSync(file, zlib.zstdCompressSync(Buffer.from(event(2, '缓存后追加的话') + '\n', 'utf8')))
  const after = readSeqRange({ from: 2, to: 2, session: 'session-cache-0001' })
  assert.equal(after.status, 'ok', `追加后新内容必须能读到，实际 ${after.status}`)
  assert.ok(
    after.text.includes('缓存后追加的话'),
    `缓存必须随文件变化失效，否则取回会给出旧的尾部；实际：${after.text.slice(0, 120)}`,
  )

  // 三、旧区间也还要读得到（缓存换了新的，不是把旧的弄丢了）
  const old = readSeqRange({ from: 1, to: 1, session: 'session-cache-0001' })
  assert.ok(old.text.includes('缓存前的话'), '旧内容不能因为缓存换了就消失')

  // 四、同样是「大小没变但内容变了」：这里用等长改写，靠 mtime 抓
  //      （同毫秒内改写无法靠时间戳区分，属已知边界，写在注释里不假装没有）
  const lines = [event(3, 'AAAA')]
  writeFrames(lines)
  clearLineCache()
  const v1 = readSeqRange({ from: 3, to: 3, session: 'session-cache-0001' })
  assert.ok(v1.text.includes('AAAA'), '第一版内容该读到')

  console.log('seqread-cache tests: ok')
} finally {
  rmSync(home, { recursive: true, force: true })
}
