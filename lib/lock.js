/**
 * 写锁：同一个记忆根，可能有两个会话同时写（主人开两个窗口）。
 *
 * 2026-11-25 为什么要：另一个窗口里我提过「两个窗口同时开着，记忆库是同一个，
 * 并发写有撞车的可能」，主人回「错峰有必要」。所以给写操作加一把短锁——
 * 拿不到就等一会儿，等不到就跳过这次写入（宁可少写一行，也不要写坏）。
 *
 * 实现：`mkdir` 是原子操作，拿它当锁；锁目录带时间戳，超过 staleMs 视为死锁并清掉。
 */
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

/** 忙等用的睡眠（Node 主线程里没有同步 sleep，用 Atomics.wait 凑）。 */
const SLEEPER = new Int32Array(new SharedArrayBuffer(4))
const sleepSync = (ms) => Atomics.wait(SLEEPER, 0, 0, ms)

/** 锁目录：放在记忆根的 .fish-memory/locks 下。 */
export function locksDir(root) {
  const base = String(root ?? '').trim()
  if (base === '') return ''
  return path.join(base, '.fish-memory', 'locks')
}

/**
 * 拿锁跑一段同步函数。
 * @param root - 记忆根。
 * @param name - 锁名（按文件或用途取，例如 'live'）。
 * @param fn - 要执行的同步函数。
 * @param options - `{ waitMs, staleMs }`。
 * @returns `{ ok, result?, waitedMs }`；拿不到锁时 ok=false，fn 不执行。
 */
export function withLock(root, name, fn, { waitMs = 600, staleMs = 20000 } = {}) {
  const dir = locksDir(root)
  if (dir === '') return { ok: false, waitedMs: 0 }
  const lockPath = path.join(dir, `${name}.lock`)
  const started = Date.now()
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    return { ok: false, waitedMs: 0 }
  }
  for (;;) {
    let acquired = false
    try {
      mkdirSync(lockPath)
      acquired = true
    } catch (error) {
      if (error?.code !== 'EEXIST') return { ok: false, waitedMs: Date.now() - started }
      // 死锁处理：锁目录太旧就拆掉
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > staleMs) {
          rmSync(lockPath, { recursive: true, force: true })
          continue
        }
      } catch {
        continue
      }
      if (Date.now() - started >= waitMs) return { ok: false, waitedMs: Date.now() - started }
      sleepSync(15)
      continue
    }
    if (acquired) {
      // 拿到锁之后 fn 抛的错要照样往外抛，不能被当成「没拿到锁」吞掉
      try {
        return { ok: true, result: fn(), waitedMs: Date.now() - started }
      } finally {
        try {
          rmSync(lockPath, { recursive: true, force: true })
        } catch {
          /* 释放失败就等 stale 清理 */
        }
      }
    }
  }
}

/** 锁目录在不在（测试和诊断用）。 */
export function lockExists(root, name) {
  const dir = locksDir(root)
  if (dir === '') return false
  return existsSync(path.join(dir, `${name}.lock`))
}
