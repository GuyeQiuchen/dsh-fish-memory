/**
 * 日志正在写（末帧只有一半）时，取回不能假装成功。
 *
 * 2026-11-24 为什么加这一组：审查发现 `readLines` 按 `frames.length > 1` 分流，
 * 末帧截断时帧数退化成 1 → 走整段解 → 只解出第一帧 → 返回 ok，后面的内容
 * 无声消失。这和 11-23 修掉的那个 bug 是同一个形状，只是触发条件换成了“正在写入”。
 *
 * 这里真造多帧 zstd（宿主 Node v24 只解第一帧，正好是这个坑的土壤）。
 */
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const home = mkdtempSync(path.join(tmpdir(), 'fish-seqwrite-'))
process.env.DSH_HOME = home
const dir = path.join(home, 'sessions', '--root-workspace--', 'session-writing-0001')
mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'session.v4.jsonl.zstd')

const { readSeqRange } = await import('../lib/seqread.js')

/** 把几行 JSON 各自压成一帧，拼起来（真实日志就是这么追加的）。 */
function makeFrames(lines) {
  return lines.map((line) => zlib.zstdCompressSync(Buffer.from(line + '\n', 'utf8')))
}

const event = (seq, text) =>
  JSON.stringify({ type: 'user/message', seq, data: { content: [{ type: 'text', text }] } })

try {
  const lines = [event(1, '第一帧里的话'), event(2, '第二帧里的话'), event(3, '第三帧里的话'), event(4, '第四帧里的话')]
  const frames = makeFrames(lines)

  // 一、完整的四帧文件：四条都要读得到，而且不该有任何警告
  writeFileSync(file, Buffer.concat(frames))
  const whole = readSeqRange({ from: 1, to: 4, session: 'session-writing-0001' })
  assert.equal(whole.status, 'ok', `完整文件该是 ok，实际 ${whole.status}`)
  assert.ok(whole.text.includes('第四帧里的话'), `最后一帧也要读到，实际：${whole.text.slice(0, 200)}`)
  assert.equal(whole.warning, undefined, `完整文件不该有 warning，实际：${whole.warning}`)

  // 二、末帧只写了一半：前面三帧照读，但要**明说读得不完整**
  const partial = frames.slice(0, 3)
  const halfTail = frames[3].subarray(0, Math.floor(frames[3].length / 2))
  writeFileSync(file, Buffer.concat([...partial, halfTail]))
  const cut = readSeqRange({ from: 1, to: 4, session: 'session-writing-0001' })
  assert.equal(cut.status, 'ok', '前几帧还能读，状态该是 ok')
  assert.ok(cut.text.includes('第三帧里的话'), '前面的帧不能因为末帧坏了就丢')
  assert.ok(
    typeof cut.warning === 'string' && cut.warning.includes('完整帧'),
    `末帧半截必须报出来，实际 warning：${JSON.stringify(cut.warning)}`,
  )

  // 三、只剩一帧且这一帧是半截的：不能返回 ok
  writeFileSync(file, frames[0].subarray(0, 10))
  const broken = readSeqRange({ from: 1, to: 1, session: 'session-writing-0001' })
  assert.notEqual(broken.status, 'ok', '只有半截帧时不能装作读到了')
  assert.ok(
    typeof broken.reason === 'string' && broken.reason !== '',
    `失败要给原因，实际：${JSON.stringify(broken.reason)}`,
  )

  // 四、中间帧坏掉：后面的好帧照样要读到（不能吞掉整段）
  const bad = Buffer.from(frames[1])
  bad.write('XXXX', 4) // 破坏帧头描述符
  writeFileSync(file, Buffer.concat([frames[0], bad, frames[2], frames[3]]))
  const mid = readSeqRange({ from: 1, to: 4, session: 'session-writing-0001' })
  assert.equal(mid.status, 'ok', '中间坏一帧，别的帧还得能读')
  assert.ok(mid.text.includes('第一帧里的话'), '第一帧不该受影响')
  assert.ok(mid.text.includes('第三帧里的话'), '坏帧之后的好帧不能被吞掉')
  assert.ok(mid.text.includes('第四帧里的话'), '最后一帧也要在')

  console.log('seqread-writing tests: ok')
} finally {
  rmSync(home, { recursive: true, force: true })
}
