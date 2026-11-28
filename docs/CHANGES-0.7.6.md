# 0.7.6（2026-11-28）· 整理草案自动生成

## 改了什么

到期不再要求模型先调 `mem_consolidate`。boot 每次拼装时会检查 `tidyDue`，到期就直接：

```
log.md / pages
  → parseLogEntries
  → draftConsolidation
  → draftMarkdown
  → .drafts/consolidate-<时间>.md
```

跑完就 `markTidy` 打点（有草案、没材料都算跑过），boot 只留下「整理草案 N 份待处理」一行；生成抛错才不打点。模型拿 `mem_drafts` 取草案，决定合并、折指针还是 `drop`。

## 触发与边界

| 情况 | 行为 |
|---|---|
| `tidyHours` 到期（默认 24h） | 自动生成草案并打点 |
| 没有足够材料 | 不打草案，但仍然打点，避免每轮重算 |
| 已有 pending 草案 | 不重复生成；打点，提醒仍指向已有草案 |
| 生成抛错 | **不打点**，下一轮 boot 再试，并打一条 console 警告 |
| `autoConsolidate: false` | 退回旧流程：模型自己调 `mem_consolidate` |

手动 `mem_consolidate` 仍然保留：它会用同一条 `generateConsolidationDraft()` 重算，并照旧返回工作单；模型不再需要靠它触发整理。

## 提示文案

- 叫醒的整理轮：先看 `mem_drafts`，有草案就按 A/B/C 处理，没有才翻页整理；
- boot 的工作单不再写「先调 mem_consolidate」，改成「处理完用 mem_drafts apply/drop 打点」。

## 验证

```
node --test test/*.test.mjs
tests 46 / pass 46 / fail 0
```

新增 6 条：到期自动生成并打点、未到期不生成、没材料也打点、生成失败不打点、`autoConsolidate: false`、boot 到期只留草案提醒。

## 生效

默认值在插件加载时读，**要重启 DSH** 才生效。重启后到期的第一轮 boot 会自动落一份草案，不需要任何工具调用。
