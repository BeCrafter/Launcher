import { eq, ok } from '../lib/assert.mjs'

// 可缩放区块的角柄:图片 / 音视频 / 网页 / PDF / 表格 / 图表共用一套观感 ——
// 悬停出描边 + 一个角柄,拖它改尺寸,松手写回正文。
//
// 这组用例看的是**用户看到的样子**,不是内部函数:
//   · 角柄必须贴在区块的**右下角**;定了宽之后区块要跟着内容收缩,角柄不能浮在中间;
//   · 描边画在用户认的那一层(嵌入画在整张卡片上、表格画在表格上),不能里外两个框;
//   · 角柄在拖动位置真的能被点中 —— 没被 iframe / 表格新增条 / 滚动容器盖住或裁掉;
//   · 拖完尺寸写回正文的正确落点(图片 alt、嵌入围栏正文、表格 / 图表围栏信息串)。

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const IMAGE_DOC = [
  '# 图片缩放',
  '',
  '![示意图](assets/sample.png)',
  '',
  '图片下面的说明文字。'
].join('\n')

const AV_DOC = [
  '# 音视频缩放',
  '',
  '![声音](assets/sample.mp3)',
  '',
  '![录像](assets/sample.mp4)',
  '',
  '音视频下面的说明文字。'
].join('\n')

const EMBED_DOC = [
  '# 网页嵌入缩放',
  '',
  '```embed',
  'assets/sample-page.html',
  'height: 200',
  '```',
  '',
  '嵌入下面的说明文字。'
].join('\n')

const PDF_DOC = [
  '# PDF 缩放',
  '',
  '![](assets/sample.pdf)',
  '',
  'PDF 下面的说明文字。'
].join('\n')

const TABLE_DOC = [
  '# 表格缩放',
  '',
  '```table',
  '| 列一 | 列二 |',
  '| --- | --- |',
  '| 甲 | 乙 |',
  '```',
  '',
  '表格下面的说明文字。'
].join('\n')

const DIAGRAM_DOC = [
  '# 图表缩放',
  '',
  '```mermaid',
  'flowchart LR',
  '  A --> B',
  '```',
  '',
  '图表下面的说明文字。'
].join('\n')

/**
 * 量角柄和它所在的区块。
 *
 * `handleIn` 是角柄的宿主(拖动时它带 `.dragging`),`anchor` 是角柄该贴住的那一层 ——
 * 两者并不总是同一个元素:表格的角柄挂在带 24px 新增条留白的外层块上,要贴的是里面的表格。
 */
async function geometry(ctx, spec) {
  return ctx.cdp.json(`(() => {
    const host = document.querySelector(${JSON.stringify(spec.handleIn)})
    const anchor = document.querySelector(${JSON.stringify(spec.anchor)})
    const handle = host === null ? null : host.querySelector('.md-resize-handle')
    if (host === null || anchor === null || handle === null) return null
    const b = anchor.getBoundingClientRect()
    const h = handle.getBoundingClientRect()
    const cs = getComputedStyle(handle)
    // 点角柄**外侧**那半圈:网页 / PDF 的内部是 iframe,内侧的坐标会被它吞掉
    const cx = Math.round(h.right - 3)
    const cy = Math.round(h.bottom - 3)
    const top = document.elementFromPoint(cx, cy)
    return {
      anchor: { right: b.right, bottom: b.bottom, width: b.width, height: b.height },
      handle: { right: h.right, bottom: h.bottom, cx, cy },
      opacity: cs.opacity,
      hit: top === handle || (top !== null && handle.contains(top)),
      at: top === null ? 'null' : typeof top.className === 'string' ? top.className : top.tagName,
      view: { w: innerWidth, h: innerHeight }
    }
  })()`)
}

async function outlineOf(ctx, selector) {
  return ctx.cdp.json(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (el === null) return null
    const s = getComputedStyle(el)
    return { style: s.outlineStyle, width: s.outlineWidth }
  })()`)
}

/** 把指针停到预览左上角的空白处,别让上一步的悬停串进这一条断言 */
async function parkPointer(ctx) {
  const at = await ctx.cdp.json(`(() => {
    const b = document.querySelector('.notes-preview-body')?.getBoundingClientRect()
    return b === undefined || b === null ? null : { x: Math.round(b.left + 4), y: Math.round(b.top + 4) }
  })()`)
  if (at !== null) await ctx.cdp.mouse('mouseMoved', at.x, at.y)
  await sleep(100)
}

/** 把区块滚到视口中间,再量坐标 —— 预览区会滚动,直接量到的坐标可能落在视口外 */
async function reveal(ctx, selector) {
  await ctx.cdp.eval(
    `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center', inline: 'nearest' })`
  )
  await sleep(200)
}

/** 指针移到角柄外侧那半圈:透明时也命中得到,移上去区块就进入 :hover */
async function moveToHandle(ctx, spec) {
  const before = await geometry(ctx, spec)
  ok(before !== null, `找到 ${spec.handleIn} 的缩放角柄`)
  await ctx.cdp.mouse('mouseMoved', before.handle.cx, before.handle.cy)
  await ctx.cdp.waitFor(
    `(() => {
      const h = document.querySelector(${JSON.stringify(spec.handleIn)})?.querySelector('.md-resize-handle')
      return h !== null && getComputedStyle(h).opacity === '1'
    })()`,
    { timeout: 3000, message: '悬停后角柄显形' }
  )
  const after = await geometry(ctx, spec)
  ok(after !== null, '悬停后角柄仍可量到')
  return after
}

/**
 * 角柄必须贴着 `anchor` 的右下角,画在框外 `offset` px。
 *
 * `offset` 默认 7(与 `.md-resize-handle { right/bottom: -7px }` 一致);
 * 嵌入的描边画在带 1px 边框的整张卡片上,角柄相对卡片只差 6px,由调用方传入。
 */
function assertCorner(g, label, offset = 7) {
  ok(g !== null, `${label}:角柄存在`)
  ok(
    g.hit,
    `${label}:角柄所在位置真的能点中,没有被 iframe / 滚动容器盖住(命中 ${g.at} @ ${g.handle.cx},${g.handle.cy} 视口 ${g.view.w}×${g.view.h})`
  )
  ok(
    Math.abs(g.handle.right - (g.anchor.right + offset)) <= 2,
    `${label}:角柄右缘应贴着区块右下角外 ${offset}px(角柄 ${g.handle.right.toFixed(1)} / 区块 ${g.anchor.right.toFixed(1)})`
  )
  ok(
    Math.abs(g.handle.bottom - (g.anchor.bottom + offset)) <= 2,
    `${label}:角柄下缘应贴着区块右下角外 ${offset}px(角柄 ${g.handle.bottom.toFixed(1)} / 区块 ${g.anchor.bottom.toFixed(1)})`
  )
}

/** 按住角柄拖 `dx`/`dy`;拖到一半断言区块进入拖拽态、角柄还在,松手后返回首尾几何 */
async function dragHandle(ctx, spec, dx, dy) {
  const start = await moveToHandle(ctx, spec)
  await ctx.cdp.mouse('mousePressed', start.handle.cx, start.handle.cy, { buttons: 1 })
  const steps = 6
  for (let i = 1; i <= steps; i += 1) {
    await ctx.cdp.mouse(
      'mouseMoved',
      start.handle.cx + Math.round((dx * i) / steps),
      start.handle.cy + Math.round((dy * i) / steps),
      { buttons: 1 }
    )
    await sleep(25)
  }
  const dragging = await ctx.cdp.eval(
    `document.querySelector(${JSON.stringify(spec.handleIn)})?.classList.contains('dragging') === true`
  )
  ok(dragging, '拖动角柄时区块进入拖拽态')
  const during = await geometry(ctx, spec)
  eq(during.opacity, '1', '拖动中角柄保持可见')
  await ctx.cdp.mouse('mouseReleased', start.handle.cx + dx, start.handle.cy + dy, { buttons: 0 })
  await ctx.cdp.waitFor(
    `document.querySelector(${JSON.stringify(spec.handleIn)})?.classList.contains('dragging') !== true`,
    { timeout: 3000, message: '松开后退出拖拽态' }
  )
  return { start, end: await geometry(ctx, spec) }
}

/** 单轴改宽后,高度按固有比例跟 —— 不跟就是拉变形了 */
function assertRatioKept(start, end, label) {
  const before = start.anchor.height / start.anchor.width
  const after = end.anchor.height / end.anchor.width
  ok(
    Math.abs(before - after) <= 0.02,
    `${label}:只拖宽时高度应等比变化(原比例 ${before.toFixed(3)} / 拖后 ${after.toFixed(3)})`
  )
}

export default [
  {
    id: 'resize/image-handle',
    area: 'resize',
    title: '图片:悬停出描边与右下角角柄,拖角柄改宽并写回 alt;定宽后不再被栏宽卡住,角柄仍贴图片右下角',
    tags: ['resize', 'media', 'image'],
    fixture: IMAGE_DOC,
    async run(ctx) {
      const box = '.notes-preview-body .md-media-box[data-kind="image"]'
      const img = `${box} img.md-img`
      await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(img)})?.complete === true`, {
        timeout: 10_000,
        message: '图片加载完成'
      })
      await reveal(ctx, box)
      await parkPointer(ctx)

      const spec = { handleIn: box, anchor: box }
      const imgSize = () =>
        ctx.cdp.json(`(() => {
          const r = document.querySelector(${JSON.stringify(img)}).getBoundingClientRect()
          return { width: r.width, height: r.height }
        })()`)
      const before = await geometry(ctx, spec)
      ok(before !== null, '找到图片的缩放角柄')
      eq(before.opacity, '0', '未悬停时图片角柄不可见')

      const hovered = await moveToHandle(ctx, spec)
      assertCorner(hovered, '悬停时')
      const border = await outlineOf(ctx, box)
      eq(border.style, 'solid', '悬停时图片框出现描边')
      eq(border.width, '2px', '描边宽 2px')

      // 移开:描边与角柄一起收起,不留下悬停残影
      await parkPointer(ctx)
      eq((await geometry(ctx, spec)).opacity, '0', '移开后角柄重新隐藏')
      eq((await outlineOf(ctx, box)).style, 'none', '移开后描边也消失')

      const sizeStart = await imgSize()
      const { end } = await dragHandle(ctx, spec, -60, 0)
      const sizeEnd = await imgSize()
      ok(
        end.anchor.width < before.anchor.width - 30,
        `拖动后图片变窄:${before.anchor.width.toFixed(1)} → ${end.anchor.width.toFixed(1)}`
      )
      assertCorner(end, '拖动后')
      assertRatioKept({ anchor: sizeStart }, { anchor: sizeEnd }, '图片')
      // 盒子必须跟着图片收缩 —— 盒子还停在栏宽上时角柄会浮在图片中间
      ok(
        Math.abs(end.anchor.width - sizeEnd.width) <= 2,
        `定宽后盒子应与图片同宽(盒子 ${end.anchor.width.toFixed(1)} / 图片 ${sizeEnd.width.toFixed(1)})`
      )
      eq(
        await ctx.cdp.eval(`getComputedStyle(document.querySelector(${JSON.stringify(img)})).maxWidth`),
        'none',
        '定宽后图片解除 max-width,不会被栏宽压回去'
      )

      await ctx.waitSaved()
      const body = await ctx.savedBody()
      const m = /!\[示意图\|(\d+)\]\(assets\/sample\.png\)/.exec(body ?? '')
      ok(m !== null, `宽度应写回图片 alt,实际正文:\n${body}`)
      ok(
        Math.abs(Number(m[1]) - end.anchor.width) <= 2,
        `写回的宽度应与渲染宽度一致(写回 ${m[1]},渲染 ${end.anchor.width.toFixed(1)})`
      )
    }
  },

  {
    id: 'resize/audio-video-handle',
    area: 'resize',
    title: '音视频:铺满一栏时角柄仍贴右下角;拖音频角柄改宽并写回 alt',
    tags: ['resize', 'media'],
    fixture: AV_DOC,
    async run(ctx) {
      const audioBox = '.notes-preview-body .md-media-box[data-kind="audio"]'
      const videoBox = '.notes-preview-body .md-media-box[data-kind="video"]'
      await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(audioBox)}) !== null`, {
        message: '音频渲染'
      })
      await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(videoBox)}) !== null`, {
        message: '视频渲染'
      })
      // 音频 / 视频加载出真实高度后盒子才有量得准的右下角
      await ctx.cdp.waitFor(
        `(() => {
          const a = document.querySelector(${JSON.stringify(audioBox)})
          const v = document.querySelector(${JSON.stringify(videoBox)})
          return a !== null && v !== null &&
            a.getBoundingClientRect().height > 20 && v.getBoundingClientRect().height > 20
        })()`,
        { timeout: 10_000, message: '音视频量出真实高度' }
      )
      await reveal(ctx, audioBox)
      await parkPointer(ctx)

      const audio = { handleIn: audioBox, anchor: audioBox }
      const video = { handleIn: videoBox, anchor: videoBox }
      eq((await geometry(ctx, audio)).opacity, '0', '未悬停时音频角柄不可见')
      assertCorner(await moveToHandle(ctx, audio), '音频悬停时')

      // 视频在下一条:先确认它没有跟着音频一起显形
      await parkPointer(ctx)
      eq((await geometry(ctx, video)).opacity, '0', '悬停音频时视频角柄保持隐藏')
      await reveal(ctx, videoBox)
      await parkPointer(ctx)
      assertCorner(await moveToHandle(ctx, video), '视频悬停时')
      ok((await outlineOf(ctx, videoBox)).style === 'solid', '悬停视频时框出现描边')

      // 拖音频:铺满一栏的区块定宽后跟着内容收缩,角柄贴着新的右下角。
      // 往左拖(变窄)而不是往右:铺满一栏的区块再变宽会把角柄推到窗口外,
      // 这里要看的是「定宽后角柄仍贴角」,两个方向等价。
      await reveal(ctx, audioBox)
      await parkPointer(ctx)
      const { start, end } = await dragHandle(ctx, audio, -50, 0)
      ok(
        end.anchor.width < start.anchor.width - 20,
        `拖动后音频变窄:${start.anchor.width.toFixed(1)} → ${end.anchor.width.toFixed(1)}`
      )
      assertCorner(end, '拖动后')

      await ctx.waitSaved()
      const body = await ctx.savedBody()
      const m = /!\[声音\|(\d+)\]\(assets\/sample\.mp3\)/.exec(body ?? '')
      ok(m !== null, `音频宽度应写回 alt,实际正文:\n${body}`)
      ok(
        Math.abs(Number(m[1]) - end.anchor.width) <= 2,
        `写回的宽度应与渲染宽度一致(写回 ${m[1]},渲染 ${end.anchor.width.toFixed(1)})`
      )
    }
  },

  {
    id: 'resize/embed-card-handle',
    area: 'resize',
    title: '网页嵌入:描边画在整张卡片上而不是里面的 iframe,角柄贴卡片右下角;拖两轴改宽高并写回围栏,卡片跟着内容收缩',
    tags: ['resize', 'media', 'embed'],
    fixture: EMBED_DOC,
    async run(ctx) {
      const box = '.notes-preview-body .md-media-box[data-kind="embed"]'
      const card = '.notes-preview-body .md-embed'
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(box)})?.querySelector('iframe.md-embed-frame') !== null`,
        { timeout: 10_000, message: '网页 iframe 渲染' }
      )
      await reveal(ctx, card)
      await parkPointer(ctx)

      const embed = { handleIn: box, anchor: card }
      const boxOnly = { handleIn: box, anchor: box }
      const startBox = await geometry(ctx, boxOnly)
      ok(startBox !== null, '量到嵌入的 iframe 盒子')

      const hovered = await moveToHandle(ctx, embed)
      assertCorner(hovered, '悬停时', 6)
      // 整张卡片(含地址栏)一圈描边;里面的 iframe 盒子不能再画第二个框
      const cardOutline = await outlineOf(ctx, card)
      eq(cardOutline.style, 'solid', '悬停时整张嵌入卡片出现描边')
      eq(cardOutline.width, '2px', '描边宽 2px')
      eq((await outlineOf(ctx, box)).style, 'none', '内层 iframe 盒子不重复描边')

      const { end } = await dragHandle(ctx, embed, -120, 40)
      assertCorner(end, '拖动后', 6)

      // 卡片与内容同宽:曾经出现「框停在栏宽、iframe 自己变宽」的错位
      const sizes = await ctx.cdp.json(`(() => {
        const c = document.querySelector(${JSON.stringify(card)}).getBoundingClientRect()
        const b = document.querySelector(${JSON.stringify(box)}).getBoundingClientRect()
        const f = document.querySelector(${JSON.stringify(box)} + ' iframe').getBoundingClientRect()
        return { card: c.width, box: b.width, boxH: b.height, frame: f.width, frameH: f.height }
      })()`)
      ok(
        Math.abs(sizes.card - sizes.box) <= 3,
        `卡片应与内容同宽:卡片 ${sizes.card.toFixed(1)} / 内容 ${sizes.box.toFixed(1)}`
      )
      ok(
        Math.abs(sizes.frame - sizes.box) <= 1 && Math.abs(sizes.frameH - sizes.boxH) <= 1,
        `iframe 应恰好铺满盒子:iframe ${sizes.frame.toFixed(1)}×${sizes.frameH.toFixed(1)} / 盒子 ${sizes.box.toFixed(1)}×${sizes.boxH.toFixed(1)}`
      )

      await ctx.waitSaved()
      const body = await ctx.savedBody()
      const mw = /^width: (\d+)$/m.exec(body ?? '')
      const mh = /^height: (\d+)$/m.exec(body ?? '')
      ok(mw !== null && mh !== null, `宽高应写进 embed 围栏,实际正文:\n${body}`)
      ok(
        Math.abs(Number(mw[1]) - (startBox.anchor.width - 120)) <= 2,
        `写回的宽度应等于拖后的宽(写回 ${mw[1]},期望 ${(startBox.anchor.width - 120).toFixed(1)})`
      )
      ok(
        Math.abs(Number(mh[1]) - (startBox.anchor.height + 40)) <= 2,
        `写回的高度应等于拖后的高(写回 ${mh[1]},期望 ${(startBox.anchor.height + 40).toFixed(1)})`
      )
    }
  },

  {
    id: 'resize/pdf-handle',
    area: 'resize',
    title: 'PDF:悬停出描边与右下角角柄,两轴拖动改宽高并写回 alt 的 |宽x高',
    tags: ['resize', 'media', 'pdf'],
    fixture: PDF_DOC,
    async run(ctx) {
      const box = '.notes-preview-body .md-media-box[data-kind="pdf"]'
      await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(box)})?.querySelector('iframe.md-media-pdf') !== null`, {
        timeout: 10_000,
        message: 'PDF 阅读器渲染'
      })
      await reveal(ctx, box)
      await parkPointer(ctx)

      const spec = { handleIn: box, anchor: box }
      const start = await geometry(ctx, spec)
      ok(start !== null, '量到 PDF 盒子')

      const hovered = await moveToHandle(ctx, spec)
      assertCorner(hovered, '悬停时')
      eq((await outlineOf(ctx, box)).style, 'solid', '悬停时 PDF 框出现描边')
      eq((await outlineOf(ctx, box)).width, '2px', '描边宽 2px')

      const { end } = await dragHandle(ctx, spec, -80, 40)
      assertCorner(end, '拖动后')
      ok(
        end.anchor.width < start.anchor.width - 40 && end.anchor.height > start.anchor.height + 20,
        `PDF 宽度变窄、高度变大:${start.anchor.width.toFixed(1)}×${start.anchor.height.toFixed(1)} → ${end.anchor.width.toFixed(1)}×${end.anchor.height.toFixed(1)}`
      )

      await ctx.waitSaved()
      const body = await ctx.savedBody()
      const m = /!\[\|(\d+)x(\d+)\]\(assets\/sample\.pdf\)/.exec(body ?? '')
      ok(m !== null, `宽高应写回 alt 的 |宽x高,实际正文:\n${body}`)
      ok(
        Math.abs(Number(m[1]) - (start.anchor.width - 80)) <= 2 &&
          Math.abs(Number(m[2]) - (start.anchor.height + 40)) <= 2,
        `写回的宽高应与拖后一致(写回 ${m[1]}×${m[2]},期望 ${(start.anchor.width - 80).toFixed(1)}×${(start.anchor.height + 40).toFixed(1)})`
      )
    }
  },

  {
    id: 'resize/table-handle',
    area: 'resize',
    title: '表格:角柄贴在表格右下角(不被外层 24px 新增条留白推偏),描边画在表格上;拖角柄改宽并写回围栏 width=',
    tags: ['resize', 'table'],
    fixture: TABLE_DOC,
    async run(ctx) {
      const block = '.notes-preview-body .md-table-block'
      const table = `${block} .md-table`
      await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(table)}) !== null`, {
        message: '表格渲染'
      })
      await reveal(ctx, block)
      await parkPointer(ctx)

      const spec = { handleIn: block, anchor: table }
      const start = await geometry(ctx, spec)
      ok(start !== null, '量到表格的缩放角柄')

      const hovered = await moveToHandle(ctx, spec)
      assertCorner(hovered, '悬停时')
      // 描边画在表格自己身上;外层块的 24px 留白不该出现第二个框
      eq((await outlineOf(ctx, table)).style, 'solid', '悬停时表格出现描边')
      eq((await outlineOf(ctx, block)).style, 'none', '外层留白块不画描边')

      const { end } = await dragHandle(ctx, spec, -60, 0)
      ok(
        end.anchor.width < start.anchor.width - 30,
        `拖动后表格变窄:${start.anchor.width.toFixed(1)} → ${end.anchor.width.toFixed(1)}`
      )
      assertCorner(end, '拖动后')

      await ctx.waitSaved()
      const body = await ctx.savedBody()
      const m = /^```table width=(\d+)$/m.exec(body ?? '')
      ok(m !== null, `表格宽度应写回围栏信息串,实际正文:\n${body}`)
      ok(
        Math.abs(Number(m[1]) - end.anchor.width) <= 2,
        `写回的宽度应与渲染宽度一致(写回 ${m[1]},渲染 ${end.anchor.width.toFixed(1)})`
      )
    }
  },

  {
    id: 'resize/diagram-handle',
    area: 'resize',
    title: '图表:悬停出描边与右下角角柄,拖角柄改宽并写回围栏的 width=,图不被栏宽卡住',
    tags: ['resize', 'diagram'],
    fixture: DIAGRAM_DOC,
    async run(ctx) {
      const diagram = '.notes-preview-body .md-diagram'
      await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(diagram)})?.querySelector('.md-mermaid svg') !== null`, {
        timeout: 15_000,
        message: '图表渲染出 SVG'
      })
      await reveal(ctx, diagram)
      await parkPointer(ctx)

      const spec = { handleIn: diagram, anchor: diagram }
      const start = await geometry(ctx, spec)
      ok(start !== null, '量到图表的缩放角柄')

      const hovered = await moveToHandle(ctx, spec)
      assertCorner(hovered, '悬停时')
      eq((await outlineOf(ctx, diagram)).style, 'solid', '悬停时图表出现描边')
      eq((await outlineOf(ctx, diagram)).width, '2px', '描边宽 2px')

      const { end } = await dragHandle(ctx, spec, -40, 0)
      ok(
        end.anchor.width < start.anchor.width - 20,
        `拖动后图表变窄:${start.anchor.width.toFixed(1)} → ${end.anchor.width.toFixed(1)}`
      )
      assertCorner(end, '拖动后')
      eq(
        await ctx.cdp.eval(`getComputedStyle(document.querySelector(${JSON.stringify(diagram)})).maxWidth`),
        'none',
        '定宽后图表解除 max-width,不会被栏宽压回去'
      )

      await ctx.waitSaved()
      const body = await ctx.savedBody()
      const m = /^```mermaid width=(\d+)$/m.exec(body ?? '')
      ok(m !== null, `图表宽度应写回围栏信息串,实际正文:\n${body}`)
      ok(
        Math.abs(Number(m[1]) - end.anchor.width) <= 2,
        `写回的宽度应与渲染宽度一致(写回 ${m[1]},渲染 ${end.anchor.width.toFixed(1)})`
      )
    }
  }
]
