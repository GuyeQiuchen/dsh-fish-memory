# lib/ 分层契约（0.7.1）

`lib/engine/` 之外这些模块的规矩。引擎自己的契约在 `lib/engine/CONTRACT.md`。

## 方向

```
app.js ──> lib/*.js ──> lib/engine/api.js ──> lib/engine/*.js
```

- `app.js` 是唯一碰宿主（`ctx`、工具注册、事件）的文件；
- `lib/*.js` 不 import `app.js` / `index.js`，不读 `ctx`；
- 引擎只能经 `api.js` 用，`lib/*.js` 也一样；
- 反向依赖、循环依赖一律算错，`test/boundary.test.mjs` 会拦。

## 依赖注入

- 需要记忆根和配置的模块，接收 `store`（有 `.root`、`.config`、`.file()`、`.read()`）；
- 不接收 `ctx`，不自己算 `DSH_HOME`；
- 例外：`compact.js`、`pointers.js`、`seqread.js` 要读会话日志，路径来自 `$DSH_HOME`（宿主不传这个），已记录为已知不可注入点。

## 写盘

- 整文件写走 `fs-atomic.writeAtomic`（临时文件 + rename）；
- 追加写（`log.md`、`live.md`）直接 append，失败最多多一行，不阻断；
- 写状态表（草案、度量）必须加锁或原子替换，避免两个窗口互相覆盖。

## 错误口径

- 「读不到」返回空值（`''`、`[]`、`null`），不抛；
- 「写不进去」允许吞掉，但**吞之前必须留下痕迹**（返回值、计数或警告行）；
- 工具层把异常转成 `{ status: 'error', reason }`，不把堆栈丢给模型。

## 测试

- 每个模块至少一条能在临时记忆根上跑的测试；
- 临时根用 `mkdtempSync`，用完删；不许读写真实 `$DSH_HOME/memory`；
- 行为改动必须附「旧 vs 新、同一批输入」的比对记录。
