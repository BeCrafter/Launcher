// 白板:Excalidraw 场景文件。从目录新建预填 excal,正文是它自己的场景 JSON。
// 已经在库里的 .excalidraw 仍按白板打开。
//
// 覆盖用户看得见的路径:入口、画布而不是代码编辑器、文字写完离开再打开还在、
// 画笔落盘、自带缩放按钮改变百分比、Backspace 与 Delete 删掉选中的元素、
// 解不开的文本(包括旧的 JSON Canvas)只报错不改字节、
// 嵌进去的笔记按渲染样式显示、库内图片显示出来,离开再打开还在。
// 第一级是类型;笔记和文件进第二级;网页切到画布上拖,不在选择器里填地址。
// 素材库的「打开」只接受 .excalidrawlib,图片不读内容,并提示不支持当前类型。
// 拖到画布上的场景和素材库不读内容,也不替换当前白板。
// 可预览的文件嵌进去,平时跟原文件,不拷进笔记目录;图片仍可以放上去。
// 原文件不在时读项目副本;原文件还在就读它,不管记的是哪台电脑。
// 各类文件嵌进卡片后,点一下要能进入交互:图片放大、表格换表、压缩包点条目、
// 视频有控件且不自己播放。没点之前卡片不接指针。
// Excalidraw 0.18 没有小地图,缩放看 `.reset-zoom-button` 里的百分比。

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { eq, includes, ok } from '../lib/assert.mjs'
import { sleep } from '../lib/cdp.mjs'

function notesDir(ctx) {
  return join(ctx.profileDir, 'notes')
}

function absPath(ctx, rel) {
  return join(notesDir(ctx), rel)
}

function writeVaultFile(ctx, rel, content) {
  const full = absPath(ctx, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
  return full
}

/** 直接写一份场景。目录扫描是异步的,调用方要等白板行出现再打开。 */
function writeCanvas(ctx, rel, scene) {
  return writeVaultFile(ctx, rel, scene)
}

/** 一页、带交叉引用的 PDF。空壳会被阅读器拒绝,卡片会掉进失败占位。 */
function onePagePdf(text) {
  const objs = []
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
  objs[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
  objs[4] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  let out = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 1; i < objs.length; i += 1) {
    offsets[i] = out.length
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objs.length; i += 1) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return out
}

/** 1×1 的 PNG。库内图片嵌进白板后,查看器按这个地址显示。 */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

function fileSelector(rel) {
  return `[data-file-path=${JSON.stringify(rel)}]`
}

async function createCanvas(ctx, name) {
  await ctx.cdp.eval(`document.querySelector('[data-new="canvas"]')?.click()`)
  await ctx.cdp.waitFor(`document.querySelector('.notes-create-fields .notes-create-name') !== null`, {
    timeout: 5000,
    message: '出现新建白板的名字输入框'
  })
  const ext = await ctx.cdp.eval(`document.querySelector('.notes-create-ext-input')?.value`)
  eq(ext, 'excal', '白板入口把类型预填成 excal')
  await ctx.cdp.eval(`document.querySelector('.notes-create-name')?.select()`)
  await ctx.cdp.type(name)
  await ctx.press('Enter')
  await ctx.cdp.waitFor(
    `document.querySelector('.file-main .file-name')?.textContent === ${JSON.stringify(`${name}.excal`)}`,
    { timeout: 15_000, message: '白板在应用内打开' }
  )
  await ctx.cdp.waitFor(`document.querySelector('.canvas-board .excalidraw') !== null`, {
    timeout: 15_000,
    message: '窗格里是 Excalidraw 画布'
  })
}

async function openCanvasFile(ctx, rel) {
  const sel = fileSelector(rel)
  await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(sel)}) !== null`, {
    timeout: 10_000,
    message: `白板行出现:${rel}`
  })
  await ctx.cdp.eval(`document.querySelector(${JSON.stringify(sel)})?.click()`)
  await ctx.cdp.waitFor(
    `document.querySelector('.file-main .file-name')?.textContent === ${JSON.stringify(rel.split('/').pop())}`,
    { timeout: 15_000, message: `白板打开:${rel}` }
  )
}

async function waitCanvasSaved(ctx) {
  await ctx.cdp.waitFor(
    `(() => { const el = document.querySelector('.file-main .notes-save-state');
      return el !== null && !el.classList.contains('dirty') && !el.classList.contains('saving') })()`,
    { timeout: 10_000, message: '白板自动保存完成' }
  )
}

async function clickTool(ctx, name) {
  await ctx.cdp.eval(
    `document.querySelector(${JSON.stringify(`[data-testid="toolbar-${name}"]`)})?.click()`
  )
  await sleep(80)
}

/**
 * 真实指针点元素中心。
 * HTMLElement.click() 不派发 pointerdown,菜单会在捕获阶段先被关掉,点击看起来没效果,这种回归要用这里才能复现。
 */
/** 嵌入入口在「更多工具」里,和 Excalidraw 的「嵌入网页」是同一项。 */
async function openEmbedPicker(ctx) {
  await pointerClick(ctx, '.App-toolbar__extra-tools-trigger')
  await ctx.cdp.waitFor(
    `document.querySelector('.dropdown-menu-container [data-testid="toolbar-embeddable"]') !== null`,
    { timeout: 5000, message: '更多工具里有嵌入这一项' }
  )
  ok(
    await ctx.cdp.eval(
      `document.querySelector('.dropdown-menu-container [data-testid="toolbar-embeddable"] .dropdown-menu-item__text')?.textContent === '嵌入'`
    ),
    '更多工具里这一项叫嵌入'
  )
  await pointerClick(ctx, '.dropdown-menu-container [data-testid="toolbar-embeddable"]')
  await ctx.cdp.waitFor(`document.querySelector('.canvas-embed-picker') !== null`, {
    timeout: 5000,
    message: '嵌入选择器打开'
  })
  ok(
    await ctx.cdp.eval(`document.querySelector('.dropdown-menu-container') === null`),
    '选择器打开后更多工具菜单关上'
  )
}

async function pointerClick(ctx, selector) {
  const box = await ctx.cdp.json(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (el === null) return null
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const top = document.elementFromPoint(x, y)
    const label = el.labels ? el.labels[0] : null
    const hit = top !== null && (top === el || el.contains(top) || top.contains(el) || (label !== null && (top === label || label.contains(top))))
    const by = top === null ? null : ((top.getAttribute('class') || top.tagName) + (label === null ? ' no-label' : ' label'))
    return { x, y, hit, by }
  })()`)
  ok(box !== null, `要点到:${selector}`)
  ok(box.hit, `指针落点被别的东西挡住:${selector} ← ${box.by ?? '视口外'}`)
  await ctx.cdp.click(box.x, box.y)
}

/** 在画布上层找一块不压着工具栏、缩放条和已有文字的空白。 */
async function clearSpot(ctx) {
  const spot = await ctx.cdp.json(`(() => {
    const board = document.querySelector('.canvas-board')
    const canvas = document.querySelector('.canvas-board canvas.excalidraw__canvas.interactive')
    if (board === null || canvas === null) return null
    const box = board.getBoundingClientRect()
    const blocked = [...document.querySelectorAll(
      '.App-toolbar, .zoom-actions, .Stack, .excalidraw-wysiwyg'
    )].map((el) => el.getBoundingClientRect())
    const clear = (x, y) => x > box.left + 24 && x < box.right - 24 && y > box.top + 24 && y < box.bottom - 24
      && blocked.every((rect) => rect.width === 0 || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)
    const onCanvas = (x, y) => {
      const top = document.elementFromPoint(x, y)
      return top === canvas
    }
    for (let y = box.top + 120; y < box.bottom - 80; y += 28) {
      for (let x = box.left + 160; x < box.right - 160; x += 36) {
        if (clear(x, y) && onCanvas(x, y)) return { x, y }
      }
    }
    return null
  })()`)
  ok(spot !== null && typeof spot.x === 'number', '画布上有空白可以点')
  return spot
}

/** 用文本工具点一下。属性面板会跟着打开,所以落点在选中工具之后再找。 */
async function placeText(ctx, text, nudge = { x: 0, y: 0 }) {
  await clickTool(ctx, 'text')
  await sleep(200)
  const spot = await clearSpot(ctx)
  const at = { x: spot.x + nudge.x, y: spot.y + nudge.y }
  ok(
    await ctx.cdp.eval(`(() => {
      const canvas = document.querySelector('canvas.excalidraw__canvas.interactive')
      return document.elementFromPoint(${at.x}, ${at.y}) === canvas
    })()`),
    '文字落在画布上'
  )
  await ctx.cdp.click(at.x, at.y)
  await ctx.cdp.waitFor(`document.querySelector('textarea.excalidraw-wysiwyg') !== null`, {
    timeout: 5000,
    message: '文本工具点出就地编辑框'
  })
  const editor = await ctx.cdp.json(`(() => {
    const el = document.querySelector('textarea.excalidraw-wysiwyg')
    const rect = el.getBoundingClientRect()
    return { x: rect.x + 2, y: rect.y + rect.height / 2 }
  })()`)
  await ctx.cdp.click(editor.x, editor.y)
  await ctx.cdp.type(text)
  eq(
    await ctx.cdp.eval(`document.querySelector('textarea.excalidraw-wysiwyg')?.value`),
    text,
    '字写在画布上的编辑框里'
  )
  await ctx.press('Escape')
  await ctx.cdp.waitFor(`document.querySelector('textarea.excalidraw-wysiwyg') === null`, {
    timeout: 5000,
    message: 'Escape 收起文字编辑'
  })
  return { x: at.x + 12, y: at.y + 8 }
}

/** 字写在画布上,不在 DOM 文本里。双击落点再进编辑,才能读到字。 */
async function readTextAt(ctx, spot) {
  await clickTool(ctx, 'selection')
  await ctx.cdp.mouse('mousePressed', spot.x, spot.y, { buttons: 1, clickCount: 1 })
  await ctx.cdp.mouse('mouseReleased', spot.x, spot.y, { buttons: 0, clickCount: 1 })
  await ctx.cdp.mouse('mousePressed', spot.x, spot.y, { buttons: 1, clickCount: 2 })
  await ctx.cdp.mouse('mouseReleased', spot.x, spot.y, { buttons: 0, clickCount: 2 })
  await ctx.cdp.waitFor(`document.querySelector('textarea.excalidraw-wysiwyg') !== null`, {
    timeout: 5000,
    message: '双击文字进入编辑'
  })
  const value = await ctx.cdp.eval(`document.querySelector('textarea.excalidraw-wysiwyg')?.value`)
  await ctx.press('Escape')
  await ctx.cdp.waitFor(`document.querySelector('textarea.excalidraw-wysiwyg') === null`, {
    timeout: 5000,
    message: '读完文字后收起编辑'
  })
  return value
}

function liveElements(scene) {
  return (scene.elements ?? []).filter((element) => element.isDeleted !== true)
}

/** 等到落盘场景满足条件。拖放的写入是异步的,不能在松手后立刻读。 */
async function waitForScene(ctx, rel, ready) {
  const deadline = Date.now() + 8000
  let last = ''
  while (Date.now() < deadline) {
    last = readFileSync(absPath(ctx, rel), 'utf8')
    try {
      const scene = JSON.parse(last)
      if (ready(scene)) return scene
    } catch {
      // 写入还没结束
    }
    await sleep(100)
  }
  throw new Error(`场景没有变成预期的样子:${rel} ${last.slice(0, 180)}`)
}

/** 把本地文件拖到画布空白处。场景和素材库必须带真实路径,选择器才会读到文件。 */
async function dropOnCanvas(ctx, paths) {
  const spot = await clearSpot(ctx)
  await ctx.prepareFileDrag(paths)
  await ctx.cdp.eval(`(() => {
    const canvas = document.querySelector('.canvas-board canvas.excalidraw__canvas.interactive')
    const dt = window.__e2eFileTransfer
    if (canvas === null || !(dt instanceof DataTransfer)) return false
    const init = { bubbles: true, cancelable: true, clientX: ${spot.x}, clientY: ${spot.y}, dataTransfer: dt }
    canvas.dispatchEvent(new DragEvent('dragenter', init))
    canvas.dispatchEvent(new DragEvent('dragover', init))
    canvas.dispatchEvent(new DragEvent('drop', init))
    return true
  })()`)
}

/** 一份只有一段文本的 docx。卡片要把这段字画出来。 */
async function makeDocx(text) {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'
  )
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`
  )
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}

/** 两张工作表。卡片里要能点到第二张。 */
async function makeXlsx() {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('数据').getCell('A1').value = '第一表'
  workbook.addWorksheet('第二表').getCell('A1').value = '另一张表'
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

/** 一份只有一个文本条目的 zip。 */
async function makeZip(name, text) {
  const zip = new JSZip()
  zip.file(name, text)
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}

/** 一个三角面。模型查看器要能画出自己的画布。 */
const STL_ASCII = [
  'solid e2e',
  'facet normal 0 0 1',
  'outer loop',
  'vertex 0 0 0',
  'vertex 1 0 0',
  'vertex 0 1 0',
  'endloop',
  'endfacet',
  'endsolid e2e'
].join('\n')

/** 四帧黑白的 H.264。卡片要能挂上带控件的 video,并且不自己开始播。 */
const MP4_TINY = Buffer.from(
  'AAAAHGZ0eXBtcDQyAAAAAWlzb21tcDQxbXA0MgAAAAFtZGF0AAAAAAAAAOQAAAA1BgUtR1ZK3FxMQz+U78URPNFDqAEAAAMAAQMAAAMAAQIAAeYACwAAAwAAAwAACFIMA5ErAYAAAAA5JbggH94I5Uz/n/9jf/JtF0gAh/2tp4akvq+1cKjJBcxGF+opkpW1SxvPfAAAK6hlS3gCyc+KDxIwAAAAHiHhDF/Eku94VQKkgu1okfxkMzyMiyZn4AASJVpZ0AAAABohqIKEv5xU+3GaET774o7QvEhEHKAATt5m6gAAABoBqMGP/6fK15GVOBRAUfGIojZKp6AAKVLFFwAAAv5tb292AAAAbG12aGQAAAAA5xvXIOcb1yEAAAJYAAAA8AABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACinRyYWsAAABcdGtoZAAAAAHnG9ch5xvXIQAAAAEAAAAAAAAA8AAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAEAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAAPAAAAB4AAEAAAAAAgJtZGlhAAAAIG1kaGQAAAAA5xvXIecb1yEAAAJYAAAA8FXEAAAAAAAxaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAENvcmUgTWVkaWEgVmlkZW8AAAABqW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAWlzdGJsAAAAoXN0c2QAAAAAAAAAAQAAAJFhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAJ2F2Y0MBZAAL/+EADCdkAAusVlDDeBBhFAEABCjuPLD9+PgAAAAACmZpZWwBAAAAAApjaHJtAAAAAAAYc3R0cwAAAAAAAAABAAAABAAAADwAAAAwY3R0cwAAAAAAAAAEAAAAAQAAAHgAAAABAAAA8AAAAAEAAAB4AAAAAQAAAAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABBzZHRwAAAAACAQEBgAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAQAAAABAAAAJHN0c3oAAAAAAAAAAAAAAAQAAAB2AAAAIgAAAB4AAAAeAAAAFHN0Y28AAAAAAAAAAQAAACw=',
  'base64'
)

/** 一块带外部文件记录的嵌入。link 只放文件名,路径在 customData 里。 */
function externalScene(fileName, embed) {
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [
      {
        type: 'embeddable',
        id: 'embed-1',
        x: 0,
        y: 0,
        width: 720,
        height: 480,
        link: `launcher-note://file/${encodeURIComponent(fileName)}`,
        strokeColor: 'transparent',
        backgroundColor: 'transparent',
        isDeleted: false,
        customData: { embed }
      }
    ],
    appState: {},
    files: {}
  })
}

/** 从「更多工具 → 嵌入」选一份库外文件。选择框被换成直接填路径。 */
async function embedLocalFile(ctx, name, abs) {
  await openEmbedPicker(ctx)
  await ctx.cdp.eval(`(() => {
    const proto = HTMLInputElement.prototype
    if (proto.__embedClick) return
    const click = proto.click
    proto.click = function () {
      if (this.type === 'file') return
      return click.call(this)
    }
    proto.__embedClick = true
  })()`)
  await pointerClick(ctx, '[data-embed-kind="computer"]')
  const inputId = await ctx.cdp.evalHandle(
    `document.querySelector('.canvas-embed-picker-file')`
  )
  ok(inputId !== null && inputId !== undefined, '嵌入用的文件框在')
  await ctx.cdp.send('DOM.setFileInputFiles', { files: [abs], objectId: inputId })
  await ctx.cdp.send('Runtime.releaseObject', { objectId: inputId }).catch(() => {})
  await ctx.cdp.waitFor(
    `document.querySelector(${JSON.stringify(`[data-embed-label="${name}"]`)}) !== null`,
    { timeout: 15_000, message: `卡片出现:${name}` }
  )
}

/** 把指定文件的那张卡片滚到视口中间,返回它的中心。多块卡片叠着时靠文件名区分。 */
async function cardCenter(ctx, name) {
  const sel = `[data-embed-label=${JSON.stringify(name)}]`
  const spot = await ctx.cdp.json(`(() => {
    const card = document.querySelector(${JSON.stringify(sel)})
    if (card === null) return null
    card.scrollIntoView({ block: 'center', inline: 'center' })
    const box = card.getBoundingClientRect()
    return {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
      active: card.dataset.embedActive === 'true',
      events: getComputedStyle(card).pointerEvents
    }
  })()`)
  ok(spot !== null, `找到卡片:${name}`)
  return spot
}

/** 这张白板上只有刚嵌进去的一块,并且还没打包。 */
async function assertSingleEmbed(ctx, rel, name) {
  const scene = await waitForScene(
    ctx,
    rel,
    (next) => liveElements(next).filter((element) => element.type === 'embeddable').length === 1
  )
  const embed = liveElements(scene).find((element) => element.type === 'embeddable')
  eq(embed.customData?.embed?.project, '', `${name} 嵌入时不写项目路径`)
  ok(embed.customData?.embed?.source?.endsWith(name) === true, `${name} 记下的是这份源文件`)
}

/** 点一下进入交互。没点之前卡片不接指针,里面的按钮也点不到。 */
async function activateCard(ctx, name) {
  const before = await cardCenter(ctx, name)
  eq(before.events, 'none', `${name} 没点之前不接指针`)
  ok(before.active === false, `${name} 没点之前还不能交互`)
  await ctx.cdp.click(before.x, before.y)
  await ctx.cdp.waitFor(
    `document.querySelector(${JSON.stringify(`[data-embed-label="${name}"]`)})?.dataset.embedActive === 'true'`,
    { timeout: 5000, message: `${name} 点一下后可以交互` }
  )
}

/** 链接里的路径是逐段编码的。比较时解回原路径。 */
function embedPath(link) {
  const body = link.startsWith('note:')
    ? link.slice('note:'.length)
    : link.startsWith('launcher-note://file/')
      ? link.slice('launcher-note://file/'.length).split(/[?#]/, 1)[0]
      : ''
  return body
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join('/')
}

export default [
  {
    id: 'canvas/create-and-text',
    area: 'canvas',
    title: '从目录建白板:行是 canvas,窗格是画布;文字写完离开再打开还在,画笔与缩放也落盘',
    tags: ['canvas', 'create', 'save'],
    async run(ctx) {
      await createCanvas(ctx, '第一张白板')
      eq(
        await ctx.cdp.eval(`document.querySelector('.file-main .cm-editor')`),
        null,
        '白板不进代码编辑器'
      )
      // 空文件打开不算改过。等一轮自动保存窗口,确认没有被写成空场景。
      await sleep(1200)
      eq(readFileSync(absPath(ctx, '第一张白板.excal'), 'utf8'), '', '新建出来仍是空文件')

      const row = await ctx.cdp.json(`(() => {
        const el = document.querySelector(${JSON.stringify(fileSelector('第一张白板.excal'))})
        const icon = el?.querySelector('.notes-file-icon')
        return { kind: el?.dataset.fileKind ?? null, icon: icon?.className ?? '' }
      })()`)
      eq(row?.kind, 'canvas', '文件行 data-file-kind 是 canvas')
      includes(row?.icon ?? '', 'fa-chalkboard', '白板行用黑板图标')

      const textAt = await placeText(ctx, '画布上的字')
      eq(await readTextAt(ctx, textAt), '画布上的字', '收笔后画布上还看得到这段字')
      await waitCanvasSaved(ctx)

      const saved = JSON.parse(readFileSync(absPath(ctx, '第一张白板.excal'), 'utf8'))
      eq(saved.type, 'excalidraw', '文件是 Excalidraw 场景')
      const textElement = liveElements(saved).find((element) => element.type === 'text')
      eq(textElement?.text, '画布上的字', '文字写进场景的 text 元素')

      // 离开再打开:点一篇笔记再点回来
      await ctx.cdp.eval(`document.querySelector('.notes-row[data-note-id]')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.notes-title') !== null`, {
        timeout: 10_000,
        message: '切到一篇笔记'
      })
      await openCanvasFile(ctx, '第一张白板.excal')
      await ctx.cdp.waitFor(`document.querySelector('.canvas-board canvas.excalidraw__canvas.interactive') !== null`, {
        timeout: 10_000,
        message: '重新打开后画布挂上'
      })
      eq(await readTextAt(ctx, textAt), '画布上的字', '重新打开后字还在')

      await clickTool(ctx, 'freedraw')
      await sleep(200)
      const strokeAt = await clearSpot(ctx)
      const x = strokeAt.x
      const y = strokeAt.y
      await ctx.cdp.mouse('mousePressed', x, y, { buttons: 1 })
      await ctx.cdp.mouse('mouseMoved', x + 30, y + 16, { buttons: 1 })
      await ctx.cdp.mouse('mouseMoved', x + 60, y, { buttons: 1 })
      await ctx.cdp.mouse('mouseReleased', x + 60, y, { buttons: 0 })
      await waitCanvasSaved(ctx)
      const inked = JSON.parse(readFileSync(absPath(ctx, '第一张白板.excal'), 'utf8'))
      const stroke = liveElements(inked).find((element) => element.type === 'freedraw')
      ok(Array.isArray(stroke?.points) && stroke.points.length >= 2, '画笔写成 freedraw,至少两个点')

      await openCanvasFile(ctx, '第一张白板.excal')
      await ctx.cdp.waitFor(`document.querySelector('.canvas-board canvas.excalidraw__canvas.interactive') !== null`, {
        timeout: 10_000,
        message: '重开后画布挂上'
      })
      await sleep(400)
      const reopened = JSON.parse(readFileSync(absPath(ctx, '第一张白板.excal'), 'utf8'))
      ok(
        liveElements(reopened).some((element) => element.type === 'text' && element.text === '画布上的字'),
        '重开后文字还在文件里'
      )
      ok(
        liveElements(reopened).some((element) => element.type === 'freedraw'),
        '重开后画笔还在文件里'
      )

      const percentBefore = Number(
        await ctx.cdp.eval(
          `document.querySelector('.reset-zoom-button')?.textContent?.replace('%', '').trim()`
        )
      )
      ok(Number.isFinite(percentBefore) && percentBefore > 0, '缩放按钮上有百分比')
      // 顶到最大时放大不会变。顶格时改点缩小。
      const zoomIn = percentBefore < 200
      await ctx.cdp.eval(
        `document.querySelector(${JSON.stringify(zoomIn ? '.zoom-in-button' : '.zoom-out-button')})?.click()`
      )
      await ctx.cdp.waitFor(
        `(() => {
          const next = Number(document.querySelector('.reset-zoom-button')?.textContent?.replace('%', '').trim())
          return Number.isFinite(next) && (${zoomIn} ? next > ${percentBefore} : next < ${percentBefore})
        })()`,
        { timeout: 5000, message: '缩放按钮改变视口百分比' }
      )
    }
  },

  {
    id: 'canvas/delete',
    area: 'canvas',
    title: '两块文字分别用 Backspace 和 Delete 删掉,保存后没有未删除的元素',
    tags: ['canvas', 'delete'],
    async run(ctx) {
      await createCanvas(ctx, '删除板')
      const firstAt = await placeText(ctx, '第一块')
      const secondAt = await placeText(ctx, '第二块', { x: 0, y: 90 })
      eq(await readTextAt(ctx, firstAt), '第一块', '第一块文字在画布上')
      eq(await readTextAt(ctx, secondAt), '第二块', '第二块文字在画布上')

      await clickTool(ctx, 'selection')
      await ctx.cdp.click(firstAt.x, firstAt.y)
      await sleep(150)
      if (await ctx.cdp.eval(`document.querySelector('textarea.excalidraw-wysiwyg') !== null`)) {
        await ctx.press('Escape')
      }
      await ctx.cdp.eval(`document.querySelector('.excalidraw')?.focus()`)
      await ctx.press('Backspace')
      await sleep(200)
      await clickTool(ctx, 'selection')
      await ctx.cdp.click(secondAt.x, secondAt.y)
      await sleep(150)
      if (await ctx.cdp.eval(`document.querySelector('textarea.excalidraw-wysiwyg') !== null`)) {
        await ctx.press('Escape')
      }
      await ctx.cdp.eval(`document.querySelector('.excalidraw')?.focus()`)
      await ctx.press('Delete')
      await waitCanvasSaved(ctx)
      const saved = JSON.parse(readFileSync(absPath(ctx, '删除板.excal'), 'utf8'))
      eq(
        liveElements(saved).length,
        0,
        '保存后没有未删除的元素'
      )
    }
  },

  {
    id: 'canvas/invalid-json',
    area: 'canvas',
    title: '解不开的 .excalidraw 和旧的 JSON Canvas 都显示错误,文件字节不变',
    tags: ['canvas', 'error'],
    async run(ctx) {
      const broken = '{ 这不是 json'
      writeVaultFile(ctx, '坏掉.excalidraw', broken)
      await openCanvasFile(ctx, '坏掉.excalidraw')
      await ctx.cdp.waitFor(`document.querySelector('.canvas-error') !== null`, {
        timeout: 10_000,
        message: '坏文件显示解析错误'
      })
      eq(
        await ctx.cdp.eval(`document.querySelector('.canvas-board .excalidraw')`),
        null,
        '坏文件不进画布'
      )
      eq(readFileSync(absPath(ctx, '坏掉.excalidraw'), 'utf8'), broken, '打开错误不改文件字节')
      ok(existsSync(absPath(ctx, '坏掉.excalidraw')), '文件还在')

      const legacy = '{ "nodes": [], "edges": [] }'
      writeVaultFile(ctx, '旧白板.excalidraw', legacy)
      await openCanvasFile(ctx, '旧白板.excalidraw')
      await ctx.cdp.waitFor(`document.querySelector('.canvas-error') !== null`, {
        timeout: 10_000,
        message: '旧的 JSON Canvas 也显示解析错误'
      })
      eq(
        await ctx.cdp.eval(`document.querySelector('.canvas-board .excalidraw')`),
        null,
        '旧格式不进画布'
      )
      await sleep(1200)
      eq(readFileSync(absPath(ctx, '旧白板.excalidraw'), 'utf8'), legacy, '旧格式打开后字节不变')
    }
  },

  {
    id: 'canvas/embed',
    area: 'canvas',
    title: '嵌进白板的笔记按渲染样式显示,库内图片也显示,离开再打开还在',
    tags: ['canvas', 'embed'],
    async run(ctx) {
      writeVaultFile(
        ctx,
        '嵌入的笔记.md',
        '---\ntitle: 嵌入的笔记\n---\n\n# 渲染出来的标题\n\n一段**加粗**的正文\n'
      )
      writeVaultFile(ctx, '嵌入的图.png', PNG_1PX)
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify('[data-note-id="嵌入的笔记"]')}) !== null`,
        { timeout: 10_000, message: '笔记出现在目录里' }
      )
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileSelector('嵌入的图.png'))}) !== null`,
        { timeout: 10_000, message: '图片出现在目录里' }
      )

      await createCanvas(ctx, '嵌入板')
      ok(
        await ctx.cdp.eval(`document.querySelector('.canvas-embed-button') === null`),
        '右上角不再有压住素材库的嵌入按钮'
      )
      ok(
        await ctx.cdp.eval(`document.querySelector('.default-sidebar-trigger') !== null`),
        '素材库按钮还在'
      )
      ok(
        await ctx.cdp.eval(`document.querySelector('.canvas-embed-tool') === null`),
        '工具栏末尾不再另挂一颗嵌入按钮'
      )
      await openEmbedPicker(ctx)
      await pointerClick(ctx, '[data-embed-page="library"]')
      await ctx.cdp.waitFor(`document.querySelector('.canvas-embed-picker-query') !== null`, {
        timeout: 5000,
        message: '笔记和文件这一级有搜索'
      })
      await ctx.press('Escape')
      await ctx.cdp.waitFor(
        `document.querySelector('.canvas-embed-picker') !== null && document.querySelector('.canvas-embed-picker-query') === null && document.querySelector('[data-embed-kind="pdf"]') !== null`,
        { timeout: 5000, message: 'Escape 从笔记和文件回到类型' }
      )
      await ctx.press('Escape')
      await ctx.cdp.waitFor(
        `document.querySelector('.canvas-embed-picker') === null && document.querySelector('.dropdown-menu-container') === null`,
        { timeout: 5000, message: '再按 Escape 关掉选择器，更多工具菜单也不在' }
      )
      await openEmbedPicker(ctx)
      ok(
        await ctx.cdp.eval(`document.querySelector('input[data-embed-web]') === null`),
        '选择器里不再填网址'
      )
      ok(
        await ctx.cdp.eval(`document.querySelector('button[data-embed-web]')?.textContent?.includes('网页') === true`),
        '第一级有网页这一行'
      )
      await pointerClick(ctx, 'button[data-embed-web]')
      await ctx.cdp.waitFor(
        `document.querySelector('.canvas-embed-picker') === null && document.querySelector('.HintViewer')?.textContent?.includes('点击并拖动以创建嵌入网页') === true`,
        { timeout: 5000, message: '网页改到画布上拖' }
      )
      await clickTool(ctx, 'selection')
      await ctx.cdp.waitFor(
        `document.querySelector('.HintViewer')?.textContent?.includes('点击并拖动以创建嵌入网页') !== true`,
        { timeout: 5000, message: '切回选择工具' }
      )
      await openEmbedPicker(ctx)
      await pointerClick(ctx, '[data-embed-page="library"]')
      await pointerClick(ctx, '.canvas-embed-picker-row[data-embed-path="嵌入的笔记"]')
      await ctx.cdp.waitFor(
        `document.querySelector('.canvas-embed .md-h')?.textContent?.includes('渲染出来的标题') === true`,
        { timeout: 10_000, message: '笔记按标题样式渲染在画布上' }
      )
      ok(
        await ctx.cdp.eval(`document.querySelector('.canvas-embed strong')?.textContent === '加粗'`),
        '笔记正文的加粗也渲染出来'
      )

      await openEmbedPicker(ctx)
      await pointerClick(ctx, '[data-embed-page="library"]')
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify('.canvas-embed-picker-row[data-embed-path="嵌入的图.png"]')}) !== null`,
        { timeout: 5000, message: '图片出现在选择器里' }
      )
      await pointerClick(ctx, '.canvas-embed-picker-row[data-embed-path="嵌入的图.png"]')
      await ctx.cdp.waitFor(
        `document.querySelector('.canvas-embed .file-image')?.complete === true`,
        { timeout: 10_000, message: '库内图片显示在画布上' }
      )

      await waitCanvasSaved(ctx)
      const saved = JSON.parse(readFileSync(absPath(ctx, '嵌入板.excal'), 'utf8'))
      const embeds = liveElements(saved).filter((element) => element.type === 'embeddable')
      eq(embeds.length, 2, '两块嵌入都写进场景')
      ok(
        embeds.some((element) => element.link.startsWith('note:') && embedPath(element.link) === '嵌入的笔记'),
        '笔记嵌成 note: 链接'
      )
      ok(
        embeds.some(
          (element) =>
            element.link.startsWith('launcher-note://file/') && embedPath(element.link) === '嵌入的图.png'
        ),
        '图片嵌成库内文件链接'
      )

      await ctx.cdp.eval(`document.querySelector('.notes-row[data-note-id]')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.notes-title') !== null`, {
        timeout: 10_000,
        message: '切到一篇笔记'
      })
      await openCanvasFile(ctx, '嵌入板.excal')
      await ctx.cdp.waitFor(
        `document.querySelector('.canvas-embed .md-h')?.textContent?.includes('渲染出来的标题') === true`,
        { timeout: 10_000, message: '重新打开后笔记还按样式显示' }
      )
      await ctx.cdp.waitFor(
        `document.querySelector('.canvas-embed .file-image')?.complete === true`,
        { timeout: 10_000, message: '重新打开后图片还在' }
      )
    }
  },

  {
    id: 'canvas/image',
    area: 'canvas',
    title: '插入图像接受图片并放到画布上,普通 PNG 不替换场景',
    tags: ['canvas', 'image'],
    async run(ctx) {
      await createCanvas(ctx, '插图')
      await ctx.cdp.eval(`(() => {
        window.showOpenFilePicker = async (options) => {
          window.__imagePicker = options
          const bytes = Uint8Array.from(atob(${JSON.stringify(PNG_1PX.toString('base64'))}), (c) => c.charCodeAt(0))
          const file = new File([bytes], '一张图.png', { type: 'image/png' })
          return [{ getFile: async () => file }]
        }
      })()`)
      await pointerClick(ctx, '[data-testid="toolbar-image"]')
      const spot = await clearSpot(ctx)
      await ctx.cdp.click(spot.x, spot.y)
      await waitCanvasSaved(ctx)
      const saved = JSON.parse(readFileSync(absPath(ctx, '插图.excal'), 'utf8'))
      const images = liveElements(saved).filter((element) => element.type === 'image')
      eq(images.length, 1, '图片写进场景,没有被当成场景替换掉')
      eq(liveElements(saved).some((element) => element.type === 'text'), false, '图片里没有藏着文字元素')
      const placed = await ctx.cdp.json(`(() => {
        const options = window.__imagePicker ?? null
        const accept = options?.types?.[0]?.accept ?? {}
        const exts = Object.values(accept).flat()
        return {
          calls: window.__imagePicker ? 1 : 0,
          png: exts.includes('.png'),
          library: exts.includes('.excalidrawlib'),
          toast: document.querySelector('.Toast__message')?.textContent ?? null
        }
      })()`)
      eq(placed.calls, 1, '点插入图像弹出一次选择框')
      ok(placed.png, '选择框接受 png')
      ok(!placed.library, '插入图像的选择框不列素材库文件')
      eq(placed.toast, null, '普通图片不报无法加载')
    }
  },

  {
    id: 'canvas/library-open',
    area: 'canvas',
    title: '素材库的打开只接受素材库文件,图片不读内容并提示不支持',
    tags: ['canvas', 'library'],
    async run(ctx) {
      await createCanvas(ctx, '素材库')
      await ctx.cdp.waitFor(`document.querySelector('.default-sidebar-trigger') !== null`, {
        timeout: 5000,
        message: '素材库按钮出现'
      })
      await pointerClick(ctx, '.default-sidebar-trigger')
      await ctx.cdp.waitFor(
        `document.querySelector('.library-menu-dropdown-container [data-testid="dropdown-menu-button"]') !== null`,
        { timeout: 5000, message: '素材库侧栏里的菜单按钮出现' }
      )
      await pointerClick(ctx, '.library-menu-dropdown-container [data-testid="dropdown-menu-button"]')
      await ctx.cdp.waitFor(
        `document.querySelector('[data-testid="lib-dropdown--load"]') !== null`,
        { timeout: 5000, message: '素材库菜单里有打开' }
      )

      await ctx.cdp.eval(`(() => {
        window.__libraryPickerCalls = []
        window.showOpenFilePicker = async (options) => {
          window.__libraryPickerCalls.push(options)
          const file = new File(['not-a-library'], '照片.png', { type: 'image/png' })
          let read = false
          const original = file.text.bind(file)
          file.text = async () => {
            read = true
            return original()
          }
          file.__wasRead = () => read
          window.__libraryPickedFile = file
          return [{ getFile: async () => file }]
        }
      })()`)
      await pointerClick(ctx, '[data-testid="lib-dropdown--load"]')
      await ctx.cdp.waitFor(
        `document.body.textContent.includes('不支持当前类型') === true`,
        { timeout: 5000, message: '图片被拒绝后提示不支持当前类型' }
      )
      const picked = await ctx.cdp.json(`(() => {
        const options = window.__libraryPickerCalls[0] ?? null
        const file = window.__libraryPickedFile
        return {
          calls: window.__libraryPickerCalls.length,
          excludeAcceptAllOption: options?.excludeAcceptAllOption ?? null,
          extensions: options?.types?.[0]?.accept?.['application/vnd.excalidrawlib+json'] ?? null,
          read: file?.__wasRead?.() ?? null
        }
      })()`)
      eq(picked.calls, 1, '打开只弹一次选择框')
      eq(picked.excludeAcceptAllOption, true, '选择框不提供所有文件')
      eq(picked.extensions, ['.excalidrawlib'], '选择框只列出素材库文件')
      eq(picked.read, false, '图片不读内容')
    }
  },

  {
    id: 'canvas/drop',
    area: 'canvas',
    title: '拖到画布上的场景不替换白板,库外文本跟着原文件,图片可以放上去',
    tags: ['canvas', 'drop'],
    async run(ctx) {
      await createCanvas(ctx, '投放')
      const marker = await placeText(ctx, '投放前的字')
      await waitCanvasSaved(ctx)
      const before = readFileSync(absPath(ctx, '投放.excal'), 'utf8')

      const scene = writeVaultFile(
        ctx,
        '外来场景.excal',
        JSON.stringify({
          type: 'excalidraw',
          version: 2,
          elements: [
            {
              type: 'text',
              id: '外来',
              x: 0,
              y: 0,
              text: '外来的字',
              originalText: '外来的字',
              isDeleted: false
            }
          ],
          appState: {},
          files: {}
        })
      )
      const library = writeVaultFile(
        ctx,
        '外来库.excalidrawlib',
        JSON.stringify({ type: 'excalidrawlib', version: 2, libraryItems: [] })
      )
      const outside = mkdtempSync(join(tmpdir(), 'launcher-canvas-drop-'))
      const note = join(outside, '外来说明.txt')
      writeFileSync(note, '这不是图片')
      const photo = writeVaultFile(ctx, '外来图.png', PNG_1PX)

      try {
      await dropOnCanvas(ctx, [scene])
      await ctx.cdp.waitFor(
        `document.body.textContent.includes('不支持当前类型') === true`,
        { timeout: 5000, message: '拖入场景后提示不支持当前类型' }
      )
      await sleep(600)
      eq(readFileSync(absPath(ctx, '投放.excal'), 'utf8'), before, '场景文件不替换当前白板')
      eq(await readTextAt(ctx, marker), '投放前的字', '原来的字还在')

      await dropOnCanvas(ctx, [library])
      await dropOnCanvas(ctx, [note])
      const embedded = await waitForScene(ctx, '投放.excal', (scene) =>
        liveElements(scene).some((element) => element.type === 'embeddable')
      )
      const embeds = liveElements(embedded).filter((element) => element.type === 'embeddable')
      eq(embeds.length, 1, '库外文本嵌成一块,不替换白板')
      eq(embeds[0].customData?.embed?.source, note, '场景记下源绝对路径')
      eq(embeds[0].customData?.embed?.project, '', '还没打包,项目路径为空')
      ok(!String(embeds[0].link ?? '').includes(note), '绝对路径不写进 link')
      ok(existsSync(note) && !existsSync(absPath(ctx, '外来说明.txt')), '文本不拷进笔记目录')
      eq(
        liveElements(embedded).filter((element) => element.type === 'text')[0]?.text,
        '投放前的字',
        '原来的字还在'
      )
      ok(
        (await ctx.cdp.eval(`document.body.textContent.includes('无法加载素材库')`)) !== true,
        '素材库文件不走加载失败提示'
      )
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }

      await dropOnCanvas(ctx, [photo])
      const dropped = await ctx.cdp.json(`(() => {
        const file = window.__e2eFileTransfer?.files?.[0]
        return file ? { name: file.name, type: file.type, size: file.size } : null
      })()`)
      const saved = await waitForScene(ctx, '投放.excal', (scene) =>
        liveElements(scene).some((element) => element.type === 'image')
      )
      const images = liveElements(saved).filter((element) => element.type === 'image')
      const texts = liveElements(saved).filter((element) => element.type === 'text')
      eq(images.length, 1, `拖入的图片出现在画布上 ${JSON.stringify(dropped)}`)
      eq(texts.length, 1, '原来的字没有被图片换掉')
      eq(texts[0].text, '投放前的字', '拖入图片后原来的字还是那一句')
    }
  },

  {
    id: 'canvas/embed-external',
    area: 'canvas',
    title: '工具栏按类型选库外 PDF,卡片跟着原文件,删掉后显示找不到',
    tags: ['canvas', 'embed', 'external'],
    async run(ctx) {
      const outside = mkdtempSync(join(tmpdir(), 'launcher-canvas-pdf-'))
      const pdf = join(outside, '说明.pdf')
      writeFileSync(pdf, onePagePdf('BT /F1 28 Tf 72 750 Td (E2E PDF) Tj ET'))
      try {
        await createCanvas(ctx, '外部嵌入')
        await openEmbedPicker(ctx)
        for (const kind of ['video', 'slides', 'document', 'spreadsheet', 'pdf', 'model', 'audio', 'image']) {
          ok(
            await ctx.cdp.eval(
              `document.querySelector(${JSON.stringify(`[data-embed-kind="${kind}"]`)}) !== null`
            ),
            `面板里有${kind}这一项`
          )
        }
        ok(
          await ctx.cdp.eval(
            `document.querySelector('[data-embed-kind="pdf"]')?.textContent?.includes('PDF') === true`
          ),
          'PDF 这一行写着 PDF'
        )
        await ctx.cdp.eval(`(() => {
          const proto = HTMLInputElement.prototype
          const click = proto.click
          proto.click = function () {
            if (this.type === 'file') return
            return click.call(this)
          }
        })()`)
        await pointerClick(ctx, '[data-embed-kind="pdf"]')
        await ctx.cdp.eval(`(() => {
          const input = document.querySelector('.canvas-embed-picker-file')
          window.__embedChanges = 0
          input?.addEventListener('change', () => { window.__embedChanges += 1 }, true)
        })()`)
        const inputId = await ctx.cdp.evalHandle(`(() => {
          const input = document.querySelector('.canvas-embed-picker-file')
          if (input === null) return null
          return input
        })()`)
        await ctx.cdp.send('DOM.setFileInputFiles', { files: [pdf], objectId: inputId })
        await ctx.cdp.send('Runtime.releaseObject', { objectId: inputId }).catch(() => {})
        // setFileInputFiles 自己会派发 change。再派一次就会叠两块,后一块盖住前一块的中心。
        const changes = await ctx.cdp.eval(
          `new Promise((resolve) => setTimeout(() => resolve(window.__embedChanges ?? 0), 50))`
        )
        if (changes === 0) {
          await ctx.cdp.eval(`(() => {
            const input = document.querySelector('.canvas-embed-picker-file')
            input.dispatchEvent(new Event('change', { bubbles: true }))
          })()`)
        }
        const saved = await waitForScene(ctx, '外部嵌入.excal', (scene) =>
          liveElements(scene).filter((element) => element.type === 'embeddable').length === 1
        )
        const embeds = liveElements(saved).filter((element) => element.type === 'embeddable')
        eq(embeds.length, 1, '一份 PDF 只嵌一块')
        const embed = embeds[0]
        eq(embed.customData?.embed?.source, pdf, '记下 PDF 的源路径')
        eq(embed.customData?.embed?.project, '', '嵌入时不写项目路径')
        ok(!String(embed.link ?? '').includes(pdf), 'link 不是绝对路径')
        ok(!existsSync(absPath(ctx, '说明.pdf')), '笔记目录里还没有这份拷贝')
        await ctx.cdp.waitFor(
          `(() => {
            const view = document.querySelector('.canvas-embed .file-pdf')
            return view !== null && String(view.dataset.pdfSrc).startsWith('launcher-note://external/?p=')
          })()`,
          { timeout: 10_000, message: '卡片用外部协议打开 PDF' }
        )
        const center = await ctx.cdp.json(`(() => {
          const card = document.querySelector('.canvas-embed')
          if (card === null) return null
          const box = card.getBoundingClientRect()
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
        })()`)
        ok(center !== null, 'PDF 卡片在画布上')
        // 按住左键时白板不进入悬停。移过去时按钮是松开的。
        await ctx.cdp.mouse('mouseMoved', center.x, center.y, { button: 'none', buttons: 0, clickCount: 0 })
        await ctx.cdp.waitFor(
          `document.querySelector('.excalidraw__embeddable-hint')?.textContent === '点击以开始交互'`,
          { message: '悬停卡片中心出现点击以开始交互' }
        )
        const hint = await ctx.cdp.json(`(() => {
          const hint = document.querySelector('.excalidraw__embeddable-hint')
          const card = document.querySelector('.canvas-embed')
          if (hint === null || card === null) return null
          const hintBox = hint.getBoundingClientRect()
          const cardBox = card.getBoundingClientRect()
          // 提示不接指针,elementsFromPoint 会跳过它,改看实际叠在上面的元素。
          // 画布是透明的,不算盖住。PDF 页面和工具条才算。
          hint.style.pointerEvents = 'auto'
          const top = document.elementFromPoint(
            hintBox.left + hintBox.width / 2,
            hintBox.top + hintBox.height / 2
          )
          hint.style.pointerEvents = ''
          const covering = top !== null && top !== hint && !hint.contains(top)
            && top.closest('.excalidraw__canvas') === null
            && (top === card || card.contains(top))
          return {
            visible: hintBox.width > 0 && hintBox.height > 0
              && hintBox.left < cardBox.right && hintBox.right > cardBox.left
              && hintBox.top < cardBox.bottom && hintBox.bottom > cardBox.top,
            covering
          }
        })()`)
        ok(hint?.visible === true, '提示落在卡片范围内')
        ok(hint?.covering === false, '提示没有被 PDF 页面盖住')
        eq(
          await ctx.cdp.eval(
            `getComputedStyle(document.querySelector('.canvas-embed .file-pdf-view .file-image-tools')).display`
          ),
          'none',
          '没点开始交互前不显示 PDF 工具条'
        )
        await ctx.cdp.click(center.x, center.y)
        await ctx.cdp.waitFor(
          `document.querySelector('.canvas-embed')?.dataset.embedActive === 'true'`,
          { message: '点一下卡片后可以交互' }
        )
        await ctx.cdp.waitFor(
          `(() => {
            const tools = document.querySelector('.canvas-embed .file-pdf-view .file-image-tools')
            return tools !== null && getComputedStyle(tools).display !== 'none'
              && tools.querySelector('button[title="放大"]') !== null
          })()`,
          { message: '点了开始交互之后 PDF 工具条才出现' }
        )
        await ctx.cdp.waitFor(
          `(() => {
            const panel = document.querySelector('.canvas-board .selected-shape-actions')
            return panel !== null && getComputedStyle(panel).display === 'none'
          })()`,
          { message: '进入交互后左侧编辑栏收起' }
        )

        writeFileSync(pdf, onePagePdf('BT /F1 28 Tf 72 750 Td (E2E PDF v2) Tj ET'))
        await ctx.cdp.eval(`document.querySelector('[data-note-id], .notes-rail')?.click()`)
        await openCanvasFile(ctx, '外部嵌入.excal')
        await ctx.cdp.waitFor(
          `(() => {
            const view = document.querySelector('.canvas-embed .file-pdf')
            return view !== null && decodeURIComponent(String(view.dataset.pdfSrc)).includes('说明.pdf')
          })()`,
          { timeout: 10_000, message: '重开后仍从原路径打开' }
        )

        rmSync(pdf)
        // 还停在这块白板上时不重新探测,否则光标一动卡片就重挂。离开再打开才再查一次原文件。
        await ctx.cdp.eval(`document.querySelector('[data-note-id]')?.click()`)
        await ctx.cdp.waitFor(`document.querySelector('.canvas-board') === null`, {
          timeout: 10_000,
          message: '先离开这块白板'
        })
        await openCanvasFile(ctx, '外部嵌入.excal')
        await ctx.cdp.waitFor(
          `document.body.textContent.includes('找不到这个文件') === true`,
          { timeout: 10_000, message: '源文件删掉后显示找不到' }
        )
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    }
  },

  {
    id: 'canvas/embed-fallback',
    area: 'canvas',
    title: '原文件不在时卡片读项目副本,原文件还在就读它,记的是哪台电脑不影响',
    tags: ['canvas', 'embed', 'external'],
    async run(ctx) {
      writeVaultFile(ctx, '副本.txt', '项目里的副本')
      writeCanvas(ctx, '读副本.excal', externalScene('副本.txt', {
        source: '/tmp/launcher-e2e-missing-source.txt',
        project: '副本.txt',
        host: '以前的电脑'
      }))
      await openCanvasFile(ctx, '读副本.excal')
      await ctx.cdp.waitFor(
        `document.querySelector('.canvas-embed .canvas-embed-code')?.textContent === '项目里的副本'`,
        { timeout: 10_000, message: '原文件不在时读项目副本' }
      )
      ok(
        await ctx.cdp.eval(
          `document.querySelector('.canvas-embed .file-pdf') === null && document.body.textContent.includes('找不到这个文件') !== true`
        ),
        '有副本时不显示找不到'
      )
      eq(
        await ctx.cdp.eval(
          `document.querySelector('.canvas-embed .canvas-embed-code')?.closest('.canvas-embed')?.querySelector('[src^="launcher-note://external"]') === null`
        ),
        true,
        '副本不走外部协议'
      )

      const outside = mkdtempSync(join(tmpdir(), 'launcher-canvas-src-'))
      const source = join(outside, '原件.txt')
      writeFileSync(source, '还在的原文件')
      writeVaultFile(ctx, '另一份副本.txt', '这份不该被读到')
      try {
        writeCanvas(ctx, '读原件.excal', externalScene('原件.txt', {
          source,
          project: '另一份副本.txt',
          host: '另一台电脑'
        }))
        await openCanvasFile(ctx, '读原件.excal')
        await ctx.cdp.waitFor(
          `document.querySelector('.canvas-embed .canvas-embed-code')?.textContent === '还在的原文件'`,
          { timeout: 10_000, message: '原文件还在就读它,不读项目副本' }
        )
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    }
  },

  {
    id: 'canvas/embed-kinds',
    area: 'canvas',
    title: '图片、文档、表格、压缩包、模型和视频嵌进卡片后,点一下都能操作',
    tags: ['canvas', 'embed', 'external'],
    async run(ctx) {
      const outside = mkdtempSync(join(tmpdir(), 'launcher-canvas-kinds-'))
      const files = {
        '一张图.png': PNG_1PX,
        '说明.docx': await makeDocx('卡片里的文档'),
        '数据.xlsx': await makeXlsx(),
        '包.zip': await makeZip('里面.txt', '包里的字'),
        '三角.stl': STL_ASCII,
        '短片.mp4': MP4_TINY
      }
      for (const [name, bytes] of Object.entries(files)) writeFileSync(join(outside, name), bytes)
      try {
        // 每块都放在视口正中,后一块会盖住前一块。一种文件一张白板,点中心才点得到它自己。
        await createCanvas(ctx, '图板')
        await embedLocalFile(ctx, '一张图.png', join(outside, '一张图.png'))
        await activateCard(ctx, '一张图.png')
        await pointerClick(ctx, '[data-embed-label="一张图.png"] .file-image-tools button[title="放大"]')
        await ctx.cdp.waitFor(
          `Number(document.querySelector('[data-embed-label="一张图.png"] .file-image-stage')?.dataset.scale) > 1`,
          { timeout: 5000, message: '卡片里的图片可以放大' }
        )
        await assertSingleEmbed(ctx, '图板.excal', '一张图.png')

        await createCanvas(ctx, '文档板')
        await embedLocalFile(ctx, '说明.docx', join(outside, '说明.docx'))
        await activateCard(ctx, '说明.docx')
        await ctx.cdp.waitFor(
          `document.querySelector('[data-embed-label="说明.docx"] [data-office-page]')?.textContent?.includes('卡片里的文档') === true`,
          { timeout: 10_000, message: '卡片里的文档画出正文' }
        )
        await pointerClick(ctx, '[data-embed-label="说明.docx"] .file-zoom button[title="放大"]')
        await ctx.cdp.waitFor(
          `document.querySelector('[data-embed-label="说明.docx"] .file-zoom')?.textContent?.includes('110%') === true`,
          { timeout: 5000, message: '卡片里的文档可以放大' }
        )
        await assertSingleEmbed(ctx, '文档板.excal', '说明.docx')

        await createCanvas(ctx, '表格板')
        await embedLocalFile(ctx, '数据.xlsx', join(outside, '数据.xlsx'))
        await activateCard(ctx, '数据.xlsx')
        await ctx.cdp.waitFor(
          `document.querySelector('[data-embed-label="数据.xlsx"] [data-office-sheet]')?.textContent?.includes('第一表') === true`,
          { timeout: 10_000, message: '卡片里的表格画出第一张表' }
        )
        await pointerClick(ctx, '[data-embed-label="数据.xlsx"] .file-sheet-tab:nth-of-type(2)')
        await ctx.cdp.waitFor(
          `document.querySelector('[data-embed-label="数据.xlsx"] [data-office-sheet]')?.textContent?.includes('另一张表') === true`,
          { timeout: 5000, message: '卡片里可以换到第二张表' }
        )
        await assertSingleEmbed(ctx, '表格板.excal', '数据.xlsx')

        await createCanvas(ctx, '压缩包板')
        await embedLocalFile(ctx, '包.zip', join(outside, '包.zip'))
        await activateCard(ctx, '包.zip')
        await ctx.cdp.waitFor(
          `document.querySelector('[data-embed-label="包.zip"] .file-archive-name')?.textContent === '里面.txt'`,
          { timeout: 10_000, message: '卡片里的压缩包列出条目' }
        )
        await pointerClick(ctx, '[data-embed-label="包.zip"] .file-archive-row')
        await ctx.cdp.waitFor(
          `document.querySelector('[data-embed-label="包.zip"] .file-archive-preview')?.textContent?.includes('包里的字') === true`,
          { timeout: 5000, message: '点条目后卡片里能看到内容' }
        )
        await assertSingleEmbed(ctx, '压缩包板.excal', '包.zip')

        await createCanvas(ctx, '模型板')
        await embedLocalFile(ctx, '三角.stl', join(outside, '三角.stl'))
        await activateCard(ctx, '三角.stl')
        await ctx.cdp.waitFor(
          `document.querySelector('[data-embed-label="三角.stl"] canvas[data-model-canvas]') !== null`,
          { timeout: 10_000, message: '卡片里的模型画出画布' }
        )
        await assertSingleEmbed(ctx, '模型板.excal', '三角.stl')

        await createCanvas(ctx, '视频板')
        await embedLocalFile(ctx, '短片.mp4', join(outside, '短片.mp4'))
        await activateCard(ctx, '短片.mp4')
        await ctx.cdp.waitFor(
          `(() => {
            const video = document.querySelector('[data-embed-label="短片.mp4"] video.file-video')
            return video !== null && video.controls === true && video.paused === true
              && getComputedStyle(video).width !== '0px'
          })()`,
          { timeout: 10_000, message: '卡片里的视频有控件且不自己播放' }
        )
        await assertSingleEmbed(ctx, '视频板.excal', '短片.mp4')
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    }
  }
]
