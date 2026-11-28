# 职责边界（2026-11-22 定）

这个包是**基底**，不是平台。只管记忆的存、取、写，不加别的能力。

## 我负责

1. 记忆库的读写：页面、索引、log、家规、近况；
2. 每次开口前注入一小块（boot）：人设、家规、时态声明、索引、最近两条；
3. 按关键词检索，把命中的页交回给模型；
4. 压缩之后核对约束有没有被压丢。

## 我不负责

压缩本身（那是鲫鱼）、主动性策略、成长计划、外发消息、界面。要长新东西，长到新插件里；它们通过下面的口用记忆，不直接改 `memory/` 里的文件。

## 对外提供（稳定接口）

| 接口 | 内容 |
|---|---|
| 记忆根目录 | `$DSH_HOME/memory`（或 `memoryRoot`）；页面是 markdown，`index.md` 是目录，`log.md` 是流水 |
| 工具 | `mem_recall` / `mem_live` / `mem_seq` / `mem_log` / `mem_page` / `mem_status` / `rule_add` / `rule_status` / `mood_set` / `mem_harvest` / `mem_consolidate` / `mem_drafts` / `mem_diary` |
| 注入块 | 每轮进上下文的那段文本（`bootMaxChars` 上限内） |
| 读取别家报告 | 只读鲫鱼的 `~/.dsh/fish-jiyu/last-report.json` 取压缩线，不写它 |

**页面布局是接口**：`identity/`、`projects/`、`journal/`、`index.md`、`log.md` 的约定算公开契约，改结构要在 `docs/DETAIL.md` 的变更里写明。

## 冻结（保留现状，不删不改不加）

- 叫醒与整理轮（`lib/alarm.js`）：属于主动性，不属于记忆；
- 日记提醒、心情漂移：同上；
- 度量 `metrics.json`：属于观察。

要改这些，应该在新插件里做，而不是往这里加逻辑。

## 什么算 bug

三条同时满足才算：**能复现**（步骤或输入）、**有验收**（修完怎么证明）、**属于本包职责**。

「召回不够聪明」「叫醒太频繁」「家规只能写 22 字」都属于设计取舍或别的插件的活，不算 bug，记进 `docs/DETAIL.md` 的已知限制。
