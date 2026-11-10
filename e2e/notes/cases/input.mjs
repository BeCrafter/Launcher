import { eq, includes, ok } from '../lib/assert.mjs'
import { sleep } from '../lib/cdp.mjs'
import { BASIC, NESTED } from '../lib/fixtures.mjs'

const FENCE = ['# 反引号', '', '普通文字。', ''].join('\n')
const WRAP = ['# 反引号升级', '', '待升级的文字。', ''].join('\n')
const LIST = ['# 列表续行', '', '- 外层甲', ''].join('\n')
const TASK = ['# 任务续行', '', '- [] 宽松任务', ''].join('\n')
const COLUMNS = ['# 列选择', '', '甲行文字', '乙行文字', ''].join('\n')

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
    id: 'input/tab-indents-list',
    area: 'input',
    title: 'Tab / Shift+Tab:列表项整行增减一级缩进',
    tags: ['input', 'list', 'tab'],
    fixture: NESTED,
    async run(ctx, t) {
      const line = '  - 内层甲一'
      await ctx.setCursor(line, 0)
      await ctx.press('Tab')
      includes(await ctx.lines(), '    - 内层甲一', 'Tab 增加一级缩进')
      await ctx.press('Tab', 8)
      includes(await ctx.lines(), '  - 内层甲一', 'Shift+Tab 恢复原缩进')
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
