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

/** 目录行(按 path)。找不到时返回 undefined,调用方用 == null 判断。 */
function railFolderRowExpr(path) {
  return `[...document.querySelectorAll('.notes-folder-row')]
    .find((el) => el.dataset.folderPath === ${JSON.stringify(path)})`
}

/** 笔记行(按 data-note-id)。 */
function railNoteRowExpr(id) {
  return `document.querySelector('.notes-row[data-note-id=${JSON.stringify(id)}]')`
}

/** 整列唯一的悬停色块:几何、透明度与命中设置 */
function railHoverPillExpr() {
  return `(() => {
    const el = document.querySelector('.notes-rail-hover')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      left: r.left, top: r.top, width: r.width, height: r.height,
      opacity: Number(cs.opacity), pointerEvents: cs.pointerEvents,
      background: cs.backgroundColor, hidden: el.getAttribute('aria-hidden')
    }
  })()`
}

/** 色块是否贴在某个行矩形上(1px 容差:色块走 transform,对齐由脚本量矩形得到) */
function railHoverAtExpr(rect) {
  return `(() => {
    const p = document.querySelector('.notes-rail-hover')
    if (!p) return false
    const r = p.getBoundingClientRect()
    return Number(getComputedStyle(p).opacity) >= 0.99 &&
      Math.abs(r.left - ${rect.left}) <= 1 && Math.abs(r.top - ${rect.top}) <= 1 &&
      Math.abs(r.width - ${rect.width}) <= 1 && Math.abs(r.height - ${rect.height}) <= 1
  })()`
}

/** 取计算颜色的 alpha;用于断言“行自己不再铺底、只有色块有底色” */
function colorAlpha(color) {
  if (color === 'transparent') return 0
  if (color.startsWith('rgba')) return Number(color.slice(color.lastIndexOf(',') + 1, -1))
  return 1
}

/** 文件行(按 data-file-path)。找不到时返回 null。 */
function railFileRowExpr(path) {
  return `document.querySelector('.notes-row[data-file-path=${JSON.stringify(path)}]')`
}

/** 选中色块:几何、透明度、命中设置与可见标记 */
function railSelectionPillExpr() {
  return `(() => {
    const el = document.querySelector('.notes-rail-selection')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      left: r.left, top: r.top, width: r.width, height: r.height,
      opacity: Number(cs.opacity), pointerEvents: cs.pointerEvents,
      background: cs.backgroundColor, hidden: el.getAttribute('aria-hidden'),
      visible: el.dataset.visible ?? null
    }
  })()`
}

/** 选中色块是否贴在某个行表达式对应的行上(1px 容差,与悬停色块一致) */
function railSelectionAtRowExpr(rowExpression) {
  return `(() => {
    const row = ${rowExpression}
    const p = document.querySelector('.notes-rail-selection')
    if (!row || !p) return false
    const rr = row.getBoundingClientRect()
    const pr = p.getBoundingClientRect()
    return p.dataset.visible === 'true' &&
      Number(getComputedStyle(p).opacity) >= 0.99 &&
      Math.abs(pr.left - rr.left) <= 1 && Math.abs(pr.top - rr.top) <= 1 &&
      Math.abs(pr.width - rr.width) <= 1 && Math.abs(pr.height - rr.height) <= 1
  })()`
}

/** 真实鼠标点击某一行:先移到行中心再按下 / 抬起,与用户点击同一条链路。 */
async function realClickRow(ctx, rowExpression) {
  const point = await ctx.cdp.json(`(() => {
    const el = ${rowExpression}
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  ok(point !== null, '目标行可见')
  await ctx.cdp.mouse('mouseMoved', point.x, point.y)
  await ctx.cdp.click(point.x, point.y)
}

/** 每帧记录选中色块的 top/left/opacity,用来证明它在行间滑动而不是瞬移。 */
async function startRailSelectionProbe(ctx) {
  await ctx.cdp.eval(`(() => {
    const samples = []
    let raf = 0
    const tick = () => {
      const p = document.querySelector('.notes-rail-selection')
      if (p) {
        const r = p.getBoundingClientRect()
        samples.push({ top: r.top, left: r.left, opacity: Number(getComputedStyle(p).opacity) })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    window.__railSelectionProbe = { samples, stop: () => cancelAnimationFrame(raf) }
    return true
  })()`)
  await ctx.cdp.eval(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`
  )
}

async function stopRailSelectionProbe(ctx) {
  return ctx.cdp.eval(`(() => {
    const p = window.__railSelectionProbe
    if (!p) return []
    p.stop()
    delete window.__railSelectionProbe
    return p.samples
  })()`)
}

async function indentCreateRootFolder(ctx, name) {
  await ctx.newDoc('folder')
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
  await ctx.openFolderNewMenu(parent)
  await ctx.pickNew('folder')
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
  await ctx.openFolderNewMenu(parent)
  await ctx.pickNew('note')
  await ctx.cdp.waitFor(`document.querySelector('.notes-create-fields .notes-create-name') !== null`, {
    timeout: 5000,
    message: '出现新建笔记输入框'
  })
  // 挂上时已经只选中主名。再全选会把 .md 一起冲掉,打出来的就不是笔记了。
  await ctx.cdp.eval(`document.querySelector('.notes-create-name')?.focus()`)
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
    id: 'basics/header-align',
    area: 'basics',
    title: '头部对齐:拖动带 12px + 标题行/工具条合计 54px(24+30),标题与目录名同字号,rail 右线为渐变、搜索行底线通栏',
    tags: ['smoke', 'header', 'layout'],
    fixture: BASIC,
    async run(ctx) {
      // 目录树默认展开;若被前序用例折叠了先展开,让 rail 搜索行也参与对齐断言
      if (await ctx.cdp.eval(`document.querySelector('.notes-rail-top') === null`)) {
        await ctx.cdp.eval(`document.querySelector('.notes-hd .notes-rail-toggle')?.click()`)
        await ctx.cdp.waitFor(`document.querySelector('.notes-rail-top') !== null`, {
          message: '展开目录树后出现搜索行'
        })
      }

      const geo = await ctx.cdp.json(`(() => {
        const box = (sel) => {
          const el = document.querySelector(sel)
          if (el === null) return null
          const r = el.getBoundingClientRect()
          return { top: r.top, bottom: r.bottom, height: r.height }
        }
        const text = (sel) => {
          const el = document.querySelector(sel)
          if (el === null) return null
          const cs = getComputedStyle(el)
          return { fontSize: parseFloat(cs.fontSize), color: cs.color }
        }
        return {
          titlebar: box('.titlebar-drag'),
          sidebar: box('.sidebar-header'),
          hd: box('.notes-hd'),
          meta: box('.notes-meta'),
          railTop: box('.notes-rail-top'),
          title: text('.notes-title'),
          rowTitle: text('.notes-row-title'),
          pathExt: text('.notes-path-ext')
        }
      })()`)
      ok(
        geo.titlebar !== null && geo.sidebar !== null && geo.hd !== null && geo.meta !== null,
        '拖动带、标题行、工具条行与左侧栏头都在'
      )
      const near = (a, b) => Math.abs(a - b) <= 1
      // 几何不允许 1px 误差:border-box 下少算底边 1px 会让工具条长到 31px、底线错开 1px,
      // 以前的 1px 容差正好把这个问题吃掉(踩过),所以对齐/高度改用 0.5px。
      const tight = (a, b) => Math.abs(a - b) <= 0.5
      ok(tight(geo.titlebar.height, 12), `拖动带高度 ${geo.titlebar.height}px,应为 12px`)
      ok(
        tight(geo.hd.top, geo.titlebar.bottom),
        `标题行顶边(${geo.hd.top})应紧贴拖动带下沿(${geo.titlebar.bottom})`
      )
      ok(
        tight(geo.hd.top, geo.sidebar.top),
        `标题行顶边(${geo.hd.top})与左侧栏头顶边(${geo.sidebar.top})齐平`
      )
      ok(tight(geo.hd.height, 24), `标题行高度 ${geo.hd.height}px,应为 24px`)
      ok(tight(geo.meta.height, 30), `工具条行高度 ${geo.meta.height}px,应为 30px`)
      ok(
        tight(geo.hd.height + geo.meta.height, 54),
        `标题行 + 工具条合计 ${geo.hd.height + geo.meta.height}px,应为 54px`
      )
      ok(
        tight(geo.meta.bottom, geo.sidebar.bottom),
        `工具条底线(${geo.meta.bottom})与左侧栏头底线(${geo.sidebar.bottom})对齐`
      )
      ok(
        geo.railTop !== null && near(geo.railTop.bottom, geo.sidebar.bottom),
        `目录树搜索行底线(${geo.railTop?.bottom})与左侧栏头底线(${geo.sidebar.bottom})对齐`
      )
      // 搜索行底边画通栏细线:与左侧栏头 / 右侧工具条用同一枚 --border,
      // 加上上面 railTop.bottom === sidebar.bottom,三列在 y=66 接成一条完整的头部分界线。
      const railBorder = await ctx.cdp.json(`(() => {
        const rail = getComputedStyle(document.querySelector('.notes-rail-top'))
        const sidebar = getComputedStyle(document.querySelector('.sidebar-header'))
        return { width: rail.borderBottomWidth, color: rail.borderBottomColor, sidebarColor: sidebar.borderBottomColor }
      })()`)
      ok(railBorder.width === '1px', `搜索行底边应为 1px 通栏细线,实际 ${railBorder.width}`)
      ok(
        railBorder.color === railBorder.sidebarColor,
        `搜索行底线色(${railBorder.color})应与左侧栏头底线(${railBorder.sidebarColor})一致`
      )

      // rail 右侧竖线:与左侧边栏同款,靠 ::after 的渐变绘制,不再用 border-right
      const railLine = await ctx.cdp.json(`(() => {
        const el = document.querySelector('.notes-rail')
        return {
          borderRight: getComputedStyle(el).borderRightWidth,
          afterBg: getComputedStyle(el, '::after').backgroundImage
        }
      })()`)
      ok(railLine.borderRight === '0px', `rail 不应再有 border-right,实际 ${railLine.borderRight}`)
      ok(
        railLine.afterBg.includes('linear-gradient'),
        `rail 右侧竖线应为渐变,实际 ${railLine.afterBg}`
      )

      // 标题字号与目录/列表名一致,层级靠颜色区分(标题 --text,路径后缀 --dim)
      ok(geo.title !== null && geo.rowTitle !== null, '笔记标题与列表标题都在')
      ok(
        geo.title.fontSize === geo.rowTitle.fontSize,
        `标题字号(${geo.title.fontSize})应与列表名(${geo.rowTitle.fontSize})一致`
      )
      ok(
        geo.pathExt !== null && geo.title.color !== geo.pathExt.color,
        `标题颜色(${geo.title.color})应与路径后缀(${geo.pathExt?.color})不同`
      )

      // 工具条降一档 + 上紧下松:最高控件是视图切换组(1px 边框 + 20px 按钮 = 22px)
      const tuning = await ctx.cdp.json(`(() => {
        const meta = document.querySelector('.notes-meta')
        const cs = getComputedStyle(meta)
        const input = document.querySelector('.notes-tag-input')
        const modes = document.querySelector('.notes-modes')
        const btn = document.querySelector('.notes-mode-btn')
        return {
          paddingTop: cs.paddingTop,
          paddingBottom: cs.paddingBottom,
          inputColor: input ? getComputedStyle(input).color : null,
          placeholderColor: input ? getComputedStyle(input, '::placeholder').color : null,
          // 占位符应落到 --dim:拿同一枚 token 的路径后缀作对照,而不是和输入色比(UA 占位符本就不同色)
          pathExtColor: getComputedStyle(document.querySelector('.notes-path-ext')).color,
          modesHeight: modes ? modes.getBoundingClientRect().height : null,
          modeBtnHeight: btn ? btn.getBoundingClientRect().height : null
        }
      })()`)
      ok(
        tuning.paddingTop === '2px' && tuning.paddingBottom === '5px',
        `工具条应上紧下松(上 2px / 下 5px + 底边 1px),实际 ${tuning.paddingTop} / ${tuning.paddingBottom}`
      )
      ok(
        tuning.placeholderColor !== null && tuning.placeholderColor === tuning.pathExtColor,
        `标签占位符颜色(${tuning.placeholderColor})应等于 --dim(路径后缀 ${tuning.pathExtColor}),而不是输入文字色(${tuning.inputColor})`
      )
      ok(tight(tuning.modesHeight, 22), `视图切换组高 ${tuning.modesHeight}px,应为 22px`)
      ok(tight(tuning.modeBtnHeight, 20), `视图切换按钮高 ${tuning.modeBtnHeight}px,应为 20px`)
    }
  },

  {
    id: 'basics/header-drag-title',
    area: 'basics',
    title: '标题行是窗口拖动区,标题输入框与按钮 no-drag:点标题仍能聚焦并输入',
    tags: ['smoke', 'header', 'layout'],
    fixture: BASIC,
    async run(ctx) {
      const regions = await ctx.cdp.json(`(() => {
        const region = (el) =>
          el === null ? null : getComputedStyle(el).getPropertyValue('-webkit-app-region')
        return {
          // 正值对照:顶部色带必须读得到 drag,否则说明这个 Electron 版本不暴露该计算值
          titlebar: region(document.querySelector('.titlebar-drag')),
          hd: region(document.querySelector('.notes-hd')),
          input: region(document.querySelector('.notes-title')),
          toggle: region(document.querySelector('.notes-hd .notes-rail-toggle')),
          action: region(document.querySelector('.notes-hd-actions button'))
        }
      })()`)
      eq(regions.titlebar, 'drag', '对照组:顶部色带的计算值可读,为 drag')
      eq(regions.hd, 'drag', '标题行本身参与窗口拖动')
      eq(regions.input, 'no-drag', '标题输入框不参与拖动,点击仍然进入编辑')
      eq(regions.toggle, 'no-drag', '折叠按钮不参与拖动')
      eq(regions.action, 'no-drag', '标题行动作按钮不参与拖动')

      // CDP 的合成鼠标事件直接进渲染层,绕过 macOS 的非客户区命中测试;
      // 所以这一段只证明「输入框仍然可编辑」,真正的 drag/no-drag 判定由上面的计算样式负责。
      // 用真实鼠标坐标点到标题文字末尾:输入框必须聚焦,且能正常输入
      const caret = await ctx.cdp.json(`(() => {
        const r = document.querySelector('.notes-title').getBoundingClientRect()
        return { x: r.right - 3, y: r.top + r.height / 2 }
      })()`)
      await ctx.cdp.click(caret.x, caret.y)
      await ctx.cdp.waitFor(
        `document.activeElement?.classList.contains('notes-title') === true`,
        { message: '点击标题后输入框获得焦点' }
      )
      const before = await ctx.cdp.eval(`document.querySelector('.notes-title').value`)
      await ctx.cdp.type('X')
      eq(
        await ctx.cdp.eval(`document.querySelector('.notes-title').value`),
        `${before}X`,
        '标题输入框仍然接收文字输入(编辑路径未被 no-drag 破坏)'
      )
      await ctx.cdp.key('Backspace', 'Backspace', 8)
      eq(
        await ctx.cdp.eval(`document.querySelector('.notes-title').value`),
        before,
        'Backspace 能撤销这次输入'
      )
      // 值已恢复,失焦改名是 no-op;避免把改动带进下一条用例
      await ctx.cdp.eval(`document.querySelector('.notes-title').blur()`)
    }
  },

  {
    id: 'basics/rail-search-look',
    area: 'basics',
    title: '搜索框视觉:复用 .search-wrap,聚焦出现紫色环,输入后清除按钮一键清空',
    tags: ['smoke', 'header', 'layout', 'search'],
    fixture: BASIC,
    async run(ctx) {
      if (await ctx.cdp.eval(`document.querySelector('.notes-rail-top') === null`)) {
        await ctx.cdp.eval(`document.querySelector('.notes-hd .notes-rail-toggle')?.click()`)
        await ctx.cdp.waitFor(`document.querySelector('.notes-rail-top') !== null`, {
          message: '展开目录树后出现搜索行'
        })
      }

      const read = () =>
        ctx.cdp.json(`(() => {
          const wrap = document.querySelector('.notes-rail-search')
          if (wrap === null) return null
          const input = wrap.querySelector('input')
          if (input === null || input === undefined) return null
          const cs = getComputedStyle(wrap)
          return {
            primitive: wrap.classList.contains('search-wrap'),
            boxShadow: cs.boxShadow,
            borderColor: cs.borderColor,
            value: input.value,
            clear: document.querySelector('.notes-rail-clear') !== null
          }
        })()`)

      const idle = await read()
      ok(idle !== null, '目录树搜索框存在')
      ok(idle.primitive, '搜索框复用 .search-wrap 原语(统一底色 / 边框 / 聚焦环)')
      ok(idle.boxShadow === 'none', `未聚焦时不应有聚焦环,实际 ${idle.boxShadow}`)

      // 窗口在 E2E 里没有系统焦点,`:focus-within` 不会命中;先让 CDP 模拟「页面已聚焦」
      await ctx.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
      await ctx.cdp.eval(`document.querySelector('.notes-rail-search input')?.focus()`)
      // 边框色与阴影都有 0.2s 过渡:等到两者一起落到聚焦态再读,避免读到过渡起点
      await ctx.cdp.waitFor(
        `(() => {
          const cs = getComputedStyle(document.querySelector('.notes-rail-search'))
          return cs.boxShadow !== 'none' && cs.borderColor.includes('124, 106, 244')
        })()`,
        { message: '聚焦后出现紫色聚焦环' }
      )
      const focused = await read()
      ok(
        /124,\s*106,\s*244/.test(focused.borderColor),
        `聚焦时边框应变为强调色,实际 ${focused.borderColor}`
      )

      await ctx.cdp.type('a')
      await ctx.cdp.waitFor(`document.querySelector('.notes-rail-clear') !== null`, {
        message: '输入后出现清除按钮'
      })
      const typed = await read()
      ok(typed.value === 'a', `输入框应为 a,实际 ${JSON.stringify(typed.value)}`)

      await ctx.cdp.eval(`document.querySelector('.notes-rail-clear')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.notes-rail-search input').value === ''`, {
        message: '点击清除后输入框清空'
      })
      const cleared = await read()
      ok(!cleared.clear, '清空后清除按钮消失')
    }
  },

  {
    id: 'basics/pick-empty-bg',
    area: 'basics',
    title:
      '「选一篇笔记开始」空页与左栏目录树同底色(--surface):新建笔记并删掉后落到空态,背景与 rail 一致、不再是 --bg',
    tags: ['smoke', 'layout'],
    fixture: BASIC,
    async run(ctx) {
      // 用一篇临时笔记走「删掉当前笔记」这条真实路径回到空态;
      // 不删夹具里的主笔记,下一条用例的 reset 仍能找回它。
      const TEMP = 'E2E 空态'
      await ctx.newDoc('note')
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-create-fields .notes-create-name') !== null`,
        { timeout: 5000, message: '根层出现新建名字输入框' }
      )
      await ctx.cdp.type(TEMP)
      await ctx.press('Enter')
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-title')?.value?.includes(${JSON.stringify(TEMP)}) === true`,
        { timeout: 15_000, message: '新建笔记自动打开' }
      )

      // 删除当前笔记:store 清空 draft,主区回到「选一篇笔记开始」。
      await ctx.cdp.eval(`document.querySelector('.notes-hd-actions .notes-act.danger')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('#dangerModal.open') !== null`, {
        message: '删除前弹出二次确认'
      })
      await ctx.cdp.eval(`document.querySelector('#dangerModal .d-btn.red')?.click()`)
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-title') === null &&
          document.querySelector('.notes-main-empty .notes-firstrun-title') !== null`,
        { timeout: 10_000, message: '删除后回到「选一篇笔记开始」空态' }
      )

      const colors = await ctx.cdp.json(`(() => {
        const bg = (sel) => {
          const el = document.querySelector(sel)
          return el === null ? null : getComputedStyle(el).backgroundColor
        }
        return {
          empty: bg('.notes-main-empty'),
          rail: bg('.notes-rail'),
          view: bg('.notes-view')
        }
      })()`)
      ok(colors.empty !== null && colors.rail !== null && colors.view !== null, '空页、左栏与笔记视图都在')
      eq(colors.empty, colors.rail, '空页底色应与左栏目录树一致(--surface)')
      ok(
        colors.empty !== colors.view,
        `空页底色应覆盖 .notes-view 的 --bg(空页 ${colors.empty},视图 ${colors.view})`
      )
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
    title: '打开笔记较慢时:转圈替换行首类型图标(同一槽位),标题全程不位移,完成后图标恢复',
    tags: ['smoke'],
    fixture: BASIC,
    async run(ctx, t) {
      // 这条用例验证「超过延迟阈值」的加载态:E2E 把延迟调成 0,让打开第一帧就换转圈。
      await ctx.cdp.eval(`document.documentElement.dataset.openingSpinnerDelay = '0'`)
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
      await ctx.cdp.eval(`delete document.documentElement.dataset.openingSpinnerDelay`)
    }
  },

  {
    id: 'basics/rail-opening-fast-no-spinner',
    area: 'basics',
    title: '打开笔记很快时:全程保留类型图标,不闪转圈,标题不位移',
    tags: ['smoke'],
    fixture: BASIC,
    async run(ctx) {
      // 正常延迟(200ms):本地打开远快于阈值,图标不该被换掉。
      await ctx.cdp.eval(`delete document.documentElement.dataset.openingSpinnerDelay`)
      const base = await ctx.cdp.json(`(() => {
        const el = ${rowExpr(LINK_NOTE.title)}
        if (!el) return null
        const icon = el.querySelector('.notes-row-main .notes-file-icon')
        const ir = icon?.getBoundingClientRect()
        const tr = el.querySelector('.notes-row-title').getBoundingClientRect()
        return {
          iconPresent: icon !== null,
          iconLeft: ir ? ir.left : null,
          iconTop: ir ? ir.top : null,
          iconWidth: ir ? ir.width : null,
          iconHeight: ir ? ir.height : null,
          titleLeft: tr.left
        }
      })()`)
      ok(base !== null && base.iconPresent, '找到链接笔记行及类型图标')

      // 观察整个打开过程:打开慢到阈值以上才会出现转圈,这里不应该出现。
      await ctx.cdp.eval(`(() => {
        const list = document.querySelector('.notes-rail-list')
        const probe = { samples: [] }
        const take = () => {
          const row = ${rowExpr(LINK_NOTE.title)}
          if (!row) {
            probe.samples.push({ missing: true })
            return
          }
          const main = row.querySelector('.notes-row-main')
          const icon = main?.querySelector('.notes-file-icon')
          const spin = main?.querySelector('.notes-row-spin')
          const ir = icon?.getBoundingClientRect()
          const tr = row.querySelector('.notes-row-title')?.getBoundingClientRect()
          probe.samples.push({
            missing: false,
            opening: row.classList.contains('opening'),
            icon: icon !== null,
            spin: spin !== null,
            iconLeft: ir ? ir.left : null,
            iconTop: ir ? ir.top : null,
            iconWidth: ir ? ir.width : null,
            iconHeight: ir ? ir.height : null,
            titleLeft: tr ? tr.left : null
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
        window.__railFastOpeningProbe = probe
      })()`)

      const rect = await ctx.cdp.json(railRowExpr(LINK_NOTE.title))
      await ctx.cdp.click(rect.left + rect.width / 2, rect.top + rect.height / 2)
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-title')?.value === ${JSON.stringify(LINK_NOTE.title)}`,
        { timeout: 5000, message: '切到链接笔记' }
      )

      const samples = await ctx.cdp.json(`(() => {
        window.__railFastOpeningProbe.stop()
        const out = window.__railFastOpeningProbe.samples
        delete window.__railFastOpeningProbe
        return out
      })()`)
      const present = samples.filter((s) => !s.missing)
      ok(present.length >= 2, `探针应采到打开中与完成两帧(实际 ${present.length} 帧)`)
      ok(present.some((s) => s.opening), '探针应采到带 opening 状态的帧')

      for (const s of present) {
        eq(s.spin, false, `延迟未到不该出现转圈(样本 ${JSON.stringify(s)})`)
        eq(s.icon, true, `类型图标应全程留在槽位(样本 ${JSON.stringify(s)})`)
        ok(
          Math.abs(s.titleLeft - base.titleLeft) <= 0.5,
          `标题 x 应全程不变:基准 ${base.titleLeft},实际 ${s.titleLeft}`
        )
        ok(
          Math.abs(s.iconLeft - base.iconLeft) <= 0.5 &&
            Math.abs(s.iconTop - base.iconTop) <= 0.5 &&
            Math.abs(s.iconWidth - base.iconWidth) <= 0.5 &&
            Math.abs(s.iconHeight - base.iconHeight) <= 0.5,
          `类型图标位置/尺寸应全程不变:基准 ${JSON.stringify(base)},实际 ${JSON.stringify(s)}`
        )
      }

      eq(await ctx.cdp.eval(`document.querySelectorAll('.notes-row-spin').length`), 0, '整个过程没有转圈')
      const restored = await ctx.cdp.json(`(() => {
        const el = ${rowExpr(LINK_NOTE.title)}
        const icon = el?.querySelector('.notes-row-main .notes-file-icon')
        return { kind: icon?.dataset.kind ?? null, cls: icon?.className ?? '' }
      })()`)
      eq(restored?.kind, 'markdown', '完成后仍是 Markdown 图标')
      includes(restored?.cls ?? '', 'fa-file-lines', '图标类名未变')
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
  },

  {
    id: 'basics/rail-hover-glide',
    area: 'basics',
    title:
      '左侧目录树:悬停底色在行间快速滑动,活动/打开行不叠悬停层,离开行与列表时淡出',
    tags: ['rail', 'motion'],
    fixture: BASIC,
    async run(ctx) {
      // 共享实例:目录会保留,名字必须全组唯一。
      const A = '悬停甲'
      const B = '悬停乙'
      const N = `${A}/悬停笔记`

      // 上一条用例结束时指针停在目录行上,悬停态会跨用例保留:先移出 rail。
      const editor = await ctx.cdp.json(`(() => {
        const r = document.querySelector('.notes-editor-pane')?.getBoundingClientRect()
        return r ? { x: r.left + r.width / 2, y: r.top + 80 } : null
      })()`)
      ok(editor !== null, '编辑区可见')
      await ctx.cdp.mouse('mouseMoved', editor.x, editor.y)
      await ctx.cdp.waitFor(
        `(() => {
          const p = document.querySelector('.notes-rail-hover')
          return p !== null && Number(getComputedStyle(p).opacity) === 0
        })()`,
        { message: '起始时没有悬停高亮' }
      )

      const pill0 = await ctx.cdp.json(railHoverPillExpr())
      ok(pill0 !== null, '悬停色块层已挂载')
      eq(pill0.pointerEvents, 'none', '悬停色块不参与命中测试')
      eq(pill0.hidden, 'true', '悬停色块对读屏隐藏')
      eq(pill0.opacity, 0, '初始没有可见的悬停色块')

      // 目录 A 里放一篇笔记(A 会展开),再建目录 B 并把选中态移到 B。
      // 随后打开主笔记:新建的那篇不再 active,而主笔记保留 active ——
      // 用它验证“活动行不叠悬停色块,选中底色由单独的选中层绘制”。
      await indentCreateRootFolder(ctx, A)
      await indentCreateNote(ctx, A, '悬停笔记')
      await indentCreateRootFolder(ctx, B)
      const selectedB = await ctx.cdp.eval(`(() => {
        const row = ${railFolderRowExpr(B)}
        row?.querySelector('.notes-folder-name')?.click()
        return row !== undefined
      })()`)
      ok(selectedB, `找到目录 B「${B}」`)
      await ctx.cdp.eval(clickRow(MAIN_NOTE.title))
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-title')?.value === ${JSON.stringify(MAIN_NOTE.title)}`,
        { timeout: 10_000, message: '主笔记成为活动笔记' }
      )
      await ctx.cdp.eval(
        `(() => { const el = document.querySelector('.notes-rail-list'); if (el) el.scrollTop = 0 })()`
      )
      await ctx.cdp.waitFor(
        `(() => {
          const folder = ${railFolderRowExpr(A)}
          const note = ${railNoteRowExpr(N)}
          return folder != null && note !== null &&
            !folder.classList.contains('selected') &&
            !note.classList.contains('active') && !note.classList.contains('opening')
        })()`,
        { timeout: 5000, message: '悬停目标行不在活动/选中态' }
      )

      const g = await ctx.cdp.json(`(() => {
        const box = (el) => {
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { left: r.left, top: r.top, width: r.width, height: r.height }
        }
        const list = document.querySelector('.notes-rail-list')
        const lr = list.getBoundingClientRect()
        return {
          folder: box(${railFolderRowExpr(A)}),
          note: box(${railNoteRowExpr(N)}),
          main: box(${rowExpr(MAIN_NOTE.title)}),
          list: {
            left: lr.left, top: lr.top, right: lr.right, bottom: lr.bottom,
            width: lr.width, height: lr.height
          }
        }
      })()`)
      ok(g.folder !== null && g.note !== null && g.main !== null, '目录行、目录内笔记行、活动笔记行都已渲染')
      for (const [label, r] of [
        ['目录行', g.folder],
        ['笔记行', g.note],
        ['活动笔记行', g.main]
      ]) {
        ok(
          r.top >= g.list.top && r.top + r.height <= g.list.bottom,
          `${label}应在列表可视区内(实际 ${r.top}..${r.top + r.height},列表 ${g.list.top}..${g.list.bottom})`
        )
      }

      const hoverAt = async (rect, message) => {
        await ctx.cdp.mouse('mouseMoved', rect.left + rect.width / 2, rect.top + rect.height / 2)
        await ctx.cdp.waitFor(railHoverAtExpr(rect), { message })
      }

      // 1) 首次进入目录行:色块原地出现,尺寸贴合整行
      await hoverAt(g.folder, '悬停目录行:色块出现在该行')

      // 2) 活动行不叠悬停色块(半透明底色叠两层会变色)
      await ctx.cdp.mouse(
        'mouseMoved',
        g.main.left + g.main.width / 2,
        g.main.top + g.main.height / 2
      )
      await ctx.cdp.waitFor(
        `(() => {
          const p = document.querySelector('.notes-rail-hover')
          return p !== null && Number(getComputedStyle(p).opacity) === 0
        })()`,
        { timeout: 3000, message: '活动笔记行不铺悬停高亮' }
      )

      // 3) 回到目录行,准备录一帧帧的滑动过程
      await hoverAt(g.folder, '离开活动行后色块回到目录行')
      await ctx.cdp.eval(`(() => {
        const pill = document.querySelector('.notes-rail-hover')
        if (!pill) return false
        const samples = []
        let raf = 0
        const tick = () => {
          const r = pill.getBoundingClientRect()
          samples.push({ top: r.top, left: r.left, opacity: Number(getComputedStyle(pill).opacity) })
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        window.__railHoverProbe = { samples, stop: () => cancelAnimationFrame(raf) }
        return true
      })()`)
      await ctx.cdp.eval(
        `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`
      )

      let samples = []
      try {
        await hoverAt(g.note, '指针移到笔记行时色块滑到该行')
      } finally {
        samples = await ctx.cdp.eval(`(() => {
          const p = window.__railHoverProbe
          if (!p) return []
          p.stop()
          delete window.__railHoverProbe
          return p.samples
        })()`)
      }

      const lo = Math.min(g.folder.top, g.note.top)
      const hi = Math.max(g.folder.top, g.note.top)
      const middle = samples.filter((s) => s.top > lo + 1 && s.top < hi - 1)
      ok(
        middle.length > 0,
        `从目录行滑到笔记行应经过中间位置,而不是瞬移(采样 top: ${samples
          .map((s) => s.top.toFixed(1))
          .join(', ')})`
      )

      // 4) 行自己不再铺底:悬停时行背景透明,视觉底色只来自色块
      const colors = await ctx.cdp.json(`(() => {
        const note = ${railNoteRowExpr(N)}
        const pill = document.querySelector('.notes-rail-hover')
        return {
          note: getComputedStyle(note).backgroundColor,
          pill: getComputedStyle(pill).backgroundColor
        }
      })()`)
      eq(colorAlpha(colors.note), 0, `笔记行自己不再铺悬停底色(实际 ${colors.note})`)
      ok(colorAlpha(colors.pill) > 0, `悬停色块本身有底色(实际 ${colors.pill})`)

      // 5) 移到列表空白:短暂宽限后淡出
      const blank = await ctx.cdp.json(`(() => {
        const list = document.querySelector('.notes-rail-list')
        const r = list.getBoundingClientRect()
        for (let y = r.bottom - 3; y > r.top + 20; y -= 2) {
          if (document.elementFromPoint(r.left + r.width / 2, y) === list) {
            return { x: r.left + r.width / 2, y }
          }
        }
        return null
      })()`)
      ok(blank !== null, '列表底部有一段不属于任何行的空白')
      await ctx.cdp.mouse('mouseMoved', blank.x, blank.y)
      await ctx.cdp.waitFor(
        `(() => {
          const p = document.querySelector('.notes-rail-hover')
          return p !== null && Number(getComputedStyle(p).opacity) === 0
        })()`,
        { timeout: 3000, message: '移到空白后色块淡出' }
      )

      // 6) 指针离开列表,不给后面的用例留悬停态
      await ctx.cdp.mouse('mouseMoved', editor.x, editor.y)
      await ctx.cdp.waitFor(
        `(() => {
          const p = document.querySelector('.notes-rail-hover')
          return p !== null && Number(getComputedStyle(p).opacity) === 0
        })()`,
        { message: '指针离开列表后没有残留高亮' }
      )
    }
  },

  {
    id: 'basics/rail-selection-glide',
    area: 'basics',
    title:
      '左侧目录树:点击笔记/文件时选中底色从旧活动行滑到新行;行自身不铺底,目录选中不参与滑动',
    tags: ['rail', 'motion'],
    fixture: BASIC,
    async run(ctx) {
      // 共享实例:目录/文件会保留,名字必须全组唯一。
      const FOLDER = '选中目录'
      const FILE = '选中文件.txt'

      await indentCreateRootFolder(ctx, FOLDER)

      // 建一个非 Markdown 文件:创建后会自动在应用内打开。
      await ctx.newDoc('note')
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-create-fields .notes-create-name') !== null`,
        { timeout: 5000, message: '根层出现新建名字输入框' }
      )
      // 默认只选中主名。打完主名再把后缀从 md 改成 txt。
      await ctx.cdp.type('选中文件')
      await ctx.cdp.eval(`(() => {
        const el = document.querySelector('.notes-create-name')
        const dot = el.value.lastIndexOf('.')
        el.focus()
        el.setSelectionRange(dot + 1, el.value.length)
      })()`)
      await ctx.cdp.type('txt')
      await ctx.press('Enter')
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-row[data-file-path=${JSON.stringify(FILE)}]') !== null`,
        { timeout: 10_000, message: `文件「${FILE}」出现在左栏` }
      )
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-name')?.textContent === ${JSON.stringify(FILE)}`,
        { timeout: 15_000, message: '新建文件在应用内打开' }
      )

      // 回到主笔记:后面几次切换都从它出发。
      await ctx.cdp.eval(clickRow(MAIN_NOTE.title))
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-title')?.value === ${JSON.stringify(MAIN_NOTE.title)}`,
        { timeout: 10_000, message: '主笔记成为活动笔记' }
      )
      await ctx.cdp.waitFor(
        `(${rowExpr(MAIN_NOTE.title)})?.classList.contains('active') === true`,
        { timeout: 10_000, message: '主笔记行进入 active' }
      )
      await ctx.cdp.eval(
        `(() => { const el = document.querySelector('.notes-rail-list'); if (el) el.scrollTop = 0 })()`
      )

      const pill0 = await ctx.cdp.json(railSelectionPillExpr())
      ok(pill0 !== null, '选中色块层已挂载')
      eq(pill0.pointerEvents, 'none', '选中色块不参与命中测试')
      eq(pill0.hidden, 'true', '选中色块对读屏隐藏')
      ok(colorAlpha(pill0.background) > 0, `选中色块本身有底色(实际 ${pill0.background})`)

      const g = await ctx.cdp.json(`(() => {
        const box = (el) => {
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { left: r.left, top: r.top, width: r.width, height: r.height }
        }
        const list = document.querySelector('.notes-rail-list')
        const lr = list.getBoundingClientRect()
        return {
          folder: box(${railFolderRowExpr(FOLDER)}),
          main: box(${rowExpr(MAIN_NOTE.title)}),
          link: box(${rowExpr(LINK_NOTE.title)}),
          file: box(${railFileRowExpr(FILE)}),
          list: {
            left: lr.left, top: lr.top, right: lr.right, bottom: lr.bottom,
            width: lr.width, height: lr.height
          }
        }
      })()`)
      ok(
        g.folder !== null && g.main !== null && g.link !== null && g.file !== null,
        '目录、主笔记、链接笔记、文件行都已渲染'
      )
      for (const [label, r] of [
        ['目录行', g.folder],
        ['主笔记行', g.main],
        ['链接笔记行', g.link],
        ['文件行', g.file]
      ]) {
        ok(
          r.top >= g.list.top && r.top + r.height <= g.list.bottom,
          `${label}应在列表可视区内(实际 ${r.top}..${r.top + r.height},列表 ${g.list.top}..${g.list.bottom})`
        )
      }

      // 初始:选中色块贴在活动的主笔记行。
      await ctx.cdp.waitFor(railSelectionAtRowExpr(rowExpr(MAIN_NOTE.title)), {
        message: '初始选中色块贴在活动笔记行'
      })

      // 1) 点击目录只改变目录选中态,不移动文档选中色块。
      await realClickRow(ctx, railFolderRowExpr(FOLDER))
      await ctx.cdp.waitFor(
        `(${railFolderRowExpr(FOLDER)})?.classList.contains('selected') === true`,
        { message: '目录行进入选中态' }
      )
      await ctx.cdp.waitFor(railSelectionAtRowExpr(rowExpr(MAIN_NOTE.title)), {
        message: '点击目录不移动文档选中色块'
      })

      const waitNote = async (title) => {
        await ctx.cdp.waitFor(
          `document.querySelector('.notes-title')?.value === ${JSON.stringify(title)}`,
          { timeout: 10_000, message: `笔记「${title}」在编辑器打开` }
        )
        await ctx.cdp.waitFor(`(${rowExpr(title)})?.classList.contains('active') === true`, {
          timeout: 10_000,
          message: `笔记「${title}」行进入 active`
        })
      }
      const waitFile = async () => {
        await ctx.cdp.waitFor(
          `document.querySelector('.file-main .file-name')?.textContent === ${JSON.stringify(FILE)}`,
          { timeout: 15_000, message: '文件在应用内打开' }
        )
        await ctx.cdp.waitFor(
          `(${railFileRowExpr(FILE)})?.classList.contains('active') === true`,
          { timeout: 10_000, message: '文件行进入 active' }
        )
      }

      /** 真实点击目标行,记录选中色块每帧位置,并断言它经过两行之间的中间位置。 */
      const slideFrom = async (fromExpr, toExpr, waitTarget, message) => {
        const before = await ctx.cdp.json(`(() => {
          const top = (el) => {
            if (!el) return null
            return el.getBoundingClientRect().top
          }
          return { from: top(${fromExpr}), to: top(${toExpr}) }
        })()`)
        ok(before.from !== null && before.to !== null, `${message}:起止行都已渲染`)
        await startRailSelectionProbe(ctx)
        let samples = []
        try {
          await realClickRow(ctx, toExpr)
          await waitTarget()
          await ctx.cdp.waitFor(railSelectionAtRowExpr(toExpr), {
            message: `${message}:选中色块到达目标行`
          })
        } finally {
          samples = await stopRailSelectionProbe(ctx)
        }
        const lo = Math.min(before.from, before.to)
        const hi = Math.max(before.from, before.to)
        const middle = samples.filter((s) => s.top > lo + 1 && s.top < hi - 1)
        ok(
          middle.length > 0,
          `${message}:应经过中间位置而不是瞬移(采样 top: ${samples
            .map((s) => s.top.toFixed(1))
            .join(', ')})`
        )
      }

      // 2) 笔记 → 笔记:主笔记滑到链接目标。
      await slideFrom(
        rowExpr(MAIN_NOTE.title),
        rowExpr(LINK_NOTE.title),
        () => waitNote(LINK_NOTE.title),
        '主笔记滑到链接笔记'
      )
      const colors = await ctx.cdp.json(`(() => {
        const main = ${rowExpr(MAIN_NOTE.title)}
        const link = ${rowExpr(LINK_NOTE.title)}
        const pill = document.querySelector('.notes-rail-selection')
        return {
          main: getComputedStyle(main).backgroundColor,
          link: getComputedStyle(link).backgroundColor,
          pill: getComputedStyle(pill).backgroundColor
        }
      })()`)
      eq(colorAlpha(colors.main), 0, `主笔记行自己不再铺活动底色(实际 ${colors.main})`)
      eq(colorAlpha(colors.link), 0, `活动笔记行自己不再铺底色(实际 ${colors.link})`)
      ok(colorAlpha(colors.pill) > 0, `选中底色只来自色块(实际 ${colors.pill})`)

      // 3) 笔记 → 文件。
      await slideFrom(
        rowExpr(LINK_NOTE.title),
        railFileRowExpr(FILE),
        waitFile,
        '链接笔记滑到文件'
      )
      const noteLost = await ctx.cdp.eval(
        `(${rowExpr(LINK_NOTE.title)})?.classList.contains('active') === false`
      )
      ok(noteLost, '打开文件后笔记行失去 active')
      const fileBg = await ctx.cdp.json(
        `getComputedStyle(${railFileRowExpr(FILE)}).backgroundColor`
      )
      eq(colorAlpha(fileBg), 0, `活动文件行自己不再铺底色(实际 ${fileBg})`)

      // 4) 文件 → 笔记:跨 store 切换时旧文件可能还挂着 active,
      //    色块应直接从文件滑回笔记,不能被带回文件。
      await slideFrom(
        railFileRowExpr(FILE),
        rowExpr(LINK_NOTE.title),
        () => waitNote(LINK_NOTE.title),
        '文件滑回链接笔记'
      )
      const fileLost = await ctx.cdp.eval(
        `(${railFileRowExpr(FILE)})?.classList.contains('active') === false`
      )
      ok(fileLost, '回到笔记后文件行失去 active')

      // 5) 收尾:选中色块不跟指针走,离开列表后仍停在活动行。
      const editor = await ctx.cdp.json(`(() => {
        const r = document.querySelector('.notes-editor-pane')?.getBoundingClientRect()
        return r ? { x: r.left + r.width / 2, y: r.top + 80 } : null
      })()`)
      ok(editor !== null, '编辑区可见')
      await ctx.cdp.mouse('mouseMoved', editor.x, editor.y)
      await ctx.cdp.waitFor(
        `(() => {
          const p = document.querySelector('.notes-rail-hover')
          return p !== null && Number(getComputedStyle(p).opacity) === 0
        })()`,
        { message: '指针离开列表后没有残留悬停高亮' }
      )
      await ctx.cdp.waitFor(railSelectionAtRowExpr(rowExpr(LINK_NOTE.title)), {
        message: '指针离开后选中色块仍停在活动笔记行'
      })
    }
  },

  {
    id: 'basics/rail-new-menu',
    area: 'basics',
    title:
      '左侧目录只有一颗「新增」:二级菜单列出笔记/白板/图表/文件夹,portal 定位、键盘与关闭都对',
    tags: ['rail', 'menu'],
    fixture: BASIC,
    async run(ctx) {
      // 1) 根层只剩一颗整行按钮
      const root = await ctx.cdp.json(`(() => {
        const row = document.querySelector('.notes-new-row')
        if (!row) return null
        const buttons = [...row.querySelectorAll('.notes-new-btn')]
        const el = buttons[0]
        return {
          count: buttons.length,
          folders: row.querySelectorAll('.notes-new-folder').length,
          text: el?.textContent?.trim() ?? '',
          haspopup: el?.getAttribute('aria-haspopup') ?? '',
          expanded: el?.getAttribute('aria-expanded') ?? ''
        }
      })()`)
      ok(root !== null, '根层新增行存在')
      eq(root.count, 1, '根层只有一颗「新增」')
      eq(root.folders, 0, '旧的并排按钮已移除')
      eq(root.text, '新增', '按钮文字是「新增」')
      eq(root.haspopup, 'menu', '按钮声明了弹出菜单')
      eq(root.expanded, 'false', '未打开时 aria-expanded=false')

      // 窄栏下这颗按钮仍完整可见(以前并排 3 颗放不下)
      const fit = await ctx.cdp.json(`(() => {
        const rail = document.querySelector('.notes-rail')
        const el = document.querySelector('[data-new-menu="root"]')
        if (!rail || !el) return null
        const prev = rail.style.width
        rail.style.width = '150px'
        rail.classList.add('rail-narrow')
        const er = el.getBoundingClientRect()
        const span = el.querySelector('span')
        const sr = span?.getBoundingClientRect()
        const out = {
          full: span !== null && Math.min(span.scrollWidth, sr.width) >= span.scrollWidth - 1,
          inside: sr !== undefined && sr.right <= er.right + 1 && sr.left >= er.left - 1,
          width: er.width
        }
        rail.style.width = prev
        rail.classList.remove('rail-narrow')
        return out
      })()`)
      ok(fit !== null, '窄栏下能量到新增按钮')
      ok(fit.full, '窄栏下「新增」没有被省略号裁掉')
      ok(fit.inside, '窄栏下「新增」没有溢出按钮')

      // 2) 打开菜单:4 项、顺序与文案、分隔线、portal 与几何
      const anchor = await ctx.cdp.json(`(() => {
        const r = document.querySelector('[data-new-menu="root"]').getBoundingClientRect()
        return { left: r.left, top: r.top, bottom: r.bottom, width: r.width }
      })()`)
      await ctx.openNewMenu()

      const menu = await ctx.cdp.json(`(() => {
        const el = document.querySelector('.notes-new-menu')
        if (!el) return null
        const r = el.getBoundingClientRect()
        const items = [...el.querySelectorAll('[data-new-item]')].map((b) => ({
          kind: b.dataset.newItem,
          label: b.querySelector('.notes-new-menu-label')?.textContent ?? '',
          hint: b.querySelector('.notes-new-menu-hint')?.textContent ?? '',
          role: b.getAttribute('role'),
          top: b.getBoundingClientRect().top
        }))
        const sep = el.querySelector('[role="separator"]')
        return {
          inRow: document.querySelector('.notes-new-row')?.contains(el) ?? false,
          inBody: el.parentElement === document.body,
          width: r.width,
          left: r.left,
          top: r.top,
          viewport: { w: innerWidth, h: innerHeight },
          items,
          sepBetween: sep !== null && sep.getBoundingClientRect().top > items[2]?.top
            && sep.getBoundingClientRect().top < items[3]?.top,
          role: el.getAttribute('role'),
          focus: document.activeElement?.dataset?.newItem ?? null,
          expanded: document.querySelector('[data-new-menu="root"]')?.getAttribute('aria-expanded')
        }
      })()`)
      ok(menu !== null, '菜单已渲染')
      eq(menu.role, 'menu', '浮层 role=menu')
      eq(menu.items.length, 4, '菜单有 4 项')
      eq(menu.items.map((i) => i.kind).join(','), 'note,canvas,drawio,folder', '顺序固定')
      eq(menu.items[0].label, '笔记', '第一项是笔记')
      eq(menu.items[0].hint, 'Markdown', '笔记提示后缀')
      eq(menu.items[1].label, '白板', '第二项是白板')
      eq(menu.items[1].hint, 'Excalidraw', '白板提示')
      eq(menu.items[2].label, '图表', '第三项是图表')
      eq(menu.items[2].hint, 'draw.io', '图表提示')
      eq(menu.items[3].label, '文件夹', '第四项是文件夹')
      for (const item of menu.items) eq(item.role, 'menuitem', `${item.kind} role=menuitem`)
      ok(menu.sepBetween, '分隔线在图表与文件夹之间')
      ok(!menu.inRow, '浮层没有挂在列表行里')
      ok(menu.inBody, '浮层 portal 到 body')
      eq(Math.round(menu.width), 190, '菜单宽度 190')
      ok(Math.abs(menu.left - anchor.left) <= 1, `菜单左缘贴按钮(菜单 ${menu.left} / 按钮 ${anchor.left})`)
      ok(menu.top >= anchor.bottom, '默认向下弹出')
      ok(
        menu.left >= 0 && menu.left + menu.width <= menu.viewport.w,
        '菜单在视口内'
      )
      eq(menu.expanded, 'true', '打开时 aria-expanded=true')
      eq(menu.focus, 'note', '打开后焦点在第一项')

      // 3) Escape 关闭,焦点回到触发按钮
      await ctx.cdp.key('Escape', 'Escape', 27)
      await ctx.cdp.waitFor(`document.querySelector('.notes-new-menu') === null`, {
        timeout: 3000,
        message: 'Escape 关闭菜单'
      })
      const focused = await ctx.cdp.json(`document.activeElement?.dataset?.newMenu ?? null`)
      eq(focused, 'root', 'Escape 后焦点回到「新增」按钮')

      // 4) 点外部关闭
      await ctx.openNewMenu()
      await ctx.cdp.eval(`document.body.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, clientX: 2, clientY: 2, button: 0 }))`)
      await ctx.cdp.waitFor(`document.querySelector('.notes-new-menu') === null`, {
        timeout: 3000,
        message: '点外部关闭菜单'
      })

      // 5) 目录滚动时关闭(fixed 浮层不能跟着列表漂)
      await ctx.openNewMenu()
      await ctx.cdp.eval(
        `document.querySelector('.notes-rail-list')?.dispatchEvent(new Event('scroll'))`
      )
      await ctx.cdp.waitFor(`document.querySelector('.notes-new-menu') === null`, {
        timeout: 3000,
        message: '目录滚动时菜单收起'
      })

      // 6) 键盘:↓ 移动,Enter 选中,落到预填完整文件名的输入框
      await ctx.openNewMenu()
      await ctx.cdp.key('ArrowDown', 'ArrowDown', 40)
      const second = await ctx.cdp.json(`document.activeElement?.dataset?.newItem ?? null`)
      eq(second, 'canvas', '↓ 移到白板')
      await ctx.cdp.key('Enter', 'Enter', 13)
      await ctx.cdp.waitFor(`document.querySelector('.notes-create-fields .notes-create-name') !== null`, {
        timeout: 5000,
        message: 'Enter 选中后出现文件名输入框'
      })
      const draft = await ctx.cdp.eval(`document.querySelector('.notes-create-name')?.value ?? null`)
      eq(draft, '未命名.excal', '白板预填 .excal')
      // 关掉输入框,不留文件
      await ctx.cdp.eval(`document.querySelector('.notes-create-name')?.focus()`)
      await ctx.cdp.key('Escape', 'Escape', 27)
      await ctx.cdp.waitFor(`document.querySelector('.notes-create-fields') === null`, {
        timeout: 3000,
        message: '取消新建输入框'
      })
    }
  },

  {
    id: 'basics/rail-new-targets',
    area: 'basics',
    title: '「新增」的落点:根层建四种类型都给对应默认名,目录行只剩 3 个动作且建在目录内',
    tags: ['rail', 'menu'],
    fixture: BASIC,
    async run(ctx) {
      // 1) 根层选「图表」→ 未命名.drawio;取消掉,不留文件
      await ctx.newDoc('drawio')
      await ctx.cdp.waitFor(`document.querySelector('.notes-create-fields .notes-create-name') !== null`, {
        timeout: 5000,
        message: '根层出现文件名输入框'
      })
      eq(
        await ctx.cdp.eval(`document.querySelector('.notes-create-name')?.value ?? null`),
        '未命名.drawio',
        '图表预填 .drawio'
      )
      await ctx.cdp.eval(`document.querySelector('.notes-create-name')?.focus()`)
      await ctx.cdp.key('Escape', 'Escape', 27)
      await ctx.cdp.waitFor(`document.querySelector('.notes-create-fields') === null`, {
        timeout: 3000,
        message: '取消新建'
      })

      // 2) 根层选「文件夹」→ 目录输入框(没有后缀)
      const FOLDER = '二级菜单目录'
      await ctx.newDoc('folder')
      await ctx.cdp.waitFor(`document.querySelector('.notes-folder-edit .notes-folder-input') !== null`, {
        timeout: 5000,
        message: '根层出现目录输入框'
      })
      await ctx.cdp.type(FOLDER)
      await ctx.press('Enter')
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-folder-row[data-folder-path=${JSON.stringify(FOLDER)}]') !== null`,
        { timeout: 10_000, message: `目录「${FOLDER}」出现` }
      )

      // 3) 目录行只剩 新增 / 改名 / 删除
      const acts = await ctx.cdp.json(`(() => {
        const row = document.querySelector('.notes-folder-row[data-folder-path=${JSON.stringify(FOLDER)}]')
        return [...row.querySelectorAll('[data-folder-act]')].map((el) => el.dataset.folderAct)
      })()`)
      eq(acts.join(','), 'new,rename,delete', '目录行动作收成 3 个')

      // 4) 目录行的「新增」→ 笔记,建在目录内并自动展开
      const NOTE = '目录内笔记'
      await ctx.openFolderNewMenu(FOLDER)
      const menuKinds = await ctx.cdp.json(
        `[...document.querySelectorAll('.notes-new-menu [data-new-item]')].map((el) => el.dataset.newItem)`
      )
      eq(menuKinds.join(','), 'note,canvas,drawio,folder', '目录行与根层共用同一份菜单')
      await ctx.pickNew('note')
      await ctx.cdp.waitFor(`document.querySelector('.notes-folder-edit .notes-create-name') !== null`, {
        timeout: 5000,
        message: '目录内出现新建输入框'
      })
      eq(
        await ctx.cdp.eval(`document.querySelector('.notes-create-name')?.value ?? null`),
        '未命名.md',
        '笔记预填 .md'
      )
      await ctx.cdp.type(NOTE)
      await ctx.press('Enter')
      const id = `${FOLDER}/${NOTE}`
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-row[data-note-id=${JSON.stringify(id)}]') !== null`,
        { timeout: 10_000, message: `笔记「${id}」建在目录内` }
      )
    }
  }
]
