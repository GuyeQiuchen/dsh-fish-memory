/**
 * 硬信息判定（可删的小模块）。
 *
 * 用途只有一个：自动提示时决定「这页值不值得直接摊开正文」。
 * 有数字、路径、命令、错误码的页，光给页码没用，翻过去才说得准；
 * 只是闲聊和判断的页，给一行指针就够。
 *
 * 规则故意收得很窄，宁可漏也别误报：误报会让不相干的页挤进上下文，
 * 那比漏掉更难查（别名那次就是这么被叫停的）。
 *
 * 删掉本文件、index.js 顶部那行 import、queryHint 里那两行即可回退。
 */

/**
 * 这段文字里有没有硬信息。
 * @param text - 页面或片段全文。
 * @returns 有没有。
 */
export function hasHardInfo(text) {
  const body = String(text ?? '')
  if (body === '') return false
  // 带单位的数字：转速、耗时、体积、比例
  if (/\d+(?:\.\d+)?\s*(?:%|ms|秒|分钟|度|°|转|rpm|tokens?|MB|GB|KB|KB\/s)/i.test(body)) return true
  // 盘符路径或三段以上的斜杠路径
  if (/[A-Za-z]:\\|\/(?:[\w.-]+\/){2,}/.test(body)) return true
  // 会话里出现过就能照抄的命令
  if (/\b(?:npm|pnpm|node|git|pwsh|powershell|robocopy|curl|wget|python)\b/i.test(body)) return true
  // 错误码和十六进制端口/寄存器
  if (/\b(?:ERR_[A-Z_]+|E[A-Z]{3,}|0x[0-9a-f]{2,})\b/i.test(body)) return true
  return false
}
