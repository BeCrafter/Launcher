import { eq, includes, ok } from '../lib/assert.mjs'
import { sleep } from '../lib/cdp.mjs'
import { BASIC, NESTED } from '../lib/fixtures.mjs'

function nonEmpty(lines) {
  return lines.filter((line) => line.trim() !== '')
}

export default [
  {
    id: 'picker/open-and-list',
    area: 'picker',
    title: '块菜单「移动到…」:列出文首、所有标题、文末,搜索框自动聚焦',
    tags: ['picker', 'smoke'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.openMovePicker('第一节第一段。')
      const rows = await ctx.movePickerRows()
      eq(rows.length, 5, '文首 + 3 个标题 + 文末')
      ok(rows.some((row) => row.includes('第一节 甲')), '列出标题「第一节 甲」')
      ok(rows.some((row) => row.includes('一小节 甲一')), '列出标题「一小节 甲一」')
      ok(rows.some((row) => row.includes('第二节 乙')), '列出标题「第二节 乙」')
      eq(
        await ctx.cdp.eval(`document.activeElement?.tagName`),
        'INPUT',
        '搜索框自动获得焦点'
      )
    }
  },

  {
    id: 'picker/search-enter-moves',
    area: 'picker',
    title: '选择器搜索 + 回车:块移动到目标标题之前,面板关闭,焦点回到正文',
    tags: ['picker', 'move'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.openMovePicker('第一节第一段。')
      await ctx.pickerSearch('第二节')
      const rows = await ctx.movePickerRows()
      eq(rows.length, 1, '搜索只留下一个标题')
      includes(rows[0], '第二节 乙', '留下的是「第二节 乙」')
      await ctx.press('Enter')
      await ctx.cdp.waitFor(`document.querySelector('.notes-move-picker') === null`, {
        message: '执行后面板关闭'
      })
      await sleep(300)
      const lines = nonEmpty(await ctx.lines())
      eq(lines[lines.indexOf('# 第二节 乙') - 1], '第一节第一段。', '块落在「第二节 乙」之前')
      ok(
        await ctx.cdp.eval(
          `document.querySelector('.notes-editor-pane .cm-content')?.contains(document.activeElement) === true`
        ),
        '焦点回到编辑器'
      )
    }
  },

  {
    id: 'picker/escape-no-change',
    area: 'picker',
    title: '选择器按 Escape:关闭且不改动正文',
    tags: ['picker', 'cancel'],
    fixture: BASIC,
    async run(ctx, t) {
      const before = await ctx.body()
      await ctx.openMovePicker('第一节第一段。')
      await ctx.press('Escape')
      await ctx.cdp.waitFor(`document.querySelector('.notes-move-picker') === null`, {
        message: 'Escape 关闭面板'
      })
      eq(await ctx.body(), before, '正文没有变化')
    }
  },

  {
    id: 'picker/nested-shows-hint',
    area: 'picker',
    title: '嵌套列表项:没有跨节目标,显示提示而不是空白',
    tags: ['picker', 'nested'],
    fixture: NESTED,
    async run(ctx, t) {
      await ctx.openMovePicker('  - 内层甲一')
      eq(await ctx.cdp.eval(`document.querySelectorAll('.notes-move-row').length`), 0, '没有候选行')
      ok(
        await ctx.cdp.eval(`document.querySelector('.notes-move-picker-empty') !== null`),
        '显示空状态提示'
      )
    }
  },

  {
    id: 'picker/undo-restores',
    area: 'picker',
    title: '选择器移动后撤销:正文顺序恢复',
    tags: ['picker', 'undo'],
    fixture: BASIC,
    async run(ctx, t) {
      const before = await ctx.body()
      await ctx.openMovePicker('第一节第一段。')
      await ctx.pickerSearch('第二节')
      await ctx.press('Enter')
      await sleep(300)
      ok((await ctx.body()) !== before, '移动已生效')
      await ctx.pressLetter('z', 4)
      await sleep(300)
      eq(await ctx.body(), before, '撤销后恢复原顺序')
    }
  },

  {
    id: 'picker/table-target-shows-type',
    area: 'picker',
    title: '没有标题的文档:选择器列出顶层块,并标注类型',
    tags: ['picker', 'fallback'],
    fixture: ['甲段落。', '', '| 列一 | 列二 |', '| --- | --- |', '| 甲 | 乙 |', '', '乙段落。'].join('\n'),
    async run(ctx, t) {
      await ctx.openMovePicker('乙段落。')
      const rows = await ctx.movePickerRows()
      ok(rows.some((row) => row.includes('甲段落。')), '列出段落')
      ok(rows.some((row) => row.includes('列一') || row.includes('表格')), '列出表格目标')
    }
  }
]
