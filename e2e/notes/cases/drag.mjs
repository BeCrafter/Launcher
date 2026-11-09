import { eq, includes, ne, ok, truthy } from '../lib/assert.mjs'
import { sleep } from '../lib/cdp.mjs'
import { BASIC, FOLD, LONG, NESTED, TABLE_AND_DIAGRAM } from '../lib/fixtures.mjs'

const P1 = '第1节第1段。这是一段用来撑长度的正文。'

function nonEmpty(lines) {
  return lines.filter((line) => line.trim() !== '')
}

function indexOfText(lines, text) {
  return lines.findIndex((line) => line.trim() === text.trim())
}

export default [
  {
    id: 'drag/paragraph-across-blocks',
    area: 'drag',
    title: '拖拽段落跨过多个块:落点线/目标标签可见,松手后顺序正确',
    tags: ['drag', 'smoke'],
    fixture: BASIC,
    async run(ctx, t) {
      const snapshot = await ctx.dragBlock('第一节第二段。', '第二节第一段。', { edge: 'after' })
      truthy(snapshot.label, '拖拽中显示目标标签')
      truthy(snapshot.dropLine, '拖拽中显示落点线')
      const lines = nonEmpty(await ctx.lines())
      const target = lines.indexOf('第二节第一段。')
      const moved = lines.indexOf('第一节第二段。')
      ok(moved > target, `段落移到目标之后（target=${target}, moved=${moved}）\n${lines.join('\n')}`)
      eq(lines[moved - 1], '第二节第一段。', '紧跟在目标块之后')
    }
  },

  {
    id: 'drag/before-heading-enters-section',
    area: 'drag',
    title: '拖到标题上方:成为该节的第一个块',
    tags: ['drag', 'heading'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.dragBlock('第二节第二段。', '## 一小节 甲一', { edge: 'before' })
      const lines = nonEmpty(await ctx.lines())
      eq(lines[lines.indexOf('## 一小节 甲一') - 1], '第二节第二段。', '段落紧贴在标题之前')
      ok(lines.indexOf('第二节第二段。') > lines.indexOf('第一节第二段。'), '没有跑回文档最前')
    }
  },

  {
    id: 'drag/table-block',
    area: 'drag',
    title: '拖动表格块:整块移动,表格结构不被拆散',
    tags: ['drag', 'table'],
    fixture: TABLE_AND_DIAGRAM,
    async run(ctx, t) {
      await ctx.dragBlock('| 列一 | 列二 |', '图表后的段落。', { edge: 'after' })
      const lines = await ctx.lines()
      const header = indexOfText(lines, '| 列一 | 列二 |')
      ok(header > indexOfText(lines, '图表后的段落。'), '表格移到最后一个段落之后')
      eq(lines[header + 1], '| --- | --- |', '分隔行紧跟表头')
      eq(lines[header + 2], '| 甲 | 乙 |', '数据行完整')
      eq(lines.filter((line) => line === '| 列一 | 列二 |').length, 1, '表头没有重复')
    }
  },

  {
    id: 'drag/mermaid-block',
    area: 'drag',
    title: '拖动流程图块:围栏整体移动,首尾围栏成对',
    tags: ['drag', 'mermaid'],
    fixture: TABLE_AND_DIAGRAM,
    async run(ctx, t) {
      await ctx.dragBlock('```mermaid', '表格前的段落。', { edge: 'before' })
      const lines = await ctx.lines()
      const start = indexOfText(lines, '```mermaid')
      ok(start >= 0 && start < indexOfText(lines, '表格前的段落。'), '图表移到目标之前')
      eq(lines[start + 1], 'flowchart LR')
      eq(lines[start + 2], '  A --> B')
      eq(lines[start + 3], '```')
    }
  },

  {
    id: 'drag/escape-cancels',
    area: 'drag',
    title: '拖拽中按 Escape:取消移动、清掉落点线与大纲',
    tags: ['drag', 'cancel'],
    fixture: BASIC,
    async run(ctx, t) {
      const before = await ctx.body()
      const start = await ctx.beginDrag('第一节第二段。')
      await ctx.cdp.mouse('mouseMoved', start.x + 120, start.y + 160, { buttons: 1 })
      await sleep(200)
      await ctx.cancelDrag()
      eq(await ctx.body(), before, '正文未变')
      const leftovers = await ctx.cdp.json(`({
        line: document.querySelector('.cm-block-drop-line') !== null,
        label: document.querySelector('.cm-block-drop-label') !== null,
        outline: document.querySelector('.cm-block-outline') !== null
      })`)
      eq(leftovers, { line: false, label: false, outline: false }, '拖拽 DOM 已清理')
    }
  },

  {
    id: 'drag/nested-list-constrained',
    area: 'drag',
    title: '嵌套列表拖动:只在同层内换序,不出现右侧大纲',
    tags: ['drag', 'nested'],
    fixture: NESTED,
    async run(ctx, t) {
      await ctx.hoverLine('  - 内层甲一')
      await ctx.waitPill()
      const innerId = await ctx.cdp.eval(
        `document.querySelector('.notes-editor-pane .cm-block-pill')?.dataset.blockId`
      )
      await ctx.hoverLine('- 外层甲')
      await ctx.waitPill()
      const outerId = await ctx.cdp.eval(
        `document.querySelector('.notes-editor-pane .cm-block-pill')?.dataset.blockId`
      )
      ne(innerId, outerId, '悬停内层项与外层项时手柄属于不同块')
      const snapshot = await ctx.dragBlock('  - 内层甲一', '  - 内层甲二', { edge: 'after' })
      eq(snapshot.outlineCount, 0, '嵌套拖拽没有大纲')
      const lines = nonEmpty(await ctx.lines())
      ok(
        lines.indexOf('  - 内层甲二') < lines.indexOf('  - 内层甲一'),
        `两个内层项换序（inner=${innerId}, outer=${outerId}, label=${snapshot.label}, block=${
          snapshot.sourceBlockId
        }, dropLine=${JSON.stringify(snapshot.dropLine)}）\n${lines.join('\n')}`
      )
      ok(lines.indexOf('  - 内层甲一') < lines.indexOf('- 外层乙'), '没有跑出父列表')
    }
  },

  {
    id: 'drag/wheel-retargets-drop-target',
    area: 'drag',
    title: '拖拽中滚动滚轮:落点按滚动后的内容重新计算',
    tags: ['drag', 'scroll'],
    fixture: LONG,
    async run(ctx, t) {
      const start = await ctx.beginDrag(P1)
      const scroller = await ctx.cdp.json(
        `(() => { const el = document.querySelector('.notes-editor-pane .cm-scroller');
          const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`
      )
      const x = scroller.x + scroller.width / 2
      const y = scroller.y + scroller.height * 0.35
      await ctx.cdp.mouse('mouseMoved', x, y, { buttons: 1 })
      await sleep(200)
      const first = await ctx.dragSnapshot()
      truthy(first.label, '滚动前有目标标签')

      // 贴边之外的真滚轮；滚到指针下正好是一个标题，标签里应出现该标题 ——
      // 普通段落的标签只写「文本段落」，分不出是哪一段，标题才验证得了「重算」。
      let heading = null
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await ctx.cdp.wheel(x, y, 160)
        await sleep(120)
        const text = await ctx.cdp.eval(
          `document.elementFromPoint(${x}, ${y})?.closest('.cm-line')?.textContent ?? ''`
        )
        const match = /^ {0,3}#{1,10}[ \t]+(.+)$/.exec(text)
        if (match !== null) {
          heading = match[1].replace(/[ \t]+#+[ \t]*$/, '').trim()
          break
        }
      }
      truthy(heading, '滚动后指针落在标题行上')
      await sleep(200)
      const second = await ctx.dragSnapshot()
      truthy(second.label, '滚动后仍有目标标签')
      includes(second.label, heading, '滚动后标签按指针下的标题重新计算')
      ne(second.label, first.label, '滚动前后目标标签不同')
      await ctx.cancelDrag()
    }
  },

  {
    id: 'drag/edge-auto-scroll',
    area: 'drag',
    title: '拖到视口底边:自动滚动持续进行,目标标签跟随',
    tags: ['drag', 'scroll'],
    fixture: LONG,
    async run(ctx, t) {
      const start = await ctx.beginDrag(P1)
      const scroller = await ctx.cdp.json(
        `(() => { const el = document.querySelector('.notes-editor-pane .cm-scroller');
          const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`
      )
      await ctx.cdp.mouse('mouseMoved', scroller.x + scroller.width / 2, scroller.y + scroller.height - 6, {
        buttons: 1
      })
      await sleep(1400)
      const scrollTop = await ctx.scrollTop()
      ok(scrollTop > 120, `贴底 1.4s 后应已滚动（scrollTop=${scrollTop}）`)
      const snapshot = await ctx.dragSnapshot()
      truthy(snapshot.label, '自动滚动期间目标标签持续更新')
      await ctx.cancelDrag()
    }
  },

  {
    id: 'drag/outline-lock-and-drop',
    area: 'drag',
    title: '长文档大纲:悬停标题锁定落点并跳转,松手落在该标题之前',
    tags: ['drag', 'outline'],
    fixture: LONG,
    async run(ctx, t) {
      const snapshot = await ctx.dragToOutline(P1, '第10节', { release: true })
      ok(snapshot.outlineCount >= 10, `大纲列出足够多标题（实际 ${snapshot.outlineCount}）`)
      includes(snapshot.activeOutline, '第10节', '悬停项高亮')
      includes(snapshot.label, '第10节', '目标标签指向该节')
      ok(snapshot.scrollTop > 100, '悬停后编辑器跳到该节')
      const lines = nonEmpty(await ctx.lines())
      const moved = lines.indexOf(P1)
      const target = lines.indexOf('## 第10节')
      ok(moved >= 0 && target > 0, '移动块与目标标题都在')
      eq(moved, target - 1, '块落在「第10节」标题之前')
      ok(moved > lines.indexOf('## 第9节'), '没有落到上一节')
    }
  },

  {
    id: 'drag/outline-leave-unlocks',
    area: 'drag',
    title: '大纲锁定后把指针移出面板:解除锁定,恢复自由落点',
    tags: ['drag', 'outline'],
    fixture: LONG,
    async run(ctx, t) {
      const snapshot = await ctx.dragToOutline(P1, '第10节', { leaveBeforeRelease: true })
      includes(snapshot.activeOutline, '第10节', '移出前处于锁定态')
      eq(snapshot.afterLeave?.activeOutline ?? null, null, '移出后没有高亮项')
      await ctx.cancelDrag()
      eq(await ctx.cdp.eval(`document.querySelector('.cm-block-outline') === null`), true, '取消后大纲移除')
    }
  },

  {
    id: 'drag/outline-start-edge',
    area: 'drag',
    title: '大纲「文首」:拖到文档最前',
    tags: ['drag', 'outline'],
    fixture: LONG,
    async run(ctx, t) {
      await ctx.dragToOutline(P1, '@start', { release: true })
      const lines = nonEmpty(await ctx.lines())
      eq(lines[0], P1, '块成为文档第一块')
    }
  },

  {
    id: 'drag/outline-end-edge',
    area: 'drag',
    title: '大纲「文末」:拖到文档最后',
    tags: ['drag', 'outline'],
    fixture: LONG,
    async run(ctx, t) {
      await ctx.dragToOutline(P1, '@end', { release: true })
      const lines = nonEmpty(await ctx.lines())
      eq(lines[lines.length - 1], P1, '块成为文档最后一块')
    }
  },

  {
    id: 'drag/fold-preserved',
    area: 'drag',
    title: '移动其他块后,折叠节的折叠状态保持',
    tags: ['drag', 'fold'],
    fixture: FOLD,
    async run(ctx, t) {
      await ctx.setCursor('## 子节', 0)
      await ctx.hoverLine('## 子节')
      await ctx.cdp.waitFor(`document.querySelector('.notes-editor-pane .cm-block-caret') !== null`, {
        message: '折叠抓手出现'
      })
      await ctx.cdp.eval(`document.querySelector('.notes-editor-pane .cm-block-caret')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('.cm-foldPlaceholder') !== null`, {
        message: '先折叠子节'
      })
      await ctx.dragBlock('另一个节正文。', '折叠节正文。', { edge: 'before' })
      await sleep(300)
      eq(
        await ctx.cdp.eval(`document.querySelectorAll('.cm-foldPlaceholder').length`),
        1,
        '移动后折叠仍在'
      )
      const lines = nonEmpty(await ctx.lines())
      ok(lines.indexOf('另一个节正文。') < lines.indexOf('折叠节正文。'), '块确实移动了')
    }
  }
]
