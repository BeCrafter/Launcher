// 左侧目录树内部拖拽:把文件夹、文件、笔记拖到另一个目录,或拖回最外层。
//
// 必须用 CDP 真实按住名字再移过拖拽阈值。只派发 DragEvent 测不出来:
// Chromium 不会从按钮开始父节点的 HTML5 拖拽,而名字本身就是按钮。
// mouseMoved 能点着 dragstart,但不会把 dragover 送进页面,落点接着
// 截住的那一份载荷(Input.dragIntercepted)继续派。
//
// 进度条出现不出现不在这里等。同盘 rename 通常不到 200ms,条可能一闪而过;
// moving 的挂起与清理由 notes-store 单测保证。这里只断言结束后条不留下。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { eq, ok } from '../lib/assert.mjs'
import { sleep } from '../lib/cdp.mjs'
import { BASIC } from '../lib/fixtures.mjs'

function notesDir(ctx) {
  return join(ctx.profileDir, 'notes')
}

export function absPath(ctx, rel) {
  return join(notesDir(ctx), rel)
}

/** 写一个笔记目录里的文件(自动建父目录)。 */
export function writeNoteFile(ctx, rel, content) {
  const full = absPath(ctx, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
  return full
}

/** 直接建目录。UI 入口是悬停才出现的按钮,夹具不走那条路。 */
export function makeFolder(ctx, rel) {
  mkdirSync(absPath(ctx, rel), { recursive: true })
}

export function folderSelector(path) {
  return `.notes-folder-row[data-folder-path=${JSON.stringify(path)}]`
}

function fileSelector(rel) {
  return `[data-file-path=${JSON.stringify(rel)}]`
}

export function noteSelector(id) {
  return `.notes-row[data-note-id=${JSON.stringify(id)}]`
}

/** 展开目录(已展开则不动)。夹具直接写盘时,先等目录行被监听推上来。 */
export async function expandFolder(ctx, path) {
  const selector = folderSelector(path)
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
  await sleep(80)
}

export async function collapseFolder(ctx, path) {
  await ctx.cdp.eval(`(() => {
    const row = document.querySelector(${JSON.stringify(folderSelector(path))})
    const name = row?.querySelector('.notes-folder-name')
    if (name?.getAttribute('aria-expanded') === 'true') name.click()
  })()`)
  await ctx.cdp.waitFor(
    `document.querySelector(${JSON.stringify(
      folderSelector(path)
    )})?.querySelector('.notes-folder-name')?.getAttribute('aria-expanded') === 'false'`,
    { message: `目录「${path}」已折叠` }
  )
}

function center(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/**
 * 按住名字,真实移过拖拽阈值,再把这次拖拽停在目标上但不松手。
 * 返回松手函数,调用方先断言 drop-target 再松。
 *
 * 只派发合成 DragEvent 测不出「按钮吞掉父节点拖拽」:dragstart 必须来自
 * 名字控件自己。CDP 的 mouseMoved 能点着这次 dragstart,但不会把后面的
 * dragover 送进页面,所以落点接着截住的那一份载荷继续派。
 *
 * 目标矩形在按下之前量好。按下之后再 scrollIntoView 会把正在进行的拖拽取消。
 */
export async function dragHold(ctx, sourceSelector, targetSelector) {
  // 先按住源再去找目标。两条不在同一屏时,先把目标滚进来会把源滚走,
  // 按下的坐标就落到别的行上(前面用例展开的目录越高,越容易踩中)。
  const source = center(await rectOf(ctx, sourceSelector))
  const drag = await beginNameDrag(ctx, source)
  let target = null
  try {
    await ctx.cdp.waitFor(
      `(() => {
        const handle = document.querySelector(${JSON.stringify(sourceSelector)})
        const row = document.querySelector('.notes-row.dragging, .notes-folder-row.dragging')
        return handle !== null && row !== null && row.contains(handle)
      })()`,
      { timeout: 3000, message: `拖起来的是「${sourceSelector}」` }
    )
    target = center(await rectOf(ctx, targetSelector))
    await drag.hover(target.x, target.y)
    await sleep(60)
  } catch (error) {
    await drag.cancel()
    throw error
  }
  return async () => {
    // 落点色块是拖起来之后才盖到目标上的。盖上去时浏览器会清掉上一次
    // dragover 认下的投放目标,不再发 dragover 就直接 drop 会被丢掉。
    // 人按着不动时浏览器会持续发 dragover,这里补一次再松手。
    await drag.hover(target.x, target.y)
    await drag.drop(target.x, target.y)
    await sleep(80)
  }
}

/**
 * 量矩形。行在列表视口外时,只滚 `.notes-rail-list` 把它带进来。
 * 不用 scrollIntoView:它会把整页一起滚,按下之后再滚还会取消正在进行的拖拽。
 */
export async function rectOf(ctx, selector) {
  const rect = await ctx.cdp.json(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (el === null) return null
    const list = el.closest('.notes-rail-list')
    if (list !== null) {
      const box = list.getBoundingClientRect()
      const r0 = el.getBoundingClientRect()
      if (r0.top < box.top || r0.bottom > box.bottom) {
        list.scrollTop += r0.top - box.top - (box.height - r0.height) / 2
      }
    }
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })()`)
  if (rect === null) throw new Error(`找不到元素:${selector}`)
  return rect
}

/** 按下名字并移过阈值。没进入拖拽就松开,避免按钮一直按着漏到下一个用例。 */
async function beginNameDrag(ctx, source) {
  let drag = null
  try {
    drag = await ctx.cdp.captureDrag(async () => {
      await ctx.cdp.mouse('mouseMoved', source.x, source.y)
      await sleep(40)
      await ctx.cdp.mouse('mousePressed', source.x, source.y, { buttons: 1, clickCount: 1 })
      await sleep(30)
      // 拖拽阈值在不同 Chromium 上不一样,一次走 40px,中间不再停顿。
      await ctx.cdp.mouse('mouseMoved', source.x + 40, source.y + 6, { buttons: 1 })
    })
  } finally {
    await ctx.cdp.mouse('mouseReleased', source.x + 40, source.y + 6, { buttons: 0 }).catch(() => {})
  }
  if (drag === null) throw new Error('按住名字并移开后没有开始拖拽')
  await ctx.cdp.waitFor(`document.querySelector('.notes-rail-list')?.dataset.dragging === 'true'`, {
    timeout: 3000,
    message: '按住名字并移开后进入拖拽'
  })
  return drag
}

export async function expectNoMoveProgress(ctx) {
  await ctx.cdp.waitFor(`document.querySelector('.notes-move-progress') === null`, {
    timeout: 8000,
    message: '移动结束后进度条不留下'
  })
}

/**
 * 落点色块贴住目标行,标签的 data-drop-path 是目标路径(根层是空字符串)。
 * 量的是松手之前的活矩形:色块会滑约 120ms,对齐要等过渡结束。
 * 不截拖影。那是操作系统的图,页面里留不下节点。
 */
async function expectDropCue(ctx, rowSelector, path) {
  await ctx.cdp.waitFor(
    `(() => {
      const row = document.querySelector(${JSON.stringify(rowSelector)})
      const pill = document.querySelector('.notes-rail-drop')
      const label = document.querySelector('.notes-rail-drop-label')
      if (row === null || pill === null || label === null) return false
      if (pill.getAttribute('data-visible') !== 'true') return false
      if (label.getAttribute('data-drop-path') !== ${JSON.stringify(path)}) return false
      const r = row.getBoundingClientRect()
      const p = pill.getBoundingClientRect()
      return Number(getComputedStyle(pill).opacity) >= 0.99 &&
        Math.abs(p.left - r.left) <= 1 &&
        Math.abs(p.top - r.top) <= 1 &&
        Math.abs(p.width - r.width) <= 1 &&
        Math.abs(p.height - r.height) <= 1
    })()`,
    { message: `落点色块贴住 ${rowSelector}，路径为 ${path === '' ? '根层' : path}` }
  )
}

async function expectNoDropCue(ctx) {
  const hidden = await ctx.cdp.eval(`(() => {
    const pill = document.querySelector('.notes-rail-drop')
    if (pill === null) return true
    return pill.getAttribute('data-visible') !== 'true' && Number(getComputedStyle(pill).opacity) < 0.2
  })()`)
  ok(hidden === true, '拖到自己身上落点色块不出现')
}

/**
 * 松手后那一行会从原位滑到新槽,大约 180ms。
 * 轮询要比这段短,否则滑完才开始等,中间态就没了。
 * 看到飞行层时它还不能贴在新行上:贴上就分不出是在飞还是已经落地。
 */
async function expectFlight(ctx, rowSelector, toPath) {
  await ctx.cdp.waitFor(
    `(() => {
      const flight = document.querySelector('.notes-rail-flight')
      const row = document.querySelector(${JSON.stringify(rowSelector)})
      if (flight === null || row === null) return false
      if (flight.getAttribute('data-to-path') !== ${JSON.stringify(toPath)}) return false
      const f = flight.getBoundingClientRect()
      const r = row.getBoundingClientRect()
      return Math.abs(f.top - r.top) > 4
    })()`,
    { interval: 16, timeout: 4000, message: `飞行层离开原位、尚未贴上 ${toPath === '' ? '根层' : toPath}` }
  )
}

export async function expectFlightGone(ctx) {
  await ctx.cdp.waitFor(`document.querySelector('.notes-rail-flight') === null`, {
    interval: 16,
    timeout: 4000,
    message: '飞行结束'
  })
}

export default [
  {
    id: 'rail-move/folder-into-folder',
    area: 'rail-move',
    title: '把展开的文件夹拖到另一个文件夹:先在原位收起,再滑到目标,落地后仍展开,磁盘路径已变',
    tags: ['rail', 'drag', 'folder'],
    fixture: BASIC,
    async run(ctx) {
      makeFolder(ctx, '移出甲/子层')
      makeFolder(ctx, '移入乙')
      await expandFolder(ctx, '移出甲')
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(folderSelector('移出甲/子层'))}) !== null`,
        { message: '子目录出现在移出甲下面' }
      )
      await collapseFolder(ctx, '移入乙')

      const release = await dragHold(
        ctx,
        `${folderSelector('移出甲')} .notes-folder-name`,
        `${folderSelector('移入乙')} .notes-folder-name`
      )
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(
          folderSelector('移入乙')
        )})?.classList.contains('drop-target') === true`,
        { message: '松手前目标目录有投放高亮' }
      )
      await expectDropCue(ctx, folderSelector('移入乙'), '移入乙')
      ok(
        (await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(folderSelector('移出甲'))}) !== null`
        )) === true,
        '松手前源目录还在原处'
      )
      await release()

      // 展开着的目录先在原位收起,再飞。收起容器的高度要在变小。
      await ctx.cdp.waitFor(
        `(() => {
          const box = document.querySelector('.notes-rail-collapse')
          if (box === null) return false
          return box.getBoundingClientRect().height < 40
        })()`,
        { interval: 16, timeout: 2000, message: '展开的目录先在原位收起' }
      )
      await expectFlight(ctx, folderSelector('移入乙/移出甲'), '移入乙/移出甲')
      await expectFlightGone(ctx)
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(folderSelector('移入乙/移出甲'))}) !== null`,
        { timeout: 10_000, message: '文件夹行出现在目标下面' }
      )
      ok(
        (await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(folderSelector('移出甲'))}) === null`
        )) === true,
        '根层不再有同名文件夹'
      )
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(folderSelector('移入乙'))})?.querySelector('.notes-folder-name')?.getAttribute('aria-expanded') === 'true'`,
        { message: '折叠着的目标在移完后展开' }
      )
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(folderSelector('移入乙/移出甲/子层'))}) !== null`,
        { message: '展开的子目录前缀跟着换,移完看得见' }
      )
      ok(existsSync(absPath(ctx, '移入乙/移出甲')), '磁盘上的目录已经挪到目标下')
      ok(!existsSync(absPath(ctx, '移出甲')), '原路径不再存在')
      await expectNoMoveProgress(ctx)
    }
  },

  {
    id: 'rail-move/file-into-folder',
    area: 'rail-move',
    title: '把文件拖进文件夹:路径更新、字节不变;打开中的文本跟着换路径并保存到新位置',
    tags: ['rail', 'drag', 'file'],
    fixture: BASIC,
    async run(ctx) {
      makeFolder(ctx, '文件落点')
      writeNoteFile(ctx, 'move-me.txt', '原样字节\n')
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileSelector('move-me.txt'))}) !== null`,
        { timeout: 10_000, message: '文件行出现在根层' }
      )
      await ctx.cdp.eval(`document.querySelector(${JSON.stringify(fileSelector('move-me.txt'))})?.click()`)
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-name')?.textContent === 'move-me.txt'`,
        { timeout: 10_000, message: '文件视图打开' }
      )

      const release = await dragHold(
        ctx,
        `${fileSelector('move-me.txt')} .notes-file-main`,
        `${folderSelector('文件落点')} .notes-folder-name`
      )
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(
          folderSelector('文件落点')
        )})?.classList.contains('drop-target') === true`,
        { message: '松手前目标目录有投放高亮' }
      )
      await expectDropCue(ctx, folderSelector('文件落点'), '文件落点')
      await release()

      await expectFlight(ctx, fileSelector('文件落点/move-me.txt'), '文件落点/move-me.txt')
      await expectFlightGone(ctx)
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(fileSelector('文件落点/move-me.txt'))}) !== null`,
        { timeout: 10_000, message: '文件行出现在目标目录下' }
      )
      ok(
        (await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(fileSelector('move-me.txt'))}) === null`
        )) === true,
        '根层不再有这个文件行'
      )
      eq(readFileSync(absPath(ctx, '文件落点/move-me.txt'), 'utf8'), '原样字节\n', '字节原样保留')
      ok(!existsSync(absPath(ctx, 'move-me.txt')), '源文件不在了')
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .notes-path-dir')?.textContent === '文件落点/'`,
        { timeout: 8000, message: '打开中的文件路径显示新目录' }
      )
      eq(
        await ctx.cdp.eval(`document.querySelector('.file-main .file-name')?.textContent ?? null`),
        'move-me.txt',
        '文件名没变'
      )

      const editor = await ctx.elementRect('.file-main .file-editor .cm-content')
      await ctx.cdp.click(editor.x + 12, editor.y + 16)
      await sleep(60)
      await ctx.cdp.type('再改')
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .notes-save-state.dirty') !== null`,
        { message: '文件进入未保存状态' }
      )
      await ctx.cdp.waitFor(
        `(() => { const el = document.querySelector('.file-main .notes-save-state');
          return el !== null && !el.classList.contains('dirty') && !el.classList.contains('saving') })()`,
        { timeout: 10_000, message: '改动保存到新路径' }
      )
      eq(
        readFileSync(absPath(ctx, '文件落点/move-me.txt'), 'utf8'),
        '再改原样字节\n',
        '保存写到移动后的路径'
      )
      ok(!existsSync(absPath(ctx, 'move-me.txt')), '旧路径没有被重新写出来')
      await expectNoMoveProgress(ctx)
    }
  },

  {
    id: 'rail-move/note-to-root',
    area: 'rail-move',
    title: '把目录里的笔记拖到「移到最外层」条,笔记回到根层',
    tags: ['rail', 'drag', 'note'],
    fixture: BASIC,
    async run(ctx) {
      makeFolder(ctx, '笔记夹')
      writeNoteFile(ctx, '笔记夹/被拖的笔记.md', '---\ntitle: 被拖的笔记\n---\n\n正文\n')
      await expandFolder(ctx, '笔记夹')
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(noteSelector('笔记夹/被拖的笔记'))}) !== null`,
        { timeout: 10_000, message: '笔记出现在目录里' }
      )

      const source = center(
        await rectOf(ctx, `${noteSelector('笔记夹/被拖的笔记')} .notes-row-main`)
      )
      const drag = await beginNameDrag(ctx, source)
      try {
        await ctx.cdp.waitFor(`document.querySelector('.notes-rootdrop') !== null`, {
          message: '拖起来之后才出现「移到最外层」条'
        })
        const strip = center(await rectOf(ctx, '.notes-rootdrop'))
        await drag.hover(strip.x, strip.y)
        await ctx.cdp.waitFor(
          `document.querySelector('.notes-rootdrop')?.classList.contains('active') === true`,
          { message: '松手前根层投放条处于投放态' }
        )
        await expectDropCue(ctx, '.notes-rootdrop', '')
        // 提示盖住投放条之后,要再 dragover 一次,drop 才会落到这条上。
        await drag.hover(strip.x, strip.y)
        await drag.drop(strip.x, strip.y)
      } catch (error) {
        await drag.cancel()
        throw error
      }

      await expectFlight(ctx, noteSelector('被拖的笔记'), '被拖的笔记')
      await expectFlightGone(ctx)
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(noteSelector('被拖的笔记'))}) !== null`,
        { timeout: 10_000, message: '笔记行回到根层' }
      )
      ok(
        (await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(noteSelector('笔记夹/被拖的笔记'))}) === null`
        )) === true,
        '目录里不再有这篇笔记'
      )
      ok(existsSync(absPath(ctx, '被拖的笔记.md')), '磁盘上的笔记在根层')
      ok(!existsSync(absPath(ctx, '笔记夹/被拖的笔记.md')), '原路径的笔记文件不在了')
      await expectNoMoveProgress(ctx)
    }
  },

  {
    id: 'rail-move/folder-onto-self',
    area: 'rail-move',
    title: '把文件夹拖到它自己身上不出现落点色块,也不移动',
    tags: ['rail', 'drag', 'folder'],
    fixture: BASIC,
    async run(ctx) {
      makeFolder(ctx, '自己')
      await ctx.cdp.waitFor(
        `document.querySelector(${JSON.stringify(folderSelector('自己'))}) !== null`,
        { timeout: 10_000, message: '目录行出现' }
      )

      const rect = center(await rectOf(ctx, `${folderSelector('自己')} .notes-folder-name`))
      const drag = await beginNameDrag(ctx, rect)
      try {
        const back = center(await rectOf(ctx, `${folderSelector('自己')} .notes-folder-name`))
        await drag.hover(back.x, back.y)
        await sleep(80)
        ok(
          (await ctx.cdp.eval(
            `document.querySelector(${JSON.stringify(
              folderSelector('自己')
            )})?.classList.contains('drop-target') === true`
          )) === false,
          '拖到自己身上不出现投放高亮'
        )
        await expectNoDropCue(ctx)
        await drag.cancel()
        await sleep(200)
        ok(
          (await ctx.cdp.eval(
            `document.querySelector('.notes-rail-flight') === null && document.querySelector('.notes-rail-collapse') === null`
          )) === true,
          '拖到自己身上不收起也不飞行'
        )
      } catch (error) {
        await drag.cancel()
        throw error
      }
      await sleep(250)

      ok(
        (await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(folderSelector('自己'))}) !== null`
        )) === true,
        '文件夹仍在原处'
      )
      ok(existsSync(absPath(ctx, '自己')), '磁盘路径没变')
      await expectNoMoveProgress(ctx)
    }
  }
]
