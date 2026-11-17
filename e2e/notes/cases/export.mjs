// 文档导出:笔记 → Markdown / HTML / PDF,文件 → 原文 / HTML / PDF。
//
// 原生保存框在 E2E 里没人点,运行器用 LAUNCHER_E2E_EXPORT_DIR 把落点指到临时目录
// (main 侧见 domains/export-path.ts)。所以这里能直接读导出的文件、逐字断言内容。
//
// 覆盖的用户可见路径:头部按钮 → 菜单项(按文件类型给出不同格式)→ 落盘文件 →
// 内容(含未保存改动、frontmatter 保留、原文编码/行尾、HTML 转义、PDF 文件头)。

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { eq, includes, ok } from '../lib/assert.mjs'
import { sleep } from '../lib/cdp.mjs'
import { absPath, writeNoteFile } from './rail-move.mjs'

const VIEW = `document.querySelector('.notes-editor-pane .cm-content')?.cmTile?.root?.view ?? null`

function exportsDir(ctx) {
  if (ctx.exportsDir === null || ctx.exportsDir === undefined) {
    throw new Error('运行器没有注入 exportsDir')
  }
  return ctx.exportsDir
}

function exportedPath(ctx, name) {
  return join(exportsDir(ctx), name)
}

/** 每条用例自己清空导出目录,避免同名去重干扰断言 */
function clearExports(ctx) {
  rmSync(exportsDir(ctx), { recursive: true, force: true })
  mkdirSync(exportsDir(ctx), { recursive: true })
}

async function waitExported(ctx, name) {
  const path = exportedPath(ctx, name)
  await ctx.waitForNode(
    async () => existsSync(path),
    `导出文件出现:${name}`,
    { timeout: 15_000 }
  )
  return path
}

/**
 * 执行一次导出并等到主进程记录「写完」。
 * 不能只看文件存在:写入过程中文件已经存在,紧接着读会读到空/半截内容。
 */
async function exportAs(ctx, format, name, mode = 'write') {
  const from = ctx.logs.length
  await openExportMenu(ctx)
  await clickFormat(ctx, format)
  await ctx.waitForNode(
    async () =>
      ctx.logs.slice(from).some((line) => line.includes(`[note-export] ${mode}`)),
    `导出完成:${name}`,
    { timeout: 30_000 }
  )
  return waitExported(ctx, name)
}

/** 展开一个目录行(夹具是直接写盘的,先等监听把目录推给列表) */
async function expandFolder(ctx, path) {
  const selector = `.notes-folder-row[data-folder-path=${JSON.stringify(path)}]`
  await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(selector)}) !== null`, {
    timeout: 10_000,
    message: `目录行出现:${path}`
  })
  await ctx.cdp.eval(`(() => {
    const row = document.querySelector(${JSON.stringify(selector)})
    const name = row?.querySelector('.notes-folder-name')
    if (name?.getAttribute('aria-expanded') !== 'true') name?.click()
    return name !== null
  })()`)
  await sleep(150)
}

async function openNoteRow(ctx, title) {
  const selector = `.notes-rail-list .notes-row[data-note-id=${JSON.stringify(title)}]`
  await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(selector)}) !== null`, {
    timeout: 10_000,
    message: `笔记行出现:${title}`
  })
  await ctx.cdp.eval(`document.querySelector(${JSON.stringify(selector)})?.click()`)
  await ctx.cdp.waitFor(
    `document.querySelector('.notes-title')?.value === ${JSON.stringify(title)}`,
    { timeout: 10_000, message: `打开笔记:${title}` }
  )
  await ctx.cdp.waitFor(`document.querySelector('.notes-editor-pane .cm-editor') !== null`, {
    message: '笔记编辑器挂载'
  })
}

async function openFileRow(ctx, rel, { expand = [] } = {}) {
  for (const folder of expand) await expandFolder(ctx, folder)
  const selector = `.notes-rail-list [data-file-path=${JSON.stringify(rel)}]`
  await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(selector)}) !== null`, {
    timeout: 10_000,
    message: `文件行出现:${rel}`
  })
  await ctx.cdp.eval(`document.querySelector(${JSON.stringify(selector)})?.click()`)
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  await ctx.cdp.waitFor(
    `document.querySelector('.file-main .file-name')?.textContent === ${JSON.stringify(name)}`,
    { timeout: 15_000, message: `文件视图打开:${rel}` }
  )
}

/** 头部导出按钮 → 打开菜单(已经开着就复用,不把按钮当开关来回点) */
async function openExportMenu(ctx) {
  await ctx.cdp.waitFor(`document.querySelector('.notes-hd-actions .notes-export-btn') !== null`, {
    timeout: 8000,
    message: '头部出现导出按钮'
  })
  const alreadyOpen = await ctx.cdp.eval(
    `(() => { const m = document.querySelector('.notes-export-menu')
      return m !== null && getComputedStyle(m).visibility === 'visible' })()`
  )
  if (alreadyOpen !== true) {
    // 上一次导出还没收尾时按钮是禁用的,点它不会开菜单
    await ctx.cdp.waitFor(
      `document.querySelector('.notes-hd-actions .notes-export-btn')?.disabled === false`,
      { timeout: 15_000, message: '导出按钮可用' }
    )
    await ctx.cdp.eval(`document.querySelector('.notes-hd-actions .notes-export-btn')?.click()`)
  }
  try {
    await ctx.cdp.waitFor(
      `(() => { const m = document.querySelector('.notes-export-menu')
        return m !== null && getComputedStyle(m).visibility === 'visible' })()`,
      { timeout: 5000, message: '导出菜单打开' }
    )
  } catch (error) {
    const state = await ctx.cdp.json(`(() => {
      const btn = document.querySelector('.notes-hd-actions .notes-export-btn')
      return {
        button: btn !== null,
        disabled: btn?.disabled ?? null,
        expanded: btn?.getAttribute('aria-expanded') ?? null,
        menu: document.querySelector('.notes-export-menu') !== null,
        menuVisibility: document.querySelector('.notes-export-menu') === null
          ? null
          : getComputedStyle(document.querySelector('.notes-export-menu')).visibility
      }
    })()`)
    throw new Error(`${error.message}；按钮/菜单状态=${JSON.stringify(state)}`)
  }
}

async function menuFormats(ctx) {
  return ctx.cdp.json(
    `[...document.querySelectorAll('.notes-export-menu [data-export-format]')]
      .map((el) => el.dataset.exportFormat)`
  )
}

async function clickFormat(ctx, format) {
  await ctx.cdp.eval(
    `document.querySelector('.notes-export-menu [data-export-format=${JSON.stringify(format)}]')?.click()`
  )
}

async function setNoteBody(ctx, text) {
  const okSet = await ctx.cdp.eval(`(() => {
    const v = ${VIEW}
    if (v === null) return false
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: ${JSON.stringify(text)} },
      selection: { anchor: 0 }
    })
    v.focus()
    return true
  })()`)
  if (okSet !== true) throw new Error('编辑器未挂载,无法替换正文')
  await ctx.waitForNode(async () => (await ctx.body()) === text, '正文替换完成')
}

/** 从 frontmatter 里取一个标量键(本用例只读自己写的单行键) */
function fmValue(text, key) {
  const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(text)
  return m === null ? null : m[1].trim()
}

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

export default [
  {
    id: 'export/note-menu-markdown',
    area: 'export',
    title:
      '笔记头部导出:菜单三项 Markdown/HTML/PDF,Escape 与外点关闭;导出的 .md 保留未知 frontmatter 键与 updated,未保存的正文也一起导出',
    tags: ['export', 'note', 'markdown'],
    async run(ctx) {
      clearExports(ctx)
      const id = '导出笔记'
      const rel = `${id}.md`
      const diskText = [
        '---',
        `title: ${id}`,
        'created: 2024-01-01T00:00:00+08:00',
        'updated: 2024-02-02T00:00:00+08:00',
        'custom-key: keep-me',
        '---',
        '',
        '# 标题',
        '',
        '原始正文',
        ''
      ].join('\n')
      writeNoteFile(ctx, rel, diskText)
      await openNoteRow(ctx, id)

      // 菜单:笔记只给这三项,按 markdown / html / pdf 的顺序
      await openExportMenu(ctx)
      eq(await menuFormats(ctx), ['markdown', 'html', 'pdf'], '笔记菜单是 Markdown/HTML/PDF')

      // Escape 关闭
      await ctx.press('Escape')
      await ctx.cdp.waitFor(`document.querySelector('.notes-export-menu') === null`, {
        timeout: 3000,
        message: 'Escape 关闭导出菜单'
      })

      // 外点关闭(pointerdown 路径)。点预览栏中部 —— 菜单浮在头部下方,
      // 点它附近会落到菜单项上,反而开始一次导出。
      await openExportMenu(ctx)
      const rect = await ctx.elementRect('.notes-preview-body')
      await ctx.cdp.click(rect.x + Math.min(rect.width / 2, 120), rect.y + Math.min(rect.height - 20, 320))
      await ctx.cdp.waitFor(`document.querySelector('.notes-export-menu') === null`, {
        timeout: 3000,
        message: '点菜单外关闭导出菜单'
      })

      // ① 没有编辑时导出:与磁盘逐项一致(updated 不被导出刷成当前时间)
      const first = await exportAs(ctx, 'markdown', `${id}.md`)
      const firstText = readFileSync(first, 'utf8')
      eq(fmValue(firstText, 'title'), id, '导出文件标题')
      eq(fmValue(firstText, 'updated'), '2024-02-02T00:00:00+08:00', '导出不刷新 updated')
      eq(fmValue(firstText, 'custom-key'), 'keep-me', '未知 frontmatter 键原样保留')
      includes(firstText, '原始正文', '正文在导出文件里')

      // ② 改一行但不等自动保存,立刻导出:导出的是编辑缓冲
      const edited = '# 标题\n\n这一行还没保存\n'
      await setNoteBody(ctx, edited)
      await ctx.cdp.waitFor(`document.querySelector('.notes-save-state.dirty') !== null`, {
        timeout: 5000,
        message: '正文处于未保存状态'
      })
      const second = await exportAs(ctx, 'markdown', `${id} (1).md`)
      includes(readFileSync(second, 'utf8'), '这一行还没保存', '未保存的正文也导出了')
      eq(
        fmValue(readFileSync(second, 'utf8'), 'custom-key'),
        'keep-me',
        '第二次导出仍保留未知键'
      )

      // 收尾:等自动保存落定再删文件,别让外部改动提示影响下一组
      await ctx.cdp.waitFor(`document.querySelector('.notes-save-state.dirty') === null`, {
        timeout: 10_000,
        message: '改动自动保存完成'
      })
      rmSync(absPath(ctx, rel), { force: true })
      await ctx.ensureMainNote()
    }
  },

  {
    id: 'export/note-html-pdf',
    area: 'export',
    title:
      '笔记导出 HTML 与 PDF:HTML 自带样式与渲染结果(标题/段落),PDF 是真实 PDF 文件并记录日志',
    tags: ['export', 'note', 'html', 'pdf'],
    async run(ctx) {
      clearExports(ctx)
      const id = '导出排版'
      const rel = `${id}.md`
      writeNoteFile(
        ctx,
        rel,
        ['---', `title: ${id}`, 'created: 2024-01-01T00:00:00+08:00', '---', '', '# 大标题', '', '一段正文', ''].join(
          '\n'
        )
      )
      await openNoteRow(ctx, id)

      const htmlPath = await exportAs(ctx, 'html', `${id}.html`)
      const html = readFileSync(htmlPath, 'utf8')
      includes(html, '<!doctype html>', 'HTML 导出有 doctype')
      includes(html, '<meta charset="utf-8">', 'HTML 导出声明 UTF-8')
      includes(html, '<style>', 'HTML 导出内联样式')
      includes(html, 'md-h1', '标题渲染成 md-h1')
      includes(html, '大标题', '标题文本')
      includes(html, '一段正文', '段落文本')

      const pdfPath = await exportAs(ctx, 'pdf', `${id}.pdf`, 'pdf')
      const pdf = readFileSync(pdfPath)
      ok(pdf.length > 1024, `PDF 不是空壳(实际 ${pdf.length} 字节)`)
      eq(pdf.subarray(0, 5).toString('latin1'), '%PDF-', 'PDF 文件头')

      rmSync(absPath(ctx, rel), { force: true })
      await ctx.ensureMainNote()
    }
  },

  {
    id: 'export/file-formats',
    area: 'export',
    title:
      '文件按类型给格式:text 三项且原文保留 BOM/CRLF;HTML 文件直接预览、没有导出入口;图片也没有入口',
    tags: ['export', 'file', 'text', 'html'],
    async run(ctx) {
      clearExports(ctx)
      const txt = '导出原文.txt'
      const original = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('第一行 <b>x</b>\r\nsecond\r\n', 'utf8')
      ])
      writeNoteFile(ctx, txt, original)
      writeNoteFile(ctx, '导出站点/index.html', '<!doctype html><html><body><p id="p">站点</p></body></html>')
      writeNoteFile(ctx, '导出图片.png', PNG_1x1)

      // ── text:原文 / HTML / PDF ──
      await openFileRow(ctx, txt)
      await openExportMenu(ctx)
      eq(await menuFormats(ctx), ['text', 'html', 'pdf'], 'text 文件菜单是原文/HTML/PDF')

      const textPath = await exportAs(ctx, 'text', txt)
      eq(
        readFileSync(textPath).equals(original),
        true,
        '原文导出逐字节保留 BOM 与 CRLF'
      )

      const plainHtmlPath = await exportAs(ctx, 'html', '导出原文.html')
      const plainHtml = readFileSync(plainHtmlPath, 'utf8')
      includes(plainHtml, '<pre class="md-export-plain">', '纯文本导出走 pre')
      includes(plainHtml, '&lt;b&gt;x&lt;/b&gt;', '正文被 HTML 转义')

      const txtPdf = readFileSync(await exportAs(ctx, 'pdf', '导出原文.pdf', 'pdf'))
      eq(txtPdf.subarray(0, 5).toString('latin1'), '%PDF-', 'text 文件也能导出 PDF')

      // ── HTML:应用内预览就是最终形态,头部不再提供导出 ──
      await openFileRow(ctx, '导出站点/index.html', { expand: ['导出站点'] })
      eq(
        await ctx.cdp.eval(`document.querySelector('.file-main .notes-export-btn') === null`),
        true,
        'HTML 文件头部没有导出按钮'
      )

      // ── 图片:没有导出入口 ──
      await openFileRow(ctx, '导出图片.png')
      eq(
        await ctx.cdp.eval(`document.querySelector('.file-main .notes-export-btn') === null`),
        true,
        '图片文件头部没有导出按钮'
      )

      // 收尾
      for (const rel of [txt, '导出站点/index.html', '导出图片.png']) {
        rmSync(absPath(ctx, rel), { force: true })
      }
      rmSync(absPath(ctx, '导出站点'), { recursive: true, force: true })
      await sleep(150)
      await ctx.ensureMainNote()
    }
  }
]
