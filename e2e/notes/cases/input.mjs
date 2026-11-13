import { eq, includes, ok } from '../lib/assert.mjs'
import { sleep } from '../lib/cdp.mjs'
import { BASIC, NESTED } from '../lib/fixtures.mjs'

const FENCE = ['# 反引号', '', '普通文字。', ''].join('\n')
const WRAP = ['# 反引号升级', '', '待升级的文字。', ''].join('\n')
const LIST = ['# 列表续行', '', '- 外层甲', ''].join('\n')
const TASK = ['# 任务续行', '', '- [] 宽松任务', ''].join('\n')
const COLUMNS = ['# 列选择', '', '甲行文字', '乙行文字', ''].join('\n')
const LEVELS = [
  '# 列表层级',
  '',
  '- 一级甲',
  '  - 二级甲',
  '    - 三级甲',
  '      - 四级甲',
  '',
  '结尾段落。'
].join('\n')
const QUOTED = ['# 引用列表', '', '> - 引用甲', '>   - 引用乙', ''].join('\n')
const QUOTE_EXIT = ['# 引用退出', '', '> 引用甲', '', '结尾段落。'].join('\n')
const QUOTE_NESTED = ['# 嵌套引用退出', '', '> > 内层甲', '', '结尾段落。'].join('\n')
const SAME_MARKER = ['# 同级标记', '', '* 甲', '* 乙', ''].join('\n')
const MIXED_MARKERS = ['# 标记', '', '- [ ] 任务甲', '* [x] 任务乙', '1. 有序甲', ''].join('\n')
const CODE_LIST = ['# 代码块', '', '```', '- 不是列表', '```', ''].join('\n')

function nonEmpty(lines) {
  return lines.filter((line) => line.trim() !== '')
}

export default [
  {
    id: 'input/wiki-autocomplete-insert',
    area: 'input',
    title: '输入 [[ 查询笔记:补全弹层出现,回车插入 [[标题]]',
    tags: ['input', 'completion'],
    fixture: BASIC,
    async run(ctx, t) {
      const line = '第一节第一段。'
      await ctx.setCursor(line, line.length)
      await ctx.typeText(' [[E2E 链接')
      await ctx.cdp.waitFor(`document.querySelector('.cm-tooltip-autocomplete') !== null`, {
        message: 'wikilink 补全弹层出现'
      })
      // 候选是按最后一次输入过滤的;等弹层里的匹配段追平查询词再回车,
      // 否则回车可能落在 100ms 防抖窗口内,被当成普通换行。
      await ctx.cdp.waitFor(
        `[...document.querySelectorAll('.cm-tooltip-autocomplete .cm-completionMatchedText')]
          .some((el) => el.textContent === 'E2E 链接')`,
        { message: '补全结果已按查询词更新' }
      )
      // CodeMirror 的补全激活/重查有 100ms 防抖:弹层已经绘出新结果时,内部状态
      // 仍可能停在 pending,回车会被当成换行。真人的输入间隔远大于这个窗口。
      await sleep(350)
      await ctx.press('Enter')
      await sleep(150)
      includes(await ctx.body(), '[[E2E 链接目标]]', '插入完整 wikilink')
    }
  },

  {
    id: 'input/no-tag-autocomplete',
    area: 'input',
    title: '正文输入 #:不再弹标签补全(标签只在元数据行维护)',
    tags: ['input', 'completion'],
    fixture: BASIC,
    async run(ctx, t) {
      // 即使笔记库里有同名标签,正文的 # 也只是普通文字
      await ctx.cdp.eval(`document.querySelector('.notes-tag-input')?.focus()`)
      await ctx.cdp.type('e2e补全标签')
      await ctx.press('Enter')
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-tag-chip')?.textContent?.includes('e2e补全标签')`,
        { message: '标签已添加到笔记' }
      )
      await ctx.waitSaved()

      const line = '第一节第一段。'
      await ctx.setCursor(line, line.length)
      await ctx.typeText(' #e2e')
      // 补全弹层有约 100ms 防抖;负向断言只能用一段有界等待来证明「没有弹」
      await sleep(400)
      eq(
        await ctx.cdp.eval(`document.querySelector('.cm-tooltip-autocomplete') === null`),
        true,
        '正文输入 # 不弹标签补全'
      )
      includes(await ctx.body(), '#e2e', '输入的 # 保持字面')

      // 清掉刚加的标签,别让后续用例看到多余元数据。
      await ctx.cdp.eval(`document.querySelector('.notes-tag-chip button')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.notes-tag-chip') === null`, {
        message: '标签已清理'
      })
    }
  },

  {
    id: 'input/fence-autopair',
    area: 'input',
    title: '空行连续输入三个反引号:自动补出成对围栏,光标在开头围栏之后',
    tags: ['input', 'fence'],
    fixture: FENCE,
    async run(ctx, t) {
      const line = '普通文字。'
      await ctx.setCursor(line, line.length)
      await ctx.press('Enter')
      await ctx.typeText('```')

      const lines = await ctx.lines()
      eq(lines.filter((text) => text === '```').length, 2, '自动补出首尾两条围栏')

      // 光标应停在开头围栏末尾:直接输入语言标记。
      await ctx.typeText('js')
      await ctx.press('Enter')
      await ctx.typeText('const a = 1')
      const body = await ctx.body()
      includes(body, '```js\nconst a = 1\n```', '语言标记与正文都落在围栏内')
    }
  },

  {
    id: 'input/fence-upgrade-from-selection',
    area: 'input',
    title: '选中文字连按三次反引号:行内代码 → 双反引号 → 围栏代码块',
    tags: ['input', 'fence'],
    fixture: WRAP,
    async run(ctx, t) {
      const line = '待升级的文字。'
      await ctx.selectRange(line, 0, line.length)
      await ctx.typeText('`')
      includes(await ctx.body(), '`待升级的文字。`', '第一个反引号包成行内代码')
      await ctx.typeText('`')
      includes(await ctx.body(), '``待升级的文字。``', '第二个反引号把首尾标记各补成两个')
      await ctx.typeText('`')
      await sleep(150)
      includes(await ctx.body(), '```\n待升级的文字。\n```', '第三个反引号升级为围栏代码块')
    }
  },

  {
    id: 'input/list-continuation-enter',
    area: 'input',
    title: '列表项行尾回车:下一行自动续上同样的列表标记',
    tags: ['input', 'list'],
    fixture: LIST,
    async run(ctx, t) {
      const line = '- 外层甲'
      await ctx.setCursor(line, line.length)
      await ctx.press('Enter')
      await ctx.typeText('新项')
      const lines = nonEmpty(await ctx.lines())
      includes(lines, '- 外层甲', '原列表项保留')
      includes(lines, '- 新项', '回车续出新的列表项')
    }
  },

  {
    id: 'input/loose-task-normalized-enter',
    area: 'input',
    title: '宽松任务写法 -[] 行尾回车:当前行规整为标准任务,并续出新任务',
    tags: ['input', 'task'],
    fixture: TASK,
    async run(ctx, t) {
      const line = '- [] 宽松任务'
      await ctx.setCursor(line, line.length)
      await ctx.press('Enter')
      const lines = nonEmpty(await ctx.lines())
      includes(lines, '- [ ] 宽松任务', '当前行补成标准任务写法')
      eq(lines[lines.length - 1], '- [ ] ', '下一行续出未勾选任务')
    }
  },

  {
    id: 'input/quote-exit-enter',
    area: 'input',
    title: '引用块回车:第一次续出空引用行,第二次回车就清掉 > 只留一个空行,随后输入落在普通段落',
    tags: ['input', 'quote'],
    fixture: QUOTE_EXIT,
    async run(ctx, t) {
      const line = '> 引用甲'
      await ctx.setCursor(line, line.length)
      await ctx.press('Enter')
      let lines = await ctx.lines()
      const base = lines.indexOf(line)
      ok(base >= 0, '找到引用行')
      eq(lines[base + 1], '> ', '第一次回车续出空引用行')
      await ctx.press('Enter')
      lines = await ctx.lines()
      eq(lines[base], line, '引用正文保留')
      eq(lines[base + 1], '', '第二次回车清掉最内层 >,光标留在这一个空行')
      eq(lines.includes('> '), false, '没有遗留空的引用行')
      await ctx.typeText('普通段落')
      lines = await ctx.lines()
      eq(lines[base + 1], '普通段落', '随后输入落在普通段落上')
    }
  },

  {
    id: 'input/quote-exit-nested',
    area: 'input',
    title: '嵌套引用回车:每次只退最内层一层,`> > 内层甲` → `> > ` → `> ` → 空行',
    tags: ['input', 'quote'],
    fixture: QUOTE_NESTED,
    async run(ctx, t) {
      const line = '> > 内层甲'
      await ctx.setCursor(line, line.length)
      await ctx.press('Enter')
      let lines = await ctx.lines()
      const base = lines.indexOf(line)
      ok(base >= 0, '找到嵌套引用行')
      eq(lines[base + 1], '> > ', '续出空的内层引用')
      await ctx.press('Enter')
      lines = await ctx.lines()
      eq(lines[base + 1], '> ', '只退一层,外层引用保留')
      await ctx.press('Enter')
      lines = await ctx.lines()
      eq(lines[base + 1], '', '再退最后一层,只剩空行')
      eq(lines.includes('> '), false, '没有遗留空的引用行')
    }
  },

  {
    id: 'input/tab-indents-list',
    area: 'input',
    title: 'Tab / Shift+Tab:列表项整行增减一级缩进,无序标记跟随上一级',
    tags: ['input', 'list', 'tab'],
    fixture: NESTED,
    async run(ctx, t) {
      const line = '  - 内层甲一'
      await ctx.setCursor(line, 0)
      await ctx.press('Tab')
      // 标记由**上一级**决定:上一级是 `- 外层甲` → 本级 `*`;反缩进后仍是 `*`。
      includes(await ctx.lines(), '    * 内层甲一', 'Tab 增加一级缩进,标记跟随上一级变为 *')
      await ctx.press('Tab', 8)
      includes(await ctx.lines(), '  * 内层甲一', 'Shift+Tab 恢复原缩进,标记仍跟随上一级为 *')
    }
  },

  {
    // 复现用户报告:选中/停在列表项后按 Tab 没有缩进,焦点被移到工具栏。
    // 根因是 CodeMirror 在 Escape 后有 2 秒「Tab 交给浏览器」模式,它在 keymap 之前
    // 就 return 了 —— 这里先按 Escape 把这个状态摆出来。
    id: 'input/tab-after-escape-indents-list',
    area: 'input',
    title: '刚按过 Escape 后的 Tab / Shift+Tab:仍在编辑器内缩进,焦点不跑到工具栏',
    tags: ['input', 'list', 'tab', 'focus'],
    fixture: NESTED,
    async run(ctx, t) {
      const line = '  - 内层甲一'
      await ctx.setCursor(line, 0)
      await ctx.press('Escape')
      await ctx.press('Tab')
      includes(await ctx.lines(), '    * 内层甲一', 'Escape 后 Tab 仍缩进一级')
      eq(
        await ctx.cdp.eval(`document.activeElement?.classList.contains('cm-content') === true`),
        true,
        'Tab 后焦点留在编辑器'
      )
      await ctx.press('Escape')
      await ctx.press('Tab', 8)
      includes(await ctx.lines(), '  * 内层甲一', 'Escape 后 Shift+Tab 仍反缩进')
      eq(
        await ctx.cdp.eval(`document.activeElement?.classList.contains('cm-content') === true`),
        true,
        'Shift+Tab 后焦点仍在编辑器'
      )
    }
  },

  {
    id: 'input/tab-marker-follows-parent-chain',
    area: 'input',
    title: '选中多级列表按 Tab:每层的标记跟随它的上一级,- → * → + 逐层递进',
    tags: ['input', 'list', 'tab'],
    fixture: LEVELS,
    async run(ctx, t) {
      await ctx.selectLines('- 一级甲', '      - 四级甲')
      await ctx.press('Tab')
      const lines = await ctx.lines()
      includes(lines, '  - 一级甲', '没有上级 → -')
      includes(lines, '    * 二级甲', '上级 - → *')
      includes(lines, '      + 三级甲', '上级 * → +')
      includes(lines, '        - 四级甲', '上级 + → -')
    }
  },

  {
    // 用户报告的差异:上一级是 `*`,`Tab` 后本级必须是 `+`,而不是按绝对深度算成 `*`。
    id: 'input/tab-marker-follows-parent',
    area: 'input',
    title: '同级 `*` 列表上按 Tab:新标记跟随上一级 `*` 变为 `+`',
    tags: ['input', 'list', 'tab'],
    fixture: SAME_MARKER,
    async run(ctx, t) {
      await ctx.setCursor('* 乙', 0)
      await ctx.press('Tab')
      includes(await ctx.lines(), '  + 乙', '上一级是 * → 本级 +')
      // 反缩进回顶格后没有上级,按基础标记归一成 `-`
      await ctx.press('Tab', 8)
      includes(await ctx.lines(), '- 乙', '回到顶格没有上级,标记归一为 -')
    }
  },

  {
    id: 'input/tab-caret-follows-content',
    area: 'input',
    title: 'Tab 缩进列表项时光标跟着文字走,不会被挤到行首',
    tags: ['input', 'list', 'tab', 'caret'],
    fixture: NESTED,
    async run(ctx, t) {
      await ctx.setCursor('  - 内层甲一', 6) // 落在「甲」上
      await ctx.press('Tab')
      includes(await ctx.lines(), '    * 内层甲一', 'Tab 增加缩进并换标记')
      const caret = await ctx.cdp.eval(`(() => {
        const v = document.querySelector('.notes-editor-pane .cm-content')?.cmTile?.root?.view
        if (!v) return null
        const head = v.state.selection.main.head
        const line = v.state.doc.lineAt(head)
        return { column: head - line.from, char: v.state.sliceDoc(head, head + 1) }
      })()`)
      eq(caret?.char, '甲', '光标仍停在同一文字上')
      eq(caret?.column, 8, '光标列随缩进和标记宽度一起后移')
    }
  },

  {
    id: 'input/tab-quoted-list',
    area: 'input',
    title: '引用里的列表 Tab:缩进加在 > 之后,标记跟随引用内的上一级',
    tags: ['input', 'list', 'tab', 'quote'],
    fixture: QUOTED,
    async run(ctx, t) {
      await ctx.setCursor('>   - 引用乙', 0)
      await ctx.press('Tab')
      includes(
        await ctx.lines(),
        '>     * 引用乙',
        '缩进在引用前缀之后,标记跟随上一级 `> - 引用甲` 变为 *'
      )
      await ctx.press('Tab', 8)
      includes(await ctx.lines(), '>   * 引用乙', 'Shift+Tab 缩回一级,标记仍为 *')
    }
  },

  {
    id: 'input/tab-task-and-ordered-markers',
    area: 'input',
    title: '任务与有序列表 Tab:只缩进,不换标记(Obsidian Tasks 只认 `-`)',
    tags: ['input', 'list', 'tab', 'task'],
    fixture: MIXED_MARKERS,
    async run(ctx, t) {
      await ctx.selectLines('- [ ] 任务甲', '1. 有序甲')
      await ctx.press('Tab')
      const lines = await ctx.lines()
      includes(lines, '  - [ ] 任务甲', '未勾选任务只缩进,标记保持 -')
      includes(lines, '  * [x] 任务乙', '已勾选任务只缩进,标记保持 *')
      includes(lines, '  1. 有序甲', '有序列表只缩进')
    }
  },

  {
    id: 'input/tab-code-block-list-like-line',
    area: 'input',
    title: '代码块里的列表样文本 Tab:只缩进,不换标记(那是代码)',
    tags: ['input', 'list', 'tab', 'code'],
    fixture: CODE_LIST,
    async run(ctx, t) {
      await ctx.setCursor('- 不是列表', 0)
      await ctx.press('Tab')
      includes(await ctx.lines(), '  - 不是列表', '围栏内只加缩进')
      await ctx.press('Tab', 8)
      includes(await ctx.lines(), '- 不是列表', 'Shift+Tab 复原')
    }
  },

  {
    id: 'input/tab-paragraph-stays-in-editor',
    area: 'input',
    title: '普通段落 Tab:在光标处插空格,焦点不离开编辑器;有选区时整行缩进',
    tags: ['input', 'tab', 'focus'],
    fixture: NESTED,
    async run(ctx, t) {
      const line = '结尾段落。'
      await ctx.setCursor(line, 2)
      await ctx.press('Tab')
      includes(await ctx.lines(), '结尾  段落。', '光标处插入 2 个空格')
      eq(
        await ctx.cdp.eval(`document.activeElement?.classList.contains('cm-content') === true`),
        true,
        'Tab 后焦点留在编辑器'
      )
      await ctx.press('Tab', 8)
      includes(await ctx.lines(), '结尾段落。', 'Shift+Tab 删掉刚插入的空格')
      // 有选区时仍走整行缩进,与列表项一致
      await ctx.selectWholeLine(line)
      await ctx.press('Tab')
      includes(await ctx.lines(), '  结尾段落。', '选区 Tab 仍是整行缩进')
    }
  },

  {
    id: 'input/column-cursors',
    area: 'input',
    title: 'Cmd+Alt+C 多行选区:在每一行同一列放光标,一次输入同时生效',
    tags: ['input', 'column'],
    fixture: COLUMNS,
    async run(ctx, t) {
      await ctx.selectLines('甲行文字', '乙行文字')
      await ctx.pressLetter('c', 5) // Cmd(4) + Alt(1)
      await sleep(120)
      const cursors = await ctx.cdp.eval(
        `(() => {
          const v = document.querySelector('.notes-editor-pane .cm-content')?.cmTile?.root?.view
          return v === null || v === undefined ? -1 : v.state.selection.ranges.length
        })()`
      )
      eq(cursors, 2, '选区被拆成每行一个光标')
      await ctx.typeText('!')
      const lines = await ctx.lines()
      includes(lines, '甲行文字!', '第一行同一列插入')
      includes(lines, '乙行文字!', '第二行同一列插入')
    }
  }
]
