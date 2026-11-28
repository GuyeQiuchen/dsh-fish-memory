/**
 * 引擎唯一出口。插件只许 import 这个文件。
 *
 * 内部四个模块（tokens/rank/answerable/tidy）可以随便重写，
 * 只要这里导出的名字、参数、返回形状不变，就没人受伤。
 */
export { ENGINE_VERSION } from './version.js'
export { searchTerms, contentTerms } from './tokens.js'
export { rank, DEFAULT_OPTIONS } from './rank.js'
export { answerable } from './answerable.js'
export { parseLogEntries, titleGrams, jaccard, factTokens, changeTable, draftConsolidation, draftMarkdown } from './tidy.js'
