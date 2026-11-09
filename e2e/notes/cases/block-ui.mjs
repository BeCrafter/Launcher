import { eq, includes, ok } from '../lib/assert.mjs'
import { sleep } from '../lib/cdp.mjs'
import { BASIC, FOLD, TABLE_AND_DIAGRAM } from '../lib/fixtures.mjs'

function nonEmpty(lines) {
  return lines.filter((line) => line.trim() !== '')
}

export default [
  {
    id: 'block-ui/hover-handle',
    area: 'block-ui',
    title: '悬停块:出现手柄;标题块还有折叠抓手',
    tags: ['handle', 'smoke'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.hoverLine('第一节第一段。')
      const pill = await ctx.waitPill()
      ok(pill.width > 0, '手柄可见')
      await ctx.hoverLine('## 一小节 甲一')
      await ctx.cdp.waitFor(`document.querySelector('.notes-editor-pane .cm-block-caret') !== null`, {
        message: '标题块出现折叠抓手'
      })
    }
  },

  {
    id: 'block-ui/menu-items',
    area: 'block-ui',
    title: '点击手柄:块菜单打开,包含移动到…等 8 个行操作',
    tags: ['menu', 'smoke'],
    fixture: BASIC,
    async run(ctx, t) {
      const items = await ctx.openBlockMenu('第一节第一段。')
      eq(items.length, 8, '块菜单有 8 个行操作')
      eq(
        items.map((item) => item.danger),
        [false, false, false, false, false, true, false, false],
        '只有「删除」是危险样式'
      )
      // 关闭:点菜单外
      await ctx.cdp.eval(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
      await ctx.cdp.waitFor(`document.querySelector('.notes-block-menu') === null`, {
        message: '菜单外点击关闭'
      })
    }
  },

  {
    id: 'block-ui/menu-duplicate',
    area: 'block-ui',
    title: '块菜单「复制区块」:正文出现两份',
    tags: ['menu'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.openBlockMenu('第一节第二段。')
      await ctx.clickBlockMenuItem(2)
      const lines = await ctx.lines()
      eq(lines.filter((line) => line === '第一节第二段。').length, 2, '段落被复制一份')
    }
  },

  {
    id: 'block-ui/menu-delete',
    area: 'block-ui',
    title: '块菜单「删除」:整块从正文移除',
    tags: ['menu'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.openBlockMenu('第一节第二段。')
      await ctx.clickBlockMenuItem(5)
      ok(!(await ctx.body()).includes('第一节第二段。'), '段落被删除')
      includes(await ctx.body(), '第一节第一段。', '邻块保留')
    }
  },

  {
    id: 'block-ui/menu-insert-rule',
    area: 'block-ui',
    title: '块菜单「分隔线」:在块后插入 ---',
    tags: ['menu'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.openBlockMenu('第一节第二段。')
      await ctx.clickBlockMenuItem(1)
      includes(await ctx.body(), '\n---\n', '插入分隔线')
      ok(await ctx.cdp.eval(`document.querySelector('.notes-preview-body .md-hr') !== null`), '预览渲染分隔线')
    }
  },

  {
    id: 'block-ui/heading-level-conversion',
    area: 'block-ui',
    title: '块菜单标题层级:H1 一键改成 H10',
    tags: ['menu', 'heading'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.openBlockMenu('# 第一节 甲')
      await ctx.cdp.eval(
        `document.querySelectorAll('.notes-block-menu .notes-block-fmt-grid')[0]?.querySelectorAll('button')[9]?.click()`
      )
      await sleep(250)
      includes(await ctx.body(), '########## 第一节 甲', '标题变为 H10')
    }
  },

  {
    id: 'block-ui/fold-toggle',
    area: 'block-ui',
    title: '折叠抓手:折叠隐藏子树,再点展开',
    tags: ['fold'],
    fixture: FOLD,
    async run(ctx, t) {
      await ctx.setCursor('## 子节', 0)
      await ctx.hoverLine('## 子节')
      await ctx.cdp.waitFor(`document.querySelector('.notes-editor-pane .cm-block-caret') !== null`, {
        message: '折叠抓手出现'
      })
      await ctx.cdp.eval(`document.querySelector('.notes-editor-pane .cm-block-caret')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.cm-foldPlaceholder') !== null`, {
        message: '出现折叠占位'
      })
      ok(
        !(await ctx.cdp.eval(
          `[...document.querySelectorAll('.cm-line')].some((el) => el.textContent === '子节正文。')`
        )),
        '折叠后子节正文不可见'
      )
      await ctx.cdp.eval(`document.querySelector('.notes-editor-pane .cm-block-caret')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.cm-foldPlaceholder') === null`, {
        message: '再次点击展开'
      })
      ok(
        await ctx.cdp.eval(
          `[...document.querySelectorAll('.cm-line')].some((el) => el.textContent === '子节正文。')`
        ),
        '展开后子节正文可见'
      )
    }
  },

  {
    id: 'block-ui/list-marker-to-task',
    area: 'block-ui',
    title: '列表项块菜单:无序列表改成任务项',
    tags: ['menu', 'list'],
    fixture: ['# 列表', '', '- 外层甲', '  - 内层甲一', ''].join('\n'),
    async run(ctx, t) {
      await ctx.openBlockMenu('- 外层甲')
      await ctx.cdp.eval(
        `document.querySelectorAll('.notes-block-list-styles button')[2]?.click()`
      )
      await sleep(250)
      includes(await ctx.body(), '- [ ] 外层甲', '列表项变成任务项')
      ok(await ctx.cdp.eval(`document.querySelector('.notes-editor-pane .tk-task') !== null`), '任务标记 tk-task 着色')
    }
  },

  {
    id: 'block-ui/table-menu',
    area: 'block-ui',
    title: '表格块菜单:显示表格设置(边框/对齐/行列)',
    tags: ['menu', 'table'],
    fixture: TABLE_AND_DIAGRAM,
    async run(ctx, t) {
      await ctx.openBlockMenu('| 列一 | 列二 |')
      ok(
        await ctx.cdp.eval(`document.querySelector('.notes-block-menu.notes-block-menu-table') !== null`),
        '菜单切到表格模式'
      )
      ok(
        await ctx.cdp.eval(`document.querySelector('.notes-block-menu .notes-table-settings') !== null`),
        '显示表格设置面板'
      )
    }
  },

  {
    id: 'block-ui/table-add-column',
    area: 'block-ui',
    title: '表格设置「末尾加列」:表头/分隔行/数据行同时多一列',
    tags: ['menu', 'table'],
    fixture: TABLE_AND_DIAGRAM,
    async run(ctx, t) {
      await ctx.openBlockMenu('| 列一 | 列二 |')
      await ctx.cdp.eval(
        `document.querySelectorAll('.notes-block-menu .notes-table-rowcols button')[3]?.click()`
      )
      await sleep(250)
      const rows = (await ctx.lines()).filter((line) => line.trim().startsWith('|'))
      eq(rows.length, 3, '表格仍是三行(表头 + 分隔 + 数据)')
      eq(
        rows.map((line) => line.split('|').length),
        [5, 5, 5],
        '三行都变成三列(| a | b | c | → 5 段)'
      )
    }
  },

  {
    id: 'block-ui/menu-insert-below-text',
    area: 'block-ui',
    title: '块菜单「插入到下方」→ 文本:在块后新起一段并聚焦',
    tags: ['menu', 'insert'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.openBlockMenu('第一节第二段。')
      await ctx.clickBlockMenuItem(0)
      await ctx.cdp.waitFor(`document.querySelector('.notes-insert-menu') !== null`, {
        message: '插入菜单打开'
      })
      await ctx.cdp.eval(`document.querySelector('.notes-insert-grid button')?.click()`)
      await sleep(200)
      await ctx.typeText('插入的新段落。')
      const lines = nonEmpty(await ctx.lines())
      const inserted = lines.indexOf('插入的新段落。')
      ok(inserted >= 0, '新段落已写入')
      eq(lines[inserted - 1], '第一节第二段。', '紧跟在来源块之后')
      ok(lines.indexOf('## 一小节 甲一') > inserted, '没有插错到别的小节')
    }
  },

  {
    id: 'block-ui/menu-diagram-dialog',
    area: 'block-ui',
    title: '块菜单「图表」:打开图表对话框,插入 mermaid 围栏',
    tags: ['menu', 'diagram'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.openBlockMenu('第一节第二段。')
      await ctx.clickBlockMenuItem(6)
      await ctx.cdp.waitFor(`document.querySelector('.diagram-box') !== null`, {
        message: '图表对话框打开'
      })
      await ctx.cdp.eval(`document.querySelector('.diagram-box .modal-footer .d-btn.accent')?.click()`)
      await ctx.cdp.waitFor(`document.body.textContent.includes('\`\`\`mermaid')`, {
        message: '正文写入 mermaid 围栏'
      })
      const body = await ctx.body()
      includes(body, '```mermaid', '围栏开头')
      eq(body.split('```mermaid').length - 1, 1, '只插入一张图')
      includes(body, '```\n## 一小节 甲一', '图表块独立成块,没有粘住下一个标题')
    }
  },

  {
    id: 'block-ui/menu-insert-below-heading',
    area: 'block-ui',
    title: '块菜单「插入到下方」→ 标题:新标题独占一行,不粘住后一个块',
    tags: ['menu', 'insert', 'heading'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.openBlockMenu('第一节第二段。')
      await ctx.clickBlockMenuItem(0)
      await ctx.cdp.waitFor(`document.querySelector('.notes-insert-menu') !== null`, {
        message: '插入菜单打开'
      })
      await ctx.cdp.eval(`document.querySelectorAll('.notes-insert-grid button')[2]?.click()`)
      await sleep(200)
      await ctx.typeText('新插入的标题')
      const lines = await ctx.lines()
      includes(lines, '## 新插入的标题', '新标题独占一行')
      includes(lines, '## 一小节 甲一', '原标题原样保留')
      ok(
        lines.indexOf('## 新插入的标题') < lines.indexOf('## 一小节 甲一'),
        '新标题落在来源块之后、原下一块之前'
      )
    }
  },

  {
    id: 'block-ui/menu-embed-dialog',
    area: 'block-ui',
    title: '块菜单「嵌入」:输入相对地址后插入 embed 围栏',
    tags: ['menu', 'embed'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.openBlockMenu('第一节第二段。')
      await ctx.clickBlockMenuItem(7)
      await ctx.cdp.waitFor(`document.querySelector('.embed-box') !== null`, {
        message: '嵌入对话框打开'
      })
      await ctx.cdp.eval(`document.querySelector('.embed-input')?.focus()`)
      await ctx.cdp.type('assets/report.html')
      await ctx.cdp.waitFor(
        `document.querySelector('.embed-box .modal-footer .d-btn.accent')?.disabled === false`,
        { message: '「插入」按钮可用' }
      )
      await ctx.cdp.eval(`document.querySelector('.embed-box .modal-footer .d-btn.accent')?.click()`)
      await ctx.cdp.waitFor(`document.body.textContent.includes('assets/report.html')`, {
        message: '正文写入嵌入地址'
      })
      includes(await ctx.body(), '```embed assets/report.html', '插入 embed 围栏')
      includes(await ctx.body(), '```\n## 一小节 甲一', '嵌入块独立成块,没有粘住下一个标题')
    }
  }
]
