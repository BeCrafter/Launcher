// 置顶笔记的双份呈现。
//
// 置顶后,顶部「置顶」栏和真实目录里各有一份(同一 data-note-id 出现两次)。
// 这里逐条覆盖用户会走到的路径:折叠置顶栏、搜索摊平、点哪份选中哪份、
// 改名只落一份、从任一副本拖拽。所有选择器都用 [data-rail-copy] 精确到副本。
//
// 置顶/改名/移动都会真实写盘,用例之间用唯一名字隔离,并在末尾取消置顶。

import { existsSync } from 'node:fs'
import { eq, ok } from '../lib/assert.mjs'
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

/** 用真实鼠标点行中间(标题按钮),用于切换打开/选中。 */
async function clickRow(ctx, rowSelector) {
  const rect = await rectOf(ctx, rowSelector)
  await ctx.cdp.click(rect.x + rect.width / 2, rect.y + rect.height / 2)
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

      await clickRowAction(ctx, noteRow(id, 'tree'), 1)
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
      await clickRowAction(ctx, noteRow(id, 'tree'), 1)
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
      await clickRowAction(ctx, noteRow(id, 'tree'), 1)
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

      await clickRowAction(ctx, noteRow(id, 'tree'), 1)
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
      await clickRowAction(ctx, noteRow(id, 'tree'), 1)
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

      await clickRowAction(ctx, noteRow(id, 'tree'), 1)
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
      await clickRowAction(ctx, noteRow(id, 'tree'), 1)
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

      await clickRowAction(ctx, noteRow(renamed, 'tree'), 1)
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
      await clickRowAction(ctx, noteRow(id, 'tree'), 1)
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

      await clickRowAction(ctx, noteRow(moved, 'tree'), 1)
      await waitCopies(ctx, moved, 1, '末尾取消置顶')
    }
  },

  {
    id: 'pin/drag-from-pinned-copy',
    area: 'pin',
    title: '从置顶副本拖走置顶笔记:起点是置顶栏那份,落地仍量目录树副本',
    tags: ['pin', 'rail', 'drag'],
    fixture: BASIC,
    async run(ctx) {
      makeFolder(ctx, '0目标乙')
      const id = await seedNoteInFolder(ctx, '置顶己', '搬运乙')
      await clickRowAction(ctx, noteRow(id, 'tree'), 1)
      await waitCopies(ctx, id, 2, '先置顶出两份')

      await ctx.cdp.mouse('mouseMoved', 5, 5)
      const release = await dragHold(ctx, noteMain(id, 'pinned'), folderSelector('0目标乙'))
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
      await release()

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

      await clickRowAction(ctx, noteRow(moved, 'tree'), 1)
      await waitCopies(ctx, moved, 1, '末尾取消置顶')
    }
  }
]
