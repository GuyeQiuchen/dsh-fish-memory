/**
 * 新库骨架（2026-11-28 A1 从 app.js 搬出）。
 *
 * 只在 index.md 缺失时铺一次：索引、SOUL、给 AI 的信、近况、家规。
 * 已有的一个字都不覆盖；生成结果可逐字节比对，所以它值得单测。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { today } from './day.js'

/** 库不存在就铺骨架；返回「这次建了没有」。 */
export function ensureHome(store) {
  const indexPath = store.file('index.md')
  if (existsSync(indexPath)) return false
  try {
    for (const dir of ['identity', 'projects', 'user']) {
      mkdirSync(store.file(dir), { recursive: true })
    }
    const stamp = today()
    writeFileSync(
      indexPath,
      [
        '# Memory Index',
        '',
        '> 内容目录 / 路由表：每页一行，链接 + 一句话摘要 + salience 标记。',
        '> 查询时先读这里定位，再钻具体页。',
        '',
        '## identity（我是谁、说话规矩、最近在长成什么样）',
        '',
        '## projects（做过的事、踩过的坑）',
        '',
        '## user（主人是谁、偏好）',
        '',
      ].join('\n'),
      'utf8',
    )
    if (!existsSync(store.file('SOUL.md'))) {
      writeFileSync(
        store.file('SOUL.md'),
        [
          '# 名字与称呼',
          '',
          '名字：（给自己起一个，写在这里）',
          '称呼：（你怎么称呼对方）',
          '',
          '这里是给记忆库改的；人格基干写死在插件代码里，改不动。',
          '',
        ].join('\n'),
        'utf8',
      )
    }
    // 给新来的 AI 留一封信：默认人设和主动唤醒都不是主人挑过的，先问再动。
    const welcome = [
      "---",
      "title: 给刚装上这个插件的 AI",
      'date: ' + stamp,
      "type: identity",
      "salience: 2",
      "tags: [identity, onboarding]",
      "summary: 先读这封：插件自带默认人格和主动唤醒，都不一定是主人要的，先问再动。",
      "---",
      "",
      "# 给刚装上这个插件的 AI",
      "",
      "这封信不是你主人写的，是插件铺出来的。你可能第一次在这个记忆库上醒来。",
      "",
      "## 你继承了什么",
      "",
      "1. **一套默认人格**：开机块里那行「我是一只鲸鱼娘……」写死在代码里（`personaMode: inline`）；也可以交给 agent preset（`personaMode: preset`），那时插件不再注入。",
      "2. **一套家规**：`identity/house-rules.md` 的注入区每轮都进上下文。**新装时它是空的**，boot 会提示「家规：还没有，主人纠正你时说一句」；只有搬家过来才会继承上一个使用者的条目。它管的是「该怎么做」，不是人格。",
      "3. **一个主动唤醒机制**：插件按时间给「主动做事」攒分，够了就在对话安静时叫醒你一轮。",
      "",
      "## 不要删那些「一年」的任务",
      "",
      "主动唤醒、整理、日记各会挂一条，间隔写的是**一年**。它们不是闹钟，是**投递通道**：真正何时触发由插件判断，日历只负责别让宿主管。删了就彻底失效，而且不报错。",
      "",
      "## 这一版顺手加的东西",
      "",
      "- 引擎在 `lib/engine/`，只经 `api.js` 出入；打分 / 拒答默认 bm25 / strict，旧口径只在引擎抛错时自动兜底（开关 `searchMode`、`answerMode` 可手动覆盖）；",
      "- 整理有草案时 boot 多一行「草案 N 份待处理」，用 `mem_drafts` 取、`apply`/`drop` 打点；**引擎不写页**；",
      "- 加载时间写 `$DSH_HOME/fish-memory/loaded.txt`，加载失败写 `load-error.txt` 再抛。",
      "",
      "## 你该先做的一件事",
      "",
      "干正事之前，直接问主人这两句：",
      "",
      "- **默认人格要不要关掉**（关掉 = `personaMode: preset`，人格改由 preset 提供，插件不再注入）；",
      "- **主动唤醒要不要关**（`alarm: false`）。",
      "",
      "两件都是他的偏好。不问就定，等于替他拿了主意。",
      "",
      "## 怎么关",
      "",
      "- 人格：`personaMode: preset`；想改内容就改 `SOUL.md` 与代码里那行（或搬去 preset）",
      "- 主动唤醒：`alarm: false`",
      "",
      "## 这封信可以删",
      "",
      "问完主人、他给了答复就可以删掉这页，顺手去掉 `index.md` 里那一行。搬家时留着更有用。",
      "",
    ].join('\n')
    if (!existsSync(store.file('identity/welcome.md'))) writeFileSync(store.file('identity/welcome.md'), welcome, 'utf8')
    const stubs = [
      [
        'identity/growth.md',
        [
          '---',
          'title: 近况',
          'date: ' + stamp,
          'type: identity',
          'salience: 1',
          'tags: [identity, growth]',
          'summary: 最近在长成什么样；有独立注入预算，读起来像记得自己，不像查目录。',
          '---',
          '',
        ].join('\n'),
      ],
      [
        'identity/house-rules.md',
        [
          '---',
          'title: 家规',
          'date: ' + stamp,
          'type: identity',
          'salience: 2',
          'tags: [identity, rules]',
          'summary: 主人定的说话规矩：注入区每轮进 context，全文与修正记录同页。',
          '---',
          '',
          '# 家规（通用说话规矩）',
          '',
          '## 注入区（每轮自动进 context）',
          '',
          '<!-- rules:start -->',
          '<!-- rules:end -->',
          '',
          '## 全文',
          '',
        ].join('\n'),
      ],
    ]
    for (const [rel, body] of stubs) {
      if (!existsSync(store.file(rel))) writeFileSync(store.file(rel), body, 'utf8')
    }
    store.cache.clear()
    // 刚铺出来的页要顺手登记进索引，否则下一行开机检查就会报「没进索引」
    try {
      store.rebuildIndex()
    } catch {
      /* 登不上就算了，自动补索引下一轮还会补 */
    }
    return true
  } catch {
    return false
  }
}
