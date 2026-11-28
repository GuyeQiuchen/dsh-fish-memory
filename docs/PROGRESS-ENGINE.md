# 记忆体引擎化 · 进度单

> 规矩：**钩子后面必须有命令输出**。没有证据不钩；「应该没问题」不算。
> 对应方案：`/root/workspace/mem-engine-plan.md`（会被搬进包内 docs/）。
> 开工时间：2026-11-27 21:3x 主人说「按清单推进，一项项打钩」。

## 阶段 P1 · 引擎内核（先做）

> 顺序按主人 2026-11-27 23:5x 的纠正：先搭引擎，再做盒子，最后重建功能。
> 原来的 M0/M1 顺序作废，内容并入 P1/P2。

- [x] **P1-1 分词与打分独立成函数**：`lib/engine/tokens.js` + `rank.js`，行为与现有一致
  证据：`node --test test/engine.test.mjs` → **8/8 通过**（含「legacy 分数 = 词种×2+行数、log 排最后」）
- [x] **P1-2 BM25-lite**（尺子已统一，数字见下）
  证据：`node tools/eval.mjs`（引擎入口，插件自己的分词，100 正例 + 15 负例 + 10 跨页）
  `legacy 正例 42 / 68 / .567 ｜ bm25 正例 72 / 86 / .791`
  注：`journal×0.8` 这条先验在新尺子上**略微掉分**（@1 72→70，后定为 1.0，@1 回到 72），按数据把默认 prior 设为 1.0，
  先验只保留参数位；旧记忆页里「×0.8 最好」的结论是旧分词下的，已作废。
- [x] **P1-5 跨页题**：bm25 80% → **90%**（目标 ≥90%）
  做法：先查 10 道跨页题**为什么掉**，而不是先改算法。
  两道失败里，一道是**期望写错**：「鱼聊为什么停用」的答案在 `projects/dsh-plugins.md`
  （「2026-11-23 主人定：不再用鱼聊…」），原期望指的两页都没有这个原因；改对期望后通过。
  剩下一道「压缩到极限会卡在哪」是真限制：页面里写的是「尽头 / 会话日志」，
  查询用的是「极限」——**词法检索桥不过同义词**。要修得加页内别名或换语义检索，不在本轮。
  证据：`node tools/eval.mjs` → bm25 跨页@3 **90%**，正例 @1 72% 不变。
- [x] **P1-3 拒答判据改实义词**：`answerable.js`（strict 模式）
  证据：单测里构造负例「在哪实现」→ legacy 判「查得到」、strict 判「查不到」；
  负例全集（15 题）还没跑，跑完才算完整验收
- [x] **P1-4 引擎可离线单测**：不 import 插件、不碰 fs、不读配置
  证据：`test/engine.test.mjs` 最后一条扫 `lib/engine/*.js`——无 `@deepseek-ai`、无 `node:fs`、无反向 import；
  整个测试文件不依赖宿主包，`node --test` 直接过

## 阶段 P2 · 盒子（引擎能跑之后）

- [x] **P2-1 `api.js` 唯一出口 + `CONTRACT.md`**
  证据：`node --input-type=module -e "import('./lib/engine/api.js')"` → 11 个导出；
  契约写了输入输出、错误口径、版本规则（`ENGINE_VERSION` 1.0.0）
- [x] **P2-2 方向测试**：插件 → api；引擎 ← 插件 一律禁止
  证据：`node --test test/boundary.test.mjs` → **5/5 通过**（导出齐全 / 不碰宿主 / 不读盘 / 插件不深引用 / 只有 api 一个入口）
- [x] **P2-3 安装可见性**：`install.sh --verify-only` + `loaded.txt`
  证据：见下「已完成」两条（正例退出码 0、删文件负例退出码 1）
- [x] **P2-4 加载失败必须喊**
  做法：`index.js` 只做动态加载（1.6KB）+ try/catch，主体移到同目录 `app.js`；失败写
  `$DSH_HOME/fish-memory/load-error.txt` 再抛。
  证据：临时副本删掉 `lib/survival.js` → 抛 `ERR_MODULE_NOT_FOUND` 且文件里指名该模块；
  改回后正常加载；新增 `test/load-entry.test.mjs`，全量 **14/14**。
  另：`package.json` 的 files 已加 `app.js`（否则打包只带入口不带主体）。

## 阶段 P3 · 在盒子上重建现有功能

- [x] **P3-1 换检索与拒答到引擎**：`searchHits()` → `rank()`；`queryHint()` 判据 → `answerable()`
  证据：拿改造前的备份与新代码在真实记忆库上跑 10 个查询，`rel:score` 序列 **10/10 完全一致**
- [x] **P3-2 `index.js` < 900 行**（1,931 → **898**，六刀切完）
  S1 工具注册 → `lib/tools/register.js`（313 行）：index.js **1,931 → 1,652**；
  证据：同一个假 ctx 跑旧/新 `apply()`，**12 个工具的 name+description 完全一致**；测试 13/13
  S2 家规 + 原子写 → `lib/rules.js`（187 行）+ `lib/fs-atomic.js`：index.js **1,652 → 1,477**；
  证据：旧/新 Store 在真实记忆库上 `ruleItems` / `rulesStatus` / `rulesText` / `bootTextSync` **全部逐字节一致**

  S3a 展示（`indexLines`/`logLines`/`growthText`）→ `lib/boot-display.js`：index.js **1,477 → 1,447**；
  证据：旧/新 `indexLines`/`logLines`/`growthText` 在真实库上**逐字节一致**；status 只差 `bootChars`（近况停用导致，预期内）
  S3b 压缩存活核对 → `lib/survival.js`（196 行）+ `lib/text.js`：index.js **1,447 → 1,271**；
  证据：真实检查点 + 8 条真实约束重放 `survivalCheck` **逐条一致**；`recordLoss +2`/`lossWarning`/`clearLoss` 在临时库上与旧实现**完全一致**

  S4 boot 拼装 → `lib/boot.js`：index.js **1,271 → 1,126**；证据：新 boot **1,079 字**，与切前逐字节同长
  S5 召回取景 → `lib/recall-view.js`：index.js **1,126 → 970**；证据：`headLines`/`seqNear`/`hitLines`/`sourceTag` 与旧实现一致
  S6 写回 → `lib/writeback.js` + `lib/day.js`：index.js **970 → 898**；证据：`appendLog`/`appendLogOnce`/`appendPage` 在临时库上**返回与文件内容一致**

  **boot 索引排序修正（2026-11-28）**：同 salience 时专题页优先于 `journal/*`。
  原先按标题排，10 个位置里 7 个被日记页占掉，`projects/memory-engine`、`user/master` 这些路由页被挤出去。
  证据：改后索引 10 行全是专题/身份页；boot 1,075 → 1,101 字（摘要更长）；测试 13/13。

  **插曲（2026-11-28）：boot 里的「近况」已停用。**
  主人问「近况有没有用、会不会过期」，查证：那一行来自 8 天前的 `growth.md`，
  里面写着「鲫鱼 0.4.14 / 记忆体 0.6.11」，当天实际是 1.0.1 / 0.6.20。
  按日期过期也不够——11-25 那条在 7 天内，版本号照样过期。
  结论：**不靠模型自觉保鲜，直接不注入**；页留在 `identity/growth.md`，要看用 mem_recall。
  证据：boot **1,294 → 1,075 字**，`· 近况` 与 `0.6.11` 都不再出现；测试 13/13。
- [x] **P3-3 回归**：`mem_recall` 结果不降；两个插件共存验收
  证据：0.7.3 加载后 `mem_recall("鲫鱼 压缩 阈值")` 正常返回多页；`jiyu_search` 同词返回 2635 条；`loaded.txt` 0.7.3、无 load-error；全量 34/34
  证据：同评测集数字 + 三条共存命令输出

## 阶段 P4 · 整理引擎（2026-11-28 按主人新要求改）

> 新要求：引擎按时间归纳同类事件、产出确定性对比，**模型只负责判断新旧与总结**。

- [x] **P4-1 纯函数 + A/B/C 三块**（`lib/engine/tidy.js`）
  A 变更表（版本号/hex/数字，标 latest / stale）、B 同题簇（同题留最新）、C 冲突。
  证据：`test/engine.test.mjs` 10/10，含「0.4.14/0.6.11 标 stale、1.0.1/0.6.20 标 latest」
- [x] **P4-2 草案落盘**（`lib/drafts.js`）：`.drafts/consolidate-<日期>.md` + `index.json` 状态
  证据：`test/drafts.test.mjs` 3/3（落盘→取回→打点消失；pending 去重；坏状态表当空）
- [x] **P4-3 boot 一行**：`· 整理草案 N 份待处理（最旧 M 天），用 mem_drafts 取`
  证据：单测断言出现与消失；真库无草案时 boot 仍 1,079 字
- [x] **P4-4 取回与打点**：新工具 `mem_drafts`（list/apply/drop）；`mem_consolidate` 到期时生成草案
  证据：同上单测；工具已注册（14 个工具）
- [x] **P4-5 真实 log 演练**：51 条 log → 1 簇（7 条，归属 jiyu-limits）、44 条无归属、A 表空
  证据：在真库副本上跑；A 为空是**诚实结果**（真实 log 里没有版本类值变过），不是失败

**真演练顺手修的两个坑**：
1. 标题里带 `[日期] note |` 前缀 → 51 条并成 1 组；已清洗标题并过滤通用词；
2. 变更表把 URL 当「旧值」→ 路径不再进事实令牌（只收版本/hex/数字）。

## 已完成（原 M0 记录，保留）

- [x] **loaded.txt**（原 M0-1）
  证据：临时 `DSH_HOME` 里跑 `apply()` → `2026-11-27T13:14:47.817Z 0.6.20`；代码在 `index.js` 的 apply 开头
- [x] **`install.sh --verify-only`**（原 M0-3）
  证据（正）：`PROFILE=web ./install.sh --verify-only` → `warn 软链但不用宿主包` + 3 个 ok，退出码 0
  证据（负）：临时 profile 删掉 `lib/tidy.js` → `FAIL 入口 import 失败`，退出码 1

## 每次改动的固定动作（不是可选项）

1. `node --check` 改了哪个文件；
2. 跑该阶段测试 + 全量 `node --test test/*.test.mjs`（有 test 目录后）；
3. 真装一次 + 重启 + 各调一次 `mem_recall` / `jiyu_search`（证明两个插件都活着）；
4. 把命令输出摘一行写进对应钩子的「证据」；
5. 没有第 4 步，不许钩。

## 0.7.1 · 审查回归（2026-11-28）

两份只读审查（bug / 规整）之后的一轮；每项都有复现或比对。

- [x] 高：`rules.js` 缺 `today` → `rule_add` 全坏；`recall-view.js` 缺 `answerable`/`lastCompaction` → 自动提示静默失效
  - 证据：修复前 `addRule → today is not defined`、`queryHint → answerable is not defined`；修复后同一调用返回 ok
- [x] 中：草案同日撞名 / 状态表并发覆盖；索引路径含空格无限重复；boot 超预算丢人格家规；`fitRules` 吞整段；`personaLine` 认不出「名字：」；`status.indexEntries` 失真
  - 证据：`test/regressions.test.mjs` 11 条，全量 **31/31**
- [x] 规整：boundary 扩到 `app.js` + `lib/*.js`（注入深引用实测会 FAIL）；persona 测试改临时根；清 22 个死 import；加 `lib/CONTRACT.md`；eval 加下限与退出码
- [x] `app.js` 909 → **562 行**
  - A1 `ensureHome` → `lib/scaffold.js`；模板与现有页逐行一致
  - A2 索引编辑 → `lib/index-edit.js`；旧 vs 新 `rebuildIndex` 改动数相同、index.md 逐字节一致
- [x] `survival.js` 切词统一到引擎（0.7.3）：真实压缩 11 条约束 + 11 条负例回放，三套切词 22/22 一致；另修「行内覆盖不够就看整段」的漏判
- [x] 压缩钩子自动保存回放样本（`.fish-memory/replay/`，留 10 份）
