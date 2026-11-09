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
    .find((el) => el.querySelector('.notes-row-title')?.textContent === ${JSON.stringify(title)})`
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

      // 2) 左侧 18px 缩进也在标题按钮之外。旧行为同样点不中。
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
    id: 'basics/rail-opening-lead',
    area: 'basics',
    title: '打开笔记:转圈浮在行首留白里,标题全程不位移、不占标题宽度',
    tags: ['smoke'],
    fixture: BASIC,
    async run(ctx, t) {
      // 基准:空闲时标题的 x;此刻行首不应有转圈。
      const base = await ctx.cdp.json(`(() => {
        const el = ${rowExpr(LINK_NOTE.title)}
        if (!el) return null
        const r = el.querySelector('.notes-row-title').getBoundingClientRect()
        return {
          titleLeft: r.left,
          titleTop: r.top,
          titleHeight: r.height,
          spin: el.querySelector('.notes-row-spin') !== null
        }
      })()`)
      ok(base !== null, '找到链接笔记行')
      eq(base.spin, false, '空闲时行首没有转圈')

      // 探针:打开很快时转圈只存在一两帧,固定 sleep 采不到。
      // 挂在目标行上的 MutationObserver 会在 IPC 读取回来之前的渲染帧里采到它,
      // 同时记录每一帧标题的 x —— 这正是「文字有没有动」的判据。
      await ctx.cdp.eval(`(() => {
        const el = ${rowExpr(LINK_NOTE.title)}
        const title = el.querySelector('.notes-row-title')
        const probe = { samples: [] }
        const take = () => {
          const spin = el.querySelector('.notes-row-spin')
          const sr = spin?.getBoundingClientRect()
          const tr = title.getBoundingClientRect()
          probe.samples.push({
            spin: spin !== null,
            titleLeft: tr.left,
            titleCenterY: tr.top + tr.height / 2,
            spinLeft: sr ? sr.left : null,
            spinRight: sr ? sr.right : null,
            spinCenterY: sr ? sr.top + sr.height / 2 : null
          })
        }
        take()
        const obs = new MutationObserver(take)
        obs.observe(el, { childList: true, subtree: true })
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

      ok(samples.length >= 2, `探针应采到打开中与完成两帧(实际 ${samples.length} 帧)`)
      const spinSample = samples.find((s) => s.spin)
      ok(spinSample !== undefined, '探针应采到打开中的转圈')
      for (const s of samples) {
        ok(
          Math.abs(s.titleLeft - base.titleLeft) <= 0.5,
          `标题 x 应全程不变:基准 ${base.titleLeft},实际 ${s.titleLeft}(样本 ${JSON.stringify(s)})`
        )
      }
      ok(
        spinSample.spinRight <= base.titleLeft + 0.5,
        `转圈应在标题左侧留白里:转圈右缘 ${spinSample.spinRight},标题左缘 ${base.titleLeft}`
      )
      ok(
        Math.abs(spinSample.spinCenterY - spinSample.titleCenterY) <= 1,
        `转圈应与标题垂直居中对齐:转圈中心 y=${spinSample.spinCenterY},标题中心 y=${spinSample.titleCenterY}`
      )
      eq(samples[samples.length - 1].spin, false, '打开完成后转圈消失')
      eq(await ctx.cdp.eval(`document.querySelectorAll('.notes-row-spin').length`), 0, '打开完成后没有残留转圈')
    }
  }
]
