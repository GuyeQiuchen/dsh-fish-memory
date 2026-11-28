# 引擎契约（dsh-jiyiti-memory）

**内部四个模块随便重写，导出的名字与返回形状不许变。** 这是这个盒子唯一的承诺。
插件只许 `import ... from './lib/engine/api.js'`；深引用 `rank.js` / `tidy.js` 有测试扫。

- 版本：`ENGINE_VERSION`（`lib/engine/version.js`）。内部重写不动它；**输出形状变了才升大版本**。
- 引擎不碰 fs、不读配置、不 import 插件；页与条目文本由调用方传入。

## `rank(query, pages, options)`

| 输入 | 类型 | 说明 |
|---|---|---|
| `query` | string | 用户查询 |
| `pages` | `{ rel, text }[]` | 调用方读好的页；引擎不读盘 |
| `options.mode` | `'legacy' \| 'bm25'` | 调用方默认 `bm25`；`legacy` 只在 bm25 抛错时兜底 |

返回 `{ terms: string[], hits: Hit[] }`，`hits` 已排序（`log.md` 永远最后）：

```
Hit = { rel, count, matched, matchedList, score, picked: string[] }
```

`count` = 命中行数，`matched` = 命中词种数，`picked` = 最多两行摘录。

## `answerable(ranked, options)`

| 输入 | 说明 |
|---|---|
| `ranked` | `rank()` 的返回值，或 `hits` 数组 |
| `options.mode` | `strict`（默认，只数实义词）；`legacy` 只在 strict 抛错时兜底 |
| `options.terms` | 传 hits 数组时补上词表 |

返回 `{ ok, reason, matched, ratio, terms }`；`ok=false` 时 `reason ∈ {no-hit, too-few-terms, low-coverage}`。

## 整理

```js
parseLogEntries(raw)            // → { date, title, body }[]
factTokens(text)                // → 版本号 / hex / 4 位以上数字（年份除外；路径不收）
changeTable(entries, groups)    // → { title, token, times, first, last, status: 'latest'|'stale', sources }[]
draftConsolidation({ entries, pages, minGroup, maxSpanDays, threshold })
                                // → { groups, drafts, changes, conflicts, unowned }
draftMarkdown(result)           // → A 变更表 / B 同题簇 / C 冲突 的 markdown 草案
jaccard(a, b) / titleGrams(t)   // 相似度工具
```

**分工（2026-11-28 主人定）**：A/B/C 三块由引擎确定性产出（变更表标出
`latest` / `stale`，只陈述「哪个值在什么时候变过」，**不判断对错**）；
模型只在草案上写结论与取舍；写页永远由调用方执行。

**铁律**：整理只出草案，不写页；`drafts[].sources` 必须能点回原始条目。

## 错误

引擎不抛业务异常：输入为空返回空结果（`hits: []`、`drafts: []`），不 `throw`。
唯一例外是调用方传了不可迭代的值——那属于调用方 bug，让它抛。

## 测试

- `test/engine.test.mjs`：行为（legacy 等价、bm25、拒答、整理、草案渲染）；
- `test/boundary.test.mjs`：方向（引擎不依赖插件、插件不深引用引擎、api 导出齐全）；
- `tools/eval.mjs`：统一尺子（100 正例 + 15 负例 + 10 跨页）。
