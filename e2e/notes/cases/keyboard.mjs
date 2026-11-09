import { eq, includes, ok } from '../lib/assert.mjs'
import { sleep } from '../lib/cdp.mjs'
import { BASIC, NESTED, TABLE_AND_DIAGRAM } from '../lib/fixtures.mjs'

const ALT = 1
const ALT_SHIFT = 9

function nonEmpty(lines) {
  return lines.filter((line) => line.trim() !== '')
}

function indexOfText(lines, text) {
  return lines.findIndex((line) => line.trim() === text.trim())
}

export default [
  {
    id: 'keyboard/alt-arrow-sibling',
    area: 'keyboard',
    title: 'Alt+↓ / Alt+↑:块在兄弟之间下移、上移',
    tags: ['keyboard', 'move'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.setCursor('第一节第一段。', 0)
      await ctx.press('ArrowDown', ALT)
      let lines = await ctx.lines()
      ok(indexOfText(lines, '第一节第一段。') > indexOfText(lines, '第一节第二段。'), 'Alt+↓ 下移一个兄弟')
      await ctx.press('ArrowUp', ALT)
      lines = await ctx.lines()
      ok(indexOfText(lines, '第一节第一段。') < indexOfText(lines, '第一节第二段。'), 'Alt+↑ 移回上方')
    }
  },

  {
    id: 'keyboard/alt-down-past-heading',
    area: 'keyboard',
    title: 'Alt+↓ 跨过标题:落到下一节顶部,而不是跳过整节',
    tags: ['keyboard', 'heading'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.setCursor('第一节第二段。', 0)
      await ctx.press('ArrowDown', ALT)
      const lines = nonEmpty(await ctx.lines())
      eq(lines[indexOfText(lines, '## 一小节 甲一')], '## 一小节 甲一', '标题本身没动')
      eq(lines[indexOfText(lines, '## 一小节 甲一') + 1], '第一节第二段。', '段落落在标题之后')
      eq(lines[indexOfText(lines, '## 一小节 甲一') + 2], '甲一正文。', '没有跨到小节之外')
    }
  },

  {
    id: 'keyboard/shift-alt-down-enters-section',
    area: 'keyboard',
    title: 'Shift+Alt+↓:普通块进入下一节顶部',
    tags: ['keyboard', 'cross-section'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.setCursor('第一节第一段。', 0)
      await ctx.press('ArrowDown', ALT_SHIFT)
      const lines = nonEmpty(await ctx.lines())
      const heading = indexOfText(lines, '## 一小节 甲一')
      eq(lines[heading + 1], '第一节第一段。', '段落进入下一个标题之下')
      ok(indexOfText(lines, '第一节第二段。') < indexOfText(lines, '第一节第一段。'), '离开了原来的位置')
    }
  },

  {
    id: 'keyboard/shift-alt-down-heading-section',
    area: 'keyboard',
    title: 'Shift+Alt+↓ 在标题上:整节移动到下一节之后',
    tags: ['keyboard', 'cross-section', 'heading'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.setCursor('# 第一节 甲', 0)
      await ctx.press('ArrowDown', ALT_SHIFT)
      const lines = nonEmpty(await ctx.lines())
      const first = indexOfText(lines, '# 第一节 甲')
      const next = indexOfText(lines, '# 第二节 乙')
      // 移完以后「第二节」会变成文档第一行,不能再要求 next > 0。
      ok(first >= 0 && next >= 0, '两个标题都在')
      ok(first > next, '第一节整节移到第二节之后')
      eq(lines[lines.length - 1], '甲一正文。', '整节子树一起移动到了文末')
    }
  },

  {
    id: 'keyboard/shift-alt-up-before-own-heading',
    area: 'keyboard',
    title: 'Shift+Alt+↑:普通块从本节移到本节标题之前',
    tags: ['keyboard', 'cross-section'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.setCursor('甲一正文。', 0)
      await ctx.press('ArrowUp', ALT_SHIFT)
      const lines = nonEmpty(await ctx.lines())
      ok(
        indexOfText(lines, '甲一正文。') < indexOfText(lines, '## 一小节 甲一'),
        '块移到本节标题之前'
      )
    }
  },

  {
    id: 'keyboard/boundary-consumes-key',
    area: 'keyboard',
    title: '块已到边界:Alt+↓ 不生效,也不退回按行移动',
    tags: ['keyboard', 'boundary'],
    fixture: BASIC,
    async run(ctx, t) {
      const before = await ctx.body()
      await ctx.setCursor('第二节第二段。', 0)
      await ctx.press('ArrowDown', ALT)
      eq(await ctx.body(), before, '最后一个块不移动，也不按行下移光标')
    }
  },

  {
    id: 'keyboard/nested-sibling-only',
    area: 'keyboard',
    title: '嵌套列表项:Alt+↓ 只换同层顺序,Shift+Alt+↓ 无跨节目标',
    tags: ['keyboard', 'nested'],
    fixture: NESTED,
    async run(ctx, t) {
      await ctx.setCursor('  - 内层甲一', 0)
      await ctx.press('ArrowDown', ALT)
      let lines = await ctx.lines()
      ok(
        indexOfText(lines, '  - 内层甲二') < indexOfText(lines, '  - 内层甲一'),
        '两个内层项换序'
      )
      const afterFirst = await ctx.body()
      await ctx.press('ArrowDown', ALT_SHIFT)
      eq(await ctx.body(), afterFirst, '嵌套项没有跨节目标')
    }
  },

  {
    id: 'keyboard/caret-follows-block',
    area: 'keyboard',
    title: '移动后光标跟随块内相对位置,继续输入落在被移动块里',
    tags: ['keyboard', 'caret'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.setCursor('第一节第一段。', 3)
      await ctx.press('ArrowDown', ALT)
      await ctx.cdp.type('X')
      await sleep(150)
      const lines = await ctx.lines()
      ok(lines.includes('第一节X第一段。'), '输入落在被移动块的原相对位置')
      ok(
        indexOfText(lines, '第一节X第一段。') > indexOfText(lines, '第一节第二段。'),
        '块仍处于移动后的位置'
      )
    }
  },

  {
    id: 'keyboard/table-structure-preserved',
    area: 'keyboard',
    title: 'Alt+↓ 移动表格块:表格三行整体移动,结构不拆',
    tags: ['keyboard', 'table'],
    fixture: TABLE_AND_DIAGRAM,
    async run(ctx, t) {
      await ctx.setCursor('| 列一 | 列二 |', 0)
      await ctx.press('ArrowDown', ALT)
      const body = await ctx.lines()
      const header = indexOfText(body, '| 列一 | 列二 |')
      ok(header > indexOfText(body, '表格前的段落。'), '表格下移')
      eq(body[header + 1], '| --- | --- |', '分隔行仍在表头后')
      eq(body[header + 2], '| 甲 | 乙 |', '数据行仍在')
      eq(body.filter((line) => line === '| 列一 | 列二 |').length, 1, '表头未重复')
    }
  },

  {
    id: 'keyboard/undo-restores',
    area: 'keyboard',
    title: '键盘移动后撤销:Cmd+Z 恢复原顺序',
    tags: ['keyboard', 'undo'],
    fixture: BASIC,
    async run(ctx, t) {
      const before = await ctx.body()
      await ctx.setCursor('第一节第一段。', 0)
      await ctx.press('ArrowDown', ALT)
      ok((await ctx.body()) !== before, '移动已生效')
      await ctx.pressLetter('z', 4)
      await sleep(300)
      eq(await ctx.body(), before, '撤销恢复原顺序')
    }
  },

  {
    id: 'keyboard/heading-subtree-moves-as-one',
    area: 'keyboard',
    title: 'Alt+↓ 移动顶层标题:整棵子树一起移动',
    tags: ['keyboard', 'heading'],
    fixture: BASIC,
    async run(ctx, t) {
      // H1 的兄弟只有「# 第二节 乙」,下移即落到第二节整棵子树之后(文末)。
      await ctx.setCursor('# 第一节 甲', 0)
      await ctx.press('ArrowDown', ALT)
      const lines = nonEmpty(await ctx.lines())
      ok(
        indexOfText(lines, '# 第一节 甲') > indexOfText(lines, '# 第二节 乙'),
        `整节落到第二节之后\n${lines.join('\n')}`
      )
      eq(lines[lines.length - 1], '甲一正文。', '子树跟着标题一起移动')
    }
  },

  {
    id: 'keyboard/heading-without-sibling-noop',
    area: 'keyboard',
    title: 'Alt+↓ 在无同层兄弟的标题上:不移动、不吞掉正文',
    tags: ['keyboard', 'heading', 'boundary'],
    fixture: BASIC,
    async run(ctx, t) {
      // 「## 一小节 甲一」唯一的同层块就是它自己 —— 兄弟移动没有落点。
      const before = await ctx.body()
      await ctx.setCursor('## 一小节 甲一', 0)
      await ctx.press('ArrowDown', ALT)
      eq(await ctx.body(), before, '正文顺序不变')
    }
  }
]
