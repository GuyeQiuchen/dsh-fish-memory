/**
 * seq 读回的测试：自带取回（不依赖压缩插件）、按会话找文件、区间裁剪。
 *
 * 2026-11-22 为什么加这组：记忆页里存「页 + 会话 + seq」，取原文的能力必须是
 * 记忆体自己的；如果借压缩插件的工具，换引擎就断。
 */
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const home = mkdtempSync(path.join(tmpdir(), 'fish-seq-'))
process.env.DSH_HOME = home

const { readSeqRange, findSessionFile } = await import('../lib/seqread.js')

try {
  const dir = path.join(home, 'sessions', '--root-workspace--', 'session-abc12345-0000')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'session.v4.jsonl')
  const lines = [
    { seq: 10, type: 'user/message', data: { content: [{ type: 'text', text: '风扇转速多少' }] } },
    { seq: 11, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '3558 是稳的' }] } } },
    { seq: 12, type: 'tool/call', data: { name: 'bash', arguments: { command: 'echo 3558' } } },
    { seq: 13, type: 'tool/result', data: { message: { content: [{ type: 'text', text: '3558\n' }] } } },
  ]
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'), 'utf8')

  // 一、按会话前几位能找到文件
  assert.ok(findSessionFile('abc12345').includes('session-abc12345'), '该按会话前缀找到日志')

  // 二、区间取回：原文都在，顺序对
  const got = readSeqRange({ from: 10, to: 13, session: 'abc12345' })
  assert.equal(got.status, 'ok')
  assert.ok(got.text.includes('风扇转速多少'), `该有用户原话，实际：${got.text}`)
  assert.ok(got.text.includes('3558 是稳的'), `该有助手原话，实际：${got.text}`)
  assert.ok(got.text.includes('[调用 bash]'), `该有工具调用，实际：${got.text}`)

  // 三、只取一段
  const part = readSeqRange({ from: 11, to: 12, session: 'abc12345' })
  assert.ok(!part.text.includes('风扇转速多少'), '区间外的不该出现')

  // 四、区间太大拒绝
  const tooBig = readSeqRange({ from: 0, to: 99999, session: 'abc12345' })
  assert.equal(tooBig.status, 'rejected')

  // 五、找不到会话就明说，不猜
  const missing = readSeqRange({ from: 1, to: 2, session: 'nope999' })
  assert.equal(missing.status, 'not_found')

  // 六、多帧 zstd：真机的日志是「每写一批 flush 一帧」，而 zstdDecompressSync 只解第一帧。
  //    2026-11-23 补这条：原来这组测试全用明文 .jsonl，真机用 .zstd 多帧，
  //    结果线上一条也读不出来（解出来只有 201 字节），测试却全绿。
  if (typeof zlib.zstdCompressSync === 'function') {
    const zdir = path.join(home, 'sessions', '--root-workspace--', 'session-zstd001-0000')
    mkdirSync(zdir, { recursive: true })
    const frame1 = [JSON.stringify({ seq: 20, type: 'user/message', data: { content: [{ type: 'text', text: '第一帧里的话' }] } })]
    const frame2 = [JSON.stringify({ seq: 21, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '第二帧里的话' }] } } })]
    // 每帧内容以换行结尾——真机日志就是这样，少这个换行两帧会粘成一行
    const compressed = Buffer.concat([
      zlib.zstdCompressSync(Buffer.from(frame1.join('\n') + '\n', 'utf8')),
      zlib.zstdCompressSync(Buffer.from(frame2.join('\n') + '\n', 'utf8')),
    ])
    writeFileSync(path.join(zdir, 'session.v4.jsonl.zstd'), compressed)

    const multi = readSeqRange({ from: 20, to: 21, session: 'zstd001' })
    assert.equal(multi.status, 'ok', `多帧日志该能读出来，实际 ${multi.status} / ${multi.reason ?? ''}`)
    assert.ok(multi.text.includes('第一帧里的话'), `第一帧丢了：${multi.text}`)
    assert.ok(multi.text.includes('第二帧里的话'), `第二帧丢了（这正是线上那个 bug）：${multi.text}`)
  }

  console.log('seqread tests: ok')
} finally {
  rmSync(home, { recursive: true, force: true })
}
