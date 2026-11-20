/**
 * 压缩引擎健康检查（可删的小模块）。
 *
 * 起因：2026-11-19 鲫鱼引擎静默没激活，压缩停了一整天，没有任何提示——
 * 它不报错，只是不再产出报告。这种失败只能靠「多久没动静」看出来。
 *
 * 只看一件事：压缩引擎最近一次报告文件有多旧。不读内容、不猜原因。
 * 删掉本文件、index.js 顶部那行 import、boot 里那一段即可干净回退。
 */
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/**
 * @param options - `{ reportPath?, limitHours? }`。
 * @returns 一行提示，或空串（正常、没装、读不到都算正常）。
 */
export function engineHealth(options = {}) {
  const file =
    typeof options.reportPath === 'string' && options.reportPath.trim() !== ''
      ? options.reportPath.trim()
      : path.join(homedir(), '.dsh', 'fish-jiyu', 'last-report.json')
  let mtimeMs = 0
  try {
    mtimeMs = statSync(file).mtimeMs
  } catch {
    // 文件不在：可能压根没装压缩插件，这种情况不该报警
    return ''
  }
  const limit = Number(options.limitHours ?? 24)
  if (!Number.isFinite(limit) || limit <= 0) return ''
  const hours = (Date.now() - mtimeMs) / 3600000
  if (!(hours >= limit)) return ''
  return `· ⚠ 压缩引擎 ${Math.round(hours)} 小时没出过报告，可能没在跑；先看它的报告页`
}
