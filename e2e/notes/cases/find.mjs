import { eq, ok } from '../lib/assert.mjs'
import { sleep } from '../lib/cdp.mjs'
import { BASIC, FIND, FIND_REPLACE, LONG } from '../lib/fixtures.mjs'

/**
 * 编辑器内查找 / 替换。
 *
 * 面板挂在编辑区右上角,⌘F 打开、⌘⌥F 展开替换、Esc 回正文;匹配计数、高亮、
 * 替换全部复用 lib/note-find.ts 的同一批区间。这里跑的是用户看到的完整路径:
 * 快捷键 → 输入查询 → 计数/高亮 → 上下导航 → 单次/全部替换 → 撤销。
 */

const CMD = 4
const CMD_ALT = 5
const SHIFT = 8

const PANEL_OPEN = `document.querySelector('.notes-find') !== null`

function countIs(text) {
  return `document.querySelector('.notes-find-count')?.textContent?.trim() === ${JSON.stringify(text)}`
}

function activeIndexIs(index) {
  return `(() => {
    const all = [...document.querySelectorAll('.cm-find-match')]
    const active = [...document.querySelectorAll('.cm-find-match-active')]
    return active.length === 1 && all.indexOf(active[0]) === ${index}
  })()`
}

async function openFind(ctx, withReplace = false) {
  await ctx.focus()
  await ctx.pressLetter('f', withReplace ? CMD_ALT : CMD)
  await ctx.cdp.waitFor(PANEL_OPEN, { message: '查找面板打开' })
  // 面板会在会话内记住上一次的选项;用例之间要回到默认,否则计数随上一条用例漂移
  await ctx.cdp.eval(`(() => {
    [...document.querySelectorAll('.notes-find-opt[aria-pressed="true"]')].forEach((el) => el.click())
    document.querySelector('.notes-find-input')?.focus()
    return true
  })()`)
  await sleep(80)
}

/** 替换行里的输入框(与查询框同 class,靠结构区分)。 */
async function setReplacement(ctx, text) {
  await ctx.cdp.eval(`(() => {
    const el = document.querySelector('.notes-find-replace .notes-find-input')
    el.focus()
    el.select()
    return true
  })()`)
  await ctx.cdp.type(text)
  await sleep(80)
}

async function waitCount(ctx, text) {
  await ctx.cdp.waitFor(countIs(text), { message: `匹配计数显示「${text}」` })
}

/** 选中查询框现有内容后整段换掉(Input.insertText 会替换选区)。 */
async function setQuery(ctx, text) {
  await ctx.cdp.eval(`(() => {
    const el = document.querySelector('.notes-find-input')
    el.focus()
    el.select()
    return true
  })()`)
  await ctx.cdp.type(text)
  await sleep(80)
}

async function waitBody(ctx, fragment) {
  await ctx.waitForNode(async () => (await ctx.body()).includes(fragment), `正文包含「${fragment}」`)
}

export default [
  {
    id: 'find/open-shortcut-focus',
    area: 'find',
    title: '⌘F 打开查找:焦点进查询框,再按一次只全选不重复打开,正文不变',
    tags: ['find', 'shortcut'],
    fixture: FIND,
    async run(ctx) {
      const before = await ctx.body()
      await openFind(ctx)
      await ctx.cdp.waitFor(
        `document.activeElement === document.querySelector('.notes-find-input')`,
        { message: '打开后焦点在查询框' }
      )
      eq(
        await ctx.cdp.eval(`document.querySelectorAll('.notes-find').length`),
        1,
        '只出现一个查找面板'
      )

      await ctx.cdp.type('alpha')
      await waitCount(ctx, '1 / 5')

      // 已在打开状态再按 ⌘F:焦点拉回查询框并全选,而不是再开一个面板
      await ctx.pressLetter('f', CMD)
      await ctx.cdp.waitFor(
        `(() => {
          const el = document.querySelector('.notes-find-input')
          return document.activeElement === el && el.selectionStart === 0 &&
            el.selectionEnd === el.value.length && el.value === 'alpha'
        })()`,
        { message: '再按 ⌘F 后查询词被全选' }
      )
      eq(await ctx.body(), before, '查找过程不修改正文')

      // 关掉再用正文选区打开:查询词自动取所选的单行文本,并保持全选
      await ctx.press('Escape')
      await ctx.cdp.waitFor(`document.querySelector('.notes-find') === null`, {
        message: 'Esc 关闭面板'
      })
      await ctx.selectRange('hello hallo', 0, 5)
      await ctx.pressLetter('f', CMD)
      await ctx.cdp.waitFor(PANEL_OPEN, { message: '用选区再次打开面板' })
      await ctx.cdp.waitFor(
        `(() => {
          const el = document.querySelector('.notes-find-input')
          return el.value === 'hello' && el.selectionStart === 0 && el.selectionEnd === 5
        })()`,
        { message: '查询词取正文里选中的那一行文字' }
      )
      eq(await ctx.body(), before, '用选区打开查找同样不修改正文')
    }
  },

  {
    id: 'find/count-next-prev',
    area: 'find',
    title: '计数与上下导航:回车下一个、Shift+回车上一个,活动高亮跟着走',
    tags: ['find', 'navigate'],
    fixture: FIND,
    async run(ctx) {
      await openFind(ctx)
      await ctx.cdp.type('alpha')
      await waitCount(ctx, '1 / 5')
      await ctx.cdp.waitFor(`document.querySelectorAll('.cm-find-match').length === 5`, {
        message: '五处匹配全部高亮'
      })
      await ctx.cdp.waitFor(activeIndexIs(0), { message: '活动匹配是第一处' })

      await ctx.press('Enter')
      await waitCount(ctx, '2 / 5')
      await ctx.cdp.waitFor(activeIndexIs(1), { message: '回车后活动匹配是第二处' })

      await ctx.press('Enter', SHIFT)
      await waitCount(ctx, '1 / 5')
      await ctx.cdp.waitFor(activeIndexIs(0), { message: 'Shift+回车回到第一处' })
    }
  },

  {
    id: 'find/options',
    area: 'find',
    title: '选项:Aa 区分大小写、全词排除词内命中、正则多命中,无效正则给出错误态',
    tags: ['find', 'options', 'regex'],
    fixture: FIND,
    async run(ctx) {
      await openFind(ctx, true)
      await ctx.cdp.type('alpha')
      await waitCount(ctx, '1 / 5')

      await ctx.cdp.eval(`document.querySelector('.notes-find-case')?.click()`)
      await waitCount(ctx, '1 / 4')

      await ctx.cdp.eval(`document.querySelectorAll('.notes-find-opt')[1]?.click()`)
      await waitCount(ctx, '1 / 3')

      await ctx.cdp.eval(`document.querySelector('.notes-find-case')?.click()`)
      await waitCount(ctx, '1 / 4')

      await ctx.cdp.eval(`document.querySelector('.notes-find-regex')?.click()`)
      await setQuery(ctx, 'h(a|e)llo')
      await waitCount(ctx, '1 / 2')

      await setQuery(ctx, '(')
      await ctx.cdp.waitFor(`document.querySelector('.notes-find-input.invalid') !== null`, {
        message: '无效正则时查询框进入错误态'
      })
      await ctx.cdp.waitFor(
        `(document.querySelector('.notes-find-hint.danger')?.textContent?.trim().length ?? 0) > 0`,
        { message: '错误提示出现' }
      )
      await ctx.cdp.waitFor(
        `[...document.querySelectorAll('.notes-find-text-btn')].every((el) => el.disabled)`,
        { message: '无效正则时替换按钮禁用' }
      )
      ok((await ctx.body()).includes('alpha'), '无效正则不影响正文')
    }
  },

  {
    id: 'find/replace-one-all-undo',
    area: 'find',
    title: '替换:单次替换只改一处;全部替换后无匹配;撤销整体恢复正文',
    tags: ['find', 'replace', 'undo'],
    fixture: FIND_REPLACE,
    async run(ctx) {
      await openFind(ctx, true)
      await ctx.cdp.waitFor(`document.querySelector('.notes-find-replace') !== null`, {
        message: '⌘⌥F 展开替换行'
      })
      await ctx.cdp.type('cat')
      await waitCount(ctx, '1 / 3')
      await setReplacement(ctx, 'dog')

      await ctx.cdp.eval(`document.querySelectorAll('.notes-find-text-btn')[0]?.click()`)
      await waitBody(ctx, 'dog cat cat')
      await waitCount(ctx, '1 / 2')

      // 单次替换能单独撤销
      await ctx.focus()
      await ctx.pressLetter('z', CMD)
      await waitBody(ctx, 'cat cat cat')

      await ctx.cdp.eval(`document.querySelectorAll('.notes-find-text-btn')[1]?.click()`)
      await waitBody(ctx, 'dog dog dog')
      await ctx.cdp.waitFor(`document.querySelectorAll('.cm-find-match').length === 0`, {
        message: '全部替换后再无匹配高亮'
      })

      // 全部替换是一个 transaction:一次 ⌘Z 整体退回
      await ctx.focus()
      await ctx.pressLetter('z', CMD)
      await waitBody(ctx, 'cat cat cat')
    }
  },

  {
    id: 'find/escape-focus',
    area: 'find',
    title: 'Esc 关闭面板:高亮清除、焦点回正文、正文不变',
    tags: ['find', 'escape'],
    fixture: FIND,
    async run(ctx) {
      const before = await ctx.body()
      await openFind(ctx)
      await ctx.cdp.type('alpha')
      await waitCount(ctx, '1 / 5')

      await ctx.press('Escape')
      await ctx.cdp.waitFor(`document.querySelector('.notes-find') === null`, {
        message: 'Esc 关闭面板'
      })
      await ctx.cdp.waitFor(`document.querySelectorAll('.cm-find-match').length === 0`, {
        message: '关闭后高亮清除'
      })
      await ctx.cdp.waitFor(
        `document.activeElement?.classList.contains('cm-content') === true`,
        { message: '焦点回到正文' }
      )
      eq(await ctx.body(), before, 'Esc 不修改正文')
    }
  },

  {
    id: 'find/preview-switches-split',
    area: 'find',
    title: '纯预览下按 ⌘F:自动切到分栏,面板可见',
    tags: ['find', 'preview'],
    fixture: FIND,
    async run(ctx) {
      await ctx.setMode('preview')
      await ctx.pressLetter('f', CMD)
      await ctx.cdp.waitFor(
        `document.querySelectorAll('.notes-mode-btn')[0]?.getAttribute('aria-pressed') === 'true'`,
        { message: '⌘F 把视图切到分栏' }
      )
      await ctx.cdp.waitFor(
        `(() => {
          const el = document.querySelector('.notes-find')
          return el !== null && el.offsetParent !== null
        })()`,
        { message: '分栏下查找面板可见' }
      )
    }
  },

  {
    id: 'find/scroll-offscreen-match',
    area: 'find',
    title: '命中文末时滚动到目标:编辑区发生滚动且活动匹配进入视口',
    tags: ['find', 'scroll'],
    fixture: LONG,
    async run(ctx) {
      await openFind(ctx)
      await ctx.cdp.type('第12节第6段')
      await waitCount(ctx, '1 / 1')
      await ctx.cdp.waitFor(
        `(document.querySelector('.notes-editor-pane .cm-scroller')?.scrollTop ?? 0) > 0`,
        { message: '激活文末匹配后编辑区已滚动' }
      )
      await ctx.cdp.waitFor(
        `(() => {
          const match = document.querySelector('.cm-find-match-active')
          const scroller = document.querySelector('.notes-editor-pane .cm-scroller')
          if (match === null || scroller === null) return false
          const m = match.getBoundingClientRect()
          const s = scroller.getBoundingClientRect()
          return m.top >= s.top - 1 && m.bottom <= s.bottom + 1
        })()`,
        { message: '活动匹配落在可视区域内' }
      )
    }
  },

  {
    id: 'find/header-button',
    area: 'find',
    title: '标题栏搜索按钮:点击同样打开面板并聚焦查询框',
    tags: ['find', 'header'],
    fixture: BASIC,
    async run(ctx) {
      await ctx.cdp.eval(`document.querySelector('[data-find-open]')?.click()`)
      await ctx.cdp.waitFor(PANEL_OPEN, { message: '点击标题栏按钮打开面板' })
      await ctx.cdp.waitFor(
        `document.activeElement === document.querySelector('.notes-find-input')`,
        { message: '打开后焦点在查询框' }
      )
    }
  }
]
