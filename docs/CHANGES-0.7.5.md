# 0.7.5（2026-11-28）· 引擎转正 + 异常兜底

## 改了什么

- `searchMode` 默认从 `legacy` 改成 **`bm25`**；
- `answerMode` 默认从 `legacy` 改成 **`strict`**；
- legacy 不再是日常路径，只在主引擎抛错 / 返回结构不对时自动顶上来。

## 兜底规则

| 情况 | 行为 |
|---|---|
| `rank()` 抛错 | 回退 `legacy` 打分，记一条告警 |
| `rank()` 返回不是 `{ terms, hits }` | 同上 |
| `answerable()` 抛错 / 结构不对 | 回退 `legacy` 判据，记一条告警 |
| `ok=false`（正常拒答） | **不**回退；这是判定结果，不是引擎故障 |
| 主引擎下一次成功 | 清掉对应告警，不留常驻噪音 |

告警同时出现在：

- boot 的 `· ⚠ 引擎出错，已回退旧口径：…`；
- `mem_recall` 返回的 `warning` 字段与结果前缀；
- `mem_status` 的 `engineFallback`；
- 控制台 `[memory] …`；
- 记忆根的 `.engine-fallback.log`（隐藏文件，不进索引，超过 64 KB 只留最后 32 KB）。

## 配置

默认值已经是新口径，profile 不用再写。`searchMode: 'legacy'` / `answerMode: 'legacy'` 仍接受，作为排障时的临时手动覆盖；正常使用不要写。

## 验证

```
node --test test/*.test.mjs
tests 40 / pass 40 / fail 0
```

新增 6 条：默认值、bm25 抛错回退、结构不对回退、strict 抛错回退、正常 `ok=false` 不触发回退、recall 告警前缀。

真实记忆根冒烟：

```
searchHits('鲫鱼 压缩 阈值') → terms 3 / hits 22 / top projects/jiyu-limits.md
warning 空
```

## 生效

配置默认值在插件加载时读，**要重启 DSH** 才生效。重启后 `mem_status` 的 `engineFallback` 应为空对象值（rank/answer 都是 null）。
