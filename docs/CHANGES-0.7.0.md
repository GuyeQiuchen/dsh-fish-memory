# 0.7.0（2026-11-28）· 引擎化

这一夜把记忆体从「一个大 index.js」拆成「引擎 + 盒子 + 通道」。0.6.20 → 0.7.0。

## 1. 检索与拒答搬进引擎（lib/engine/）

纯函数，不碰宿主、不读盘、不反向依赖插件：

```
lib/engine/tokens.js      分词（二元组 + 停用词 + 实义词）
lib/engine/rank.js        legacy / bm25 两种打分
lib/engine/answerable.js  legacy / strict 两种拒答判据
lib/engine/tidy.js        整理：A 变更表 / B 同题簇 / C 冲突
lib/engine/api.js         唯一出口
lib/engine/CONTRACT.md    输入输出、错误口径、版本
```

统一尺子 `tools/eval.mjs`（100 正例 + 15 负例 + 10 跨页）：

| 打分 | @1 | @3 | MRR | 跨页@3 |
|---|---|---|---|---|
| legacy（现行） | 42% | 68% | 0.567 | 90% |
| bm25（可开） | **72%** | **86%** | **0.791** | 90% |

拒答：legacy 87% → strict（只数实义词）**93%**。

**两条被数据推翻的旧结论**：
- 「journal×0.8 最好」是旧分词下的结论；换插件自己的分词后 @1 从 72 压到 70，默认改成 1.0；
- 记忆页里记的 34%/57% 来自评测脚本自带实现，与插件分词不同，不能当基线。

**开关**：`searchMode: 'bm25'` 切新打分；`answerMode: 'strict'` 切新拒答。默认仍是 legacy，
等一次真实使用后再切——切换只改配置，不动代码。

## 2. 盒子与安装可见性

- `install.sh --verify-only`：包是真目录、入口语法、lib 齐全、能 import；软链只有在「代码里用宿主包」时才判失败；
- `loaded.txt`：每次加载写「时间 + 版本」到 `$DSH_HOME/fish-memory/`；
- `load-error.txt`：入口改成 1.6KB 薄壳动态加载主体，失败**先落盘再抛**（ESM 静态导入包不住加载失败）；
- 方向测试 `test/boundary.test.mjs`：插件只能经 `api.js`，引擎不许依赖插件。

## 3. 插件瘦身

`index.js` 1,931 → **898 行**，六刀：工具注册 / 家规 / boot 展示 / 存活核对 / boot 拼装 / 召回取景 / 写回。
每一刀都用「旧代码 vs 新代码、同一批输入」比对（boot 全文、检索序列、家规状态、写回返回值与文件内容）。

搬完入口再拆成 `index.js`（薄壳）+ `app.js`（主体）。

**搬家时抓到的静默失败（都是 try/catch 吞掉的缺 import）**：
`headLines` 缺 FRONTMATTER_NOISE、`appendPage` 缺 pageHint、`writeback` 缺 mkdirSync/existsSync、
`appendPage` 缺 `path`（最后一次才发现，表现为 `mem_page` 返回 `path is not defined`）。

## 4. 整理通道（草案）

- 引擎产出 A 变更表（版本/hex/数字；标 `latest` / `stale`）、B 同题簇（同题留最新）、C 冲突；
- 草案落 `memory/.drafts/consolidate-<日期>.md`，状态在 `.drafts/index.json`；
- boot 只加一行：`· 整理草案 N 份待处理（最旧 M 天），用 mem_drafts 取`；
- 新工具 `mem_drafts`：`list` / `apply` / `drop`；处理完打点，那行消失；
- 去重：已有 pending 不重复生成；同签名 7 天内不再出；30 天未处理的自动标 dropped；
- `mem_consolidate` 到期时顺手生成草案，返回 `drafts` 与 `draftCreated`。

**引擎不写页**：草案只是材料，写回仍由模型/人决定。

## 5. boot 变化

| 项 | 0.6.20 | 0.7.0 |
|---|---|---|
| boot 字数（真库） | 1,294 | **1,079** |
| 「近况」行 | 每轮注入（内容来自 8 天前，版本号已过期） | **停用**；页保留，要看用 mem_recall |
| 索引 | 按 salience + 标题，10 行里 7 行是日记 | **9 专题 + 1 最新日记** |
| 草案行 | 无 | 有 pending 才出现 |

停用「近况」的理由：代码判断不了那一行里的事实新旧（实测写着鲫鱼 0.4.14 / 记忆体 0.6.11，
而当天是 1.0.1 / 0.6.20），按日期过期也不够（11-25 那条在 7 天内，版本号照样过期）。

## 6. 测试

`test/` 从 0 到 19 条：引擎 10（含 legacy 等价、变更表 latest/stale）、边界 5、
加载护栏 1、草案通道 3。

## 7. personaMode 开关（搬家预留）

`personaMode: 'inline'`（默认，现状）由插件注入人格；`'preset'` 时不注入，交给 agent preset。
切换只改配置，不用删三处代码。测试：`test/persona-mode.test.mjs`（默认含人格；preset 模式少 127 字）。

## 已知限制

1. **词法检索桥不过同义词**：「压缩到极限」对不上页里的「尽头 / 会话日志」，要页内别名或语义检索；
2. bm25 与 strict 拒答**还没在线上默认开启**——先跑一段 legacy 攒对照；
3. 引擎骨架之外，插件仍是个大 Store（898 行 + app.js），继续拆要单独一轮。
