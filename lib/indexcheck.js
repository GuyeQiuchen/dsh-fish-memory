/**
 * 索引体检（可删的小模块）。
 *
 * 整理的正经宿主是索引，不是周记：索引准了，boot 里那几行和检索才可靠。
 * 这里只在写入和整理时查三件事——页面没进索引、索引指向不存在的页、同一页登记了两遍。
 * 只报不改：改索引仍由模型决定，自动改会漂。
 *
 * 模块化：删掉本文件、index.js 里的 import、appendPage 里那段 hint、checkIndex 方法、
 * mem_consolidate 里合并 issues 的那几行，以及 test/indexcheck.mjs 即可回退。
 */

/**
 * 从索引文本里取登记过的页面路径（归一化：去 `./`、去空白）。
 * @param indexText - index.md 全文。
 * @returns 路径数组（可能重复）。
 */
export function indexPaths(indexText) {
  const out = []
  for (const match of String(indexText ?? '').matchAll(/\]\(([^)\s]+\.md)\)/g)) {
    const cleaned = String(match[1]).replace(/^\.\//, '').trim()
    if (cleaned !== '' && !cleaned.startsWith('http')) out.push(cleaned)
  }
  return out
}

/**
 * 查索引问题。
 * @param indexText - index.md 全文。
 * @param pages - 记忆根内的页面相对路径数组。
 * @returns `{ kind, path, message }[]`。
 */
export function indexProblems(indexText, pages) {
  const registered = indexPaths(indexText)
  const known = new Set(pages)
  const seen = new Set()
  const out = []
  for (const item of registered) {
    if (seen.has(item)) {
      out.push({ kind: 'duplicate', path: item, message: `索引里 ${item} 登记了两遍` })
      continue
    }
    seen.add(item)
    if (!known.has(item)) {
      out.push({ kind: 'dead', path: item, message: `索引指向 ${item}，但文件不存在` })
    }
  }
  for (const page of pages) {
    // 索引页自己不进索引，这是自指，不是漏。
    if (page.replace(/^\.\//, '') === 'index.md') continue
    if (!seen.has(page)) {
      out.push({ kind: 'unindexed', path: page, message: `${page} 还没进索引` })
    }
  }
  return out
}

/**
 * 写页之后的当场提示：这一页进索引了吗。
 * @param indexText - index.md 全文。
 * @param page - 刚写的页面相对路径。
 * @returns 提示文本；已登记则返回 null。
 */
export function pageHint(indexText, page) {
  const rel = String(page ?? '').replace(/^\.\//, '')
  if (rel === '') return null
  return indexPaths(indexText).includes(rel) ? null : `${rel} 还没进索引，回头补一行 index.md`
}
