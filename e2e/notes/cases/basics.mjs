import { eq, includes, ok, excludes } from '../lib/assert.mjs'
import { BASIC } from '../lib/fixtures.mjs'

export default [
  {
    id: 'basics/open-note-split',
    area: 'basics',
    title: '打开笔记:编辑区与预览同时渲染,默认分栏',
    tags: ['smoke'],
    fixture: BASIC,
    async run(ctx, t) {
      eq(await ctx.body(), `${BASIC}\n`, '正文与夹具一致')
      ok(await ctx.editorVisible(), '编辑区可见')
      ok(await ctx.previewVisible(), '预览区可见')
      ok(await ctx.previewExists(), '预览正文已渲染')
      const modes = await ctx.cdp.json(
        `[...document.querySelectorAll('.notes-mode-btn')].map((el) => el.getAttribute('aria-pressed'))`
      )
      eq(modes, ['true', 'false', 'false'], '默认选中「分栏」')
      includes(await ctx.previewText(), '第一节第一段。', '预览渲染出正文')
    }
  },

  {
    id: 'basics/autosave',
    area: 'basics',
    title: '输入后自动保存:内容落盘、保存状态回到已保存',
    tags: ['smoke', 'persistence'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.setCursor('第二节第二段。', '第二节第二段。'.length)
      await ctx.cdp.type('自动保存验证')
      await ctx.waitSaved()
      includes(await ctx.savedBody(), '自动保存验证', '笔记文件包含新输入')
      ok(!(await ctx.cdp.eval(`document.querySelector('.notes-save-state')?.classList.contains('dirty')`)), '保存状态不再是未保存')
    }
  },

  {
    id: 'basics/undo-redo',
    area: 'basics',
    title: '撤销 / 重做:一次输入可整体撤销并重做',
    tags: ['smoke', 'history'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.setCursor('第二节第二段。', '第二节第二段。'.length)
      await ctx.cdp.type('撤销测试')
      includes(await ctx.body(), '撤销测试', '输入已生效')
      await ctx.pressLetter('z', 4)
      excludes(await ctx.body(), '撤销测试', '撤销后输入消失')
      await ctx.pressLetter('z', 12)
      includes(await ctx.body(), '撤销测试', '重做后输入恢复')
    }
  },

  {
    id: 'basics/view-modes',
    area: 'basics',
    title: '视图模式:编辑隐藏预览、预览隐藏编辑、分栏两者都在',
    tags: ['smoke'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.setMode('edit')
      ok(await ctx.editorVisible(), '编辑模式:编辑区可见')
      ok(!(await ctx.previewVisible()), '编辑模式:预览隐藏')

      await ctx.setMode('preview')
      ok(!(await ctx.editorVisible()), '预览模式:编辑区隐藏')
      ok(await ctx.previewVisible(), '预览模式:预览可见')

      await ctx.setMode('split')
      ok(await ctx.editorVisible(), '分栏:编辑区可见')
      ok(await ctx.previewVisible(), '分栏:预览可见')
    }
  }
]
