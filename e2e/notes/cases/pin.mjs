// 置顶笔记 / 文件的双份呈现。
//
// 置顶后,顶部「置顶」栏和真实目录里各有一份(同一 data-note-id 出现两次)。
// 这里逐条覆盖用户会走到的路径:折叠置顶栏、搜索摊平、点哪份选中哪份、
// 改名只落一份、从任一副本拖拽。所有选择器都用 [data-rail-copy] 精确到副本。
//
// 文件行同样可置顶(文本 / 图片 / 白板 / 图表),置顶区与目录各一份,改名后路径跟着走。
// 置顶区是**一条混排顺序**:笔记与各类文件(可来自不同目录)用指针拖拽任意交错排序,
// 顺序按 `n:`/`f:` token 记进 localStorage;目录树里的副本仍是原生拖拽。
// 置顶/改名/移动都会真实写盘,用例之间用唯一名字隔离,并在末尾取消置顶。

import { existsSync } from 'node:fs'
import { eq, ok } from '../lib/assert.mjs'
import { sleep } from '../lib/cdp.mjs'
import { BASIC } from '../lib/fixtures.mjs'
import {
  absPath,
  dragHold,
  expandFolder,
  expectFlightGone,
  expectNoMoveProgress,
  folderSelector,
  makeFolder,
  rectOf,
  writeNoteFile
} from './rail-move.mjs'

function noteRow(id, copy) {
  return `.notes-row[data-note-id=${JSON.stringify(id)}][data-rail-copy=${JSON.stringify(copy)}]`
}

function noteMain(id, copy) {
  return `${noteRow(id, copy)} .notes-row-main`
}

function rowCount(id) {
  return `document.querySelectorAll('.notes-row[data-note-id=${JSON.stringify(id)}]').length`
}

/** 直接落盘一篇目录里的笔记(与应用自己的格式一致),再展开目录等行出现。 */
async function seedNoteInFolder(ctx, folder, title) {
  makeFolder(ctx, folder)
  const id = `${folder}/${title}`
  writeNoteFile(ctx, `${id}.md`, `---\ntitle: ${title}\n---\n\n正文\n`)
  await expandFolder(ctx, folder)
  await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(noteRow(id, 'tree'))}) !== null`, {
    timeout: 10_000,
    message: `笔记行出现在目录里:${id}`
  })
  return id
}

/** 等同一篇笔记在 DOM 里恰好有 count 份。 */
async function waitCopies(ctx, id, count, message) {
  await ctx.cdp.waitFor(`${rowCount(id)} === ${count}`, { timeout: 10_000, message })
}

/** 悬停某一行,点它的第 index 个动作按钮(0 改名 / 1 置顶 / 2 删除)。 */
async function clickRowAction(ctx, rowSelector, index) {
  const rect = await rectOf(ctx, rowSelector)
  const x = rect.x + rect.width / 2
  const y = rect.y + rect.height / 2
  await ctx.cdp.mouse('mouseMoved', x, y)
  await ctx.cdp.waitFor(
    `(() => {
      const acts = document.querySelector(${JSON.stringify(rowSelector)})?.querySelector('.notes-row-acts')
      return acts !== null && acts !== undefined && Number(getComputedStyle(acts).opacity) >= 0.9
    })()`,
    { timeout: 3000, message: '悬停后出现动作浮层' }
  )
  const btn = await ctx.cdp.json(`(() => {
    const el = document.querySelector(${JSON.stringify(rowSelector)})
      ?.querySelectorAll('.notes-row-acts button')[${index}]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  ok(btn !== null, `找到第 ${index + 1} 个动作按钮`)
  await ctx.cdp.click(btn.x, btn.y)
}


/**
 * 悬停笔记行,点「置顶 / 取消置顶」(第 2 个动作按钮)。
 * 带重试:置顶区增减会让整个列表位移,第一次量到的坐标可能已经落到相邻行。
 */
async function clickNotePin(ctx, id, copy = 'tree') {
  const rowSelector = noteRow(id, copy)
  const actsShown = `(() => {
    const acts = document.querySelector(${JSON.stringify(rowSelector)})?.querySelector('.notes-row-acts')
    if (acts === null || acts === undefined) return false
    const style = getComputedStyle(acts)
    const box = acts.getBoundingClientRect()
    return style.display !== 'none' && Number(style.opacity) >= 0.9 && box.width > 0 && box.height > 0
  })()`
  let btn = null
  for (let attempt = 0; attempt < 4 && btn === null; attempt++) {
    const rect = await rectOf(ctx, rowSelector)
    await ctx.cdp.mouse('mouseMoved', rect.x + rect.width / 2, rect.y + rect.height / 2)
    try {
      await ctx.cdp.waitFor(actsShown, { timeout: 1200 })
    } catch {
      continue
    }
    btn = await ctx.cdp.json(`(() => {
      const el = document.querySelector(${JSON.stringify(rowSelector)})
        ?.querySelectorAll('.notes-row-acts button')[1]
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
  }
  ok(btn !== null, `悬停后找到笔记的置顶按钮(${id})`)
  await ctx.cdp.click(btn.x, btn.y)
}

function fileRow(rel, copy) {
  return `[data-file-path=${JSON.stringify(rel)}][data-rail-copy=${JSON.stringify(copy)}]`
}

/** 悬停文件行,点它的某个动作按钮(按 data-file-action 定位,不依赖按钮顺序)。 */
async function clickFileAction(ctx, rel, action, copy = 'tree') {
  const rowSelector = fileRow(rel, copy)
  const actsShown = `(() => {
    const acts = document.querySelector(${JSON.stringify(rowSelector)})?.querySelector('.notes-row-acts')
    if (acts === null || acts === undefined) return false
    const style = getComputedStyle(acts)
    const box = acts.getBoundingClientRect()
    return style.display !== 'none' && Number(style.opacity) >= 0.9 && box.width > 0 && box.height > 0
  })()`
  // 置顶区出现 / 收起会让列表整体位移一截:坐标可能量早了,悬停落到相邻行。
  // 没等到动作浮层就重新量一次,而不是假定第一次的坐标还有效。
  let btn = null
  for (let attempt = 0; attempt < 4 && btn === null; attempt++) {
    const rect = await rectOf(ctx, rowSelector)
    await ctx.cdp.mouse('mouseMoved', rect.x + rect.width / 2, rect.y + rect.height / 2)
    try {
      await ctx.cdp.waitFor(actsShown, { timeout: 1200 })
    } catch {
      continue
    }
    btn = await ctx.cdp.json(`(() => {
      const el = document.querySelector(${JSON.stringify(rowSelector)})
        ?.querySelector('[data-file-action=${JSON.stringify(action)}]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
  }
  ok(btn !== null, `悬停后找到文件动作:${action}(${rel})`)
  await ctx.cdp.click(btn.x, btn.y)
}

/** 用真实鼠标点行中间(标题按钮),用于切换打开/选中。 */
async function clickRow(ctx, rowSelector) {
  const rect = await rectOf(ctx, rowSelector)
  await ctx.cdp.click(rect.x + rect.width / 2, rect.y + rect.height / 2)
}

/** 行内某个纵向比例处的点(yRatio 0.25 = 行的上四分之一)。 */
async function pointIn(ctx, rowSelector, yRatio = 0.5) {
  const rect = await rectOf(ctx, rowSelector)
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height * yRatio }
}

/**
 * 置顶文件行的指针拖拽:**只用真实鼠标事件**,不借助 CDP 的拖拽注入。
 * 用户的真人拖动走的就是这条事件通道;原生 HTML5 DnD 在置顶行上不可靠,
 * 用 dispatchDragEvent 注入出来的「绿」掩盖过真实故障。
 */
async function pointerDragHold(ctx, rowSelector, point, { steps = 5 } = {}) {
  const rect = await rectOf(ctx, rowSelector)
  const from = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  await ctx.cdp.mouse('mouseMoved', from.x, from.y)
  await ctx.cdp.mouse('mousePressed', from.x, from.y, { buttons: 1 })
  // 等一帧,让 pointerdown 的监听器挂上
  await sleep(60)
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps
    await ctx.cdp.mouse(
      'mouseMoved',
      from.x + (point.x - from.x) * t,
      from.y + (point.y - from.y) * t,
      { buttons: 1 }
    )
    await sleep(40)
  }
  return {
    from,
    async release() {
      await ctx.cdp.mouse('mouseReleased', point.x, point.y, { buttons: 0 })
      await sleep(120)
    }
  }
}

/** 选中色块贴着指定行。 */
async function expectSelectionOn(ctx, rowSelector, message) {
  await ctx.cdp.waitFor(
    `(() => {
      const pill = document.querySelector('.notes-rail-selection')
      const row = document.querySelector(${JSON.stringify(rowSelector)})
      if (pill === null || row === null) return false
      if (pill.getAttribute('data-visible') !== 'true') return false
      const p = pill.getBoundingClientRect()
      const r = row.getBoundingClientRect()
      return Math.abs(p.left - r.left) <= 1 && Math.abs(p.top - r.top) <= 1 &&
        Math.abs(p.width - r.width) <= 1 && Math.abs(p.height - r.height) <= 1
    })()`,
    { timeout: 4000, message }
  )
}

export default [
  {
    id: 'pin/two-copies-and-collapse',
    area: 'pin',
    title: '置顶后顶部置顶栏与真实目录各一份;折叠置顶栏后目录里那份仍在,取消置顶只剩一份',
    tags: ['pin', 'rail', 'collapse'],
    fixture: BASIC,
    async run(ctx) {
      const id = await seedNoteInFolder(ctx, '置顶甲', '笔记一')

      await clickNotePin(ctx, id)
      await waitCopies(ctx, id, 2, '置顶后同一篇出现两份')

      const state = await ctx.cdp.json(`(() => {
        return [...document.querySelectorAll('.notes-row[data-note-id=${JSON.stringify(id)}]')].map((row) => ({
          copy: row.dataset.railCopy,
          inPinned: row.closest('.notes-pinned') !== null,
          pad: Number.parseFloat(getComputedStyle(row).paddingLeft),
          pin: row.querySelector('.notes-row-pin') !== null
        }))
      })()`)
      eq(state.length, 2, '恰好两份副本')
      const pinned = state.find((row) => row.copy === 'pinned')
      const tree = state.find((row) => row.copy === 'tree')
      ok(pinned?.inPinned === true, '置顶副本在顶部置顶栏里')
      ok(tree?.inPinned === false, '目录副本不在置顶栏里')
      ok(tree.pad > pinned.pad, '目录副本保留原目录缩进,不是置顶栏的 depth 0')
      eq(pinned.pin, true, '置顶副本显示图钉')
      eq(tree.pin, true, '目录副本同样显示图钉(表示真实置顶状态)')

      // 折叠置顶栏:只藏顶部那份
      await ctx.cdp.eval(`document.querySelector('.notes-pinned-hd')?.click()`)
      await ctx.cdp.waitFor(`${rowCount(id)} === 1`, {
        timeout: 4000,
        message: '折叠置顶栏后只剩目录里那份'
      })
      const treeVisible = await ctx.cdp.eval(`(() => {
        const row = document.querySelector(${JSON.stringify(noteRow(id, 'tree'))})
        return row !== null && row.getBoundingClientRect().height > 0
      })()`)
      eq(treeVisible, true, '折叠置顶栏后原位置那份仍可见')

      // 展开置顶栏,再从目录副本取消置顶
      await ctx.cdp.eval(`document.querySelector('.notes-pinned-hd')?.click()`)
      await waitCopies(ctx, id, 2, '展开置顶栏后两份回来')

      await ctx.cdp.mouse('mouseMoved', 5, 5)
      await clickNotePin(ctx, id)
      await ctx.cdp.waitFor(`${rowCount(id)} === 1 && document.querySelector('.notes-pinned') === null`, {
        timeout: 10_000,
        message: '取消置顶后只剩目录里一份'
      })
      eq(existsSync(absPath(ctx, `${id}.md`)), true, '取消置顶不改磁盘位置')
    }
  },

  {
    id: 'pin/flat-search-single-hit',
    area: 'pin',
    title: '搜索时置顶命中只在置顶栏出现一次;清空搜索后恢复两处显示',
    tags: ['pin', 'rail', 'search'],
    fixture: BASIC,
    async run(ctx) {
      const id = await seedNoteInFolder(ctx, '置顶乙', '检索命中')
      await clickNotePin(ctx, id)
      await waitCopies(ctx, id, 2, '先置顶出两份')

      await ctx.cdp.eval(`document.querySelector('.notes-rail-search input')?.focus()`)
      await ctx.cdp.type('检索命中')
      await ctx.cdp.waitFor(
        `(() => {
          const rows = [...document.querySelectorAll('.notes-row[data-note-id=${JSON.stringify(id)}]')]
          return rows.length === 1 && rows[0].closest('.notes-pinned') !== null
        })()`,
        { timeout: 5000, message: '搜索时命中只留在置顶栏一份' }
      )

      await ctx.clearRailFilters()
      await ctx.cdp.waitFor(`${rowCount(id)} === 2`, {
        timeout: 10_000,
        message: '清空搜索后恢复两处显示'
      })

      await clickNotePin(ctx, id)
      await waitCopies(ctx, id, 1, '末尾取消置顶')
    }
  },

  {
    id: 'pin/click-each-copy-selection',
    area: 'pin',
    title: '两份副本点哪份,选中色块就落在哪份(同一篇已打开时也要移动)',
    tags: ['pin', 'rail', 'selection'],
    fixture: BASIC,
    async run(ctx) {
      const id = await seedNoteInFolder(ctx, '置顶丙', '选中甲')
      await clickNotePin(ctx, id)
      await waitCopies(ctx, id, 2, '先置顶出两份')

      await clickRow(ctx, noteRow(id, 'tree'))
      await expectSelectionOn(ctx, noteRow(id, 'tree'), '点目录副本:色块贴在目录里那份')

      // 同一篇已经打开,store 会提前 return;色块仍应移到置顶副本
      await clickRow(ctx, noteRow(id, 'pinned'))
      await expectSelectionOn(ctx, noteRow(id, 'pinned'), '点置顶副本:色块移到置顶栏那份')

      const pills = await ctx.cdp.eval(
        `document.querySelectorAll('.notes-rail-selection[data-visible="true"]').length`
      )
      eq(pills, 1, '整列只有一个选中色块')

      await clickNotePin(ctx, id)
      await waitCopies(ctx, id, 1, '末尾取消置顶')
    }
  },

  {
    id: 'pin/rename-only-clicked-copy',
    area: 'pin',
    title: '置顶笔记改名:输入框只出现在被点的那一份,提交后两份一起更新',
    tags: ['pin', 'rail', 'rename'],
    fixture: BASIC,
    async run(ctx) {
      const id = await seedNoteInFolder(ctx, '置顶丁', '笔记二')
      await clickNotePin(ctx, id)
      await waitCopies(ctx, id, 2, '先置顶出两份')

      // 从目录副本改名
      await clickRowAction(ctx, noteRow(id, 'tree'), 0)
      await ctx.cdp.waitFor(`document.querySelector('.notes-row-rename') !== null`, {
        timeout: 4000,
        message: '进入改名'
      })
      eq(
        await ctx.cdp.eval(`document.querySelectorAll('.notes-row-rename').length`),
        1,
        '两份副本只出现一个改名输入'
      )
      eq(
        await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(noteRow(id, 'tree'))})?.querySelector('.notes-row-rename') !== null`
        ),
        true,
        '输入框在目录副本里'
      )
      await ctx.cdp.eval(`(() => {
        const input = document.querySelector(${JSON.stringify(noteRow(id, 'tree'))})
          ?.querySelector('.notes-row-rename input')
        input?.focus()
        input?.select()
      })()`)
      await ctx.cdp.type('改名后')
      await ctx.press('Enter')

      const renamed = '置顶丁/改名后'
      await ctx.cdp.waitFor(
        `${rowCount(renamed)} === 2 && ${rowCount(id)} === 0`,
        { timeout: 10_000, message: '改名后新旧 id 各就各位(两份都更新)' }
      )
      eq(existsSync(absPath(ctx, '置顶丁/改名后.md')), true, '磁盘上文件已改名')
      eq(existsSync(absPath(ctx, `${id}.md`)), false, '旧文件名已不存在')

      // 从置顶副本改名:输入框只在置顶栏那份
      await clickRowAction(ctx, noteRow(renamed, 'pinned'), 0)
      await ctx.cdp.waitFor(`document.querySelector('.notes-row-rename') !== null`, {
        timeout: 4000,
        message: '从置顶副本进入改名'
      })
      eq(
        await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(noteRow(renamed, 'pinned'))})?.querySelector('.notes-row-rename') !== null`
        ),
        true,
        '输入框在置顶副本里'
      )
      await ctx.press('Escape')
      await ctx.cdp.waitFor(`document.querySelector('.notes-row-rename') === null`, {
        timeout: 4000,
        message: '取消改名'
      })

      await clickNotePin(ctx, renamed)
      await waitCopies(ctx, renamed, 1, '末尾取消置顶')
    }
  },

  {
    id: 'pin/drag-from-tree-copy',
    area: 'pin',
    title: '从目录副本拖走置顶笔记:只有它进入拖拽态,飞行落地在目录树副本上',
    tags: ['pin', 'rail', 'drag'],
    fixture: BASIC,
    async run(ctx) {
      makeFolder(ctx, '0目标甲')
      const id = await seedNoteInFolder(ctx, '置顶戊', '搬运甲')
      await clickNotePin(ctx, id)
      await waitCopies(ctx, id, 2, '先置顶出两份')

      await ctx.cdp.mouse('mouseMoved', 5, 5)
      const release = await dragHold(ctx, noteMain(id, 'tree'), folderSelector('0目标甲'))
      eq(
        await ctx.cdp.eval(`document.querySelectorAll('.notes-row.dragging').length`),
        1,
        '拖拽态只落在被拖的目录副本上'
      )
      await release()

      const moved = '0目标甲/搬运甲'
      await ctx.cdp.waitFor(
        `(() => {
          const flight = document.querySelector('.notes-rail-flight')
          if (flight === null || flight.getAttribute('data-to-path') !== ${JSON.stringify(moved)}) {
            return false
          }
          const pinned = document.querySelector(${JSON.stringify(noteRow(moved, 'pinned'))})
          const tree = document.querySelector(${JSON.stringify(noteRow(moved, 'tree'))})
          return pinned !== null && pinned.getAttribute('data-landing') !== 'true' &&
            tree !== null && tree.getAttribute('data-landing') === 'true'
        })()`,
        { interval: 16, timeout: 4000, message: '飞行中只藏目录树副本,置顶副本保持可见' }
      )
      await expectFlightGone(ctx)
      await expectNoMoveProgress(ctx)

      eq(existsSync(absPath(ctx, '0目标甲/搬运甲.md')), true, '磁盘落在目标目录')
      eq(existsSync(absPath(ctx, '置顶戊/搬运甲.md')), false, '原目录文件已不在')
      eq(await ctx.cdp.eval(rowCount(moved)), 2, '移动后仍是两处显示')
      eq(
        await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(noteRow(moved, 'tree'))})?.closest('.notes-pinned') === null`
        ),
        true,
        '目录副本仍在树里,不在置顶栏'
      )

      await clickNotePin(ctx, moved)
      await waitCopies(ctx, moved, 1, '末尾取消置顶')
    }
  },

  {
    id: 'pin/drag-from-pinned-copy',
    area: 'pin',
    title: '从置顶副本拖走置顶笔记:起点是置顶栏那份(指针拖拽),落地仍量目录树副本',
    tags: ['pin', 'rail', 'drag'],
    fixture: BASIC,
    async run(ctx) {
      makeFolder(ctx, '0目标乙')
      const id = await seedNoteInFolder(ctx, '置顶己', '搬运乙')
      await clickNotePin(ctx, id)
      await waitCopies(ctx, id, 2, '先置顶出两份')

      // 置顶副本与置顶排序走同一条指针事件通道(原生 DnD 在置顶行上不可靠)。
      const folderPoint = await pointIn(ctx, folderSelector('0目标乙'), 0.5)
      const drag = await pointerDragHold(ctx, noteMain(id, 'pinned'), folderPoint)
      await ctx.cdp.waitFor(`document.querySelector('.notes-pin-drag-card') !== null`, {
        timeout: 3000,
        message: '按住置顶副本拖动时出现跟手卡片'
      })
      eq(
        await ctx.cdp.eval(
          `(() => {
            const rows = [...document.querySelectorAll('.notes-row.dragging')]
            return rows.length === 1 && rows[0].dataset.railCopy === 'pinned'
          })()`
        ),
        true,
        '拖拽态只落在置顶副本上'
      )
      await ctx.cdp.waitFor(
        `(() => {
          const drop = document.querySelector('.notes-rail-drop')
          const label = document.querySelector('.notes-rail-drop-label')
          return drop?.dataset.visible === 'true' && label?.dataset.dropPath === '0目标乙'
        })()`,
        { timeout: 3000, message: '拖到目录行上亮出「移入目录」的落点' }
      )
      eq(
        await ctx.cdp.eval(`document.querySelector('[data-pin-drop]') === null`),
        true,
        '悬停目录行时不画置顶插入线(不是排序)'
      )
      await drag.release()

      const moved = '0目标乙/搬运乙'
      await expectFlightGone(ctx)
      await expectNoMoveProgress(ctx)

      eq(existsSync(absPath(ctx, '0目标乙/搬运乙.md')), true, '磁盘落在目标目录')
      eq(await ctx.cdp.eval(rowCount(moved)), 2, '移动后仍是两处显示')
      ok(
        await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(noteRow(moved, 'pinned'))})?.closest('.notes-pinned') !== null`
        ),
        '置顶副本仍在置顶栏'
      )
      ok(
        await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(noteRow(moved, 'tree'))})?.closest('.notes-pinned') === null`
        ),
        '目录副本仍在树里'
      )

      // 等拖拽后抑制点击的时间窗过去,再取消置顶。
      await sleep(320)
      await clickNotePin(ctx, moved)
      await waitCopies(ctx, moved, 1, '末尾取消置顶')
    }
  },
  {
    id: 'pin/files-all-kinds',
    area: 'pin',
    title:
      '文本、图片、白板和图表文件行都能置顶;置顶区与目录各一份,点置顶的白板进入白板,取消置顶只剩目录那份,改名后 pin 跟着走',
    tags: ['pin', 'file', 'canvas'],
    fixture: BASIC,
    async run(ctx) {
      const noteId = await seedNoteInFolder(ctx, '置顶文件', '笔记')
      const text = '置顶文本.txt'
      const image = '置顶图.png'
      const board = '置顶板.excal'
      const diagram = '置顶图表.drawio'
      writeNoteFile(ctx, text, '正文\n')
      writeNoteFile(ctx, image, 'x')
      // 合法空场景:点开的断言要看到真正的画布,而不是「无法解析」占位。
      writeNoteFile(
        ctx,
        board,
        JSON.stringify({
          type: 'excalidraw',
          version: 2,
          source: 'e2e',
          elements: [],
          appState: {},
          files: {}
        })
      )
      writeNoteFile(ctx, diagram, '<mxfile/>')
      for (const rel of [text, image, board, diagram]) {
        await ctx.cdp.waitFor(
          `document.querySelector(${JSON.stringify(fileRow(rel, 'tree'))}) !== null`,
          { timeout: 10_000, message: `文件行出现:${rel}` }
        )
      }

      // 笔记 + 四种文件都置顶。
      await clickNotePin(ctx, noteId)
      for (const rel of [text, image, board, diagram]) await clickFileAction(ctx, rel, 'pin')
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-pinned .notes-group-count')?.textContent === '5'`,
        { timeout: 5000, message: '置顶区计数包含笔记和四种文件' }
      )
      for (const rel of [text, image, board, diagram]) {
        await ctx.cdp.waitFor(
          `(() => {
            const row = document.querySelector(${JSON.stringify(fileRow(rel, 'pinned'))})
            return row !== null && row.querySelector('.notes-row-pin') !== null
          })()`,
          { timeout: 5000, message: `置顶区有 ${rel} 且带图钉` }
        )
        // 原目录里的那份仍在。
        await ctx.cdp.waitFor(
          `document.querySelector(${JSON.stringify(fileRow(rel, 'tree'))}) !== null`,
          { message: `目录里仍保留 ${rel}` }
        )
      }

      // 点置顶区的白板副本 → 在应用内打开白板。
      await clickRow(ctx, fileRow(board, 'pinned'))
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-name')?.textContent === ${JSON.stringify(board)} &&
         document.querySelector('.canvas-board') !== null`,
        { timeout: 15_000, message: '置顶副本把白板送进应用内画布' }
      )

      // 取消图片的置顶:置顶区那份消失,目录那份还在,计数回到 4。
      await clickFileAction(ctx, image, 'pin', 'pinned')
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileRow(image, 'pinned'))}) === null`,
        { timeout: 5000, message: '取消置顶后置顶区副本消失' }
      )
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileRow(image, 'tree'))}) !== null`,
        { message: '取消置顶不动目录里的文件' }
      )
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-pinned .notes-group-count')?.textContent === '4'`,
        { message: '置顶计数跟着减少' }
      )

      // 置顶存在 localStorage 的「目录 → 路径列表」里,取消的那条已经去掉。
      ok(
        await ctx.cdp.eval(`(() => {
          const raw = localStorage.getItem('launcherNotesPinnedFiles')
          if (raw === null) return false
          const map = JSON.parse(raw)
          return Object.values(map).some(
            (list) => Array.isArray(list) && list.includes('${text}') && !list.includes('${image}')
          )
        })()`),
        '当前目录下记录了仍在置顶的文件路径'
      )

      // 改名后 pin 跟着新路径走。
      await clickFileAction(ctx, text, 'rename')
      await ctx.cdp.waitFor(`document.querySelector('.notes-file-rename input') !== null`, {
        timeout: 5000,
        message: '出现文件改名输入框'
      })
      await ctx.cdp.eval(`(() => {
        const el = document.querySelector('.notes-file-rename input')
        el.focus()
        el.setSelectionRange(0, el.value.lastIndexOf('.'))
      })()`)
      await ctx.cdp.type('改名置顶')
      await ctx.press('Enter')
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileRow('改名置顶.txt', 'pinned'))}) !== null`,
        { timeout: 10_000, message: '改名后置顶副本跟着换路径' }
      )
      await ctx.cdp.waitFor(
        `(() => {
          const row = document.querySelector(${JSON.stringify(fileRow('改名置顶.txt', 'pinned'))})
          return row !== null && row.querySelector('.notes-row-pin') !== null
        })()`,
        { message: '改名后的置顶副本仍带图钉' }
      )
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileRow('改名置顶.txt', 'tree'))}) !== null`,
        { message: '改名后的目录行用的是新路径' }
      )
      eq(
        await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(fileRow('置顶文本.txt', 'tree'))}) === null`
        ),
        true,
        '旧路径的目录行已消失'
      )

      // 收尾:同一个 profile 里还会跑别的用例,别把置顶文件 / 笔记留在置顶区。
      for (const rel of ['改名置顶.txt', board, diagram]) {
        await clickFileAction(ctx, rel, 'pin', 'pinned')
      }
      await clickNotePin(ctx, noteId, 'pinned')
      await ctx.cdp.waitFor(`document.querySelectorAll('.notes-pinned .notes-file-row').length === 0`, {
        timeout: 5000,
        message: '收尾后置顶区没有文件行'
      })
      await waitCopies(ctx, noteId, 1, '收尾后笔记只剩目录里那份')
    }
  },
  {
    id: 'pin/files-reorder',
    area: 'pin',
    title:
      '置顶文件用指针拖拽排序:跟手卡片与插入线可见,松手后顺序与 localStorage 同步,拖进目录仍走移动,Escape 取消、阈值内仍是普通点击',
    tags: ['pin', 'file', 'drag', 'reorder'],
    fixture: BASIC,
    async run(ctx) {
      const folder = '拖排目录'
      makeFolder(ctx, folder)
      const a = '拖排甲.txt'
      const b = '拖排乙.txt'
      const c = '拖排丙.txt'
      for (const rel of [a, b, c]) {
        writeNoteFile(ctx, rel, '正文\n')
        await ctx.cdp.waitFor(
          `document.querySelector(${JSON.stringify(fileRow(rel, 'tree'))}) !== null`,
          { timeout: 10_000, message: `文件行出现:${rel}` }
        )
      }

      /** 置顶区文件行的显示顺序 */
      const pinnedOrder = () =>
        ctx.cdp.json(
          `[...document.querySelectorAll('.notes-pinned-files .notes-file-row')]
             .map((el) => el.dataset.filePath)`
        )
      /** localStorage 里当前目录的 pin 数组(取包含甲的那份,避开别的目录) */
      const storedOrder = () =>
        ctx.cdp.eval(`(() => {
          const raw = localStorage.getItem('launcherNotesPinnedFiles')
          if (raw === null) return null
          const list = Object.values(JSON.parse(raw))
            .find((v) => Array.isArray(v) && v.includes(${JSON.stringify(a)}))
          return list ?? null
        })()`)
      /** 当前在应用里打开的文件(只看置顶区那一份) */
      const activePath = () =>
        ctx.cdp.json(
          `document.querySelector('.notes-pinned-files .notes-file-row.active')?.dataset.filePath ?? null`
        )
      /** 等置顶区顺序变成期望值 */
      const waitOrder = (want, message) =>
        ctx.cdp.waitFor(
          `(() => {
            const paths = [...document.querySelectorAll('.notes-pinned-files .notes-file-row')]
              .map((el) => el.dataset.filePath)
            return ${JSON.stringify(want)}.every((p, i) => paths[i] === p)
          })()`,
          { timeout: 5000, message }
        )
      /** 某一行顶边的插入线 */
      const beforeLine = (rel) =>
        ctx.cdp.json(`(() => {
          const row = document.querySelector(${JSON.stringify(fileRow(rel, 'pinned'))})
          if (row === null) return null
          const line = getComputedStyle(row, '::before')
          return { content: line.content, height: line.height }
        })()`)

      // 依次置顶甲、乙、丙:新 pin 放最前,初始顺序是丙、乙、甲(不是字母序)。
      for (const rel of [a, b, c]) await clickFileAction(ctx, rel, 'pin')
      await ctx.cdp.waitFor(
        `document.querySelectorAll('.notes-pinned-files .notes-file-row').length === 3`,
        { timeout: 5000, message: '三个文件都进了置顶区' }
      )
      eq(await pinnedOrder(), [c, b, a], '置顶区按 pin 存储顺序显示,新 pin 在最前')
      eq(await storedOrder(), [c, b, a], 'localStorage 里记的也是这个顺序')

      // 目录树不参与排序:拖完再对比。
      const treeOrder = await ctx.cdp.json(
        `[...document.querySelectorAll('.notes-rail-list .notes-file-row[data-rail-copy="tree"]')]
           .map((el) => el.dataset.filePath)`
      )

      // 先证明普通点击没被拖拽逻辑吃掉(按下只记位置,没超阈值就是一次点击)。
      await clickRow(ctx, fileRow(b, 'pinned'))
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileRow(b, 'pinned'))})?.classList.contains('active') === true`,
        { timeout: 4000, message: '点击置顶文件行仍能打开文件' }
      )

      // 把丙拖到甲的上四分之一:插入线落在甲前面。
      const toA = await pointIn(ctx, fileRow(a, 'pinned'), 0.25)
      const drag = await pointerDragHold(ctx, `${fileRow(c, 'pinned')} .notes-row-main`, toA)
      await ctx.cdp.waitFor(`document.querySelector('.notes-pin-drag-card') !== null`, {
        timeout: 3000,
        message: '拖动中出现跟手卡片'
      })
      const card = await ctx.cdp.json(`(() => {
        const el = document.querySelector('.notes-pin-drag-card')
        if (el === null) return null
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, pe: getComputedStyle(el).pointerEvents }
      })()`)
      eq(card?.pe, 'none', '跟手卡片不吃指针事件(elementFromPoint 能命中下面的行)')
      ok(
        Math.abs((card?.x ?? -999) - toA.x) <= 80 && Math.abs((card?.y ?? -999) - toA.y) <= 80,
        `跟手卡片在指针旁边(card=${JSON.stringify(card)}, point=${JSON.stringify(toA)})`
      )
      eq(
        await ctx.cdp.json(`document.querySelectorAll('.notes-file-row.dragging').length`),
        1,
        '只有被拖的那一份副本进入拖拽态'
      )
      eq(
        await ctx.cdp.eval(
          `document.querySelector('.notes-file-row.dragging')?.dataset.railCopy === 'pinned'`
        ),
        true,
        '淡化的是置顶副本,目录树副本不动'
      )

      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileRow(a, 'pinned'))})?.dataset.pinDrop === 'before'`,
        { timeout: 3000, message: '拖到甲上半部时插入线落在甲前面' }
      )
      eq(await beforeLine(a), { content: '""', height: '2px' }, '甲行顶边真的画出了 2px 插入线')
      eq(
        await ctx.cdp.eval(`document.querySelector('.notes-rail-drop')?.dataset.visible === 'true'`),
        false,
        '置顶区内部排序不亮「移入目录」的落点色块'
      )
      eq(await activePath(), b, '拖动中文件没有被打开或切换')

      await drag.release()
      // 丙插到甲前面(移除自身后按原数组下标插)→ 乙、丙、甲。
      await waitOrder([b, c, a], '松手后顺序变成乙、丙、甲')
      eq(await pinnedOrder(), [b, c, a], '置顶区顺序按拖动结果排')
      eq(await storedOrder(), [b, c, a], '排序写回 localStorage,刷新后还在')
      eq(
        await ctx.cdp.json(
          `[...document.querySelectorAll('.notes-rail-list .notes-file-row[data-rail-copy="tree"]')]
             .map((el) => el.dataset.filePath)`
        ),
        treeOrder,
        '目录树里的文件位置不受置顶排序影响'
      )
      eq(
        await ctx.cdp.eval(`document.querySelector('[data-pin-drop]') === null`),
        true,
        '松手后插入线不残留'
      )
      eq(
        await ctx.cdp.eval(`document.querySelector('.notes-pin-drag-card') === null`),
        true,
        '松手后跟手卡片消失'
      )
      eq(
        await ctx.cdp.eval(`document.body.classList.contains('notes-pin-dragging')`),
        false,
        '松手后拖拽态被清掉'
      )
      eq(await activePath(), b, '松手那一下的点击被吃掉,没有把丙打开')

      // 拖到最后一行的下半部 = 放到末尾(anchor === null 的那条路径)。
      const toEnd = await pointIn(ctx, fileRow(a, 'pinned'), 0.9)
      const dragEnd = await pointerDragHold(ctx, `${fileRow(b, 'pinned')} .notes-row-main`, toEnd)
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileRow(a, 'pinned'))})?.dataset.pinDrop === 'after'`,
        { timeout: 3000, message: '拖到最后一行下半部时插入线落在末尾' }
      )
      await dragEnd.release()
      await waitOrder([c, a, b], '松手后顺序变成丙、甲、乙')
      eq(await storedOrder(), [c, a, b], '末尾插入也写回 localStorage')

      // 拖到目录行上仍然是「移入目录」:路径变深,置顶副本跟着新路径,不触发排序。
      const folderPoint = await pointIn(ctx, folderSelector(folder), 0.5)
      const dragFolder = await pointerDragHold(
        ctx,
        `${fileRow(c, 'pinned')} .notes-row-main`,
        folderPoint
      )
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-rail-drop')?.dataset.visible === 'true'`,
        { timeout: 3000, message: '拖到目录行上出现「移入目录」落点' }
      )
      eq(
        await ctx.cdp.eval(
          `document.querySelector('.notes-rail-drop-label')?.dataset.dropPath ?? null`
        ),
        folder,
        '落点标签指向该目录'
      )
      eq(
        await ctx.cdp.eval(`document.querySelector('[data-pin-drop]') === null`),
        true,
        '悬停目录行时不画置顶插入线'
      )
      await dragFolder.release()
      await expectFlightGone(ctx)
      await expectNoMoveProgress(ctx)
      const moved = `${folder}/${c}`
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileRow(moved, 'pinned'))}) !== null`,
        { timeout: 10_000, message: '移入目录后置顶副本跟着新路径' }
      )
      eq(
        await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(fileRow(c, 'pinned'))}) === null`
        ),
        true,
        '移动后旧的置顶路径不再出现'
      )
      eq(await storedOrder(), [moved, a, b], '移动后 pin 顺序保持,路径换成新路径')

      // Escape 取消:不排序、不移动,卡片与插入线都收掉。
      const toA2 = await pointIn(ctx, fileRow(a, 'pinned'), 0.25)
      const dragEsc = await pointerDragHold(
        ctx,
        `${fileRow(moved, 'pinned')} .notes-row-main`,
        toA2
      )
      await ctx.cdp.waitFor(`document.querySelector('.notes-pin-drag-card') !== null`, {
        timeout: 3000,
        message: '取消前跟手卡片已出现'
      })
      await ctx.press('Escape')
      await ctx.cdp.waitFor(`document.querySelector('.notes-pin-drag-card') === null`, {
        timeout: 3000,
        message: 'Escape 后跟手卡片消失'
      })
      eq(
        await ctx.cdp.eval(`document.querySelector('[data-pin-drop]') === null`),
        true,
        'Escape 后插入线消失'
      )
      await dragEsc.release()
      eq(await pinnedOrder(), [moved, a, b], 'Escape 取消不改变置顶顺序')
      eq(await storedOrder(), [moved, a, b], 'localStorage 顺序也没变')
      eq(await activePath(), b, 'Escape 取消没有打开文件')

      // 等上一次拖拽的点击抑制时间窗过去,再验证「微动仍是点击」。
      await sleep(320)
      const rectA = await rectOf(ctx, fileRow(a, 'pinned'))
      const mid = { x: rectA.x + rectA.width / 2, y: rectA.y + rectA.height / 2 }
      await ctx.cdp.mouse('mouseMoved', mid.x, mid.y)
      await ctx.cdp.mouse('mousePressed', mid.x, mid.y, { buttons: 1 })
      await ctx.cdp.mouse('mouseMoved', mid.x + 2, mid.y, { buttons: 1 })
      await ctx.cdp.mouse('mouseReleased', mid.x + 2, mid.y, { buttons: 0 })
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileRow(a, 'pinned'))})?.classList.contains('active') === true`,
        { timeout: 4000, message: '阈值内(2px)的按下松手仍然打开文件' }
      )
      eq(await pinnedOrder(), [moved, a, b], '阈值内不触发排序')

      // 收尾:别把置顶文件留给后面的用例。
      for (const rel of [moved, a, b]) await clickFileAction(ctx, rel, 'pin', 'pinned')
      await ctx.cdp.waitFor(
        `document.querySelectorAll('.notes-pinned-files .notes-file-row').length === 0`,
        { timeout: 5000, message: '收尾后置顶区没有文件行' }
      )
    }
  },
  {
    id: 'pin/files-reorder-cross-folder',
    area: 'pin',
    title:
      '置顶文件跨目录排序:来自不同文件夹的文件在置顶区混排,拖动不受来源目录限制,排序后目录树位置不变',
    tags: ['pin', 'file', 'drag', 'reorder'],
    fixture: BASIC,
    async run(ctx) {
      const folderA = '跨排甲目录'
      const folderB = '跨排乙目录'
      // 三份文件来自三个不同的位置:甲目录、乙目录、根目录。
      const a = `${folderA}/跨排甲.txt`
      const b = `${folderB}/跨排乙.txt`
      const c = '跨排丙.txt'
      for (const folder of [folderA, folderB]) makeFolder(ctx, folder)
      for (const rel of [a, b, c]) writeNoteFile(ctx, rel, '正文\n')
      for (const folder of [folderA, folderB]) await expandFolder(ctx, folder)
      for (const rel of [a, b, c]) {
        await ctx.cdp.waitFor(
          `document.querySelector(${JSON.stringify(fileRow(rel, 'tree'))}) !== null`,
          { timeout: 10_000, message: `文件行出现:${rel}` }
        )
      }

      const pinnedOrder = () =>
        ctx.cdp.json(
          `[...document.querySelectorAll('.notes-pinned-files .notes-file-row')]
             .map((el) => el.dataset.filePath)`
        )
      const storedOrder = () =>
        ctx.cdp.eval(`(() => {
          const raw = localStorage.getItem('launcherNotesPinnedFiles')
          if (raw === null) return null
          const list = Object.values(JSON.parse(raw))
            .find((v) => Array.isArray(v) && v.includes(${JSON.stringify(c)}))
          return list ?? null
        })()`)
      const waitOrder = (want, message) =>
        ctx.cdp.waitFor(
          `(() => {
            const paths = [...document.querySelectorAll('.notes-pinned-files .notes-file-row')]
              .map((el) => el.dataset.filePath)
            return ${JSON.stringify(want)}.every((p, i) => paths[i] === p)
          })()`,
          { timeout: 5000, message }
        )
      const treeOrder = () =>
        ctx.cdp.json(
          `[...document.querySelectorAll('.notes-rail-list .notes-file-row[data-rail-copy="tree"]')]
             .map((el) => el.dataset.filePath)`
        )

      // 依次置顶:新 pin 放最前 → [丙(根), 乙(乙目录), 甲(甲目录)]。
      for (const rel of [a, b, c]) await clickFileAction(ctx, rel, 'pin')
      await ctx.cdp.waitFor(
        `document.querySelectorAll('.notes-pinned-files .notes-file-row').length === 3`,
        { timeout: 5000, message: '来自不同文件夹的三个文件都进了置顶区' }
      )
      eq(await pinnedOrder(), [c, b, a], '置顶区把不同来源目录的文件放在同一个可排序列表里')
      const treeBefore = await treeOrder()

      // 根目录的丙 → 甲目录的甲上半部:跨「根 → 目录」拖拽。
      const toA = await pointIn(ctx, fileRow(a, 'pinned'), 0.25)
      const dragInto = await pointerDragHold(ctx, `${fileRow(c, 'pinned')} .notes-row-main`, toA)
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileRow(a, 'pinned'))})?.dataset.pinDrop === 'before'`,
        { timeout: 3000, message: '拖到目录里那份文件的上半部时插入线落在它前面' }
      )
      eq(
        await ctx.cdp.eval(`document.querySelector('.notes-rail-drop')?.dataset.visible === 'true'`),
        false,
        '置顶区内部跨目录排序不亮「移入目录」色块(不是移动文件)'
      )
      await dragInto.release()
      // 丙插到甲之前 → 乙、丙、甲。
      await waitOrder([b, c, a], '根目录文件插到目录里的文件之前')
      eq(await storedOrder(), [b, c, a], '跨目录排序写回 localStorage')
      eq(await treeOrder(), treeBefore, '跨目录排序不改变文件在各自目录里的位置')

      // 甲目录的甲 → 丙的上半部:跨「目录 → 根目录」拖拽。
      const toC = await pointIn(ctx, fileRow(c, 'pinned'), 0.25)
      const dragOut = await pointerDragHold(ctx, `${fileRow(a, 'pinned')} .notes-row-main`, toC)
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileRow(c, 'pinned'))})?.dataset.pinDrop === 'before'`,
        { timeout: 3000, message: '目录里的文件拖到根目录行上半部时插入线落在它前面' }
      )
      await dragOut.release()
      await waitOrder([b, a, c], '目录里的文件插到根目录文件之前')
      eq(await storedOrder(), [b, a, c], '反方向跨目录排序同样写回 localStorage')
      eq(await treeOrder(), treeBefore, '反方向跨目录排序也不动目录树')
      eq(
        await ctx.cdp.eval(`document.querySelector('[data-pin-drop]') === null`),
        true,
        '跨目录排序松手后插入线不残留'
      )

      // 等点击抑制窗口过去,再取消置顶。
      // 走目录树那一份:置顶区每取消一条都会整体上移,按置顶行坐标点击容易落到相邻行;
      // 目录树里文件的位置不受置顶增删影响,点完再等置顶副本消失。
      await sleep(320)
      for (const rel of [a, b, c]) {
        await clickFileAction(ctx, rel, 'pin', 'tree')
        await ctx.cdp.waitFor(
          `document.querySelector(${JSON.stringify(fileRow(rel, 'pinned'))}) === null`,
          { timeout: 4000, message: `取消置顶后置顶区不再有该文件:${rel}` }
        )
      }
    }
  },
  {
    id: 'pin/notes-reorder',
    area: 'pin',
    title:
      '置顶区是笔记与各类文件的一条混排顺序:笔记、txt、白板可跨类型任意交错拖动,顺序按 n:/f: token 写回 localStorage,阈值内仍是点击、Escape 取消',
    tags: ['pin', 'note', 'file', 'drag', 'reorder'],
    fixture: BASIC,
    async run(ctx) {
      const folderA = '跨序甲目录'
      const folderB = '跨序乙目录'
      const a = await seedNoteInFolder(ctx, folderA, '跨序甲')
      const b = await seedNoteInFolder(ctx, folderB, '跨序乙')
      const c = '跨序丙'
      writeNoteFile(ctx, `${c}.md`, `---\ntitle: ${c}\n---\n\n正文\n`)
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(noteRow(c, 'tree'))}) !== null`,
        { timeout: 10_000, message: `根目录笔记出现:${c}` }
      )
      // 两种非 Markdown 文件、来自不同位置:根目录的 txt + 甲目录里的白板。
      const txt = '跨序文件.txt'
      const board = `${folderA}/跨序图.excal`
      writeNoteFile(ctx, txt, '正文\n')
      writeNoteFile(
        ctx,
        board,
        JSON.stringify({
          type: 'excalidraw',
          version: 2,
          source: 'e2e',
          elements: [],
          appState: {},
          files: {}
        })
      )
      for (const rel of [txt, board]) {
        await ctx.cdp.waitFor(
          `document.querySelector(${JSON.stringify(fileRow(rel, 'tree'))}) !== null`,
          { timeout: 10_000, message: `文件行出现:${rel}` }
        )
      }

      /** 置顶区一整条混排顺序:笔记记 n:<id>,文件记 f:<path>(与存储格式一致) */
      const tokensInDom = `[...document.querySelectorAll('.notes-pinned-files > .notes-row')]
        .map((el) => (el.dataset.noteId ? 'n:' + el.dataset.noteId : 'f:' + el.dataset.filePath))`
      const pinnedTokens = () => ctx.cdp.json(tokensInDom)
      const storedOrder = () =>
        ctx.cdp.eval(`(() => {
          const raw = localStorage.getItem('launcherNotesPinnedOrder')
          if (raw === null) return null
          const list = Object.values(JSON.parse(raw))
            .find((v) => Array.isArray(v) && v.includes(${JSON.stringify(`n:${c}`)}))
          return list ?? null
        })()`)
      /** 旧 key 只留文件路径,应当跟着混排顺序派生 */
      const storedFiles = () =>
        ctx.cdp.eval(`(() => {
          const raw = localStorage.getItem('launcherNotesPinnedFiles')
          if (raw === null) return null
          const list = Object.values(JSON.parse(raw))
            .find((v) => Array.isArray(v) && v.includes(${JSON.stringify(txt)}))
          return list ?? null
        })()`)
      /** 等置顶区混排顺序变成期望值 */
      const waitOrder = (want, message) =>
        ctx.cdp.waitFor(
          `(() => {
            const tokens = ${tokensInDom}
            return tokens.length === ${want.length} &&
              ${JSON.stringify(want)}.every((t, i) => tokens[i] === t)
          })()`,
          { timeout: 5000, message }
        )
      /** 某一行顶边的插入线 */
      const beforeLine = (rowSelector) =>
        ctx.cdp.json(`(() => {
          const row = document.querySelector(${JSON.stringify(rowSelector)})
          if (row === null) return null
          const line = getComputedStyle(row, '::before')
          return { content: line.content, height: line.height }
        })()`)
      /** 当前打开的笔记(置顶区那一份);拖动中不许被打开或切走 */
      const activeNote = () =>
        ctx.cdp.eval(
          `document.querySelector('.notes-pinned-files .notes-row[data-note-id].active')?.dataset.noteId ?? null`
        )

      // 依次置顶甲、乙、丙,再置顶 txt、白板:新 pin 都放最前,笔记与文件落在同一条顺序里。
      for (const id of [a, b, c]) {
        await clickNotePin(ctx, id)
        await ctx.cdp.waitFor(
          `document.querySelector(${JSON.stringify(noteRow(id, 'pinned'))}) !== null`,
          { timeout: 5000, message: `笔记进了置顶区:${id}` }
        )
      }
      await clickFileAction(ctx, txt, 'pin')
      await clickFileAction(ctx, board, 'pin')
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-pinned .notes-group-count')?.textContent === '5'`,
        { timeout: 5000, message: '三篇笔记和两种文件都进了同一个置顶区' }
      )
      const initial = [`f:${board}`, `f:${txt}`, `n:${c}`, `n:${b}`, `n:${a}`]
      eq(
        await pinnedTokens(),
        initial,
        '笔记和两种文件按同一条顺序显示(新置顶在最前),不是「笔记在上、文件在下」'
      )
      eq(await storedOrder(), initial, '混排顺序按 n:/f: token 写进 launcherNotesPinnedOrder')
      eq(await storedFiles(), [board, txt], '旧的文件 key 跟着混排顺序派生')

      const treeBefore = await ctx.cdp.json(
        `[...document.querySelectorAll('.notes-rail-list .notes-row[data-note-id][data-rail-copy="tree"]')]
           .map((el) => el.dataset.noteId)`
      )
      const treeFilesBefore = await ctx.cdp.json(
        `[...document.querySelectorAll('.notes-rail-list .notes-file-row[data-rail-copy="tree"]')]
           .map((el) => el.dataset.filePath)`
      )

      // ① 笔记拖到文件上方:丙插到 txt 前面 → 白板、丙、txt、乙、甲。
      const activeBefore = await activeNote()
      const toTxt = await pointIn(ctx, fileRow(txt, 'pinned'), 0.25)
      const dragNoteToFile = await pointerDragHold(
        ctx,
        `${noteRow(c, 'pinned')} .notes-row-main`,
        toTxt
      )
      await ctx.cdp.waitFor(`document.querySelector('.notes-pin-drag-card') !== null`, {
        timeout: 3000,
        message: '拖动置顶笔记时出现跟手卡片'
      })
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileRow(txt, 'pinned'))})?.dataset.pinDrop === 'before'`,
        { timeout: 3000, message: '笔记拖到文件行上半部时插入线落在文件行前面' }
      )
      eq(
        await beforeLine(fileRow(txt, 'pinned')),
        { content: '""', height: '2px' },
        '文件行顶边画出了 2px 插入线'
      )
      eq(await activeNote(), activeBefore, '拖动中笔记没有被打开或切换')
      await dragNoteToFile.release()
      const afterNoteDrag = [`f:${board}`, `n:${c}`, `f:${txt}`, `n:${b}`, `n:${a}`]
      await waitOrder(afterNoteDrag, '松手后笔记插在文件上面')
      eq(await pinnedTokens(), afterNoteDrag, '置顶区按混排拖动结果排')
      eq(await storedOrder(), afterNoteDrag, '笔记跨类型排序写回 localStorage')
      eq(await storedFiles(), [board, txt], '文件之间的相对顺序不受笔记插入影响')

      // ② 文件拖到笔记上方:txt 插到丙前面 → 白板、txt、丙、乙、甲。
      const toC = await pointIn(ctx, noteRow(c, 'pinned'), 0.25)
      const dragFileToNote = await pointerDragHold(
        ctx,
        `${fileRow(txt, 'pinned')} .notes-row-main`,
        toC
      )
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(noteRow(c, 'pinned'))})?.dataset.pinDrop === 'before'`,
        { timeout: 3000, message: '文件拖到笔记行上半部时插入线落在笔记行前面' }
      )
      eq(
        await beforeLine(noteRow(c, 'pinned')),
        { content: '""', height: '2px' },
        '笔记行顶边同样画出 2px 插入线'
      )
      eq(
        await ctx.cdp.eval(`document.querySelector('.notes-rail-drop')?.dataset.visible === 'true'`),
        false,
        '置顶区内部排序不亮「移入目录」的落点色块'
      )
      await dragFileToNote.release()
      const afterFileDrag = [`f:${board}`, `f:${txt}`, `n:${c}`, `n:${b}`, `n:${a}`]
      await waitOrder(afterFileDrag, '松手后文件插在笔记上面')
      eq(await storedOrder(), afterFileDrag, '文件跨类型排序写回 localStorage')

      // ③ 白板拖到最后一行下半部 = 末尾插入(anchor === null 路径)。
      const toEnd = await pointIn(ctx, noteRow(a, 'pinned'), 0.9)
      const dragEnd = await pointerDragHold(
        ctx,
        `${fileRow(board, 'pinned')} .notes-row-main`,
        toEnd
      )
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(noteRow(a, 'pinned'))})?.dataset.pinDrop === 'after'`,
        { timeout: 3000, message: '拖到最后一行下半部时插入线落在末尾' }
      )
      await dragEnd.release()
      const afterEndDrag = [`f:${txt}`, `n:${c}`, `n:${b}`, `n:${a}`, `f:${board}`]
      await waitOrder(afterEndDrag, '混排末尾插入:白板落到结尾')
      eq(await storedOrder(), afterEndDrag, '末尾插入也写回混排顺序')
      eq(await storedFiles(), [txt, board], '派生文件列表按混排顺序排')
      await ctx.cdp.waitFor(
        `document.querySelector('[data-pin-drop]') === null &&
         document.querySelector('.notes-pin-drag-card') === null &&
         !document.body.classList.contains('notes-pin-dragging')`,
        { timeout: 3000, message: '松手后插入线、跟手卡片、拖拽态都不残留' }
      )
      eq(
        await ctx.cdp.json(
          `[...document.querySelectorAll('.notes-rail-list .notes-row[data-note-id][data-rail-copy="tree"]')]
             .map((el) => el.dataset.noteId)`
        ),
        treeBefore,
        '目录树里的笔记位置不受置顶排序影响'
      )
      eq(
        await ctx.cdp.json(
          `[...document.querySelectorAll('.notes-rail-list .notes-file-row[data-rail-copy="tree"]')]
             .map((el) => el.dataset.filePath)`
        ),
        treeFilesBefore,
        '目录树里的文件位置不受置顶排序影响'
      )

      // 阈值内仍是普通点击:打开笔记甲,顺序不变。
      await sleep(320)
      const rectA = await rectOf(ctx, noteRow(a, 'pinned'))
      const mid = { x: rectA.x + rectA.width / 2, y: rectA.y + rectA.height / 2 }
      await ctx.cdp.mouse('mouseMoved', mid.x, mid.y)
      await ctx.cdp.mouse('mousePressed', mid.x, mid.y, { buttons: 1 })
      await ctx.cdp.mouse('mouseMoved', mid.x + 2, mid.y, { buttons: 1 })
      await ctx.cdp.mouse('mouseReleased', mid.x + 2, mid.y, { buttons: 0 })
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(noteRow(a, 'pinned'))})?.classList.contains('active') === true`,
        { timeout: 4000, message: '阈值内的按下松手仍然打开笔记' }
      )
      eq(await pinnedTokens(), afterEndDrag, '阈值内不触发排序')

      // Escape 取消:拖着乙往丙上面走,松手本会改变顺序;Escape 后顺序原样。
      await sleep(320)
      const toC2 = await pointIn(ctx, noteRow(c, 'pinned'), 0.25)
      const dragEsc = await pointerDragHold(ctx, `${noteRow(b, 'pinned')} .notes-row-main`, toC2)
      await ctx.cdp.waitFor(`document.querySelector('.notes-pin-drag-card') !== null`, {
        timeout: 3000,
        message: '取消前跟手卡片已出现'
      })
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(noteRow(c, 'pinned'))})?.dataset.pinDrop === 'before'`,
        { timeout: 3000, message: '取消前插入线已落在丙前面' }
      )
      await ctx.press('Escape')
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-pin-drag-card') === null &&
         document.querySelector('[data-pin-drop]') === null`,
        { timeout: 3000, message: 'Escape 后跟手卡片与插入线一起消失' }
      )
      await dragEsc.release()
      eq(await pinnedTokens(), afterEndDrag, 'Escape 取消不改变混排顺序')
      eq(await storedOrder(), afterEndDrag, 'localStorage 混排顺序也没变')

      // 收尾:笔记与两种文件都取消置顶,别留给后面的用例。
      await sleep(320)
      for (const id of [a, b, c]) {
        await clickNotePin(ctx, id, 'tree')
        await ctx.cdp.waitFor(
          `document.querySelector(${JSON.stringify(noteRow(id, 'pinned'))}) === null`,
          { timeout: 4000, message: `取消置顶后置顶区不再有该笔记:${id}` }
        )
      }
      for (const rel of [txt, board]) {
        await clickFileAction(ctx, rel, 'pin', 'tree')
        await ctx.cdp.waitFor(
          `document.querySelector(${JSON.stringify(fileRow(rel, 'pinned'))}) === null`,
          { timeout: 4000, message: `取消置顶后置顶区不再有该文件:${rel}` }
        )
      }
      eq(
        await ctx.cdp.json(`document.querySelectorAll('.notes-pinned-files > .notes-row').length`),
        0,
        '收尾后置顶区清空'
      )
    }
  }
]
