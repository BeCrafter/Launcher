import { eq, includes, ok } from '../lib/assert.mjs'
import { sleep } from '../lib/cdp.mjs'

const PLAIN = '# 选区工具条\n\n普通文字。'
const STYLED = '# 清除格式\n\n**加粗**普通'
const MULTI = '# 多行列表\n\n第一行文字\n第二行文字'
const FENCE = ['# 代码块', '', '```', '代码里的文字', '```', ''].join('\n')

export default [
  {
    id: 'toolbar/bubble-actions-plain',
    area: 'toolbar',
    title: '选中普通文字:浮条出现,显示套格式动作、隐藏「清除格式」',
    tags: ['selection'],
    fixture: PLAIN,
    async run(ctx, t) {
      await ctx.selectRange('普通文字。', 0, 2)
      const actions = await ctx.waitBubble()
      includes(actions, 'bold', '有加粗')
      includes(actions, 'italic', '有斜体')
      includes(actions, 'highlight', '有高亮')
      includes(actions, 'link', '有链接')
      ok(!actions.includes('clear'), '没有可清格式时不显示「清除格式」')
    }
  },

  {
    id: 'toolbar/bubble-bold-wraps',
    area: 'toolbar',
    title: '浮条加粗:给选区套 ** 并在预览里生效',
    tags: ['selection', 'format'],
    fixture: PLAIN,
    async run(ctx, t) {
      await ctx.selectRange('普通文字。', 0, 2)
      await ctx.waitBubble()
      await ctx.clickBubble('bold')
      includes(await ctx.body(), '**普通**文字。', '正文套上 **')
      includes(await ctx.previewHtml(), '<strong>普通</strong>', '预览渲染为加粗')
    }
  },

  {
    id: 'toolbar/bubble-highlight-wraps',
    area: 'toolbar',
    title: '浮条高亮:套 == 并渲染为 mark',
    tags: ['selection', 'format'],
    fixture: PLAIN,
    async run(ctx, t) {
      await ctx.selectRange('普通文字。', 0, 2)
      await ctx.waitBubble()
      await ctx.clickBubble('highlight')
      includes(await ctx.body(), '==普通==文字。', '正文套上 ==')
      includes(await ctx.previewHtml(), '<mark class="md-hl">普通</mark>', '预览渲染为高亮')
    }
  },

  {
    id: 'toolbar/bubble-clear-removes-marks',
    area: 'toolbar',
    title: '清除格式:去掉包住选区的一对标记,文本保留',
    tags: ['selection', 'format'],
    fixture: STYLED,
    async run(ctx, t) {
      await ctx.selectRange('**加粗**普通', 2, 4)
      const actions = await ctx.waitBubble()
      includes(actions, 'clear', '有可清内容时出现「清除格式」')
      await ctx.clickBubble('clear')
      const line = (await ctx.lines()).find((text) => text.includes('普通'))
      eq(line, '加粗普通', '标记被去掉,文本保留')
    }
  },

  {
    id: 'toolbar/bubble-inline-code-only-clear',
    area: 'toolbar',
    title: '选中行内代码:浮条只保留「清除格式」',
    tags: ['selection', 'format'],
    fixture: ['# 行内代码', '', '前 `代码` 后'].join('\n'),
    async run(ctx, t) {
      await ctx.selectRange('前 `代码` 后', 3, 5)
      const actions = await ctx.waitBubble()
      eq(actions, ['clear'], '只剩清除格式')
    }
  },

  {
    id: 'toolbar/bubble-hidden-in-code-fence',
    area: 'toolbar',
    title: '选中围栏代码块里的文字:不弹浮条',
    tags: ['selection', 'code'],
    fixture: FENCE,
    async run(ctx, t) {
      await ctx.selectRange('代码里的文字', 0, 3)
      await sleep(250)
      ok(!(await ctx.bubbleVisible()), '代码块里不出现浮条')
    }
  },

  {
    id: 'toolbar/heading-picker-h10',
    area: 'toolbar',
    title: '工具栏标题选择器:H10 作用于当前行',
    tags: ['toolbar', 'heading'],
    fixture: PLAIN,
    async run(ctx, t) {
      await ctx.setCursor('普通文字。', 0)
      await ctx.toolbarGroup(0)
      await ctx.cdp.waitFor(`document.querySelector('.notes-heading-picker') !== null`, {
        message: '标题选择器打开'
      })
      await ctx.cdp.eval(`document.querySelectorAll('.notes-heading-picker button')[9]?.click()`)
      await sleep(200)
      includes(await ctx.body(), '########## 普通文字。', '当前行变成 H10')
      ok(
        await ctx.cdp.eval(`document.querySelector('.notes-preview-body .md-h10') !== null`),
        '预览渲染为 md-h10'
      )
    }
  },

  {
    id: 'toolbar/list-picker-multi-line',
    area: 'toolbar',
    title: '工具栏列表选择器:选中多行时一次改成有序列表',
    tags: ['toolbar', 'list'],
    fixture: MULTI,
    async run(ctx, t) {
      await ctx.selectLines('第一行文字', '第二行文字')
      await ctx.toolbarGroup(1)
      await ctx.cdp.waitFor(`document.querySelector('.notes-list-picker') !== null`, {
        message: '列表选择器打开'
      })
      await ctx.cdp.eval(`document.querySelectorAll('.notes-list-picker button')[1]?.click()`)
      await sleep(250)
      const lines = await ctx.lines()
      ok(lines.includes('1. 第一行文字'), '第一行成为有序列表')
      ok(lines.includes('1. 第二行文字'), '第二行也成为有序列表')
    }
  },

  {
    id: 'toolbar/quote-picker',
    area: 'toolbar',
    title: '工具栏引用选择器:当前行变成普通引用',
    tags: ['toolbar', 'quote'],
    fixture: PLAIN,
    async run(ctx, t) {
      await ctx.setCursor('普通文字。', 0)
      await ctx.toolbarGroup(2)
      await ctx.cdp.waitFor(`document.querySelector('.notes-quote-picker') !== null`, {
        message: '引用选择器打开'
      })
      await ctx.cdp.eval(`document.querySelectorAll('.notes-quote-picker button')[0]?.click()`)
      await sleep(250)
      includes(await ctx.body(), '> 普通文字。', '当前行变成引用')
      ok(await ctx.cdp.eval(`document.querySelector('.notes-preview-body .md-quote') !== null`), '预览渲染引用')
    }
  },

  {
    id: 'toolbar/table-picker',
    area: 'toolbar',
    title: '工具栏表格选择器:插入 3×3 表格骨架并在预览渲染',
    tags: ['toolbar', 'table'],
    fixture: PLAIN,
    async run(ctx, t) {
      await ctx.setCursor('普通文字。', '普通文字。'.length)
      await ctx.toolbarGroup(3)
      await ctx.cdp.waitFor(`document.querySelector('.notes-table-picker') !== null`, {
        message: '表格选择器打开'
      })
      await ctx.cdp.eval(`document.querySelector('.notes-table-cell[aria-label="3 × 3"]')?.click()`)
      await sleep(350)
      const body = await ctx.body()
      includes(body, '| --- |', '插入分隔行')
      const tableLines = body.split('\n').filter((line) => line.trim().startsWith('|'))
      eq(tableLines.length, 4, '3×3 表格 = 表头 + 分隔 + 2 行(表头占掉一行)')
      ok(await ctx.cdp.eval(`document.querySelector('.notes-preview-body table.md-table') !== null`), '预览渲染表格')
    }
  }
]
