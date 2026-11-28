# 0.7.1（2026-11-28）

两份只读审查（功能 bug / 代码规整）之后的修复版。0.7.0 的引擎化与瘦身没有白做，
但拆文件时漏了三处 import，其中两处会让功能静默失效。

## 修掉的真 bug

| 级别 | 位置 | 症状 | 修法 |
|---|---|---|---|
| 高 | `lib/rules.js` | `today` 没 import：`rule_add` 每次 ReferenceError，家规完全写不进去 | 补 import；回归测试 `rule_add 能写进去` |
| 高 | `lib/recall-view.js` | `answerable`、`lastCompaction` 没 import：`queryHint()` 抛错，boot 的 try/catch 静默吞掉 | 补 import；回归测试 `queryHint 不抛` |
| 中 | `lib/drafts.js` | 草案文件名只到日期：当天 apply 后再生成，复用同一文件，`markDraft` 命中旧行，新草案永远清不掉 | 文件名带到秒，同秒撞名加序号 |
| 中 | `lib/drafts.js` | `readIndex → writeIndex` 无锁：两个进程同时标记，后写覆盖先写，丢一条状态 | 读写包 `withLock`，拿不到锁返回 `busy` |
| 中 | `lib/indexcheck.js` / `app.js` | 路径含空格匹配不上：每次 boot 的 `rebuildIndex` 追加重复索引，index.md 无限长 | 路径正则允许空格；回归测试 |
| 中 | `lib/boot.js` | 已拼好的前缀（人格+家规）≥ 预算时直接 `return mood`，人格和家规整段消失 | 先保前缀，只截它后面的尾巴 |
| 中 | `lib/rules.js` | `fitRules` 首条就超长时只输出 `…[截断]`，整段家规进不了 boot | 首条给半句，后面才用省略号 |
| 中 | `app.js` | `personaLine` 只认 `我的名字**：`，模板与实际页都是 `名字：`，名字/称呼从未进 boot | 两种写法都认 |
| 低 | `app.js` | `status.indexEntries` 取被截到 10 行的展示数组，真实索引条数失真 | 数 `index.md` 真实条数 |
| 低 | `lib/boot.js` | deps 缺 `CORE_PERSONA` 会注入 `· undefined`；缺 `clip` 则抛 | 缺的跳过；`clip` 给兜底 |
| 低 | `lib/engine/tidy.js` | 变更表对无日期条目渲染 `undefined` | 没有日期的值不列 |
| 低 | `lib/engine/answerable.js` | strict 下单实义词正例必被「至少命中 2 词」判死 | 门槛随词数收缩 |

## 规整

- **边界测试加宽**：`boundary.test.mjs` 原来只扫 42 行的 `index.js`，现在扫 `index.js`、`app.js`、`lib/*.js`；
  注入深引用会被拦（审查实测过旧版拦不住）。
- **测试隔离**：`persona-mode` 原来用真实 `$DSH_HOME/memory`，`bootTextSync` 会 `ensureHome`；
  改成 `mkdtemp` 临时根。
- **死 import / 死代码**：`app.js` 与 `lib/` 共清 22 个未使用 import；删掉从未调用的 `insertIndexLine`。
- **空转形参**：`pushRuleRow`、`termsOf`、`originLine` 里没人用的 `store` 去掉。
- **契约**：新增 `lib/CONTRACT.md`（方向、注入、写盘、错误口径、测试要求）。
- **评测有牙**：`tools/eval.mjs` 从「只打印」改成带下限（bm25 @1 ≥70%、@3 ≥85%、跨页 ≥85%、strict ≥90%），
  不达标退出码 1。
- **打包/安装**：`files` 补 `tools`；`install.sh` 排除 `*.tgz`；`--verify-only` 加查 `app.js` 与 `lib/engine/api.js`；
  `uninstall.sh` 现在会清 `local-packages` 副本，没有 patch 文件也不再直接退出。

## app.js 拆分（909 → 562 行）

| 刀 | 搬到 | 验证 |
|---|---|---|
| A1 | `ensureHome` 模板 → `lib/scaffold.js` | 模板与现有欢迎页逐行一致（除日期） |
| A2 | 索引编辑（分节/补登记/去重/死链）→ `lib/index-edit.js` | 同一副本上旧 vs 新 `rebuildIndex` 改动数一致、index.md 逐字节相同 |

## 验证

```
node --test test/*.test.mjs    31/31 通过（新增 11 条回归）
node tools/eval.mjs            bm25 @1 72% / @3 86% / 跨页 90%；strict 拒答 93%；四项下限全过，退出码 0
临时 profile 实装              --verify-only 六项 ok；装完 0 个 tgz；卸载后两份副本都清掉
真库 boot                      1,079 字（未因修复变长）
```

## 已知，未做

- `survival.js` 里另有一套二元组分词，与 `lib/engine/tokens.js` 重复。统一会改动「约束存活」的判定口径，
  需要先有检查点回放集，暂不动。
- `seqread.js` 的 `clip` 与 `text.clip` 不同（前者压空白、用单字省略号），属于 `mem_seq` 的输出契约，保留。
- `compact.js` / `pointers.js` / `seqread.js` 直接读 `$DSH_HOME`，不可注入；已在 `lib/CONTRACT.md` 记为已知点。
