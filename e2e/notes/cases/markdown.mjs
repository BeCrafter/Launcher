import { eq, includes, ok } from '../lib/assert.mjs'

const HEADINGS = [
  '# 一级标题',
  '',
  '## 二级标题',
  '',
  '### 三级标题',
  '',
  '#### 四级标题',
  '',
  '##### 五级标题',
  '',
  '###### 六级标题',
  '',
  '####### 七级标题',
  '',
  '######## 八级标题',
  '',
  '######### 九级标题',
  '',
  '########## 十级标题'
].join('\n')

const INLINE = [
  '# 行内标记',
  '',
  '**加粗** *斜体* ~~删除~~ ==高亮== `代码` H~2~O x^2^',
  '',
  '[[E2E 链接目标]] 与 #e2e标签'
].join('\n')

const LINK = '# 链接\n\n[[E2E 链接目标]]\n'
const MISSING = '# 链接\n\n[[E2E 新建的笔记]]\n'
const MEDIA = ['# 媒体', '', '![[sample.png]]'].join('\n')
const TASKS = ['# 任务', '', '- [ ] 待办事项'].join('\n')
const TABLE_IMAGE = [
  '# 表格图片',
  '',
  '| 图片 | 说明 |',
  '| --- | --- |',
  '| ![图](assets/sample.png) | 端口排查 先看谁占着 8080。 |'
].join('\n')
const TABLE = [
  '# 表格',
  '',
  '| 列一 | 列二 |',
  '| --- | --- |',
  '| 甲 | 乙 |',
  '',
  '```mermaid',
  'flowchart LR',
  '  A --> B',
  '```'
].join('\n')

export default [
  {
    id: 'markdown/headings-h1-h10',
    area: 'markdown',
    title: '标题:H1–H10 在预览中渲染为对应层级,7 级以上在编辑器里也有着色',
    tags: ['render'],
    fixture: HEADINGS,
    async run(ctx, t) {
      for (let level = 1; level <= 10; level += 1) {
        ok(
          await ctx.cdp.eval(`document.querySelector('.notes-preview-body .md-h${level}') !== null`),
          `预览存在 md-h${level}`
        )
      }
      includes(await ctx.previewText(), '十级标题', '十级标题文本渲染')
      ok(
        (await ctx.cdp.eval(`document.querySelectorAll('.notes-editor-pane .tk-h4').length`)) >= 4,
        'H7–H10 在编辑器里共用 tk-h4 着色'
      )
    }
  },

  {
    id: 'markdown/inline-marks',
    area: 'markdown',
    title: '行内标记:加粗/斜体/删除线/高亮/代码/上下标预览正确,编辑器高亮有着色',
    tags: ['render'],
    fixture: INLINE,
    async run(ctx, t) {
      const html = await ctx.previewHtml()
      includes(html, '<strong>加粗</strong>', '加粗')
      includes(html, '<em>斜体</em>', '斜体')
      includes(html, '<del class="md-del">删除</del>', '删除线')
      includes(html, '<mark class="md-hl">高亮</mark>', '高亮')
      includes(html, '<code class="md-code-inline">代码</code>', '行内代码')
      includes(html, '<sub>2</sub>', '下标')
      includes(html, '<sup>2</sup>', '上标')
      ok(await ctx.cdp.eval(`document.querySelector('.notes-editor-pane .tk-hl') !== null`), '编辑器内 ==高亮== 有 tk-hl 着色')
      ok(await ctx.cdp.eval(`document.querySelector('.notes-editor-pane .tk-wikilink') !== null`), '编辑器内 wikilink 有着色')
      ok(await ctx.cdp.eval(`document.querySelector('.notes-editor-pane .tk-hashtag') !== null`), '编辑器内 #标签 有着色')
    }
  },

  {
    id: 'markdown/wikilink-resolved',
    area: 'markdown',
    title: '已解析 wikilink:预览可点击并打开目标笔记',
    tags: ['links'],
    fixture: LINK,
    async run(ctx, t) {
      ok(
        await ctx.cdp.eval(`document.querySelector('.notes-preview-body a.md-wikilink:not(.unresolved)') !== null`),
        '已解析链接不是 unresolved'
      )
      await ctx.cdp.eval(`document.querySelector('.notes-preview-body a.md-wikilink:not(.unresolved)')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.notes-title')?.value === 'E2E 链接目标'`, {
        message: '跳转到链接目标'
      })
    }
  },

  {
    id: 'markdown/wikilink-unresolved-creates',
    area: 'markdown',
    title: '未解析 wikilink:点击新建同名笔记并打开',
    tags: ['links', 'create'],
    fixture: MISSING,
    async run(ctx, t) {
      ok(
        await ctx.cdp.eval(`document.querySelector('.notes-preview-body a.md-wikilink.unresolved') !== null`),
        '未解析链接带 unresolved'
      )
      await ctx.cdp.eval(`document.querySelector('.notes-preview-body a.md-wikilink.unresolved')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.notes-title')?.value === 'E2E 新建的笔记'`, {
        timeout: 10_000,
        message: '新建并打开目标笔记'
      })
      const rows = await ctx.cdp.json(
        `[...document.querySelectorAll('.notes-row-main')].map((el) => el.textContent ?? '')`
      )
      ok(rows.some((row) => row.includes('E2E 新建的笔记')), '笔记列表出现新笔记')
    }
  },

  {
    id: 'markdown/tag-click-filters-rail',
    area: 'markdown',
    title: '行内标签:可点击,点击后在列表里按标签筛选',
    tags: ['tags'],
    fixture: INLINE,
    async run(ctx, t) {
      ok(await ctx.cdp.eval(`document.querySelector('.notes-preview-body .md-tag') !== null`), '预览渲染 #标签')
      await ctx.cdp.eval(`document.querySelector('.notes-preview-body .md-tag')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.notes-rail-active')?.textContent?.includes('e2e标签')`, {
        message: '列表出现标签筛选 chip'
      })
    }
  },

  {
    id: 'markdown/media-embed-and-lightbox',
    area: 'markdown',
    title: '媒体嵌入:![[sample.png]] 渲染图片,点击打开全屏查看器',
    tags: ['media'],
    fixture: MEDIA,
    async run(ctx, t) {
      await ctx.cdp.waitFor(`document.querySelector('.notes-preview-body img.md-img')?.complete === true`, {
        timeout: 10_000,
        message: '图片加载完成'
      })
      await ctx.cdp.eval(`document.querySelector('.notes-preview-body img.md-img')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.lightbox') !== null`, {
        message: '全屏查看器打开'
      })
      await ctx.press('Escape')
      await ctx.cdp.waitFor(`document.querySelector('.lightbox') === null`, {
        message: 'Escape 关闭全屏查看器'
      })
    }
  },

  {
    id: 'markdown/table-and-mermaid',
    area: 'markdown',
    title: '表格与图表:mermaid 渲染出 SVG,表格呈现为表格',
    tags: ['render'],
    fixture: TABLE,
    async run(ctx, t) {
      ok(await ctx.cdp.eval(`document.querySelector('.notes-preview-body table.md-table') !== null`), '渲染出表格')
      ok(
        (await ctx.cdp.json(`[...document.querySelectorAll('.notes-preview-body .md-table td')].map((el) => el.textContent)`)).includes('甲'),
        '表格单元格内容正确'
      )
      await ctx.cdp.waitFor(`document.querySelector('.notes-preview-body .md-mermaid svg') !== null`, {
        timeout: 15_000,
        message: 'mermaid 渲染出 SVG'
      })
    }
  },

  {
    id: 'markdown/table-cell-image-resize',
    area: 'markdown',
    title: '表格内嵌图片:悬停时缩放角柄贴着图片框右下角,不被表格的新增条留白推离;拖动角柄改宽并写回源码',
    tags: ['media', 'table'],
    fixture: TABLE_IMAGE,
    async run(ctx, t) {
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-preview-body td .md-media-box.resizable') !== null`,
        { message: '表格单元格里的图片可缩放' }
      )
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-preview-body td .md-media-box img.md-img')?.complete === true`,
        { timeout: 10_000, message: '图片加载完成' }
      )

      const handleOpacity = () =>
        ctx.cdp.eval(
          `getComputedStyle(document.querySelector('.notes-preview-body td .md-media-box .md-resize-handle')).opacity`
        )
      eq(await handleOpacity(), '0', '未悬停时图片角柄不可见')

      const imgCenter = await ctx.cdp.json(
        `(() => { const b = document.querySelector('.notes-preview-body td .md-media-box').getBoundingClientRect();
          return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) } })()`
      )
      await ctx.cdp.mouse('mouseMoved', imgCenter.x, imgCenter.y)
      await ctx.cdp.waitFor(
        `getComputedStyle(document.querySelector('.notes-preview-body td .md-media-box .md-resize-handle')).opacity === '1'`,
        { message: '悬停图片后角柄显形' }
      )

      // 角柄的 CSS 是 right/bottom:-7px,基准是图片的 .md-media-box。
      // 表格块给自家角柄让出的 24px 新增条留白**不能**套到格子里的媒体上。
      const geom = await ctx.cdp.json(`(() => {
        const box = document.querySelector('.notes-preview-body td .md-media-box')
        const h = box.querySelector('.md-resize-handle')
        const b = box.getBoundingClientRect()
        const r = h.getBoundingClientRect()
        return {
          boxRight: b.right, boxBottom: b.bottom,
          handleRight: r.right, handleBottom: r.bottom,
          handleX: Math.round(r.x + r.width / 2), handleY: Math.round(r.y + r.height / 2)
        }
      })()`)
      ok(
        Math.abs(geom.handleRight - (geom.boxRight + 7)) <= 2,
        `角柄右边应贴着图片框右缘外 7px:角柄 ${geom.handleRight.toFixed(1)} / 图片框 ${geom.boxRight.toFixed(1)}`
      )
      ok(
        Math.abs(geom.handleBottom - (geom.boxBottom + 7)) <= 2,
        `角柄下边应贴着图片框下缘外 7px:角柄 ${geom.handleBottom.toFixed(1)} / 图片框 ${geom.boxBottom.toFixed(1)}`
      )

      // 悬停表格右下角的新增条留白(不碰图片):图片角柄不能被表格级悬停带出来
      const tableCorner = await ctx.cdp.json(
        `(() => { const b = document.querySelector('.notes-preview-body .md-table-block').getBoundingClientRect();
          return { x: Math.round(b.right - 8), y: Math.round(b.bottom - 8) } })()`
      )
      await ctx.cdp.mouse('mouseMoved', tableCorner.x, tableCorner.y)
      await ctx.cdp.waitFor(
        `getComputedStyle(document.querySelector('.notes-preview-body td .md-media-box .md-resize-handle')).opacity === '0'`,
        { message: '悬停表格留白时,格子里图片的角柄保持隐藏' }
      )

      // 角柄真的能用:按住它往右拖 60px,图片变宽,尺寸写回这一行的源码
      await ctx.cdp.mouse('mouseMoved', geom.handleX, geom.handleY)
      await ctx.cdp.mouse('mousePressed', geom.handleX, geom.handleY, { buttons: 1 })
      await ctx.cdp.mouse('mouseMoved', geom.handleX + 60, geom.handleY, { buttons: 1 })
      await ctx.cdp.mouse('mouseReleased', geom.handleX + 60, geom.handleY, { buttons: 0 })
      await ctx.cdp.waitFor(
        `!document.querySelector('.notes-preview-body td .md-media-box').classList.contains('dragging')`,
        { message: '松开后结束拖拽' }
      )
      await ctx.waitSaved()
      const body = await ctx.savedBody()
      // 表格行里的 `|` 必须转义成 `\|`,否则会把单元格切断 —— 尺寸同样写在这一行的 alt 里
      ok(
        /!\s*\[图\\?\|\d+\]\(assets\/sample\.png\)/.test(body ?? ''),
        `拖动后图片宽度写回源码这一行,实际正文:\n${body}`
      )
    }
  },

  {
    id: 'markdown/mermaid-lightbox',
    area: 'markdown',
    title: '预览图表:点击图表画布打开全屏查看器,Escape 关闭',
    tags: ['render', 'diagram'],
    fixture: TABLE,
    async run(ctx, t) {
      await ctx.cdp.waitFor(`document.querySelector('.notes-preview-body .md-mermaid-canvas svg') !== null`, {
        timeout: 15_000,
        message: '图表渲染出 SVG'
      })
      await ctx.cdp.eval(`document.querySelector('.notes-preview-body .md-mermaid-canvas')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.lightbox .lightbox-svg svg') !== null`, {
        message: '图表全屏查看器打开,且容器里是 SVG'
      })
      await ctx.cdp.key('Escape', 'Escape', 27)
      await ctx.cdp.waitFor(`document.querySelector('.lightbox') === null`, {
        message: 'Escape 关闭图表全屏查看器'
      })
      // 关掉后正文图表仍在,没有误删内容
      ok(
        await ctx.cdp.eval(`document.querySelector('.notes-preview-body .md-mermaid svg') !== null`),
        '关闭查看器后正文图表保留'
      )
    }
  },

  {
    id: 'markdown/preview-task-toggle',
    area: 'markdown',
    title: '预览勾选任务项:源码 - [ ] ↔ - [x] 双向同步',
    tags: ['task', 'preview'],
    fixture: TASKS,
    async run(ctx, t) {
      await ctx.cdp.waitFor(`document.querySelector('.notes-preview-body input.md-task-box') !== null`, {
        message: '预览渲染任务框'
      })
      await ctx.cdp.eval(`document.querySelector('.notes-preview-body input.md-task-box')?.click()`)
      await ctx.cdp.waitFor(`document.body.textContent.includes('- [x] 待办事项')`, {
        message: '勾选后源码变成 [x]'
      })
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-preview-body input.md-task-box')?.checked === true`,
        { message: '预览任务框同步为已勾选' }
      )
      await ctx.cdp.eval(`document.querySelector('.notes-preview-body input.md-task-box')?.click()`)
      await ctx.cdp.waitFor(`document.body.textContent.includes('- [ ] 待办事项')`, {
        message: '取消勾选后源码恢复 [ ]'
      })
    }
  },

  {
    id: 'markdown/preview-task-toggle-preview-only',
    area: 'markdown',
    title: '纯预览模式下勾选任务项:没有编辑器实例也写回源码',
    tags: ['task', 'preview'],
    fixture: TASKS,
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.notes-preview-body input.md-task-box') !== null`, {
        message: '预览渲染任务框'
      })
      await ctx.cdp.eval(`document.querySelector('.notes-preview-body input.md-task-box')?.click()`)
      await ctx.cdp.waitFor(`document.body.textContent.includes('- [x] 待办事项')`, {
        message: '纯预览勾选也能写回源码'
      })
      await ctx.setMode('split')
    }
  }
]
