# 0.7.7（2026-11-28）· personaLine 兼容旧 SOUL 写法

## 修掉的

0.7.6 给 `personaLine()` 加了行首锚点，结果 `- **我的名字**：溯` 这种旧格式（列表符号加粗体）匹配不到，boot 里名字和称呼整行消失。注释写着「两种都认」，实现只认了新模板那一种。

正则改成允许行首的列表符号和两侧的 `**`，三种都认：

- `名字：溯`
- `- **我的名字**：溯`
- `我的名字**：溯`

## 验证

`node --test test/*.test.mjs`：新增 `test/persona-format.test.mjs` 三条，合计 47 通过；1 条失败是 `load-entry.test.mjs` 在 Windows 下动态 import 需要 `file://` URL，与本次改动无关。
