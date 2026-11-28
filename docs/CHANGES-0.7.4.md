# 0.7.4（2026-11-28）

两件事：包改名，以及把不该随包走的个人数据拿掉。

## 改名：dsh-fish-memory → dsh-jiyiti-memory

npm 上 `dsh-fish-memory` 已被另一个作者占用（1.6.7，维护者 dsydd），市场里两条同名。
新名 `dsh-jiyiti-memory` 在 npm 查过是空的。

本机改的 14 处：包目录与 `node_modules` 软链、`package.json`（name / repository / homepage）、
`cordis.patch.yml`（注释与 name）、`install.sh` / `install.ps1` / `uninstall.sh` / `uninstall.ps1`、
`app.js` 日志前缀、`lib/engine/CONTRACT.md`、`docs/DETAIL.md`、profile 的 bundles 与 dependency、
`pnpm-lock.yaml`。

**两处故意保留旧名**：

- `$DSH_HOME/fish-memory/`：诊断目录（`loaded.txt` / `load-error.txt`），改名会断掉已有加载记录；
- `cordis.patch.yml` 的条目 id `fish-memory`：局部标识，不是包名。

## 封包修正：不再携带个人评测集

0.7.3 及更早的 tgz 会把 `tools/eval-questions.json` 与 `tools/eval-extra.json` 一起打进去。
这两份是**本地评测数据**：100 道关于主人记忆的问题、预期页路径、负例与跨页题。
自己用没问题，但一旦发布到 npm / 市场，等于把私人问题清单公开。

现在 `files` 只放行 `tools/eval.mjs` 与 `tools/replay-survival.mjs`；
两份 JSON 仍留在仓库目录供本机评测，但**不进包**。
`tools/eval.mjs` 在缺数据时给一句明确说明并以退出码 2 结束，不再抛栈。

## 验证

```
npm pack                     72 → 70 个文件；tarball 内无 eval-questions / eval-extra
tar tzf | grep eval-          只有 tools/eval.mjs
临时 profile 实装 + verify    六项 ok，入口可 import
node --test                  34/34
```
