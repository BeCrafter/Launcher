import { eq, includes, ok } from '../lib/assert.mjs'
import { sleep } from '../lib/cdp.mjs'
import { BASIC } from '../lib/fixtures.mjs'

export default [
  {
    id: 'meta/rail-search',
    area: 'meta',
    title: '笔记列表搜索:按标题过滤,清空后恢复',
    tags: ['rail', 'search'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.cdp.eval(
        `document.querySelector('.notes-rail-search input')?.focus()`
      )
      await ctx.cdp.type('链接目标')
      await ctx.cdp.waitFor(
        `[...document.querySelectorAll('.notes-row-main')].some((el) => el.textContent?.includes('E2E 链接目标'))`,
        { message: '搜索命中目标笔记' }
      )
      const rows = await ctx.cdp.json(
        `[...document.querySelectorAll('.notes-row-main')].map((el) => el.textContent ?? '')`
      )
      ok(!rows.some((row) => row.includes('E2E 主笔记')), '不匹配的主笔记被过滤')
      await ctx.clearRailFilters()
      await ctx.cdp.waitFor(
        `[...document.querySelectorAll('.notes-row-main')].some((el) => el.textContent?.includes('E2E 主笔记'))`,
        { message: '清空搜索后主笔记回来' }
      )
    }
  },

  {
    id: 'meta/tags-add-remove',
    area: 'meta',
    title: '笔记标签:输入回车添加 chip,点 × 移除',
    tags: ['meta', 'tags'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.cdp.eval(`document.querySelector('.notes-tag-input')?.focus()`)
      await ctx.cdp.type('e2e元标签')
      await ctx.press('Enter')
      await ctx.cdp.waitFor(`document.querySelector('.notes-tag-chip')?.textContent?.includes('e2e元标签')`, {
        message: '标签 chip 出现'
      })
      await ctx.cdp.eval(`document.querySelector('.notes-tag-chip button')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.notes-tag-chip') === null`, {
        message: '标签 chip 被移除'
      })
    }
  },

  {
    id: 'meta/refs-picker-add',
    area: 'meta',
    title: '关联对象:从选择器勾选第一项并添加后出现关联 chip',
    tags: ['meta', 'refs'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.cdp.eval(`document.querySelector('.notes-add-ref')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.note-ref-picker') !== null`, {
        message: '关联选择器打开'
      })
      // 选择器列的是本机真实的 agent / cron / service,不能假设某一条一定在。
      // 勾第一项可用行,后面按它的 label 找 chip —— 换个环境也成立。
      const label = await ctx.cdp.eval(`(() => {
        const row = [...document.querySelectorAll('.note-ref-picker-row:not(.disabled)')][0]
        if (!row) return null
        row.querySelector('input')?.click()
        return row.querySelector('.note-ref-picker-label')?.textContent ?? null
      })()`)
      ok(label !== null, '选择器里至少有一项可添加对象')
      await ctx.cdp.waitFor(`!document.querySelector('.note-ref-picker-ft .d-btn.accent')?.disabled`, {
        message: '「添加」按钮可用'
      })
      await ctx.cdp.eval(`document.querySelector('.note-ref-picker-ft .d-btn.accent')?.click()`)
      const needle = JSON.stringify(label)
      await ctx.cdp.waitFor(
        `[...document.querySelectorAll('.note-ref-label')].some((el) => el.textContent === ${needle})`,
        { message: `关联 chip 出现（${label}）` }
      )
    }
  },

  {
    id: 'meta/scroll-sync-toggle',
    area: 'meta',
    title: '分栏滚动同步:按钮可切换激活态',
    tags: ['meta', 'scroll'],
    fixture: BASIC,
    async run(ctx, t) {
      const before = await ctx.cdp.eval(
        `document.querySelector('.notes-sync-btn')?.classList.contains('active') ?? null`
      )
      ok(before !== null, '存在滚动同步按钮')
      await ctx.cdp.eval(`document.querySelector('.notes-sync-btn')?.click()`)
      await sleep(150)
      const after = await ctx.cdp.eval(
        `document.querySelector('.notes-sync-btn')?.classList.contains('active') ?? null`
      )
      eq(after, !before, '激活态被切换')
      await ctx.cdp.eval(`document.querySelector('.notes-sync-btn')?.click()`)
    }
  }
]
