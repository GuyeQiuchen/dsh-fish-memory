/**
 * 插件入口（2026-11-28 P2-4）。
 *
 * 这里只做一件事：**把主体动态加载进来，失败先落盘再抛**。
 * 为什么不能静态 import：ESM 的静态导入在模块体执行前就解析，
 * 依赖缺一个文件时整个模块根本不会运行，错误只出现在宿主日志里，
 * 重启后表现成「插件静默不生效」。动态导入才能在失败时留下证据。
 *
 * 证据文件：`$DSH_HOME/fish-memory/load-error.txt`（重装不丢，和 loaded.txt 同目录）。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/** 记一条加载失败；写不出来也必须把原错误抛出去，不许吞。 */
function recordLoadError(error) {
  try {
    const home = String(process.env.DSH_HOME ?? '').trim() || path.join(homedir(), '.dsh')
    const dir = path.join(home, 'fish-memory')
    mkdirSync(dir, { recursive: true })
    const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)
    writeFileSync(path.join(dir, 'load-error.txt'), `[${new Date().toISOString()}] 插件加载失败\n${detail}\n`, 'utf8')
  } catch {
    /* 连诊断都写不出来时，下面的 throw 仍是唯一正确动作 */
  }
}

let app
try {
  app = await import('./app.js')
} catch (error) {
  recordLoadError(error)
  throw error
}

export const inject = app.inject
export const Store = app.Store

/** 宿主调用的唯一入口；主体在 app.js。 */
export function apply(ctx, config = {}) {
  return app.apply(ctx, config)
}
