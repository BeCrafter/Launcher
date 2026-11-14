// 非 Markdown 文件在应用内的查看 / 编辑。
//
// 覆盖用户看到的完整路径:文件行单击打开(不再是双击交给系统)、类型图标、
// 代码高亮编辑与自动保存、HTML 源码/预览/分栏(沙箱脚本、兄弟资源、fetch)、
// CSV 表格、图片缩放、PSD/TIFF 解码、PDF、音频、Office、压缩包(含嵌套与 HTML 条目)、
// 3D 模型、无法预览时的占位与「用默认应用打开」,以及新建入口(默认 .md / 其他类型)。
//
// 夹具全部在运行期生成:文本直接写,docx/xlsx/zip 用 JSZip / exceljs,
// PSD / TIFF 用 ag-psd / utif 编码,PDF / TAR.GZ / WAV 手工拼字节。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { gzip } from 'pako'
import ExcelJS from 'exceljs'
import agPsd from 'ag-psd'
import UTIFm from 'utif'
import { eq, includes, ok } from '../lib/assert.mjs'
import { sleep } from '../lib/cdp.mjs'

const UTIF = UTIFm.default ?? UTIFm

function notesDir(ctx) {
  return join(ctx.profileDir, 'notes')
}

/** 写一个笔记目录里的文件(自动建父目录)。字符串按 UTF-8,其余(含 Uint8Array)按字节。 */
function writeFile(ctx, rel, content) {
  const full = join(notesDir(ctx), rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
  return full
}

function absPath(ctx, rel) {
  return join(notesDir(ctx), rel)
}

function fileSelector(rel) {
  return `[data-file-path=${JSON.stringify(rel)}]`
}

async function expandFolder(ctx, path) {
  // 夹具是直接写盘的:等目录监听把新目录推给列表,再展开。
  const selector = `.notes-folder-row[data-folder-path=${JSON.stringify(path)}]`
  await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(selector)}) !== null`, {
    timeout: 10_000,
    message: `目录行出现:${path}`
  })
  const state = await ctx.cdp.eval(`(() => {
    const row = document.querySelector(${JSON.stringify(selector)})
    if (row === null) return 'missing'
    const open = row.querySelector('.notes-folder-name')?.getAttribute('aria-expanded') === 'true'
    if (!open) row.querySelector('.notes-folder-name')?.click()
    return open ? 'open' : 'opened'
  })()`)
  if (state === 'missing') throw new Error(`列表里找不到目录:${path}`)
  await sleep(150)
}

async function waitFileRow(ctx, rel, { expand = [] } = {}) {
  for (const folder of expand) await expandFolder(ctx, folder)
  const sel = fileSelector(rel)
  await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(sel)}) !== null`, {
    timeout: 10_000,
    message: `文件行出现:${rel}`
  })
}

function baseName(rel) {
  return rel.slice(rel.lastIndexOf('/') + 1)
}

/** 单击文件行 → 应用内文件视图(不再是外部应用)。 */
async function openFile(ctx, rel, { expand = [] } = {}) {
  await waitFileRow(ctx, rel, { expand })
  await ctx.cdp.eval(`document.querySelector(${JSON.stringify(fileSelector(rel))})?.click()`)
  await ctx.cdp.waitFor(
    `document.querySelector('.file-main .file-name')?.textContent === ${JSON.stringify(baseName(rel))}`,
    { timeout: 15_000, message: `文件视图打开:${rel}` }
  )
}

const FILE_MODES = ['source', 'preview', 'split']

async function setFileMode(ctx, mode) {
  const index = FILE_MODES.indexOf(mode)
  if (index < 0) throw new Error(`未知文件视图模式:${mode}`)
  await ctx.cdp.eval(`document.querySelectorAll('.file-main .notes-mode-btn')[${index}]?.click()`)
  await ctx.cdp.waitFor(
    `document.querySelectorAll('.file-main .notes-mode-btn')[${index}]?.getAttribute('aria-pressed') === 'true'`,
    { message: `文件视图切换为 ${mode}` }
  )
  await sleep(150)
}

async function waitFileSaved(ctx) {
  await ctx.cdp.waitFor(
    `(() => { const el = document.querySelector('.file-main .notes-save-state');
      return el !== null && !el.classList.contains('dirty') && !el.classList.contains('saving') })()`,
    { timeout: 10_000, message: '文件自动保存完成' }
  )
}

async function waitFileDirty(ctx) {
  await ctx.cdp.waitFor(`document.querySelector('.file-main .notes-save-state.dirty') !== null`, {
    timeout: 5000,
    message: '文件进入未保存状态'
  })
}

/** 选中编辑器全部内容后整段替换(Input.insertText 会替换选区)。 */
async function replaceFileText(ctx, text) {
  const rect = await ctx.elementRect('.file-main .file-editor .cm-content')
  await ctx.cdp.click(rect.x + rect.width / 2, rect.y + Math.min(rect.height / 2, 40))
  await sleep(80)
  await ctx.cdp.key('a', 'KeyA', 65, 4)
  await sleep(60)
  await ctx.cdp.type(text)
  await sleep(150)
}

async function textOfFileEditor(ctx) {
  // CodeMirror 每行一个 .cm-line,textContent 不带换行 —— 按行拼回来才是文档正文。
  return ctx.cdp.eval(
    `[...document.querySelectorAll('.file-main .file-editor .cm-line')]
      .map((el) => el.textContent)
      .join('\\n')`
  )
}

// ── 夹具生成 ──

/** 三页,目录两项分别指向第 1 页和第 3 页。 */
function outlinedPdf() {
  const page = (contentId) =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${contentId} 0 R /Resources << /Font << /F1 10 0 R >> >> >>`
  const stream = (body) => `<< /Length ${body.length} >>\nstream\n${body}\nendstream`
  const objs = []
  objs[1] = '<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R >>'
  objs[2] = '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>'
  objs[3] = page(11)
  objs[4] = page(12)
  objs[5] = page(13)
  objs[6] = '<< /Type /Outlines /First 7 0 R /Last 8 0 R /Count 2 >>'
  objs[7] =
    '<< /Title (Chapter One) /Parent 6 0 R /Next 8 0 R /Dest [3 0 R /XYZ 0 200 0] >>'
  objs[8] = '<< /Title (Chapter Three) /Parent 6 0 R /Prev 7 0 R /Dest [5 0 R /XYZ 0 200 0] >>'
  objs[10] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  objs[11] = stream('BT /F1 18 Tf 36 120 Td (PAGE ONE) Tj ET')
  objs[12] = stream('BT /F1 18 Tf 36 120 Td (PAGE TWO) Tj ET')
  objs[13] = stream('BT /F1 18 Tf 36 120 Td (PAGE THREE) Tj ET')
  let out = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 1; i < objs.length; i += 1) {
    offsets[i] = out.length
    if (objs[i] === undefined) continue
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objs.length; i += 1) {
    const offset = objs[i] === undefined ? 0 : offsets[i]
    const use = objs[i] === undefined ? 'f' : 'n'
    out += `${String(offset).padStart(10, '0')} 00000 ${use} \n`
  }
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return out
}

/** 八页,没有书签。页数够多,目录才会自己滚。 */
function plainPdf() {
  const count = 8
  const page = (contentId) =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${6 + count} 0 R >> >> >>`
  const stream = (body) => `<< /Length ${body.length} >>\nstream\n${body}\nendstream`
  const objs = []
  const kids = []
  for (let n = 1; n <= count; n += 1) kids.push(`${2 + n} 0 R`)
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${count} >>`
  for (let n = 1; n <= count; n += 1) objs[2 + n] = page(2 + count + n)
  objs[3 + count] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  for (let n = 1; n <= count; n += 1) {
    objs[3 + count + n] = stream(`BT /F1 18 Tf 36 120 Td (PAGE ${n}) Tj ET`)
  }
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

function onePagePdf(text) {
  const objs = []
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
  objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
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

function wavBytes() {
  const samples = 800
  const data = Buffer.alloc(samples)
  for (let i = 0; i < samples; i += 1) data[i] = 128 + Math.round(100 * Math.sin(i / 10))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(8000, 24)
  header.writeUInt32LE(8000, 28)
  header.writeUInt16LE(1, 32)
  header.writeUInt16LE(8, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

async function makeDocx() {
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
      '<w:body><w:p><w:r><w:t>E2E DOCX 文本</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'
  )
  return zip.generateAsync({ type: 'uint8array' })
}

async function makeXlsx() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('数据')
  sheet.getCell('A1').value = 'E2E 单元格'
  sheet.getCell('B2').value = 42
  const second = workbook.addWorksheet('第二表')
  second.getCell('A1').value = '另一个表'
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

function tarHeader(name, size, type = '0') {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124)
  header[156] = type.charCodeAt(0)
  header.write('ustar', 257)
  return header
}

function makeTar(files) {
  const chunks = []
  for (const file of files) {
    const body = Buffer.from(file.body)
    chunks.push(tarHeader(file.name, body.length))
    chunks.push(body)
    const pad = (512 - (body.length % 512)) % 512
    if (pad > 0) chunks.push(Buffer.alloc(pad))
  }
  chunks.push(Buffer.alloc(1024))
  return Buffer.concat(chunks)
}

async function makeZipBundle() {
  const inner = new JSZip()
  inner.file('deep.txt', '嵌套内容')
  const innerBytes = await inner.generateAsync({ type: 'uint8array' })

  const zip = new JSZip()
  zip.file('readme.txt', '压缩包里的文本')
  zip.file('pic.png', PNG_1PX)
  zip.file('inner.zip', innerBytes)
  zip.file(
    'site/index.html',
    '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head>' +
      '<body><div id="styled">归档页面</div><script src="app.js"></script></body></html>'
  )
  zip.file('site/style.css', '#styled{color:rgb(0,128,0)}')
  zip.file('site/app.js', "document.body.dataset.ran='1';document.title='archive-ran'")
  return zip.generateAsync({ type: 'uint8array' })
}

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

function embeddedGltf() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const base64 = Buffer.from(positions.buffer).toString('base64')
  return JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ uri: `data:application/octet-stream;base64,${base64}`, byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        max: [1, 1, 0],
        min: [0, 0, 0]
      }
    ]
  })
}

function smallPsd() {
  const width = 4
  const height = 4
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = 255
    rgba[i * 4 + 1] = i * 12
    rgba[i * 4 + 2] = 0
    rgba[i * 4 + 3] = 255
  }
  return Buffer.from(
    agPsd.writePsdBuffer({ width, height, imageData: { data: rgba, width, height } })
  )
}

function smallTiff() {
  const width = 4
  const height = 4
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = 0
    rgba[i * 4 + 1] = 128
    rgba[i * 4 + 2] = 255
    rgba[i * 4 + 3] = 255
  }
  return Buffer.from(UTIF.encodeImage(rgba, width, height))
}

/** 在子目标里轮询,超时抛出可以定位的消息。 */
async function waitFrame(ctx, sessionId, expression, message, timeout = 10_000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if ((await ctx.cdp.evalIn(sessionId, expression)) === true) return
    await sleep(80)
  }
  throw new Error(message)
}

async function frameHandle(ctx, urlPart, predicate, message, timeout = 15_000) {
  const handles = await ctx.cdp.attachFrame(urlPart)
  for (const frame of handles) {
    try {
      if ((await ctx.cdp.evalIn(frame.sessionId, predicate)) === true) return frame
    } catch {
      // 目标可能正在导航;继续试下一个
    }
  }
  throw new Error(message)
}

export default [
  {
    id: 'files/code-edit-autosave',
    area: 'files',
    title: '代码文件:单击应用内打开、高亮编辑器、输入自动保存、切走再切回内容仍在',
    tags: ['files', 'editor', 'autosave'],
    async run(ctx) {
      const rel = 'code/edit-me.js'
      writeFile(ctx, rel, 'const answer = 1\n')
      await openFile(ctx, rel, { expand: ['code'] })

      ok(
        (await ctx.cdp.eval(
          `document.querySelector('[data-file-kind="code"]') !== null && document.querySelector('.file-main .file-editor .cm-gutters') !== null`
        )) === true,
        '代码文件用带行号的高亮编辑器'
      )
      eq(await textOfFileEditor(ctx), 'const answer = 1\n', '编辑器载入磁盘原文')

      await replaceFileText(ctx, 'const answer = 42\n// e2e 写入')
      await waitFileDirty(ctx)
      await waitFileSaved(ctx)
      await ctx.waitForNode(
        () => readFileSync(absPath(ctx, rel), 'utf8') === 'const answer = 42\n// e2e 写入',
        '自动保存写回磁盘'
      )

      // 切到笔记再切回:文件行活动态与正文都要回来
      await ctx.cdp.eval(
        `[...document.querySelectorAll('.notes-row-main')].find((el) => el.textContent?.includes(${JSON.stringify(
          ctx.noteTitle
        )}))?.click()`
      )
      await ctx.cdp.waitFor(`document.querySelector('.notes-title') !== null`, {
        message: '切回笔记视图'
      })
      ok(
        (await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(fileSelector(rel))})?.classList.contains('active') === false`
        )) === true,
        '切到笔记后文件行不再高亮'
      )

      await openFile(ctx, rel)
      ok(
        (await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(fileSelector(rel))})?.classList.contains('active') === true`
        )) === true,
        '重新打开后文件行是活动态'
      )
      eq(await textOfFileEditor(ctx), 'const answer = 42\n// e2e 写入', '切回后仍是已保存的新内容')
    }
  },

  {
    id: 'files/html-edit-preview',
    area: 'files',
    title:
      'HTML:源码可改;预览在无同源沙箱里执行脚本、读到兄弟 CSS / fetch;保存后预览刷新;分栏同时显示',
    tags: ['files', 'html', 'iframe'],
    async run(ctx) {
      writeFile(
        ctx,
        'site/index.html',
        '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head>' +
          '<body><h1 id="styled">HTML 预览</h1><div id="fetched"></div>' +
          '<script src="app.js"></script></body></html>'
      )
      writeFile(ctx, 'site/style.css', '#styled{color:rgb(0,128,0)}')
      writeFile(
        ctx,
        'site/app.js',
        "document.body.dataset.ran='1';" +
          "fetch('data.json').then((r)=>r.json()).then((j)=>{document.getElementById('fetched').textContent=j.answer})"
      )
      writeFile(ctx, 'site/data.json', '{"answer":"42"}')

      await openFile(ctx, 'site/index.html', { expand: ['site'] })
      await setFileMode(ctx, 'preview')

      await ctx.cdp.waitFor(`document.querySelector('.file-main iframe[data-file-frame="html"]') !== null`, {
        message: 'HTML 预览 iframe 出现'
      })
      const sandbox = await ctx.cdp.eval(
        `document.querySelector('.file-main iframe[data-file-frame="html"]')?.getAttribute('sandbox') ?? ''`
      )
      includes(sandbox, 'allow-scripts', '沙箱允许脚本(用户选择「沙箱执行脚本」)')
      ok(!sandbox.includes('allow-same-origin'), `沙箱不能有 allow-same-origin(实际: ${sandbox})`)

      const page = await frameHandle(
        ctx,
        'site/index.html',
        `document.body !== null && document.body.dataset.ran === '1'`,
        '预览页里脚本执行了'
      )
      await waitFrame(
        ctx,
        page.sessionId,
        `document.getElementById('fetched')?.textContent === '42'`,
        '预览页 fetch 兄弟 data.json 成功'
      )
      eq(
        await ctx.cdp.evalIn(
          page.sessionId,
          `getComputedStyle(document.getElementById('styled')).color`
        ),
        'rgb(0, 128, 0)',
        '兄弟 style.css 生效'
      )

      // 改源码 → 自动保存 → 预览随 saveNonce 重新加载
      await setFileMode(ctx, 'source')
      await replaceFileText(
        ctx,
        '<h1 id="styled">E2E 改过</h1><script>document.body.dataset.ran="edited"</script>'
      )
      await waitFileDirty(ctx)
      await waitFileSaved(ctx)

      await setFileMode(ctx, 'preview')
      const edited = await frameHandle(
        ctx,
        'site/index.html',
        `document.body !== null && document.body.dataset.ran === 'edited'`,
        '保存后预览刷新为新内容'
      )
      eq(
        await ctx.cdp.evalIn(edited.sessionId, `document.getElementById('styled')?.textContent`),
        'E2E 改过',
        '预览显示改过的标题'
      )

      await setFileMode(ctx, 'split')
      eq(
        await ctx.cdp.eval(
          `document.querySelector('.file-main .file-split .file-editor') !== null &&
           document.querySelector('.file-main .file-split iframe[data-file-frame="html"]') !== null`
        ),
        true,
        '分栏同时显示源码与预览'
      )
    }
  },

  {
    id: 'files/csv-table',
    area: 'files',
    title: 'CSV / TSV:源码与表格切换、引号与制表符解析、超上限时如实提示截断',
    tags: ['files', 'csv'],
    async run(ctx) {
      writeFile(ctx, 'tables/data.csv', '名称,数量\n苹果,3\n"带,逗号",4\n')
      writeFile(ctx, 'tables/data.tsv', '键\t值\na\tb\n')
      writeFile(
        ctx,
        'tables/big.csv',
        ['编号,内容', ...Array.from({ length: 5010 }, (_, i) => `${i + 1},行${i + 1}`)].join('\n')
      )

      await openFile(ctx, 'tables/data.csv', { expand: ['tables'] })
      await setFileMode(ctx, 'preview')
      await ctx.cdp.waitFor(`document.querySelector('.file-main [data-csv-table]') !== null`, {
        message: 'CSV 表格出现'
      })
      const csvText = await ctx.cdp.eval(`document.querySelector('.file-main [data-csv-table]')?.innerText ?? ''`)
      includes(csvText, '名称', '表头渲染')
      includes(csvText, '带,逗号', '引号内的逗号是一个单元格')
      eq(
        await ctx.cdp.eval(
          `[...document.querySelectorAll('.file-main [data-csv-table] tbody tr')[1]?.querySelectorAll('td') ?? []].length`
        ),
        3,
        '第二行包含行号列 + 两个单元格'
      )

      await setFileMode(ctx, 'source')
      ok(
        (await ctx.cdp.eval(
          `[...document.querySelectorAll('.file-main .file-editor .cm-line')].some((el) => el.textContent === '名称,数量')`
        )) === true,
        '源码模式显示原始 CSV 行'
      )

      await openFile(ctx, 'tables/data.tsv')
      await setFileMode(ctx, 'preview')
      await ctx.cdp.waitFor(`document.querySelector('.file-main [data-csv-table]') !== null`, {
        message: 'TSV 表格出现'
      })
      const tsvText = await ctx.cdp.eval(`document.querySelector('.file-main [data-csv-table]')?.innerText ?? ''`)
      includes(tsvText, '键', 'TSV 表头')
      includes(tsvText, 'b', 'TSV 单元格按制表符拆分')

      await openFile(ctx, 'tables/big.csv')
      await setFileMode(ctx, 'preview')
      await ctx.cdp.waitFor(`document.querySelector('.file-main .file-csv-note') !== null`, {
        message: '超过 5000 行时出现截断提示'
      })
    }
  },

  {
    id: 'files/image-zoom',
    area: 'files',
    title: '图片:滚轮 / 按钮缩放夹在 0.2–8 倍,重置与双击回到 1 / 2.5 倍',
    tags: ['files', 'image', 'zoom'],
    async run(ctx) {
      writeFile(ctx, 'media/pic.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#c00"/></svg>')
      await openFile(ctx, 'media/pic.svg', { expand: ['media'] })
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-image-stage img.file-image')?.naturalWidth > 0`,
        { message: '图片加载完成' }
      )
      const scaleOf = () =>
        ctx.cdp.eval(`parseFloat(document.querySelector('.file-image-stage')?.dataset.scale ?? 'NaN')`)
      eq(await scaleOf(), 1, '初始 1 倍')

      const box = await ctx.elementRect('.file-main .file-image-stage')
      await ctx.cdp.wheel(box.x + box.width / 2, box.y + box.height / 2, -120)
      await ctx.cdp.waitFor(
        `parseFloat(document.querySelector('.file-image-stage')?.dataset.scale ?? '0') > 1`,
        { message: '滚轮向上放大' }
      )

      // 连续点 30 次「+」:上限是 8 倍
      await ctx.cdp.eval(`(() => {
        const btn = document.querySelectorAll('.file-main .file-image-tools button')[2]
        for (let i = 0; i < 30; i += 1) btn?.click()
        return true
      })()`)
      await ctx.cdp.waitFor(
        `document.querySelector('.file-image-stage')?.dataset.scale === '8.000'`,
        { message: '放大夹在 8 倍' }
      )

      // 连续点 80 次「−」:下限是 0.2 倍
      await ctx.cdp.eval(`(() => {
        const btn = document.querySelectorAll('.file-main .file-image-tools button')[0]
        for (let i = 0; i < 80; i += 1) btn?.click()
        return true
      })()`)
      await ctx.cdp.waitFor(
        `document.querySelector('.file-image-stage')?.dataset.scale === '0.200'`,
        { message: '缩小夹在 0.2 倍' }
      )

      await ctx.cdp.eval(`document.querySelectorAll('.file-main .file-image-tools button')[1]?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.file-image-stage')?.dataset.scale === '1.000'`, {
        message: '重置回 1 倍'
      })

      await ctx.doubleClick('.file-main .file-image')
      await ctx.cdp.waitFor(`document.querySelector('.file-image-stage')?.dataset.scale === '2.500'`, {
        message: '双击放大到 2.5 倍'
      })
      await ctx.doubleClick('.file-main .file-image')
      await ctx.cdp.waitFor(`document.querySelector('.file-image-stage')?.dataset.scale === '1.000'`, {
        message: '再次双击回到 1 倍'
      })
    }
  },

  {
    id: 'files/decoded-images',
    area: 'files',
    title: 'PSD / TIFF 解码后进入图片查看器;无法解码的 HEIC 给原因占位',
    tags: ['files', 'image', 'decode'],
    async run(ctx) {
      writeFile(ctx, 'decoded/vector.psd', smallPsd())
      writeFile(ctx, 'decoded/photo.tiff', smallTiff())
      writeFile(ctx, 'decoded/broken.heic', Buffer.from('not really heic'))

      await openFile(ctx, 'decoded/vector.psd', { expand: ['decoded'] })
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-image-stage img.file-image')?.naturalWidth === 4`,
        { timeout: 15_000, message: 'PSD 解码成 4×4 位图' }
      )
      ok(
        (await ctx.cdp.eval(
          `document.querySelector('.file-main .file-image-stage img.file-image')?.src.startsWith('data:image/png') === true`
        )) === true,
        'PSD 解码结果是 PNG data URL'
      )

      await openFile(ctx, 'decoded/photo.tiff')
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-image-stage img.file-image')?.naturalWidth === 4`,
        { timeout: 15_000, message: 'TIFF 解码成 4×4 位图' }
      )

      await openFile(ctx, 'decoded/broken.heic')
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-placeholder .file-placeholder-title') !== null`,
        { timeout: 20_000, message: 'HEIC 解码失败时给占位,而不是一直转圈' }
      )
      ok(
        (await ctx.cdp.eval(`document.querySelector('.file-main .file-image-stage') === null`)) === true,
        '失败时不显示空图片框'
      )
    }
  },

  {
    id: 'files/pdf-and-audio',
    area: 'files',
    title: 'PDF 在应用内画成页面,底色跟着主题,页宽跟容器走且可缩放可选中,能翻页并按目录或页列表跳转,工具条可收起;音频用原生控件且不自动播放',
    tags: ['files', 'pdf', 'media'],
    async run(ctx) {
      writeFile(ctx, 'docs/sample.pdf', outlinedPdf())
      writeFile(ctx, 'docs/plain.pdf', plainPdf())
      writeFile(ctx, 'audio/tone.wav', wavBytes())

      await openFile(ctx, 'docs/sample.pdf', { expand: ['docs'] })
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-pdf canvas') !== null`,
        { timeout: 20_000, message: 'PDF 画成 canvas,不走阅读器 iframe' }
      )
      eq(
        await ctx.cdp.eval(`document.querySelector('.file-main iframe[data-file-frame="pdf"]') === null`),
        true,
        '文件页不再开 Chromium 阅读器'
      )
      await ctx.cdp.waitFor(
        `(() => {
          const page = document.querySelector('.file-main .file-pdf-page')
          const scroller = document.querySelector('.file-main .file-pdf')
          if (page === null || scroller === null) return false
          const pad = parseFloat(getComputedStyle(scroller).paddingLeft) || 0
          return Math.abs(page.getBoundingClientRect().width - (scroller.clientWidth - pad * 2)) < 3
        })()`,
        { timeout: 10_000, message: '页宽跟滚动区走,不被画布像素撑开' }
      )
      await ctx.cdp.eval(`document.querySelector('.file-main .file-image-tools button[title="放大"]')?.click()`)
      await ctx.cdp.waitFor(
        `Number(document.querySelector('.file-main .file-pdf-view')?.dataset.pdfScale) > 1.2`,
        { message: '放大后页变宽' }
      )
      ok(
        (await ctx.cdp.eval(
          `document.querySelector('.file-main .file-pdf-page .textLayer') !== null`
        )) === true,
        '页上有可选中的文字层'
      )
      eq(
        await ctx.cdp.eval(`document.querySelector('.file-main .file-pdf-view')?.dataset.pdfPage`),
        '1',
        '打开时停在第一页'
      )
      eq(
        await ctx.cdp.eval(`document.querySelector('.file-main .file-pdf-outline')`),
        null,
        '目录默认收着'
      )
      await ctx.cdp.eval(
        `document.querySelector('.file-main .file-image-tools button[title="目录"]')?.click()`
      )
      await ctx.cdp.waitFor(
        `(() => {
          const item = document.querySelector('.file-main .file-pdf-outline [data-outline-page="3"]')
          if (item === null || item.textContent?.includes('Chapter Three') !== true) return false
          const style = getComputedStyle(item)
          return item.querySelector('.file-pdf-outline-thumb canvas') !== null && parseFloat(style.borderTopLeftRadius) >= 8
        })()`,
        { message: '目录把第三页画成带缩略图的卡片' }
      )
      await ctx.cdp.eval(
        `document.querySelector('.file-main .file-pdf-outline [data-outline-page="3"]')?.click()`
      )
      await ctx.cdp.waitFor(
        `(() => {
          const view = document.querySelector('.file-main .file-pdf-view')
          const scroller = document.querySelector('.file-main .file-pdf')
          const target = document.querySelector('.file-main .file-pdf-page[data-page="3"]')
          if (view === null || scroller === null || target === null) return false
          const box = scroller.getBoundingClientRect()
          const page = target.getBoundingClientRect()
          return view.dataset.pdfPage === '3' && page.top < box.bottom && page.bottom > box.top
        })()`,
        { message: '点目录跳到第三页,页码跟着变' }
      )
      const expanded = Number(
        await ctx.cdp.eval(
          `document.querySelector('.file-main .file-pdf-view .file-image-tools')?.getBoundingClientRect().width ?? 0`
        )
      )
      await ctx.cdp.eval(
        `document.querySelector('.file-main .file-pdf-view .file-image-tools button[title="收起工具条"]')?.click()`
      )
      await ctx.cdp.waitFor(
        `(() => {
          const tools = document.querySelector('.file-main .file-pdf-view .file-image-tools')
          const page = document.querySelector('.file-main .file-pdf-page')
          if (tools === null || page === null) return false
          if (tools.querySelector('button[title="放大"]') !== null) return false
          if (tools.querySelector('button[title="展开工具条"]') === null) return false
          const bar = tools.getBoundingClientRect()
          const box = page.getBoundingClientRect()
          const cx = box.left + box.width / 2
          const cy = box.top + box.height / 2
          const covers = cx >= bar.left && cx <= bar.right && cy >= bar.top && cy <= bar.bottom
          return bar.width < 64 && !covers
        })()`,
        { message: '收起后工具条只剩展开按钮,不再盖住页面' }
      )
      const collapsed = Number(
        await ctx.cdp.eval(
          `document.querySelector('.file-main .file-pdf-view .file-image-tools')?.getBoundingClientRect().width ?? 0`
        )
      )
      ok(expanded > 120 && collapsed < expanded / 2, '收起后工具条比展开时窄一半以上')
      await ctx.cdp.eval(
        `document.querySelector('.file-main .file-pdf-view .file-image-tools button[title="展开工具条"]')?.click()`
      )
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-pdf-view .file-image-tools button[title="放大"]') !== null`,
        { message: '展开后缩放按钮回来' }
      )

      await openFile(ctx, 'docs/plain.pdf')
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-pdf canvas') !== null`,
        { timeout: 20_000, message: '没有目录的 PDF 也能画出页面' }
      )
      eq(
        await ctx.cdp.eval(`document.querySelector('.file-main .file-pdf-outline')`),
        null,
        '没有书签时页列表默认收着'
      )
      await ctx.cdp.eval(
        `document.querySelector('.file-main .file-image-tools button[title="目录"]')?.click()`
      )
      await ctx.cdp.waitFor(
        `(() => {
          const item = document.querySelector('.file-main .file-pdf-outline [data-outline-page="2"]')
          if (item === null || item.textContent?.includes('第 2 页') !== true) return false
          return item.querySelector('.file-pdf-outline-thumb canvas') !== null
        })()`,
        { message: '没有书签时按页画成卡片' }
      )
      await ctx.cdp.eval(
        `document.querySelector('.file-main .file-pdf-outline [data-outline-page="2"]')?.click()`
      )
      await ctx.cdp.waitFor(
        `(() => {
          const view = document.querySelector('.file-main .file-pdf-view')
          const scroller = document.querySelector('.file-main .file-pdf')
          const target = document.querySelector('.file-main .file-pdf-page[data-page="2"]')
          if (view === null || scroller === null || target === null) return false
          const box = scroller.getBoundingClientRect()
          const page = target.getBoundingClientRect()
          return view.dataset.pdfPage === '2' && page.top < box.bottom && page.bottom > box.top
        })()`,
        { message: '点页列表跳到第二页' }
      )
      const outlinePoint = await ctx.cdp.json(`(() => {
        const outline = document.querySelector('.file-main .file-pdf-outline')
        if (outline === null) return null
        const box = outline.getBoundingClientRect()
        return { x: box.left + box.width / 2, y: box.top + 24 }
      })()`)
      ok(outlinePoint !== null, '目录卡片区有一块可以滚的位置')
      await ctx.cdp.wheel(outlinePoint.x, outlinePoint.y, 400)
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-pdf-outline')?.scrollTop > 40`,
        { message: '在目录上滑动时目录自己往下滚' }
      )

      await openFile(ctx, 'audio/tone.wav', { expand: ['audio'] })
      await ctx.cdp.waitFor(
        `document.querySelector('audio.file-audio')?.controls === true`,
        { message: '音频用原生控件' }
      )
      await ctx.cdp.waitFor(
        `document.querySelector('audio.file-audio')?.readyState >= 1`,
        { timeout: 10_000, message: '音频元数据加载完成' }
      )
      eq(
        await ctx.cdp.eval(`document.querySelector('audio.file-audio')?.paused`),
        true,
        '打开音频不自动播放'
      )
    }
  },

  {
    id: 'files/office-preview',
    area: 'files',
    title: 'DOCX 渲染正文、XLSX 显示工作表与单元格并支持切换、损坏的 PPTX 给占位',
    tags: ['files', 'office'],
    async run(ctx) {
      writeFile(ctx, 'office/report.docx', await makeDocx())
      writeFile(ctx, 'office/sheet.xlsx', await makeXlsx())
      writeFile(ctx, 'office/broken.pptx', Buffer.from('not a pptx'))

      await openFile(ctx, 'office/report.docx', { expand: ['office'] })
      await ctx.cdp.waitFor(
        `document.querySelector('.file-office[data-office-kind="docx"] [data-office-page]')?.textContent?.includes('E2E DOCX 文本') === true`,
        { timeout: 20_000, message: 'DOCX 正文渲染' }
      )
      await ctx.cdp.eval(`document.querySelectorAll('.file-main .file-zoom button')[2]?.click()`)
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-office-scroll')?.style.zoom === '1.1'`,
        { message: 'Office 预览可放大' }
      )
      await ctx.cdp.eval(`document.querySelectorAll('.file-main .file-zoom button')[1]?.click()`)
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-office-scroll')?.style.zoom === '1'`,
        { message: 'Office 预览可重置缩放' }
      )

      await openFile(ctx, 'office/sheet.xlsx')
      await ctx.cdp.waitFor(
        `document.querySelector('.file-office[data-office-kind="xlsx"] [data-office-sheet]') !== null`,
        { timeout: 20_000, message: 'XLSX 工作表渲染' }
      )
      const sheetText = await ctx.cdp.eval(
        `document.querySelector('.file-main [data-office-sheet]')?.innerText ?? ''`
      )
      includes(sheetText, 'E2E 单元格', 'XLSX 第一张表内容')
      includes(sheetText, '42', 'XLSX 数值单元格')
      eq(
        await ctx.cdp.eval(`document.querySelectorAll('.file-main .file-sheet-tab').length`),
        2,
        '两张工作表各有一个标签'
      )
      await ctx.cdp.eval(`document.querySelectorAll('.file-main .file-sheet-tab')[1]?.click()`)
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main [data-office-sheet]')?.innerText?.includes('另一个表') === true`,
        { message: '切换工作表显示第二张内容' }
      )

      await openFile(ctx, 'office/broken.pptx')
      await ctx.cdp.waitFor(
        `document.querySelector('.file-office[data-office-kind="pptx"] .file-placeholder-title') !== null`,
        { timeout: 20_000, message: '损坏的 PPTX 给错误占位' }
      )
    }
  },

  {
    id: 'files/archive-preview',
    area: 'files',
    title: '压缩包:条目栏可拖,文本行号列不透明;条目树、文本/图片预览、HTML 条目脚本执行、嵌套压缩包、TAR.GZ',
    tags: ['files', 'archive'],
    async run(ctx) {
      writeFile(ctx, 'bundle/bundle.zip', await makeZipBundle())
      writeFile(
        ctx,
        'bundle/bundle.tar.gz',
        gzip(makeTar([{ name: 'note.txt', body: 'tar gz 文本' }]))
      )

      await openFile(ctx, 'bundle/bundle.zip', { expand: ['bundle'] })
      await ctx.cdp.waitFor(`document.querySelector('.file-archive[data-archive-name="bundle.zip"]') !== null`, {
        timeout: 15_000,
        message: 'ZIP 条目树出现'
      })
      await ctx.cdp.waitFor(
        `document.querySelector('.file-archive [data-entry-path="readme.txt"]') !== null &&
         document.querySelector('.file-archive [data-entry-path="site/index.html"]') !== null &&
         document.querySelector('.file-archive [data-entry-path="inner.zip"]') !== null`,
        { message: '条目包含文本、HTML 与嵌套压缩包' }
      )

      // 文本条目:只读代码视图
      await ctx.cdp.eval(
        `document.querySelector('.file-archive [data-entry-path="readme.txt"]')?.click()`
      )
      await ctx.cdp.waitFor(
        `document.querySelector('.file-archive-preview .file-editor .cm-content')?.textContent?.includes('压缩包里的文本') === true`,
        { message: '文本条目用只读编辑器预览' }
      )
      ok(
        (await ctx.cdp.eval(
          `getComputedStyle(document.querySelector('.file-archive[data-archive-name="bundle.zip"] .file-archive-preview .cm-gutters')).backgroundColor !== 'rgba(0, 0, 0, 0)'`
        )) === true,
        '文本行号列不是透明的'
      )
      const grip = await ctx.cdp.json(`(() => {
        const root = document.querySelector('.file-archive[data-archive-name="bundle.zip"]')
        const bar = root?.querySelector(':scope > .file-archive-body > .file-archive-resize')
        const list = root?.querySelector(':scope > .file-archive-body > .file-archive-list')
        if (!bar || !list) return null
        const r = bar.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: list.getBoundingClientRect().width }
      })()`)
      ok(grip !== null, '条目栏有拖动条')
      await ctx.cdp.mouse('mousePressed', grip.x, grip.y, { buttons: 1 })
      await ctx.cdp.mouse('mouseMoved', grip.x - 80, grip.y, { buttons: 1 })
      await ctx.cdp.mouse('mouseReleased', grip.x - 80, grip.y, { buttons: 0 })
      await ctx.cdp.waitFor(
        `document.querySelector('.file-archive[data-archive-name="bundle.zip"] > .file-archive-body > .file-archive-list').getBoundingClientRect().width < ${grip.width - 40}`,
        { message: '向左拖后条目栏变窄' }
      )
      ok(
        (await ctx.cdp.eval(
          `document.querySelector('.file-archive[data-archive-name="bundle.zip"] > .file-archive-body > .file-archive-preview') !== null`
        )) === true,
        '拖完预览还在'
      )

      // 图片条目
      await ctx.cdp.eval(
        `document.querySelector('.file-archive [data-entry-path="pic.png"]')?.click()`
      )
      await ctx.cdp.waitFor(
        `document.querySelector('.file-archive-preview .file-image-stage img')?.naturalWidth > 0`,
        { message: '图片条目进入图片查看器' }
      )

      // HTML 条目:srcdoc + data URL 内联,脚本与样式都要生效
      await ctx.cdp.eval(
        `document.querySelector('.file-archive [data-entry-path="site/index.html"]')?.click()`
      )
      await ctx.cdp.waitFor(
        `document.querySelector('.file-archive-preview iframe[data-file-frame="archive-html"]') !== null`,
        { message: 'HTML 条目用 srcdoc 渲染' }
      )
      const archivePage = await frameHandle(
        ctx,
        'about:srcdoc',
        `document.body !== null && document.body.dataset.ran === '1'`,
        '压缩包内 HTML 的脚本执行了'
      )
      eq(
        await ctx.cdp.evalIn(
          archivePage.sessionId,
          `getComputedStyle(document.getElementById('styled')).color`
        ),
        'rgb(0, 128, 0)',
        '压缩包内 HTML 引用的 style.css 被内联'
      )

      // 嵌套压缩包:面包屑与第二层条目
      await ctx.cdp.eval(
        `document.querySelector('.file-archive [data-entry-path="inner.zip"]')?.click()`
      )
      await ctx.cdp.waitFor(
        `document.querySelectorAll('.file-archive[data-archive-name="inner.zip"]').length === 1`,
        { message: '嵌套 ZIP 打开' }
      )
      includes(
        await ctx.cdp.eval(
          `document.querySelector('.file-archive[data-archive-name="inner.zip"] .file-archive-crumbs')?.textContent ?? ''`
        ),
        'inner.zip',
        '嵌套压缩包的面包屑包含它自己的名字'
      )
      await ctx.cdp.eval(
        `document.querySelector('.file-archive [data-entry-path="deep.txt"]')?.click()`
      )
      await ctx.cdp.waitFor(
        `document.querySelector('.file-archive-preview .file-editor .cm-content')?.textContent?.includes('嵌套内容') === true`,
        { message: '嵌套压缩包内文本可预览' }
      )

      // TAR.GZ
      await openFile(ctx, 'bundle/bundle.tar.gz')
      await ctx.cdp.waitFor(
        `document.querySelector('.file-archive[data-archive-name="bundle.tar.gz"] [data-entry-path="note.txt"]') !== null`,
        { timeout: 15_000, message: 'TAR.GZ 条目树出现' }
      )
      await ctx.cdp.eval(
        `document.querySelector('.file-archive [data-entry-path="note.txt"]')?.click()`
      )
      await ctx.cdp.waitFor(
        `document.querySelector('.file-archive-preview .file-editor .cm-content')?.textContent?.includes('tar gz 文本') === true`,
        { message: 'TAR.GZ 文本条目可预览' }
      )
    }
  },

  {
    id: 'files/model-view',
    area: 'files',
    title: '3D 模型:STL 与内嵌 GLTF 都进入 three.js 画布并报告已加载',
    tags: ['files', 'model'],
    async run(ctx) {
      writeFile(ctx, 'models/tri.stl', STL_ASCII)
      writeFile(ctx, 'models/tri.gltf', embeddedGltf())

      await openFile(ctx, 'models/tri.stl', { expand: ['models'] })
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-model[data-model-state="loaded"] canvas[data-model-canvas]') !== null`,
        { timeout: 25_000, message: 'STL 渲染到画布' }
      )

      await openFile(ctx, 'models/tri.gltf')
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-model[data-model-state="loaded"] canvas[data-model-canvas]') !== null`,
        { timeout: 25_000, message: 'GLTF 渲染到画布' }
      )
    }
  },

  {
    id: 'files/unknown-binary',
    area: 'files',
    title:
      '旧版 Office / RAR / 损坏 ZIP:不能预览时给占位,「用默认应用打开」走 IPC 并给出绝对路径',
    tags: ['files', 'placeholder', 'external'],
    async run(ctx) {
      writeFile(ctx, 'misc/old.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 1, 2, 3]))
      writeFile(ctx, 'misc/pkg.rar', Buffer.from('Rar!\x1a\x07\x00not really'))
      writeFile(ctx, 'misc/broken.zip', Buffer.from('not really a zip'))

      await openFile(ctx, 'misc/old.doc', { expand: ['misc'] })
      eq(
        await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(fileSelector('misc/old.doc'))})?.dataset.fileKind`
        ),
        'legacy-office',
        '旧版 .doc 归到 legacy-office'
      )
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-placeholder .file-placeholder-title') !== null`,
        { message: '.doc 给无法预览的占位' }
      )
      await ctx.cdp.eval(
        `[...document.querySelectorAll('.file-main .file-placeholder .d-btn')].find((b) => b.classList.contains('accent'))?.click()`
      )
      await ctx.waitForLog(
        `[note-open] ${absPath(ctx, 'misc/old.doc')}`,
        '占位里的按钮把绝对路径交给系统默认应用'
      )

      await openFile(ctx, 'misc/pkg.rar')
      eq(
        await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(fileSelector('misc/pkg.rar'))})?.dataset.fileKind`
        ),
        'archive-unsupported',
        'RAR 标为不支持的压缩包'
      )
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-placeholder .file-placeholder-title') !== null`,
        { message: 'RAR 给占位' }
      )

      await openFile(ctx, 'misc/broken.zip')
      await ctx.cdp.waitFor(
        `document.querySelector('.file-archive .file-placeholder-title') !== null`,
        { timeout: 15_000, message: '损坏的 ZIP 给解析失败占位' }
      )
    }
  },

  {
    id: 'files/create-default-md',
    area: 'files',
    title: '新建:一个输入框,默认「未命名.md」,只选中主名,直接打字回车建成 Markdown 笔记',
    tags: ['files', 'rail', 'create'],
    async run(ctx) {
      await ctx.cdp.eval(`document.querySelectorAll('.notes-new-folder')[0]?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.notes-create-fields .notes-create-name') !== null`, {
        timeout: 5000,
        message: '根层出现新建名字输入框'
      })
      const initial = await ctx.cdp.json(`(() => {
        const el = document.querySelector('.notes-create-name')
        return {
          value: el?.value ?? null,
          start: el?.selectionStart ?? -1,
          end: el?.selectionEnd ?? -1,
          split: document.querySelector('.notes-create-ext-input') !== null
        }
      })()`)
      // 以前是两格:主名「未命名」加独立的类型字段 md。现在一格就是完整文件名。
      eq(initial?.value, '未命名.md', '默认值是完整文件名')
      eq(initial?.split, false, '不再有独立的扩展名输入框')
      eq(initial?.start, 0, '选区从主名开头')
      eq(initial?.end, 3, '只选中主名,后缀留在选区外,直接打字即可替换')

      // 直接打字:替换主名,后缀还在 → 建成 Markdown 笔记
      await ctx.cdp.type('默认新建笔记')
      await ctx.press('Enter')
      await ctx.cdp.waitFor(
        `[...document.querySelectorAll('.notes-row[data-note-id]')].some((el) => el.textContent?.includes('默认新建笔记'))`,
        { timeout: 10_000, message: '新笔记出现在左栏' }
      )
      await ctx.cdp.waitFor(`document.querySelector('.notes-title')?.value === '默认新建笔记'`, {
        timeout: 10_000,
        message: '新笔记在编辑器里打开'
      })
      ok(existsSync(absPath(ctx, '默认新建笔记.md')), '磁盘上生成 默认新建笔记.md')
      const badge = await ctx.cdp.json(`(() => {
        const row = [...document.querySelectorAll('.notes-row[data-note-id]')]
          .find((el) => el.textContent?.includes('默认新建笔记'))
        const icon = row?.querySelector('.notes-row-main .notes-file-icon')
        return { kind: icon?.dataset.kind ?? null, cls: icon?.className ?? '' }
      })()`)
      eq(badge?.kind, 'markdown', '新笔记行的图标是 markdown')
      includes(badge?.cls ?? '', 'fa-file-lines', '新笔记行用 Markdown 文件图标')
    }
  },

  {
    id: 'files/create-other-type',
    area: 'files',
    title: '新建:在同一格里把后缀改成 js 后按文件创建(以前类型是另一格,名字里的后缀不算数)',
    tags: ['files', 'rail', 'create'],
    async run(ctx) {
      await ctx.cdp.eval(`document.querySelectorAll('.notes-new-folder')[0]?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.notes-create-fields .notes-create-name') !== null`, {
        timeout: 5000,
        message: '根层出现新建名字输入框'
      })
      // 默认只选中主名。把光标移到后缀前面,删掉 md 再打 js:类型就在这一格里。
      await ctx.cdp.eval(`(() => {
        const el = document.querySelector('.notes-create-name')
        const dot = el.value.lastIndexOf('.')
        el.focus()
        el.setSelectionRange(0, dot)
      })()`)
      await ctx.cdp.type('e2e-fresh')
      await ctx.cdp.eval(`(() => {
        const el = document.querySelector('.notes-create-name')
        const dot = el.value.lastIndexOf('.')
        el.setSelectionRange(dot + 1, el.value.length)
      })()`)
      await ctx.cdp.type('js')
      eq(
        await ctx.cdp.eval(`document.querySelector('.notes-create-name')?.value`),
        'e2e-fresh.js',
        '同一格里改掉后缀后,文件名就是新类型'
      )
      await ctx.press('Enter')

      // 整段文件名原样落地,不会再拼出一份 .js
      await waitFileRow(ctx, 'e2e-fresh.js')
      ok(!existsSync(absPath(ctx, 'e2e-fresh.js.js')), '不会生成 e2e-fresh.js.js')
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-name')?.textContent === 'e2e-fresh.js'`,
        { timeout: 15_000, message: '新文件在应用内打开' }
      )
      ok(existsSync(absPath(ctx, 'e2e-fresh.js')), '磁盘上生成 e2e-fresh.js')
      eq(readFileSync(absPath(ctx, 'e2e-fresh.js'), 'utf8'), '', '新文件是空文件')
      const row = await ctx.cdp.json(`(() => {
        const el = document.querySelector(${JSON.stringify(fileSelector('e2e-fresh.js'))})
        const icon = el?.querySelector('.notes-file-icon')
        return {
          kind: el?.dataset.fileKind ?? null,
          iconKind: icon?.dataset.kind ?? null,
          cls: icon?.className ?? ''
        }
      })()`)
      eq(row?.kind, 'code', 'js 文件行按代码类型着色')
      eq(row?.iconKind, 'code', 'js 文件行图标 data-kind = code')
      includes(row?.cls ?? '', 'fa-file-code', 'js 文件行用代码文件图标')
    }
  },

  {
    id: 'files/create-inside-folder',
    area: 'files',
    title: '新建:目录行的 + 也能建任意类型,文件落在该目录并展开显示',
    tags: ['files', 'rail', 'create'],
    async run(ctx) {
      // 先用底部入口建一个目录,再用目录行的 + 建文件
      await ctx.cdp.eval(`document.querySelectorAll('.notes-new-folder')[1]?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.notes-folder-edit .notes-folder-input') !== null`, {
        timeout: 5000,
        message: '出现新建目录输入框'
      })
      await ctx.cdp.type('新目录')
      await ctx.press('Enter')
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-folder-row[data-folder-path="新目录"]') !== null`,
        { timeout: 10_000, message: '目录「新目录」出现' }
      )

      await ctx.cdp.eval(`document.querySelector('.notes-folder-row[data-folder-path="新目录"]')?.querySelector('[data-folder-act="new-note"]')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.notes-create-fields .notes-create-name') !== null`, {
        timeout: 5000,
        message: '目录里出现新建名字输入框'
      })
      const defaults = await ctx.cdp.json(`(() => ({
        name: document.querySelector('.notes-create-name')?.value ?? null,
        split: document.querySelector('.notes-create-ext-input') !== null
      }))()`)
      eq(defaults?.name, '未命名.md', '目录里的新建默认是完整文件名')
      eq(defaults?.split, false, '目录里的新建也没有独立的扩展名输入框')
      await ctx.cdp.eval(`(() => {
        const el = document.querySelector('.notes-create-name')
        const dot = el.value.lastIndexOf('.')
        el.focus()
        el.setSelectionRange(0, dot)
      })()`)
      await ctx.cdp.type('sub')
      await ctx.cdp.eval(`(() => {
        const el = document.querySelector('.notes-create-name')
        const dot = el.value.lastIndexOf('.')
        el.setSelectionRange(dot + 1, el.value.length)
      })()`)
      await ctx.cdp.type('txt')
      await ctx.press('Enter')

      await waitFileRow(ctx, '新目录/sub.txt')
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-name')?.textContent === 'sub.txt'`,
        { timeout: 15_000, message: '目录里的新文件在应用内打开' }
      )
      ok(existsSync(absPath(ctx, '新目录/sub.txt')), '文件落在所选目录')
      eq(
        await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(fileSelector('新目录/sub.txt'))})?.querySelector('.notes-file-icon')?.dataset.kind`
        ),
        'text',
        'txt 图标的 data-kind = text'
      )
    }
  },

  {
    id: 'files/icons',
    area: 'files',
    title: '左栏按类型换图形图标:代码/图片/PDF/Office/压缩包/3D/CSV 各有自己的符号,md 笔记行也有文件图标',
    tags: ['files', 'rail', 'icons'],
    async run(ctx) {
      const fixtures = [
        ['icons/ic.js', 'code', 'fa-file-code'],
        ['icons/ic.html', 'html', 'fa-file-code'],
        ['icons/ic.png', 'image', 'fa-file-image'],
        ['icons/ic.pdf', 'pdf', 'fa-file-pdf'],
        ['icons/ic.docx', 'docx', 'fa-file-word'],
        ['icons/ic.xlsx', 'xlsx', 'fa-file-excel'],
        ['icons/ic.zip', 'archive', 'fa-file-zipper'],
        ['icons/ic.stl', 'model', 'fa-cube'],
        ['icons/ic.csv', 'csv', 'fa-file-csv']
      ]
      for (const [rel] of fixtures) writeFile(ctx, rel, rel.endsWith('.png') ? PNG_1PX : 'x')
      await expandFolder(ctx, 'icons')
      await ctx.cdp.waitFor(
        fixtures
          .map(([rel]) => `document.querySelector(${JSON.stringify(fileSelector(rel))}) !== null`)
          .join(' && '),
        { timeout: 10_000, message: '所有类型文件行出现' }
      )

      for (const [rel, kind, iconClass] of fixtures) {
        const seen = await ctx.cdp.json(`(() => {
          const row = document.querySelector(${JSON.stringify(fileSelector(rel))})
          if (row === null) return null
          const iconEl = row.querySelector('.notes-file-icon')
          return {
            kind: row.dataset.fileKind ?? null,
            iconKind: iconEl?.dataset.kind ?? null,
            cls: iconEl?.className ?? '',
            legacyBadge: row.querySelector('.file-type-badge') !== null
          }
        })()`)
        eq(seen?.kind, kind, `${rel} 的 data-file-kind`)
        eq(seen?.iconKind, kind, `${rel} 图标的 data-kind`)
        includes(seen?.cls ?? '', iconClass, `${rel} 使用 ${iconClass} 图形图标`)
        eq(seen?.legacyBadge, false, `${rel} 不再使用写后缀的文字徽标`)
      }

      // Markdown 笔记行也带图形图标(不再是文字徽标)
      const mdIcon = await ctx.cdp.json(`(() => {
        const row = document.querySelector('.notes-row[data-note-id]')
        const icon = row?.querySelector('.notes-row-main .notes-file-icon')
        return {
          kind: icon?.dataset.kind ?? null,
          cls: icon?.className ?? ''
        }
      })()`)
      eq(mdIcon?.kind, 'markdown', '笔记行图标的 data-kind 是 markdown')
      includes(mdIcon?.cls ?? '', 'fa-file-lines', '笔记行用 Markdown 文件图标')
    }
  },

  {
    id: 'files/rename-keeps-type',
    area: 'files',
    title:
      '重命名文件:输入框是完整文件名(以前后缀锁在外面),只改主名时后缀还在;磁盘与打开中的标题一起改名;同名拒绝且不覆盖',
    tags: ['files', 'rail', 'rename'],
    async run(ctx) {
      writeFile(ctx, 'rename/old.txt', 'rename me')
      writeFile(ctx, 'rename/taken.txt', 'taken')
      await openFile(ctx, 'rename/old.txt', { expand: ['rename'] })

      // 悬停出动作浮层,点「重命名」
      const rowRect = await ctx.elementRect(fileSelector('rename/old.txt'))
      await ctx.cdp.mouse(
        'mouseMoved',
        rowRect.x + rowRect.width - 60,
        rowRect.y + rowRect.height / 2
      )
      await ctx.cdp.waitFor(
        `getComputedStyle(document.querySelector(${JSON.stringify(
          fileSelector('rename/old.txt') + ' .notes-row-acts'
        )})).display !== 'none'`,
        { message: '悬停后文件行动作出现' }
      )
      await ctx.cdp.eval(
        `document.querySelector(${JSON.stringify(
          fileSelector('rename/old.txt')
        )}).querySelector('[data-file-action="rename"]')?.click()`
      )

      await ctx.cdp.waitFor(`document.querySelector('.notes-file-rename input') !== null`, {
        timeout: 5000,
        message: '出现文件改名输入框'
      })
      const field = await ctx.cdp.json(`(() => {
        const el = document.querySelector('.notes-file-rename input')
        return {
          value: el?.value ?? null,
          start: el?.selectionStart ?? -1,
          end: el?.selectionEnd ?? -1,
          locked: document.querySelector('.notes-file-rename-ext') !== null
        }
      })()`)
      eq(field?.value, 'old.txt', '改名输入框是完整文件名')
      eq(field?.locked, false, '不再有锁在外面的扩展名')
      eq(field?.start, 0, '选区从主名开头')
      eq(field?.end, 3, '只选中主名,后缀留在选区外')

      await ctx.cdp.type('new')
      await ctx.press('Enter')

      await ctx.waitForNode(
        () =>
          existsSync(absPath(ctx, 'rename/new.txt')) && !existsSync(absPath(ctx, 'rename/old.txt')),
        '磁盘上的文件被改名且扩展名不变'
      )
      eq(readFileSync(absPath(ctx, 'rename/new.txt'), 'utf8'), 'rename me', '内容原样保留')
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-name')?.textContent === 'new.txt'`,
        { timeout: 10_000, message: '打开中的文件视图跟随新名字' }
      )
      eq(
        await ctx.cdp.eval(
          `document.querySelector('.file-main .file-path .notes-file-icon')?.dataset.kind`
        ),
        'text',
        '改名后类型图标仍是 text'
      )
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileSelector('rename/new.txt'))}) !== null`,
        { timeout: 10_000, message: '左栏文件行换成新路径' }
      )

      // 撞名:目标已存在时拒绝,原文件不动
      await waitFileRow(ctx, 'rename/taken.txt')
      const newRow = await ctx.elementRect(fileSelector('rename/new.txt'))
      await ctx.cdp.mouse('mouseMoved', newRow.x + newRow.width - 60, newRow.y + newRow.height / 2)
      await ctx.cdp.eval(
        `document.querySelector(${JSON.stringify(
          fileSelector('rename/new.txt')
        )}).querySelector('[data-file-action="rename"]')?.click()`
      )
      await ctx.cdp.waitFor(`document.querySelector('.notes-file-rename input') !== null`, {
        timeout: 5000,
        message: '再次出现改名输入框'
      })
      await ctx.cdp.eval(`(() => {
        const el = document.querySelector('.notes-file-rename input')
        const dot = el.value.lastIndexOf('.')
        el.setSelectionRange(0, dot)
      })()`)
      await ctx.cdp.type('taken')
      await ctx.press('Enter')
      await ctx.cdp.waitFor(
        `document.querySelector('#toast.show')?.textContent?.includes('同名文件已存在') === true`,
        { timeout: 5000, message: '同名时给出提示' }
      )
      ok(existsSync(absPath(ctx, 'rename/new.txt')), '撞名失败后原文件仍在')
      ok(existsSync(absPath(ctx, 'rename/taken.txt')), '已有的同名文件没有被覆盖')
      eq(readFileSync(absPath(ctx, 'rename/taken.txt'), 'utf8'), 'taken', '同名文件内容不变')
    }
  },

  {
    id: 'files/rename-changes-type',
    area: 'files',
    title: '重命名文件:同一格里改后缀,磁盘、左栏与打开中的类型一起变;改成 .md 被拒绝且原文件不动',
    tags: ['files', 'rail', 'rename'],
    async run(ctx) {
      writeFile(ctx, 'retype/old.txt', 'keep me')
      await openFile(ctx, 'retype/old.txt', { expand: ['retype'] })

      const rowRect = await ctx.elementRect(fileSelector('retype/old.txt'))
      await ctx.cdp.mouse('mouseMoved', rowRect.x + rowRect.width - 60, rowRect.y + rowRect.height / 2)
      await ctx.cdp.eval(
        `document.querySelector(${JSON.stringify(
          fileSelector('retype/old.txt')
        )}).querySelector('[data-file-action="rename"]')?.click()`
      )
      await ctx.cdp.waitFor(`document.querySelector('.notes-file-rename input') !== null`, {
        timeout: 5000,
        message: '出现文件改名输入框'
      })
      // 只换后缀:主名留着,把 .txt 改成 .js
      await ctx.cdp.eval(`(() => {
        const el = document.querySelector('.notes-file-rename input')
        const dot = el.value.lastIndexOf('.')
        el.focus()
        el.setSelectionRange(dot + 1, el.value.length)
      })()`)
      await ctx.cdp.type('js')
      eq(
        await ctx.cdp.eval(`document.querySelector('.notes-file-rename input')?.value`),
        'old.js',
        '同一格里改掉后缀'
      )
      await ctx.press('Enter')

      await ctx.waitForNode(
        () => existsSync(absPath(ctx, 'retype/old.js')) && !existsSync(absPath(ctx, 'retype/old.txt')),
        '磁盘上的后缀换成 js'
      )
      eq(readFileSync(absPath(ctx, 'retype/old.js'), 'utf8'), 'keep me', '改后缀后正文还在')
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-name')?.textContent === 'old.js'`,
        { timeout: 10_000, message: '打开中的标题换成新文件名' }
      )
      eq(
        await ctx.cdp.eval(
          `document.querySelector('.file-main .file-path .notes-file-icon')?.dataset.kind`
        ),
        'code',
        '打开中的类型图标换成代码'
      )
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileSelector('retype/old.js'))})?.dataset.fileKind === 'code'`,
        { timeout: 10_000, message: '左栏文件行换成新路径且类型是代码' }
      )

      // 再改成 .md:会被收成笔记,文件改名不走这条路
      const jsRow = await ctx.elementRect(fileSelector('retype/old.js'))
      await ctx.cdp.mouse('mouseMoved', jsRow.x + jsRow.width - 60, jsRow.y + jsRow.height / 2)
      await ctx.cdp.eval(
        `document.querySelector(${JSON.stringify(
          fileSelector('retype/old.js')
        )}).querySelector('[data-file-action="rename"]')?.click()`
      )
      await ctx.cdp.waitFor(`document.querySelector('.notes-file-rename input') !== null`, {
        timeout: 5000,
        message: '再次出现改名输入框'
      })
      await ctx.cdp.eval(`(() => {
        const el = document.querySelector('.notes-file-rename input')
        const dot = el.value.lastIndexOf('.')
        el.focus()
        el.setSelectionRange(dot + 1, el.value.length)
      })()`)
      await ctx.cdp.type('md')
      await ctx.press('Enter')
      await ctx.cdp.waitFor(
        `document.querySelector('#toast.show')?.textContent?.includes('Markdown 笔记请使用') === true`,
        { timeout: 5000, message: '改成 .md 时给出提示' }
      )
      ok(existsSync(absPath(ctx, 'retype/old.js')), '改成 .md 被拒绝后原文件仍在')
      ok(!existsSync(absPath(ctx, 'retype/old.md')), '没有生成 .md')
      eq(readFileSync(absPath(ctx, 'retype/old.js'), 'utf8'), 'keep me', '被拒绝后正文不变')
    }
  },

  {
    id: 'files/opening-spinner-slot',
    area: 'files',
    title: '打开文件较慢时:转圈替换类型图标(同一槽位),标题不位移,完成后图标恢复',
    tags: ['files', 'rail', 'spinner'],
    async run(ctx) {
      // 与笔记行一致:E2E 把延迟调成 0,直接验证超过阈值后的转圈槽位。
      await ctx.cdp.eval(`document.documentElement.dataset.openingSpinnerDelay = '0'`)
      const rel = 'opening-probe.txt'
      writeFile(ctx, rel, 'spinner probe\n')
      await waitFileRow(ctx, rel)
      const sel = fileSelector(rel)

      const base = await ctx.cdp.json(`(() => {
        const el = document.querySelector(${JSON.stringify(sel)})
        if (el === null) return null
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
      ok(base !== null, `找到文件行:${rel}`)
      eq(base.spin, false, '空闲时没有转圈')
      eq(base.iconPresent, true, '空闲时显示类型图标')
      eq(base.iconKind, 'text', 'txt 文件行图标是 text')
      includes(base.iconClass, 'fa-file-lines', '图标字形是 fa-file-lines')

      // 与笔记行相同:观察稳定的列表容器,每次采样重新查询行。
      // 文件 open() 在第一个 await 前就同步置 openingPath,React 会在 IPC 返回前提交这一帧。
      await ctx.cdp.eval(`(() => {
        const list = document.querySelector('.notes-rail-list')
        const probe = { samples: [] }
        const take = () => {
          const el = document.querySelector(${JSON.stringify(sel)})
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

      await ctx.cdp.eval(`document.querySelector(${JSON.stringify(sel)})?.click()`)
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-name')?.textContent === ${JSON.stringify(rel)}`,
        { timeout: 15_000, message: `文件视图打开:${rel}` }
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
      ok(spinSample.spinInMain === true, '转圈位于 .notes-row-main 内(替换图标槽位)')
      eq(spinSample.iconPresent, false, '转圈出现时类型图标被替换,不并存')
      eq(spinSample.opening, true, '打开中的文件行带 opening 状态')
      eq(spinSample.busy, true, '打开中的文件行 aria-busy=true')

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
        const el = document.querySelector(${JSON.stringify(sel)})
        const icon = el?.querySelector('.notes-row-main .notes-file-icon')
        return { kind: icon?.dataset.kind ?? null, cls: icon?.className ?? '' }
      })()`)
      eq(restored?.kind, 'text', '完成后类型图标恢复')
      includes(restored?.cls ?? '', 'fa-file-lines', '恢复的仍是文本文件图标')
      await ctx.cdp.eval(`delete document.documentElement.dataset.openingSpinnerDelay`)
    }
  }
]
