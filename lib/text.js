/**
 * 文本扁平化：事件正文有时是字符串、有时是块数组，统一压成纯文本。
 * 2026-11-28 从 index.js 搬出，压缩核对与插件两处共用。
 */

export function flattenText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(flattenText).filter(Boolean).join('\n')
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text
    if (value.content !== undefined) return flattenText(value.content)
    return ''
  }
  return String(value)
}

/** 截断并在末尾标出来（中文里常用，放这里共用）。 */
export function clip(text, max) {
  const value = String(text ?? '')
  return value.length <= max ? value : value.slice(0, Math.max(0, max - 12)) + '…[截断]'
}

/** frontmatter 与空行：展示时不算内容行。 */
export const FRONTMATTER_NOISE = /^(title|tags|type|date|salience|last_access|summary|sources):|^---$|^\s*$/
