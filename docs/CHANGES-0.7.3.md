# 0.7.3（2026-11-28）

把 `survival.js` 重复的切词统一到引擎；用真实压缩样本做的，不是拍脑袋。

## 样本从哪来

上一次真实压缩（2026-11-27T16:59:56Z，盖住 seq 37217-41821）：

- 检查点正文：在会话日志的 user/message（seq 42067）里找到，204,017 字；
- 8 条被检查点带住的约束：`$DSH_HOME/fish-jiyu/last-report.json` 的 `constraints.rows`；
- 3 条压在范围内的真实约束：逐条在摘要里核对过；
- 11 条负例：把每条约束的投影行换成无关词，正确判定应为「丢了」。

样本存在 `memory/.fish-memory/replay/fixture-2026-11-28.json`（本地，不入包）。

## 比对

`tools/replay-survival.mjs` 同时跑三套切词：

```
legacy（旧 survival 自带）  正例 11/11 | 负例 11/11 | 错 0
现行（引擎 searchTerms）    正例 11/11 | 负例 11/11 | 错 0
引擎 实义词                 正例 11/11 | 负例 11/11 | 错 0
```

三套完全一致，于是删掉 `KEY_STOP` 与本地二元组，`keywordTerms()` 改成
`contentTerms(searchTerms(text))`。

## 顺带修一个更深的误判

同一批样本里，seq 38843 那条约束**三种切词都判「丢了」**——但摘要里明明有原话：
它落在约束区的整行里，而投影行 `[块 seq 38843-38885 …]` 只留了关键词，覆盖率不够。

修法：行内覆盖不够时，退回整段摘要再按 `survivalCoverage` 判一次；两处都没有才判丢。
改完正例 11/11。

## 以后不再手搓样本

压缩钩子每次都会把 `{summary, constraints, verdicts}` 存到
`memory/.fish-memory/replay/compaction-*.json`，只留最近 10 份。
下次再改切词或阈值，直接 `node tools/replay-survival.mjs --fixture <文件>` 回归。

## 验证

```
node --test test/*.test.mjs                     34/34
node tools/replay-survival.mjs --fixture ...    三套切词 22/22 一致
压缩钩子落样本                                  临时库实测生成 1 份、字段完整
```
