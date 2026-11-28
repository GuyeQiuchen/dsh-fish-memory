/**
 * 分词与停用词（引擎内部）。
 *
 * 2026-11-28 从 index.js 剥出来：只做文本→词，不读文件、不看配置，
 * 离线可测，评测脚本和线上走同一份。
 */

/** 中文二元组里到处出现的组合，留着只会让每页都命中。 */
export const STOP_TERMS = new Set([
  '的了', '了的', '是我', '是你', '是他', '是她', '这个', '那个', '一个', '我们', '你们', '他们',
  '什么', '为什', '怎么', '怎样', '哪个', '哪些', '这些', '那些', '一种', '可以',
  '有没', '没有', '是不', '不是', '会不', '不会', '能不', '能会', '如果', '但是', '因为', '所以', '然后',
  '现在', '刚才', '之前', '之后', '时候', '知道', '觉得', '认为', '帮我', '给我', '的是', '了吗', '一下',
])

/** 判断「有没有记录」时要剔除的功能词：疑问、指代、时间副词这类不承载内容。 */
export const FUNCTION_TERMS = new Set([
  '在哪', '在哪儿', '哪里', '那儿', '这儿', '多少', '多久', '是否', '有没有', '是不是',
  '怎么', '如何', '为什么', '什么', '哪一', '哪个', '哪些', '这个', '那个',
  '记得', '记不', '还记', '告诉', '一下', '帮我', '请问', '关于', '有关',
])

/**
 * 把一句查询切成检索词：中文段切二元组，拉丁/数字段原样保留，停用词扔掉。
 * @param query - 用户查询。
 * @returns 词数组（去重）。
 */
export function searchTerms(query) {
  const text = String(query ?? '').toLowerCase()
  const terms = new Set()
  for (const chunk of text.split(/[\s,，。；;、:：!?？…()（）[\]【】「」『』《》<>"'“”]+/)) {
    if (!chunk) continue
    const cjk = chunk.match(/[\u4e00-\u9fa5]+/g) ?? []
    for (const seg of cjk) {
      if (seg.length === 1) {
        if (!STOP_TERMS.has(seg)) terms.add(seg)
        continue
      }
      for (let i = 0; i + 2 <= seg.length; i += 1) {
        const gram = seg.slice(i, i + 2)
        if (!STOP_TERMS.has(gram)) terms.add(gram)
      }
    }
    const latin = chunk.replace(/[\u4e00-\u9fa5]+/g, ' ').trim()
    if (latin.length >= 2) terms.add(latin)
  }
  return [...terms]
}

/** 只留下承载内容的词（判断「答不答得出」用）。 */
export function contentTerms(terms) {
  return (Array.isArray(terms) ? terms : []).filter((term) => !FUNCTION_TERMS.has(term))
}
