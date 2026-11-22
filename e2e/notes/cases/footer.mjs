// 主区底栏:纯预览 / 空态 / 文件页统一为 38px 的 .notes-footer,右侧是项目仓库入口。
//
// 编辑 / 分栏继续用原有的 .notes-toolbar(排版按钮 + 字数),本组反过来锁住「两条不能同时出现」。
// 用户确认过:左侧留空;文件页(含白板)全部加,白板因此会有 Excalidraw 自带底栏 + 应用底栏两条。

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { eq, includes, ok } from '../lib/assert.mjs'
import { BASIC } from '../lib/fixtures.mjs'

const REPO = 'https://github.com/BeCrafter/Launcher'
const LINK = '[data-notes-footer-link]'
const FOOTER = '[data-notes-footer]'

function fileSelector(rel) {
  return `[data-file-path=${JSON.stringify(rel)}]`
}

function writeVaultFile(ctx, rel, content) {
  const full = join(ctx.profileDir, 'notes', rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
  return full
}

/** 底栏几何:高度、上下边,和它所在主区的下边 */
function footerGeomExpr() {
  return `(() => {
    const footer = document.querySelector('${FOOTER}')
    const main = document.querySelector('.notes-main')
    if (footer === null || main === null) return null
    const f = footer.getBoundingClientRect()
    const m = main.getBoundingClientRect()
    return { top: f.top, bottom: f.bottom, left: f.left, right: f.right, width: f.width, height: f.height,
      mainBottom: m.bottom, mainLeft: m.left, mainRight: m.right }
  })()`
}

/** 链接契约:文字、href、target / rel、图标 */
async function assertLinkContract(ctx) {
  const link = await ctx.cdp.json(`(() => {
    const el = document.querySelector('${LINK}')
    if (el === null) return null
    const r = el.getBoundingClientRect()
    return {
      text: el.textContent?.trim() ?? '',
      href: el.getAttribute('href'),
      target: el.getAttribute('target'),
      rel: el.getAttribute('rel') ?? '',
      title: el.getAttribute('title') ?? '',
      left: r.left, right: r.right,
      icon: el.querySelector('i.fa-brands.fa-github') !== null
    }
  })()`)
  ok(link !== null, '仓库链接存在')
  eq(link.text, 'BeCrafter/Launcher', '链接文字是 BeCrafter/Launcher')
  eq(link.href, REPO, 'href 指向项目仓库')
  eq(link.target, '_blank', '在新窗口打开')
  includes(link.rel, 'noopener', 'rel 带 noopener')
  includes(link.rel, 'noreferrer', 'rel 带 noreferrer')
  eq(link.icon, true, '链接带 GitHub 图标')
  ok(link.title.length > 0, '链接有 i18n tooltip')
  return link
}

export default [
  {
    id: 'footer/preview-and-edit',
    area: 'footer',
    title:
      '底栏二选一:分栏 / 编辑是排版工具条,纯预览换成 38px 通用底栏;底栏左侧留空、右侧仓库链接贴右缘,点击走 openExternal',
    tags: ['footer', 'layout'],
    fixture: BASIC,
    async run(ctx) {
      // reset 后默认分栏:编辑侧的排版工具条在,通用底栏不在
      await ctx.cdp.waitFor(`document.querySelector('.notes-toolbar') !== null`, {
        message: '分栏模式有排版工具条'
      })
      eq(
        await ctx.cdp.eval(`document.querySelector('${FOOTER}') === null`),
        true,
        '分栏模式不渲染通用底栏'
      )

      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('${FOOTER}') !== null`, {
        message: '纯预览出现通用底栏'
      })
      eq(
        await ctx.cdp.eval(`document.querySelector('.notes-toolbar') === null`),
        true,
        '纯预览不再渲染排版工具条(不会两条底栏叠在一起)'
      )

      const geom = await ctx.cdp.json(footerGeomExpr())
      eq(Math.round(geom.height), 38, '底栏高度 38px')
      ok(Math.abs(geom.bottom - geom.mainBottom) <= 1, '底栏下边贴主区下边')
      const shellBottom = await ctx.cdp.eval(
        `document.querySelector('.notes-shell')?.getBoundingClientRect().bottom ?? -1`
      )
      ok(Math.abs(geom.top - shellBottom) <= 1, '底栏上边贴预览区下边')

      const link = await assertLinkContract(ctx)
      ok(link.left > geom.left + geom.width / 2, '链接在主区右半侧(左侧留空)')
      ok(Math.abs(geom.right - link.right - 12) <= 2, '链接贴右缘,留 12px 内边距')
      const text = await ctx.cdp.eval(`document.querySelector('${FOOTER}')?.textContent ?? ''`)
      eq(text.trim(), 'BeCrafter/Launcher', '底栏除仓库链接外没有别的文案')

      // 点击必须在运行时被 stub 短路,不真的拉起系统浏览器;日志证明走的是主进程入口
      await ctx.cdp.eval(`document.querySelector('${LINK}')?.click()`)
      await ctx.waitForLog(`[ipc] openExternal ${REPO}`, '点击底栏链接触发 openExternal')

      // 切回编辑、再切分栏:通用底栏消失,工具条回来
      await ctx.setMode('edit')
      eq(
        await ctx.cdp.eval(`document.querySelector('${FOOTER}') === null`),
        true,
        '编辑模式不渲染通用底栏'
      )
      eq(await ctx.cdp.eval(`document.querySelector('.notes-toolbar') !== null`), true, '编辑模式有排版工具条')

      await ctx.setMode('split')
      eq(
        await ctx.cdp.eval(`document.querySelector('${FOOTER}') === null`),
        true,
        '分栏模式不渲染通用底栏'
      )
      eq(await ctx.cdp.eval(`document.querySelector('.notes-toolbar') !== null`), true, '分栏模式有排版工具条')
    }
  },

  {
    id: 'footer/empty-state',
    area: 'footer',
    title:
      '未选笔记的空态:首次引导在上方内容区居中,底部是同款 38px 底栏并贴主区下边,链接契约一致',
    tags: ['footer', 'layout'],
    fixture: BASIC,
    async run(ctx) {
      // 走真实的「新建一篇临时笔记 → 删掉」路径回到空态,不动夹具里的主笔记
      const TEMP = 'E2E 底栏空态'
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

      const structure = await ctx.cdp.json(`(() => {
        const main = document.querySelector('.notes-main-empty')
        const body = main?.querySelector(':scope > .notes-empty-body')
        const footer = main?.querySelector(':scope > ${FOOTER}')
        if (main === null || body == null || footer == null) return null
        const b = body.getBoundingClientRect()
        const f = footer.getBoundingClientRect()
        const fr = main.querySelector('.notes-firstrun')?.getBoundingClientRect()
        const m = main.getBoundingClientRect()
        return {
          bodyDirect: true, footerDirect: true,
          body: { top: b.top, bottom: b.bottom, height: b.height },
          footer: { top: f.top, bottom: f.bottom, height: f.height },
          firstrun: fr == null ? null : { top: fr.top, bottom: fr.bottom },
          mainBottom: m.bottom
        }
      })()`)
      ok(structure !== null, '空态主区直接子节点是 .notes-empty-body 与底栏')
      eq(Math.round(structure.footer.height), 38, '空态底栏高度 38px')
      ok(Math.abs(structure.footer.bottom - structure.mainBottom) <= 1, '空态底栏贴主区下边')

      // 内容在「去掉底栏后的剩余区域」里垂直居中,且不会压到底栏
      const bodyCenter = (structure.body.top + structure.body.bottom) / 2
      const firstrunCenter = (structure.firstrun.top + structure.firstrun.bottom) / 2
      ok(Math.abs(bodyCenter - firstrunCenter) <= 2, '首次引导在内容区垂直居中')
      ok(structure.firstrun.bottom <= structure.footer.top, '首次引导在底栏上方')

      const geom = await ctx.cdp.json(footerGeomExpr())
      eq(Math.round(geom.height), 38, '底栏几何与其他页面一致')
      await assertLinkContract(ctx)
    }
  },

  {
    id: 'footer/file-pages',
    area: 'footer',
    title:
      '文件页也算主区:文本文件底栏贴编辑区下边;白板同样有应用底栏,Excalidraw 自带工具条仍在画布内(两条并存)',
    tags: ['footer', 'layout', 'files', 'canvas'],
    fixture: BASIC,
    async run(ctx) {
      const rel = 'E2E 底栏说明.txt'
      writeVaultFile(ctx, rel, '底栏文件页\n')
      await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(fileSelector(rel))}) !== null`, {
        timeout: 10_000,
        message: '文本文件行出现'
      })
      await ctx.cdp.eval(`document.querySelector(${JSON.stringify(fileSelector(rel))})?.click()`)
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-name')?.textContent === 'E2E 底栏说明.txt'`,
        { timeout: 15_000, message: '文件页打开' }
      )
      await ctx.cdp.waitFor(`document.querySelector('${FOOTER}') !== null`, {
        message: '文件页出现通用底栏'
      })

      const textGeom = await ctx.cdp.json(`(() => {
        const footer = document.querySelector('${FOOTER}')
        const body = document.querySelector('.file-main .file-body')
        const main = document.querySelector('.notes-main')
        if (footer === null || body === null || main === null) return null
        const f = footer.getBoundingClientRect()
        const b = body.getBoundingClientRect()
        const m = main.getBoundingClientRect()
        return { footer: { top: f.top, bottom: f.bottom, height: f.height }, bodyBottom: b.bottom, mainBottom: m.bottom }
      })()`)
      ok(textGeom !== null, '文件页底栏存在')
      eq(Math.round(textGeom.footer.height), 38, '文件页底栏高度 38px')
      ok(Math.abs(textGeom.footer.top - textGeom.bodyBottom) <= 1, '底栏上边贴 .file-body 下边')
      ok(Math.abs(textGeom.footer.bottom - textGeom.mainBottom) <= 1, '底栏下边贴主区下边')
      await assertLinkContract(ctx)

      // 白板:新建后等 Excalidraw 就绪
      await ctx.newDoc('canvas')
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-create-fields .notes-create-name') !== null`,
        { timeout: 5000, message: '出现新建白板的名字输入框' }
      )
      await ctx.cdp.eval(`document.querySelector('.notes-create-name')?.focus()`)
      await ctx.cdp.type('底栏白板')
      await ctx.press('Enter')
      await ctx.cdp.waitFor(`document.querySelector('.file-main .file-name')?.textContent === '底栏白板.excal'`, {
        timeout: 15_000,
        message: '白板在应用内打开'
      })
      await ctx.cdp.waitFor(`document.querySelector('.canvas-board .excalidraw') !== null`, {
        timeout: 15_000,
        message: '窗格里是 Excalidraw 画布'
      })
      await ctx.cdp.waitFor(`document.querySelector('${FOOTER}') !== null`, {
        message: '白板页也有应用底栏'
      })

      const canvasGeom = await ctx.cdp.json(`(() => {
        const footer = document.querySelector('${FOOTER}')
        const board = document.querySelector('.canvas-board')
        const bar = document.querySelector('.canvas-board .App-toolbar')
        if (footer === null || board === null) return null
        const f = footer.getBoundingClientRect()
        const b = board.getBoundingClientRect()
        const t = bar?.getBoundingClientRect() ?? null
        return {
          footer: { top: f.top, bottom: f.bottom, height: f.height },
          board: { top: b.top, bottom: b.bottom },
          toolbar: t === null ? null : { top: t.top, bottom: t.bottom, insideBoard: t.top >= b.top - 1 && t.bottom <= b.bottom + 1 }
        }
      })()`)
      ok(canvasGeom !== null, '白板页底栏与画布都存在')
      eq(Math.round(canvasGeom.footer.height), 38, '白板页底栏高度 38px')
      ok(canvasGeom.board.bottom <= canvasGeom.footer.top + 1, '应用底栏在画布之外,不遮画布')
      ok(canvasGeom.toolbar !== null, 'Excalidraw 自带工具条仍在')
      eq(canvasGeom.toolbar.insideBoard, true, 'Excalidraw 自带工具条仍位于画布内')
      await assertLinkContract(ctx)
    }
  }
]
