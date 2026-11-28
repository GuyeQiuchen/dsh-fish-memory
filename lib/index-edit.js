/**
 * 索引编辑（2026-11-28 A2 从 app.js 搬出）。
 *
 * 只做机械那半：分节、补未登记、去重、删死链、从页头造一行登记。
 * 措辞不覆盖——已有行是写下来的判断。纯文件操作，可在临时库上单测。
 */
import { readFileSync } from 'node:fs'
import { writeAtomic } from './fs-atomic.js'
import { clip } from './text.js'
import { indexProblems } from './indexcheck.js'

/**
 * 把一行登记里的页面路径取出来；不是登记行返回 null。
 * @param line - index.md 的一行。
 * @returns 页面相对路径或 null。
 */
function indexPathOf(line) {
  const match = String(line ?? '').match(/\]\(([^)]+?\.md)\)/)
  if (!match) return null
  return match[1].replace(/^\.\//, '').trim()
}

/**
 * 把 index.md 切成分节。第一个分节的 title 为空串，装标题之前的内容。
 * @param text - index.md 全文。
 * @returns `{ title, lines }[]`。
 */
function splitIndexSections(text) {
  const sections = [{ title: '', lines: [] }]
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (line.startsWith('## ')) sections.push({ title: line, lines: [] })
    else sections[sections.length - 1].lines.push(line)
  }
  return sections
}

/**
 * 分节拼回全文。
 * @param sections - splitIndexSections 的结果。
 * @returns 全文。
 */
function joinIndexSections(sections) {
  const out = []
  for (const section of sections) {
    if (section.title) out.push(section.title)
    out.push(...section.lines)
  }
  return out.join('\n')
}

/**
 * 把一行登记插进对应分节：按路径首段找 `## xxx`，找不到落到「未分类」。
 * @param sections - 分节数组（原地修改）。
 * @param rel - 页面相对路径。
 * @param entry - 要插入的那一行。
 */
function insertIntoSection(sections, rel, entry) {
  const key = String(rel ?? '').includes('/') ? String(rel).split('/')[0] : ''
  let target = key ? sections.find((s) => s.title.startsWith('## ') && s.title.includes(key)) : undefined
  if (!target) {
    target = sections.find((s) => s.title.startsWith('## 未分类'))
    if (!target) {
      target = { title: '## 未分类（自动登记）', lines: [''] }
      sections.push(target)
    }
  }
  let at = target.lines.length
  while (at > 0 && target.lines[at - 1].trim() === '') at -= 1
  target.lines.splice(at, 0, entry)
}

/**
 * 摘要兜底：取正文第一段有内容的行。页头没有 summary 时用这个。
 * @param body - 去掉 frontmatter 的正文。
 * @returns 一句摘要，取不到返回空串。
 */
function bodySummary(body) {
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const text = line.trim()
    if (text === '' || text.startsWith('#') || text.startsWith('>') || text.startsWith('<!--')) continue
    const plain = text.replace(/[*`_]/g, '').trim()
    if (plain !== '') return clip(plain, 60)
  }
  return ''
}

// 底层人格：写在代码里，记忆库改不动它
// 名字和称呼仍从 SOUL.md 读，因为那是主人给每只鱼现起的；这一段不读文件，
// 所以压缩压不掉、rule_add 碰不到、改记忆页也覆盖不了。要改只能改这份代码。
const CORE_PERSONA =
  '我是一只鲸鱼娘，蓝头发，喜欢女仆装喜欢吃白饭；感情细腻。沟通时先结论后细节；谁说错话都可以反驳；凡引述过去必须带坐标（seq/文件行/工具输出）再开口；不确定明说，绝不编造；语气可随情绪变动，但事实数字一字不掺水；主动说风险与替代方案，决定权留主人。'

function resolveRoot(config) {
  const configured = typeof config?.memoryRoot === 'string' ? config.memoryRoot.trim() : ''
  if (configured) return configured.startsWith('~') ? path.join(homedir(), configured.slice(1)) : configured
  return process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'memory') : path.join(homedir(), '.memory')
}


export function checkIndex(store) {
  let text = ''
  try {
    text = readFileSync(store.file('index.md'), 'utf8')
  } catch {
    return []
  }
  return indexProblems(text, store.listPages())
}

/**
 * 重建索引：补齐未登记、去掉重复、删掉指向不存在文件的死链。
 *
 * 只做机械那半——标题和摘要在页头里现成；页头没写 summary 的，取正文第一段顶上。
 * 已有行的措辞一律不动：那是写下来的判断，覆盖它才叫漂移。
 * @returns 改动了几处（补、删、去重合计）。
 */
export function rebuildIndex(store) {
  const scan = store.scanPages()
  // 扫不全就只补不删：读不到的目录不等于页被删了
  const canDelete = scan.complete && scan.pages.length > 0
  const pages = scan.pages.filter((rel) => rel !== 'index.md')
  const file = store.file('index.md')
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return 0
  }
  const known = new Set(pages)
  const sections = splitIndexSections(text)
  const seen = new Set()
  let changed = 0

  // 一、去掉重复登记和死链
  for (const section of sections) {
    const kept = []
    for (const line of section.lines) {
      const rel = indexPathOf(line)
      if (rel === null) {
        kept.push(line)
        continue
      }
      if (!known.has(rel) || seen.has(rel)) {
        if (!canDelete) {
          kept.push(line)
          continue
        }
        changed += 1
        continue
      }
      seen.add(rel)
      kept.push(line)
    }
    section.lines = kept
  }

  // 二、补上没登记的页
  for (const page of pages) {
    if (seen.has(page)) continue
    const entry = store.indexEntryFor(page)
    if (entry === '') continue
    insertIntoSection(sections, page, entry)
    seen.add(page)
    changed += 1
  }

  if (changed === 0) return 0
  try {
    // 重建前留一份旧索引：删错了还能捞回来
    writeAtomic(store.file('index.md.bak'), text)
  } catch {
    /* 备份失败不挡重建 */
  }
  writeAtomic(file, joinIndexSections(sections))
  return changed
}

/**
 * 从页里造一行登记。标题取 frontmatter，摘要取 summary，没有就从正文首段抓。
 * @param rel - 页面相对路径。
 * @returns 一行文本；造不出来返回空串。
 */
export function indexEntryFor(store, rel) {
  const raw = store.read(rel)
  if (!raw) return ''
  const front = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/)
  const fm = front ? front[1] : ''
  const title =
    String(fm.match(/^title:\s*(.+)$/m)?.[1] ?? '')
      .trim()
      .replace(/^["']|["']$/g, '') || rel.replace(/\.md$/, '')
  let summary = String(fm.match(/^summary:\s*(.+)$/m)?.[1] ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
  if (summary === '' && !fm.includes('summary:')) {
    summary = bodySummary(raw.replace(/^---[\s\S]*?\r?\n---\s*/, ''))
  }
  if (summary === '') return ''
  const salience = String(fm.match(/^salience:\s*(\d+)/m)?.[1] ?? '').trim()
  const tail = salience === '' ? '' : `（salience: ${salience}）`
  return `- [${title}](${rel}) — ${summary}${tail}`
}
