import { statSync } from 'node:fs'
import { join } from 'node:path'
import { eq, includes, ok, excludes } from '../lib/assert.mjs'
import { sleep } from '../lib/cdp.mjs'
import { readNoteBody } from '../lib/app.mjs'
import { BASIC, LINK_NOTE, LONG, MAIN_NOTE } from '../lib/fixtures.mjs'

const VIEW = `document.querySelector('.notes-editor-pane .cm-content')?.cmTile?.root?.view ?? null`

/** 点左侧目录里的某篇笔记(按标题匹配,与 rail 的渲染文案无关) */
function clickRow(title) {
  return `(() => {
    const row = [...document.querySelectorAll('.notes-row-main')]
      .find((el) => el.textContent?.includes(${JSON.stringify(title)}))
    if (!row) return false
    row.click()
    return true
  })()`
}

/**
 * 目录行的 DOM 表达式。热区用例必须用真实坐标点击(`el.click()` 会绕过命中检测,
 * 测不出「点在行的留白上」),所以先按标题拿到行 / 悬停浮层的几何。
 */
function rowExpr(title) {
  return `[...document.querySelectorAll('.notes-row[data-note-id]')]
    .find((el) => el.querySelector('.notes-row-title')?.textContent === ${JSON.stringify(`${title}.md`)})`
}

function railRowExpr(title) {
  return `(() => {
    const row = ${rowExpr(title)}
    if (!row) return null
    const r = row.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  })()`
}

/** 悬停浮层没显示时返回 null(display:none 时量出来的 rect 全是 0) */
function railActsExpr(title) {
  return `(() => {
    const acts = ${rowExpr(title)}?.querySelector('.notes-row-acts')
    if (!acts || getComputedStyle(acts).display === 'none') return null
    const r = acts.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  })()`
}

function actsVisibleExpr(title) {
  return `(() => {
    const acts = ${rowExpr(title)}?.querySelector('.notes-row-acts')
    return acts != null && getComputedStyle(acts).display !== 'none'
  })()`
}

/** 点目录行的第 index 个悬停动作(0 新建笔记 / 1 新建子目录 / 2 改名 / 3 删除)。 */
async function indentFolderAct(ctx, path, index) {
  const clicked = await ctx.cdp.eval(`(() => {
    const row = [...document.querySelectorAll('.notes-folder-row')]
      .find((el) => el.dataset.folderPath === ${JSON.stringify(path)})
    if (row === undefined) return false
    row.querySelectorAll('.notes-folder-acts button')[${index}]?.click()
    return true
  })()`)
  ok(clicked, `找到目录行:${path}`)
}

async function indentCreateRootFolder(ctx, name) {
  await ctx.cdp.eval(`document.querySelectorAll('.notes-new-folder')[1]?.click()`)
  await ctx.cdp.waitFor(`document.querySelector('.notes-folder-edit .notes-folder-input') !== null`, {
    timeout: 5000,
    message: '出现新建目录输入框'
  })
  await ctx.cdp.type(name)
  await ctx.press('Enter')
  await ctx.cdp.waitFor(
    `document.querySelector('.notes-folder-row[data-folder-path=${JSON.stringify(name)}]') !== null`,
    { timeout: 10_000, message: `目录「${name}」出现` }
  )
}

async function indentCreateSubFolder(ctx, parent, name) {
  await indentFolderAct(ctx, parent, 1)
  await ctx.cdp.waitFor(`document.querySelector('.notes-folder-edit .notes-folder-input') !== null`, {
    timeout: 5000,
    message: '出现子目录输入框'
  })
  await ctx.cdp.type(name)
  await ctx.press('Enter')
  const path = `${parent}/${name}`
  await ctx.cdp.waitFor(
    `document.querySelector('.notes-folder-row[data-folder-path=${JSON.stringify(path)}]') !== null`,
    { timeout: 10_000, message: `子目录「${path}」出现` }
  )
}

async function indentCreateNote(ctx, parent, name) {
  await indentFolderAct(ctx, parent, 0)
  await ctx.cdp.waitFor(`document.querySelector('.notes-create-fields .notes-create-name') !== null`, {
    timeout: 5000,
    message: '出现新建笔记输入框'
  })
  await ctx.cdp.eval(
    `(() => { const el = document.querySelector('.notes-create-name'); el?.focus(); el?.select() })()`
  )
  await ctx.cdp.type(name)
  await ctx.press('Enter')
  const id = `${parent}/${name}`
  await ctx.cdp.waitFor(
    `document.querySelector('.notes-row[data-note-id=${JSON.stringify(id)}]') !== null`,
    { timeout: 10_000, message: `笔记「${id}」出现` }
  )
}

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
    id: 'basics/rail-note-suffix',
    area: 'basics',
    title: '左侧目录:笔记行显示完整文件名(标题 + .md),与文件行一样带后缀',
    tags: ['smoke', 'rail'],
    fixture: BASIC,
    async run(ctx) {
      const titles = await ctx.cdp.json(
        `[...document.querySelectorAll('.notes-row[data-note-id] .notes-row-title')]
          .map((el) => el.textContent)`
      )
      ok(Array.isArray(titles) && titles.length >= 2, `目录里有两篇夹具笔记(实际: ${JSON.stringify(titles)})`)
      ok(
        titles.every((t) => typeof t === 'string' && t.endsWith('.md')),
        `所有笔记行都带 .md 后缀(实际: ${JSON.stringify(titles)})`
      )
      ok(titles.includes(`${MAIN_NOTE.title}.md`), '主笔记行显示「标题.md」')
      ok(titles.includes(`${LINK_NOTE.title}.md`), '链接目标笔记行显示「标题.md」')
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
  },

  {
    id: 'basics/switch-note-resets-and-doesnt-rewrite',
    area: 'basics',
    title: '切换笔记:不回写、不标脏,编辑/预览回到顶部,撤销不跨笔记',
    tags: ['smoke', 'persistence', 'history'],
    fixture: LONG,
    async run(ctx, t) {
      // 先离开顶部:换笔记后应回到文首,而不是沿用上一处
      await ctx.setCursor('第12节第6段。这是一段用来撑长度的正文。')
      ok((await ctx.scrollTop()) > 0, '准备态:编辑区已滚离顶部')

      const linkPath = join(ctx.profileDir, 'notes', LINK_NOTE.file)
      const before = statSync(linkPath).mtimeMs

      ok(await ctx.cdp.eval(clickRow(LINK_NOTE.title)), '找到并点击链接笔记行')
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-title')?.value === ${JSON.stringify(LINK_NOTE.title)}`,
        { timeout: 5000, message: '切到链接笔记' }
      )
      eq(await ctx.body(), LINK_NOTE.body, '正文换成链接笔记')

      eq(await ctx.scrollTop(), 0, '换笔记后编辑区回到顶部')
      const head = await ctx.cdp.eval(
        `(() => { const v = ${VIEW}; return v === null ? -1 : v.state.selection.main.head })()`
      )
      eq(head, 0, '换笔记后光标回到文首')
      const previewTop = await ctx.cdp.eval(
        `document.querySelector('.notes-preview')?.scrollTop ?? -1`
      )
      eq(previewTop, 0, '换笔记后预览也回到顶部')

      // 旧行为:整篇替换被当成用户输入 → 新笔记标脏、~900ms 后回写文件
      const deadline = Date.now() + 1600
      while (Date.now() < deadline) {
        eq(statSync(linkPath).mtimeMs, before, '只是打开,不应回写链接笔记')
        eq(
          await ctx.cdp.eval(
            `document.querySelector('.notes-save-state')?.classList.contains('dirty') ?? false`
          ),
          false,
          '只是打开,不应标脏'
        )
        await sleep(120)
      }

      // 撤销栈也不能把上一篇带回来
      await ctx.focus()
      await ctx.pressLetter('z', 4)
      eq(await ctx.body(), LINK_NOTE.body, '撤销不跨笔记:正文仍是链接笔记')
    }
  },

  {
    id: 'basics/switch-while-dirty-saves-previous',
    area: 'basics',
    title: '脏笔记立刻切走:保存转到后台,最后输入仍然落盘',
    tags: ['smoke', 'persistence'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.setCursor('第二节第二段。', '第二节第二段。'.length)
      await ctx.cdp.type('切换前最后一句')
      includes(await ctx.body(), '切换前最后一句', '输入已生效')
      // 不等去抖/保存,立刻切走
      ok(await ctx.cdp.eval(clickRow(LINK_NOTE.title)), '点击链接笔记行')
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-title')?.value === ${JSON.stringify(LINK_NOTE.title)}`,
        { timeout: 5000, message: '切到链接笔记' }
      )
      await ctx.waitForNode(
        async () => (readNoteBody(ctx.profileDir, MAIN_NOTE.file) ?? '').includes('切换前最后一句'),
        '切换前的主笔记输入已落盘',
        { timeout: 5000 }
      )
    }
  },

  {
    id: 'basics/switch-back-cancels-pending',
    area: 'basics',
    title: '连点:先点别的再点回当前笔记,挂起的打开被取消',
    tags: ['smoke'],
    fixture: BASIC,
    async run(ctx, t) {
      // 同一帧里先后点两篇:第一次打开还在读文件,第二次点回当前笔记应把它取消
      ok(
        await ctx.cdp.eval(`(() => {
          const rows = [...document.querySelectorAll('.notes-row-main')]
          const link = rows.find((el) => el.textContent?.includes(${JSON.stringify(LINK_NOTE.title)}))
          const main = rows.find((el) => el.textContent?.includes(${JSON.stringify(MAIN_NOTE.title)}))
          if (!link || !main) return false
          link.click()
          main.click()
          return true
        })()`),
        '找到并连点两行'
      )
      await sleep(400)
      eq(await ctx.currentTitle(), MAIN_NOTE.title, '没有被挂起的打开带到链接笔记')
      includes(await ctx.body(), '第二节第二段。', '正文仍是主笔记')
      eq(
        await ctx.cdp.eval(`document.querySelectorAll('.notes-row-spin').length`),
        0,
        '挂起的打开已经结束(没有残留转圈)'
      )
    }
  },

  {
    id: 'basics/rail-row-hit-area',
    area: 'basics',
    title: '左侧目录:整行可点(缩进、上下留白、悬停动作浮层背景),轻移点击不丢',
    tags: ['smoke'],
    fixture: BASIC,
    async run(ctx, t) {
      const waitTitle = (title) =>
        ctx.cdp.waitFor(
          `document.querySelector('.notes-title')?.value === ${JSON.stringify(title)}`,
          { timeout: 5000, message: `切到「${title}」` }
        )

      // 1) 行高 28、标题按钮只有 16:点上边缘那条 6px 留白。
      //    旧行为:这里落在行 div 上,没有任何 handler —— 点了没反应。
      let rect = await ctx.cdp.json(railRowExpr(LINK_NOTE.title))
      ok(rect !== null, '找到链接笔记行')
      await ctx.cdp.click(rect.left + rect.width / 2, rect.top + 2)
      await waitTitle(LINK_NOTE.title)
      eq(await ctx.cdp.eval(`document.querySelectorAll('.notes-row-spin').length`), 0, '打开结束后没有残留转圈')

      // 2) 左侧 10px 缩进也在标题按钮之外。旧行为同样点不中。
      rect = await ctx.cdp.json(railRowExpr(MAIN_NOTE.title))
      ok(rect !== null, '找到主笔记行')
      await ctx.cdp.click(rect.left + 8, rect.top + rect.height / 2)
      await waitTitle(MAIN_NOTE.title)

      // 3) 悬停动作浮层压在行的右侧,它的背景/内边距不该吞掉点击。
      rect = await ctx.cdp.json(railRowExpr(LINK_NOTE.title))
      await ctx.cdp.mouse('mouseMoved', rect.left + rect.width / 2, rect.top + rect.height / 2)
      await ctx.cdp.waitFor(actsVisibleExpr(LINK_NOTE.title), {
        timeout: 3000,
        message: '悬停后出现动作浮层'
      })
      const acts = await ctx.cdp.json(railActsExpr(LINK_NOTE.title))
      ok(acts !== null, '量出动作浮层')
      const ax = acts.left + 2
      const ay = rect.top + rect.height / 2
      await ctx.cdp.mouse('mouseMoved', ax, ay)
      await ctx.cdp.click(ax, ay)
      await waitTitle(LINK_NOTE.title)
      eq(
        await ctx.cdp.eval(`document.querySelectorAll('.notes-row-rename').length`),
        0,
        '点浮层背景不应进入改名'
      )

      // 3b) 浮层里的按钮本身仍然可点,而且不会顺带打开笔记(stopPropagation 仍在)。
      rect = await ctx.cdp.json(railRowExpr(MAIN_NOTE.title))
      await ctx.cdp.mouse('mouseMoved', rect.left + rect.width / 2, rect.top + rect.height / 2)
      await ctx.cdp.waitFor(actsVisibleExpr(MAIN_NOTE.title), {
        timeout: 3000,
        message: '主笔记行出现动作浮层'
      })
      const btn = await ctx.cdp.json(`(() => {
        const el = ${rowExpr(MAIN_NOTE.title)}?.querySelector('.notes-row-acts button')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { left: r.left, top: r.top, width: r.width, height: r.height }
      })()`)
      ok(btn !== null, '量出改名按钮')
      await ctx.cdp.click(btn.left + btn.width / 2, btn.top + btn.height / 2)
      await ctx.cdp.waitFor(`document.querySelector('.notes-row-rename') !== null`, {
        timeout: 3000,
        message: '进入改名'
      })
      eq(await ctx.currentTitle(), LINK_NOTE.title, '点改名按钮不会切换当前笔记')
      await ctx.press('Escape')
      await ctx.cdp.waitFor(`document.querySelector('.notes-row-rename') === null`, {
        timeout: 3000,
        message: '取消改名'
      })

      // 4) 按下后 1px 位移仍应算一次点击:行是 draggable,
      //    若浏览器把它判成拖拽,click 会被吞掉 —— 这条用例负责发现这种情况。
      rect = await ctx.cdp.json(railRowExpr(MAIN_NOTE.title))
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      await ctx.cdp.mouse('mousePressed', cx, cy, { buttons: 1 })
      await ctx.cdp.mouse('mouseMoved', cx + 1, cy, { buttons: 1 })
      await ctx.cdp.mouse('mouseReleased', cx + 1, cy, { buttons: 0 })
      await waitTitle(MAIN_NOTE.title)
    }
  },

  {
    id: 'basics/rail-opening-spinner-slot',
    area: 'basics',
    title: '打开笔记:转圈替换行首类型图标(同一槽位),标题全程不位移,完成后图标恢复',
    tags: ['smoke'],
    fixture: BASIC,
    async run(ctx, t) {
      // 基准:空闲时类型图标与标题的位置
      const base = await ctx.cdp.json(`(() => {
        const el = ${rowExpr(LINK_NOTE.title)}
        if (!el) return null
        const icon = el.querySelector('.notes-row-main .notes-file-icon')
        const ir = icon?.getBoundingClientRect()
        const tr = el.querySelector('.notes-row-title').getBoundingClientRect()
        return {
          iconPresent: icon !== null,
          iconKind: icon?.dataset.kind ?? null,
          iconClass: icon?.className ?? '',
          iconLeft: ir ? ir.left : null,
          iconTop: ir ? ir.top : null,
          iconWidth: ir ? ir.width : null,
          iconHeight: ir ? ir.height : null,
          titleLeft: tr.left,
          titleCenterY: tr.top + tr.height / 2,
          spin: el.querySelector('.notes-row-spin') !== null
        }
      })()`)
      ok(base !== null, '找到链接笔记行')
      eq(base.spin, false, '空闲时没有转圈')
      eq(base.iconPresent, true, '空闲时显示类型图标')
      eq(base.iconKind, 'markdown', '笔记行图标是 markdown')
      includes(base.iconClass, 'fa-file-lines', '图标字形是 fa-file-lines')

      // 探针挂在稳定的列表容器上:打开时祖先目录自动展开可能重建行,
      // 所以每次采样都重新查询目标行,不缓存节点。
      // 转圈是瞬时状态,固定 sleep 采不到;MutationObserver 能捕获每次 DOM 提交。
      await ctx.cdp.eval(`(() => {
        const list = document.querySelector('.notes-rail-list')
        const probe = { samples: [] }
        const take = () => {
          const el = [...document.querySelectorAll('.notes-row[data-note-id]')]
            .find((row) => row.querySelector('.notes-row-title')?.textContent === ${JSON.stringify(`${LINK_NOTE.title}.md`)})
          if (!el) {
            probe.samples.push({ missing: true })
            return
          }
          const main = el.querySelector('.notes-row-main')
          const spin = el.querySelector('.notes-row-spin')
          const icon = el.querySelector('.notes-row-main .notes-file-icon')
          const sr = spin?.getBoundingClientRect()
          const tr = el.querySelector('.notes-row-title')?.getBoundingClientRect()
          probe.samples.push({
            missing: false,
            spin: spin !== null,
            spinInMain: spin?.closest('.notes-row-main') === main,
            iconPresent: icon !== null,
            opening: el.classList.contains('opening'),
            busy: main?.getAttribute('aria-busy') === 'true',
            titleLeft: tr ? tr.left : null,
            titleCenterY: tr ? tr.top + tr.height / 2 : null,
            spinLeft: sr ? sr.left : null,
            spinTop: sr ? sr.top : null,
            spinWidth: sr ? sr.width : null,
            spinHeight: sr ? sr.height : null,
            spinCenterY: sr ? sr.top + sr.height / 2 : null
          })
        }
        take()
        const obs = new MutationObserver(take)
        obs.observe(list, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'aria-busy']
        })
        probe.stop = () => obs.disconnect()
        window.__railOpeningProbe = probe
      })()`)

      const rect = await ctx.cdp.json(railRowExpr(LINK_NOTE.title))
      await ctx.cdp.click(rect.left + rect.width / 2, rect.top + rect.height / 2)
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-title')?.value === ${JSON.stringify(LINK_NOTE.title)}`,
        { timeout: 5000, message: '切到链接笔记' }
      )

      const samples = await ctx.cdp.json(`(() => {
        window.__railOpeningProbe.stop()
        const out = window.__railOpeningProbe.samples
        delete window.__railOpeningProbe
        return out
      })()`)
      const present = samples.filter((s) => !s.missing)

      ok(present.length >= 2, `探针应采到打开中与完成两帧(实际 ${present.length} 帧)`)
      const spinSample = present.find((s) => s.spin)
      ok(spinSample !== undefined, '探针应采到打开中的转圈')

      ok(spinSample.spinInMain === true, '转圈位于 .notes-row-main 内(替换图标槽位,不是行首浮层)')
      eq(spinSample.iconPresent, false, '转圈出现时类型图标被替换,不并存')
      eq(spinSample.opening, true, '打开中的行带 opening 状态')
      eq(spinSample.busy, true, '打开中的行 aria-busy=true')

      for (const s of present) {
        ok(
          Math.abs(s.titleLeft - base.titleLeft) <= 0.5,
          `标题 x 应全程不变:基准 ${base.titleLeft},实际 ${s.titleLeft}(样本 ${JSON.stringify(s)})`
        )
      }
      ok(
        Math.abs(spinSample.spinLeft - base.iconLeft) <= 0.5 &&
          Math.abs(spinSample.spinWidth - base.iconWidth) <= 0.5 &&
          Math.abs(spinSample.spinTop - base.iconTop) <= 0.5 &&
          Math.abs(spinSample.spinHeight - base.iconHeight) <= 0.5,
        `转圈应与类型图标占同一槽位:图标 ${JSON.stringify(base)} ,转圈 ${JSON.stringify(spinSample)}`
      )
      ok(
        Math.abs(spinSample.spinCenterY - spinSample.titleCenterY) <= 1,
        `转圈应与标题垂直居中对齐:转圈中心 y=${spinSample.spinCenterY},标题中心 y=${spinSample.titleCenterY}`
      )

      eq(present[present.length - 1].spin, false, '打开完成后转圈消失')
      eq(await ctx.cdp.eval(`document.querySelectorAll('.notes-row-spin').length`), 0, '打开完成后没有残留转圈')
      const restored = await ctx.cdp.json(`(() => {
        const el = ${rowExpr(LINK_NOTE.title)}
        const icon = el?.querySelector('.notes-row-main .notes-file-icon')
        return { kind: icon?.dataset.kind ?? null, cls: icon?.className ?? '' }
      })()`)
      eq(restored?.kind, 'markdown', '完成后类型图标恢复')
      includes(restored?.cls ?? '', 'fa-file-lines', '恢复的仍是 Markdown 文件图标')
    }
  },

  {
    id: 'basics/rail-indent-compact',
    area: 'basics',
    title:
      '左侧目录树:去掉折叠三角后目录与文件同列,父子步进 12px、图标/标题同层对齐,点目录名仍可开合',
    tags: ['rail', 'layout'],
    fixture: BASIC,
    async run(ctx) {
      // 共享实例:目录会保留,名字必须全组唯一。
      const A = '缩进甲'
      const B = `${A}/缩进乙`
      const N1 = `${A}/缩进笔记`
      const N2 = `${B}/缩进深层`

      await indentCreateRootFolder(ctx, A)
      await indentCreateSubFolder(ctx, A, '缩进乙')
      await indentCreateNote(ctx, A, '缩进笔记')
      await indentCreateNote(ctx, B, '缩进深层')

      const g = await ctx.cdp.json(`(() => {
        const box = (el) => {
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { left: r.left, top: r.top, width: r.width, height: r.height }
        }
        const folder = (path) => {
          const row = [...document.querySelectorAll('.notes-folder-row')]
            .find((el) => el.dataset.folderPath === path)
          if (!row) return null
          return {
            row: box(row),
            toggle: box(row.querySelector('.notes-folder-toggle')),
            name: box(row.querySelector('.notes-folder-name')),
            icon: box(row.querySelector('.notes-folder-name i')),
            label: box(row.querySelector('.notes-folder-name span')),
            expanded: row.querySelector('.notes-folder-name')?.getAttribute('aria-expanded') ?? null,
            guides: [...row.querySelectorAll(':scope > .notes-guide')].map((el) => el.getBoundingClientRect().left)
          }
        }
        const note = (id) => {
          const row = [...document.querySelectorAll('.notes-row[data-note-id]')]
            .find((el) => el.dataset.noteId === id)
          if (!row) return null
          return {
            row: box(row),
            icon: box(row.querySelector('.notes-row-main .notes-file-icon')),
            title: box(row.querySelector('.notes-row-title')),
            guides: [...row.querySelectorAll(':scope > .notes-guide')].map((el) => el.getBoundingClientRect().left)
          }
        }
        return {
          A: folder(${JSON.stringify(A)}),
          B: folder(${JSON.stringify(B)}),
          N1: note(${JSON.stringify(N1)}),
          N2: note(${JSON.stringify(N2)}),
          main: note(${JSON.stringify(MAIN_NOTE.title)})
        }
      })()`)

      ok(
        g !== null && [g.A, g.B, g.N1, g.N2, g.main].every((v) => v !== null),
        `根目录、子目录、同层笔记、深层笔记都已渲染(实际:${JSON.stringify(g)})`
      )
      const near = (a, b, eps = 0.6) => Math.abs(a - b) <= eps
      const rel = (el, row) => el.left - row.left

      // 1) 前置空隙收窄:根层目录和笔记同一个内容列,标题列也一致
      ok(near(rel(g.A.icon, g.A.row), 10), `根目录图标应在行内 10px(实际 ${rel(g.A.icon, g.A.row)})`)
      ok(near(rel(g.main.icon, g.main.row), 10), `根笔记图标应在行内 10px(实际 ${rel(g.main.icon, g.main.row)})`)
      ok(near(rel(g.main.title, g.main.row), 30), `根笔记标题应在行内 30px(实际 ${rel(g.main.title, g.main.row)})`)

      // 2) 父子步进 = 12
      ok(near(g.B.icon.left - g.A.icon.left, 12), `目录图标步进应为 12(实际 ${g.B.icon.left - g.A.icon.left})`)
      ok(near(g.N2.icon.left - g.N1.icon.left, 12), `笔记图标步进应为 12(实际 ${g.N2.icon.left - g.N1.icon.left})`)

      // 3) 同层跨类型同列
      ok(near(g.B.icon.left, g.N1.icon.left), `同层目录图标/笔记图标应同列(${g.B.icon.left} vs ${g.N1.icon.left})`)
      ok(near(g.B.label.left, g.N1.title.left), `同层目录名/笔记标题应同列(${g.B.label.left} vs ${g.N1.title.left})`)

      // 4) 目录行不再有折叠三角槽,内容从同一列开始
      eq(g.A.toggle, null, '根目录行没有折叠三角')
      eq(g.B.toggle, null, '子目录行没有折叠三角')
      ok(near(rel(g.A.name, g.A.row), 10), `根目录名按钮应在行内 10px(实际 ${rel(g.A.name, g.A.row)})`)
      ok(near(rel(g.B.name, g.B.row), 22), `子目录名按钮应在行内 22px(实际 ${rel(g.B.name, g.B.row)})`)
      ok(near(rel(g.B.icon, g.B.row), 22), `目录图标应贴着内容列(实际 ${rel(g.B.icon, g.B.row)})`)

      // 5) 层级仍可读:导引线数量随层级,落在祖先图标槽中线上
      eq(g.A.guides.length, 0, '根目录没有导引线')
      eq(g.B.guides.length, 1, '子目录有一条导引线')
      eq(g.N1.guides.length, 1, '同层笔记有一条导引线')
      eq(g.N2.guides.length, 2, '深层笔记有两条导引线')
      ok(near(g.N2.guides[0] - g.N2.row.left, 17), `首条导引线应在行内 17px(实际 ${g.N2.guides[0] - g.N2.row.left})`)
      ok(near(g.N2.guides[1] - g.N2.guides[0], 12), `导引线步进应为 12(实际 ${g.N2.guides[1] - g.N2.guides[0]})`)
      ok(near(g.N2.guides[0], g.A.icon.left + 7), '首条导引线对齐根目录图标槽中线')
      ok(near(g.N2.guides[1], g.B.icon.left + 7), '第二条导引线对齐子目录图标槽中线')

      // 6) 行高没有因为去掉三角而变化
      ok(near(g.N1.row.height, 28), `笔记行高应仍为 28(实际 ${g.N1.row.height})`)

      // 7) 三角去掉后,点目录名仍能开合,状态通过 aria-expanded / 文件夹图标表达
      const nameSel = `.notes-folder-row[data-folder-path=${JSON.stringify(B)}] .notes-folder-name`
      let nameRect = await ctx.elementRect(nameSel)
      await ctx.cdp.click(nameRect.x + nameRect.width / 2, nameRect.y + nameRect.height / 2)
      await ctx.cdp.waitFor(
        `(() => {
          const row = document.querySelector('.notes-folder-row[data-folder-path=${JSON.stringify(B)}]')
          const name = row?.querySelector('.notes-folder-name')
          return name?.getAttribute('aria-expanded') === 'false' &&
            name.querySelector('i')?.classList.contains('fa-folder') === true &&
            ![...document.querySelectorAll('.notes-row[data-note-id]')]
              .some((el) => el.dataset.noteId === ${JSON.stringify(N2)})
        })()`,
        { timeout: 3000, message: '折叠后深层笔记行消失、三角位置变成合上的文件夹图标' }
      )

      nameRect = await ctx.elementRect(nameSel)
      await ctx.cdp.click(nameRect.x + nameRect.width / 2, nameRect.y + nameRect.height / 2)
      await ctx.cdp.waitFor(
        `(() => {
          const row = document.querySelector('.notes-folder-row[data-folder-path=${JSON.stringify(B)}]')
          const name = row?.querySelector('.notes-folder-name')
          return name?.getAttribute('aria-expanded') === 'true' &&
            name.querySelector('i')?.classList.contains('fa-folder-open') === true &&
            [...document.querySelectorAll('.notes-row[data-note-id]')]
              .some((el) => el.dataset.noteId === ${JSON.stringify(N2)})
        })()`,
        { timeout: 3000, message: '再点目录名后深层笔记行恢复' }
      )
    }
  }
]
