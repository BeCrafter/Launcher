import { eq, excludes, includes, ok } from '../lib/assert.mjs'
import {
  BASIC,
  FOLD,
  FOLD_SCROLLABLE,
  LONG,
  OUTLINE_MANY,
  OUTLINE_TRAPS,
  OUTLINE_TREE
} from '../lib/fixtures.mjs'

/** 70 个二级标题、几乎没有正文:刻度栏必须封顶,否则会从预览顶上排到底。 */
const TICKS_MANY = ['# 开头', ...Array.from({ length: 70 }, (_, i) => ['', `## 刻度${i + 1}`])].flat().join('\n')

/** 等某个标题成为目录里的当前项。 */
async function waitActive(ctx, title) {
  await ctx.cdp.waitFor(
    `document.querySelector('.preview-outline-row.is-active .preview-outline-jump')?.textContent?.trim() === ${JSON.stringify(
      title
    )}`,
    { message: `当前节变为「${title}」` }
  )
}

export default [
  {
    id: 'preview-outline/rail-and-card',
    area: 'preview-outline',
    title: '预览右上角默认只有短刻度;悬停展开完整层级目录,移开收起;编辑模式不出现',
    tags: ['preview-outline', 'hover'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '预览右缘出现大纲刻度'
      })
      await ctx.leavePreviewOutline()
      eq(await ctx.previewOutlineCardOpacity(), '0', '默认不铺开目录卡片')

      const ticks = await ctx.previewOutlineTicks()
      eq(
        ticks.map((tick) => tick.level),
        [1, 2, 1],
        '每个标题一条刻度,层级跟着标题'
      )
      await waitActive(ctx, '第一节 甲')

      await ctx.hoverPreviewOutline()
      const rows = await ctx.previewOutlineRows()
      eq(
        rows.map((row) => row.text),
        ['第一节 甲', '一小节 甲一', '第二节 乙'],
        '目录列出完整标题树'
      )
      eq(
        rows.map((row) => row.depth),
        [0, 1, 0],
        '子标题比父标题深一层'
      )
      eq(
        rows.map((row) => row.indent),
        [0, 12, 0],
        '缩进按层级落位'
      )
      eq(rows[0].active, true, '文首当前项是第一节')
      eq(rows[1].active, false, '其他项不高亮')

      await ctx.leavePreviewOutline()
      eq(await ctx.previewOutlineCardOpacity(), '0', '鼠标移开后卡片收起')

      await ctx.setMode('edit')
      eq(
        await ctx.cdp.eval(`document.querySelector('.preview-outline') === null`),
        true,
        '编辑模式没有预览大纲'
      )
      await ctx.setMode('split')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '分栏模式的预览栏里仍显示大纲'
      })
    }
  },

  {
    id: 'preview-outline/rail-top-right',
    area: 'preview-outline',
    title: '刻度条固定在预览右上角;悬停时白底浮层出现在刻度条左侧 1px、顶边对齐,最宽 200px,高度随内容而不是铺满整栏',
    tags: ['preview-outline', 'layout'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '预览右上角出现大纲刻度'
      })

      const closed = await ctx.previewOutlineGeometry()
      ok(closed !== null, '量得到目录条位置')
      ok(closed.handleTop <= 24, `刻度条应锚定在顶部,实际 top=${closed.handleTop}`)
      ok(closed.handleRight <= 8, `刻度条应贴右缘,实际 right=${closed.handleRight}`)
      ok(closed.handleTop < closed.paneHeight / 3, '刻度条不再垂直居中')

      await ctx.hoverPreviewOutline()
      const open = await ctx.previewOutlineGeometry()
      ok(open !== null, '展开后量得到卡片位置')
      ok(
        Math.abs(open.cardTop - open.handleTop) <= 2,
        `卡片应与刻度条顶边对齐:card=${open.cardTop}, handle=${open.handleTop}`
      )
      // 期望改过:以前量透明外框,外框贴住刻度条时白底面板其实缩在槽的左边。
      // 现在量画出来的面板,它应在刻度条左侧 1px,并且铺满卡片宽度。
      ok(open.gap >= 0 && open.gap <= 2, `白底浮层应在刻度条左侧 1px,实际间隙 gap=${open.gap}`)
      ok(open.slotSlack <= 2, `白底面板应铺满卡片,实际空出 slotSlack=${open.slotSlack}`)
      // 期望改过:浮层盖在正文上,最大宽度从 268 收到 200。
      ok(
        open.cardWidth >= 198 && open.cardWidth <= 202,
        `纯预览栏够宽时浮层应为 200px,实际 cardWidth=${open.cardWidth}`
      )
      ok(open.cardLeft < open.handleLeft, '卡片在刻度条左侧')
      ok(
        open.cardHeight < open.paneHeight - 40,
        `卡片高度应随内容而不是铺满整栏:card=${open.cardHeight}, pane=${open.paneHeight}`
      )
    }
  },

  {
    id: 'preview-outline/rail-top-right-split',
    area: 'preview-outline',
    title: '分栏模式的窄预览栏里:悬停时白底浮层同样出现在刻度条左侧 1px,不往左飘',
    tags: ['preview-outline', 'layout', 'split'],
    fixture: LONG,
    async run(ctx, t) {
      await ctx.setMode('split')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '分栏预览右上角出现大纲刻度'
      })
      await waitActive(ctx, '长文档标题')

      await ctx.hoverPreviewOutline()
      const geom = await ctx.previewOutlineGeometry()
      ok(geom !== null, '量得到目录位置')
      ok(
        Math.abs(geom.cardTop - geom.handleTop) <= 2,
        `卡片应与刻度条顶边对齐:card=${geom.cardTop}, handle=${geom.handleTop}`
      )
      // 期望改过:以前量透明外框,窄栏里白底面板会缩在槽的左边、离刻度条很远。
      ok(geom.gap >= 0 && geom.gap <= 2, `白底浮层应在刻度条左侧 1px,实际间隙 gap=${geom.gap}`)
      ok(geom.slotSlack <= 2, `白底面板应铺满卡片,实际空出 slotSlack=${geom.slotSlack}`)
      // 窄栏会被 min() 再压一截,只要求不宽过 200 的上限。
      ok(geom.cardWidth <= 202, `分栏浮层不应宽过 200px,实际 cardWidth=${geom.cardWidth}`)
      ok(geom.cardLeft < geom.handleLeft, '卡片在刻度条左侧')
      ok(
        geom.cardHeight < geom.paneHeight - 40,
        `卡片高度应随内容而不是铺满整栏:card=${geom.cardHeight}, pane=${geom.paneHeight}`
      )
    }
  },

  {
    id: 'preview-outline/card-shifts-with-layout',
    area: 'preview-outline',
    title: '浮层与刻度条共用 CSS 锚定:预览栏整体被挪动时,白底面板仍在刻度条左侧 1px',
    tags: ['preview-outline', 'layout', 'shift'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '预览大纲出现'
      })
      // 先把指针挪到目录层之外:上一条用例可能让卡片停在 hover 展开状态,
      // 而展开的卡片正好盖住预览左侧 —— 挪到卡片里不会触发 pointerleave。
      await ctx.cdp.mouse('mouseMoved', 20, 400)
      await ctx.cdp.eval(`document.querySelector('.preview-outline-handle').focus()`)
      await ctx.waitForNode(
        async () => (await ctx.previewOutlineCardOpacity()) === '1',
        '聚焦刻度后目录展开',
        { timeout: 5000, interval: 200 }
      )

      const before = await ctx.previewOutlineGeometry()
      ok(before !== null, '量得到目录位置')
      ok(Math.abs(before.cardTop - before.handleTop) <= 2, '展开时卡片与刻度条顶边对齐')
      ok(before.gap >= 0 && before.gap <= 2, `展开时白底浮层在刻度条左侧 1px,实际 gap=${before.gap}`)
      ok(before.slotSlack <= 2, `白底面板应铺满卡片,实际空出 slotSlack=${before.slotSlack}`)

      // 期望来自用户实际窗口:刻度条和卡片必须一起动。
      // 视口 fixed 坐标实现里,尺寸不变的整体位移不会触发 ResizeObserver,
      // 卡片会留在原处、与刻度条之间裂开距离 —— 这里用 translateX 复现这种失效形态。
      await ctx.cdp.eval(
        `document.querySelector('.notes-shell').style.transform = 'translateX(64px)'`
      )
      try {
        await ctx.cdp.eval(
          `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
        )
        const shifted = await ctx.previewOutlineGeometry()
        ok(shifted !== null, '位移后量得到目录位置')
        ok(Math.abs(shifted.cardTop - shifted.handleTop) <= 2, '位移后卡片仍与刻度条顶边对齐')
        ok(shifted.gap >= 0 && shifted.gap <= 2, `位移后白底浮层仍在刻度条左侧 1px,实际 gap=${shifted.gap}`)
      } finally {
        await ctx.cdp.eval(`document.querySelector('.notes-shell').style.transform = ''`)
      }

      await ctx.cdp.eval(
        `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
      )
      const restored = await ctx.previewOutlineGeometry()
      ok(restored !== null, '还原后量得到目录位置')
      ok(Math.abs(restored.cardTop - restored.handleTop) <= 2, '还原后卡片仍与刻度条顶边对齐')
      ok(restored.gap >= 0 && restored.gap <= 2, `还原后白底浮层仍在刻度条左侧 1px,实际 gap=${restored.gap}`)
    }
  },

  {
    id: 'preview-outline/active-marker',
    area: 'preview-outline',
    title: '滚到第 6 节后展开目录:只有当前行带标识,标识与刻度条高亮同色,并落在卡片里',
    tags: ['preview-outline', 'active'],
    fixture: LONG,
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '长文档出现大纲刻度'
      })
      await waitActive(ctx, '长文档标题')

      const offset = await ctx.previewHeadingOffset('第6节')
      ok(offset !== null, '找得到第 6 节的标题')
      await ctx.previewScrollTo(offset + 6)
      await waitActive(ctx, '第6节')
      await ctx.hoverPreviewOutline()

      let marker = null
      await ctx.waitForNode(async () => {
        marker = await ctx.previewOutlineMarker()
        return marker !== null && marker.inCard === true
      }, '当前节的标识出现在展开的目录卡片里')

      const rows = await ctx.previewOutlineRows()
      eq(
        rows.filter((row) => row.marker).map((row) => row.text),
        ['第6节'],
        '只有当前行带标识'
      )
      eq(
        rows.filter((row) => row.current === 'location').map((row) => row.text),
        ['第6节'],
        '只有当前行标记为 aria-current'
      )
      eq(marker.markColor, marker.tickColor, '标识与刻度条高亮同色,方便一一对应')
      ok(marker.width > 0 && marker.height > 0, '标识可见')
    }
  },

  {
    id: 'preview-outline/long-list-keeps-active-visible',
    area: 'preview-outline',
    title: '目录很长时浮层内部滚动;定位到很靠下的节,展开后当前项自动落在浮层可见范围内',
    tags: ['preview-outline', 'scroll', 'long'],
    fixture: OUTLINE_MANY,
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '长目录出现刻度'
      })
      await waitActive(ctx, '长目录')

      const offset = await ctx.previewHeadingOffset('第36节')
      ok(offset !== null, '找得到第 36 节的标题')
      await ctx.previewScrollTo(offset + 6)
      await waitActive(ctx, '第36节')

      await ctx.hoverPreviewOutline()
      let view = null
      await ctx.waitForNode(async () => {
        view = await ctx.previewOutlineActiveInView()
        return view !== null && view.visible === true
      }, '展开后当前节滚进浮层可见范围')
      eq(view.scrollable, true, '目录很多时浮层列表确实可滚动')

      // 展开状态下正文再滚到靠上的另一节:当前项仍要自动回到可见范围
      const next = await ctx.previewHeadingOffset('第10节')
      ok(next !== null, '找得到第 10 节的标题')
      await ctx.previewScrollTo(next + 6)
      await waitActive(ctx, '第10节')
      await ctx.waitForNode(async () => {
        const now = await ctx.previewOutlineActiveInView()
        return now !== null && now.visible === true
      }, '正文换到第 10 节后当前项仍在浮层可见范围内')
    }
  },

  {
    id: 'preview-outline/indent-three-levels',
    area: 'preview-outline',
    title: '分栏模式下三级标题目录:缩进依次 0 / 12 / 24px,当前节跟随预览滚动',
    tags: ['preview-outline', 'split'],
    fixture: OUTLINE_TREE,
    async run(ctx, t) {
      await ctx.setMode('split')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-row') !== null`, {
        message: '分栏预览里渲染出目录条目'
      })
      const rows = await ctx.previewOutlineRows()
      eq(
        rows.map((row) => [row.text, row.depth, row.indent]),
        [
          ['概览', 0, 0],
          ['安装', 1, 12],
          ['前置条件', 2, 24],
          ['使用', 1, 12],
          ['附录', 0, 0]
        ],
        '三级目录的层级与缩进'
      )
      await waitActive(ctx, '概览')
    }
  },

  {
    id: 'preview-outline/active-follows-scroll',
    area: 'preview-outline',
    title: '滚动预览时当前标题跟着变:滚到第 6 节时目录与刻度一起高亮,回到顶部恢复首节',
    tags: ['preview-outline', 'scroll'],
    fixture: LONG,
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '长文档出现大纲刻度'
      })
      await waitActive(ctx, '长文档标题')

      const offset = await ctx.previewHeadingOffset('第6节')
      ok(offset !== null, '找得到第 6 节的标题')
      await ctx.previewScrollTo(offset + 6)

      await waitActive(ctx, '第6节')
      const ticks = await ctx.previewOutlineTicks()
      eq(ticks.filter((tick) => tick.active).length, 1, '只有一条刻度高亮')
      eq(ticks.findIndex((tick) => tick.active), 6, '第 6 节对应的刻度高亮')

      await ctx.previewScrollTo(0)
      await waitActive(ctx, '长文档标题')
    }
  },

  {
    id: 'preview-outline/click-jump',
    area: 'preview-outline',
    title: '点目录里的「第 9 节」:预览滚到该标题,当前项同步高亮',
    tags: ['preview-outline', 'jump'],
    fixture: LONG,
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '长文档出现大纲刻度'
      })
      await ctx.hoverPreviewOutline()
      await ctx.clickPreviewOutline('第9节')
      await waitActive(ctx, '第9节')

      await ctx.waitForNode(async () => {
        const top = await ctx.previewHeadingTop('第9节')
        return top !== null && top >= -2 && top <= 40
      }, '点目录后第 9 节滚到预览顶部附近')
      ok((await ctx.previewScrollTop()) > 0, '预览确实发生了滚动')
    }
  },

  {
    id: 'preview-outline/jump-sticks-when-short',
    area: 'preview-outline',
    title: '最后几节顶不上去时,点目录仍把当前项停在那一节,正文标题短暂高亮;自己滚动后改跟滚动',
    tags: ['preview-outline', 'jump'],
    // 开头垫长所以能滚,最后两节后面没有填充,点「最后一节」到不了预览顶部。
    fixture: [
      '# 开头',
      '',
      ...Array.from({ length: 36 }, (_, i) => [`开头填充${i},把后面两节推到一屏之外。`, '']).flat(),
      '# 倒数第二节',
      '',
      '倒数第二节只有一句。',
      '',
      '# 最后一节',
      '',
      '最后一节只有一句。'
    ].join('\n'),
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '预览大纲出现'
      })
      const before = await ctx.body()
      await ctx.clickPreviewOutline('最后一节')
      await ctx.cdp.waitFor(
        `(() => {
          const active = document.querySelector('.preview-outline-row.is-active .preview-outline-jump')?.textContent?.trim()
          const el = [...document.querySelectorAll('.notes-preview-body > .md-h')]
            .find((h) => (h.textContent ?? '').trim().startsWith('最后一节'))
          return active === '最后一节' && el?.classList.contains('is-located') === true
        })()`,
        { message: '点不到顶时当前项停在最后一节,正文标题被标出' }
      )
      const box = await ctx.cdp.json(
        `(() => {
          const pv = document.querySelector('.notes-preview')
          const el = [...document.querySelectorAll('.notes-preview-body > .md-h')]
            .find((h) => (h.textContent ?? '').trim().startsWith('最后一节'))
          if (pv === null || el === undefined) return null
          return {
            scrollTop: pv.scrollTop,
            atBottom: pv.scrollTop + pv.clientHeight >= pv.scrollHeight - 2,
            top: el.getBoundingClientRect().top - pv.getBoundingClientRect().top
          }
        })()`
      )
      ok(box !== null, '量到预览和最后一节')
      ok(box.scrollTop > 0, `预览确实滚了(scrollTop ${box.scrollTop})`)
      ok(box.atBottom, '滚到了底部,不是还能继续往下')
      ok(box.top > 40, `标题没有贴到预览顶部(实际 ${box.top})`)
      eq(await ctx.body(), before, '点目录不改正文')

      await ctx.previewScrollTo(0)
      await waitActive(ctx, '开头')
    }
  },

  {
    id: 'preview-outline/level-then-caret',
    area: 'preview-outline',
    title:
      '标题前方平时不显示;鼠标停在标题上才出现随层级缩放的 H,再移到前面只剩折叠箭头,连点不闪回',
    tags: ['preview-outline', 'fold', 'level'],
    fixture: FOLD,
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.md-h-level') !== null`, {
        message: '预览标题前方出现层级标'
      })
      await ctx.cdp.mouse('mouseMoved', 20, 400)

      let state = await ctx.previewFoldState('可折叠节')
      eq(state.level, 'H1', '一级标题前面是 H1')
      eq(state.levelShown, false, '鼠标不在时层级标不显示')
      eq(state.caretShown, false, '鼠标不在时箭头不出现')
      const mark = await ctx.cdp.json(`(() => {
        const el = document.querySelector('.notes-preview-body > .md-h .md-h-mark')
        const btn = el?.closest('.md-h-fold-btn')
        if (el === null || el === undefined || btn === null) return null
        const cs = getComputedStyle(el)
        const probe = document.createElement('span')
        probe.style.color = 'var(--dim)'
        document.body.appendChild(probe)
        const dim = getComputedStyle(probe).color
        probe.remove()
        return {
          style: cs.fontStyle,
          weight: Number.parseInt(cs.fontWeight, 10),
          size: Number.parseFloat(cs.fontSize),
          color: cs.color,
          dim,
          background: getComputedStyle(btn).backgroundColor
        }
      })()`)
      eq(mark.style, 'italic', 'H 是斜体')
      ok(mark.weight >= 700, `H 应是粗体,实际字重 ${mark.weight}`)
      eq(mark.color, mark.dim, 'H 用深灰色,而不是主题强调色')
      // 期望改过:以前每级都是 26px,H2 和 H4 分不出来。现在跟标题字号走。
      const scaled = await ctx.cdp.json(`(() => {
        const px = (sel) => Number.parseFloat(getComputedStyle(document.querySelector(sel)).fontSize)
        return { h1: px('.md-h1 .md-h-mark'), h2: px('.md-h2 .md-h-mark'), num: px('.md-h1 .md-h-num') }
      })()`)
      ok(scaled.h1 - scaled.h2 >= 3, `H1 的标记应明显大于 H2:H1=${scaled.h1}, H2=${scaled.h2}`)
      ok(scaled.num >= 11, `H1 的级数应能直接读,实际 ${scaled.num}px`)
      ok(
        mark.background === 'rgba(0, 0, 0, 0)' || mark.background === 'transparent',
        `层级标不应再有按钮底,实际背景 ${mark.background}`
      )

      const badge = await ctx.previewHeadingBadge('可折叠节')
      ok(badge.gap >= 2, `标签与标题之间应留间隙,实际 gap=${badge.gap}`)
      ok(
        Math.abs(badge.bottomGap) <= 2,
        `H 的脚应与标题字的下沿对齐,实际 bottomGap=${badge.bottomGap}`
      )
      ok(badge.badgeLeft >= badge.paneLeft - 1, '标签没有探出预览左缘')
      ok(badge.scrollSlack <= 1, `标签不应撑出水平滚动,实际 scrollSlack=${badge.scrollSlack}`)

      // 期望改过:以前 H 常驻。现在平时隐藏,停在标题文字上才出现。
      await ctx.hoverHeadingText('可折叠节')
      await ctx.waitForNode(async () => {
        const next = await ctx.previewFoldState('可折叠节')
        return next.levelShown === true && next.caretShown === false
      }, '鼠标停在标题文字上时出现层级标,不出现箭头')

      await ctx.hoverHeadingBadge('可折叠节')
      // 切换是 160ms 的交叉淡入,不能在鼠标落下的同一帧读透明度。
      await ctx.waitForNode(async () => {
        const next = await ctx.previewFoldState('可折叠节')
        return next.levelShown === false && next.caretShown === true
      }, '鼠标停在标题前面的 H 上时,层级标淡出、折叠箭头淡入')

      // 连点三下:按钮被拆掉重建时,新按钮没有悬停,层级标会闪回来。
      for (let i = 0; i < 3; i += 1) {
        await ctx.clickPreviewFold('可折叠节')
        state = await ctx.previewFoldState('可折叠节')
        eq(state.caretShown, true, `第 ${i + 1} 次点击后箭头仍在`)
        eq(state.levelShown, false, `第 ${i + 1} 次点击后没有闪回层级标`)
      }
      state = await ctx.previewFoldState('可折叠节')
      eq(state.folded, true, '奇数次点击后本节收起')
      excludes(await ctx.previewText(), '折叠节正文。', '本节正文被收起')
      await ctx.cdp.mouse('mouseMoved', 20, 400)
      state = await ctx.previewFoldState('可折叠节')
      eq(state.caretShown, true, '已折叠的节移开鼠标后箭头仍在')
      eq(state.levelShown, false, '已折叠的节移开鼠标后不显示层级标')

      await ctx.clickPreviewFold('可折叠节')
      await ctx.cdp.mouse('mouseMoved', 20, 400)
      state = await ctx.previewFoldState('可折叠节')
      eq(state.folded, false, '再点一次展开')
      eq(state.levelShown, false, '展开并移开鼠标后层级标也收起')
      eq(state.caretShown, false, '展开并移开鼠标后箭头不再占着这个位置')
    }
  },

  {
    id: 'preview-outline/fold-in-preview',
    area: 'preview-outline',
    title: '预览标题旁的折叠箭头:收起本节正文与子节,再点恢复;箭头在折叠时保持可见',
    tags: ['preview-outline', 'fold'],
    fixture: FOLD,
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '预览大纲出现'
      })
      eq(await ctx.previewFoldButtonCount(), 3, '三个有内容的标题都有折叠箭头')

      await ctx.clickPreviewFold('可折叠节')
      const state = await ctx.previewFoldState('可折叠节')
      eq(state.folded, true, '本节进入折叠态')
      eq(state.expanded, 'false', '箭头 aria-expanded 为 false')
      eq(state.caretShown, true, '折叠后箭头一直可见')

      let text = await ctx.previewText()
      excludes(text, '折叠节正文。', '本节正文被收起')
      excludes(text, '子节正文。', '子节正文一起收起')
      includes(text, '另一个节正文。', '同级下一节不受影响')

      await ctx.clickPreviewFold('可折叠节')
      text = await ctx.previewText()
      includes(text, '折叠节正文。', '展开后本节正文回来')
      includes(text, '子节正文。', '展开后子节正文回来')
    }
  },

  {
    id: 'preview-outline/navigation-only',
    area: 'preview-outline',
    title: '浮层只做展示与定位:没有折叠箭头,点条目只跳转、不改正文;折叠仍只在预览标题旁',
    tags: ['preview-outline', 'navigate'],
    // 末尾垫长:FOLD 本身一屏放得下,点「另一个节」滚不到顶,当前项会一直停在首节。
    fixture: FOLD_SCROLLABLE,
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '预览大纲出现'
      })
      await ctx.hoverPreviewOutline()

      // 期望已变:用户要求浮层只做定位,折叠箭头全部移到预览标题旁。
      eq(
        await ctx.cdp.eval(
          `document.querySelectorAll('.preview-outline-caret, .preview-outline-caret-spacer').length`
        ),
        0,
        '浮层里不再有折叠箭头'
      )
      const rows = await ctx.previewOutlineRows()
      eq(
        rows.map((row) => row.text),
        ['可折叠节', '子节', '另一个节'],
        '目录完整展示层级'
      )
      eq(await ctx.previewFoldButtonCount(), 3, '预览标题旁仍有折叠箭头')

      await ctx.clickPreviewOutline('另一个节')
      await waitActive(ctx, '另一个节')
      let text = await ctx.previewText()
      includes(text, '折叠节正文。', '点目录只跳转,不会折叠正文')
      includes(text, '子节正文。', '子节正文也还在')
      eq(await ctx.previewFoldButtonCount(), 3, '目录跳转不改变折叠控件')

      // 折叠仍然从预览标题旁做;折起后目录只是跟着隐藏子级,不提供折叠操作。
      await ctx.clickPreviewFold('可折叠节')
      await ctx.cdp.waitFor(`document.querySelectorAll('.preview-outline-row').length === 2`, {
        message: '折起后目录隐藏子级'
      })
      eq(
        (await ctx.previewOutlineRows()).map((row) => row.text),
        ['可折叠节', '另一个节'],
        '子级从目录里消失'
      )
      text = await ctx.previewText()
      excludes(text, '子节正文。', '预览正文按标题旁的折叠收起')
    }
  },

  {
    id: 'preview-outline/fold-nested',
    area: 'preview-outline',
    title: '嵌套折叠:先折子节再折父节,展开父节后子节仍保持折叠,展开子节才恢复',
    tags: ['preview-outline', 'fold', 'nested'],
    fixture: FOLD,
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '预览大纲出现'
      })

      await ctx.clickPreviewFold('子节')
      excludes(await ctx.previewText(), '子节正文。', '先折起子节')
      eq((await ctx.previewFoldState('子节')).folded, true, '子节处于折叠态')

      await ctx.clickPreviewFold('可折叠节')
      await ctx.cdp.waitFor(
        `document.querySelectorAll('.preview-outline-row').length === 2`,
        { message: '父节折叠后子级条目从目录消失' }
      )
      excludes(await ctx.previewText(), '折叠节正文。', '父节正文收起')
      excludes(await ctx.previewText(), '子节正文。', '子节正文仍收起')

      await ctx.clickPreviewFold('可折叠节')
      let text = await ctx.previewText()
      includes(text, '折叠节正文。', '展开父节后父节正文回来')
      excludes(text, '子节正文。', '子节自己的折叠不会被父节展开冲掉')
      eq((await ctx.previewFoldState('子节')).folded, true, '子节仍是折叠态')

      await ctx.clickPreviewFold('子节')
      text = await ctx.previewText()
      includes(text, '子节正文。', '展开子节后正文回来')
    }
  },

  {
    id: 'preview-outline/split-jump-syncs-editor',
    area: 'preview-outline',
    title: '分栏模式点目录:预览滚到目标节,编辑器跟随滚动到同一处',
    tags: ['preview-outline', 'split', 'jump'],
    fixture: LONG,
    async run(ctx, t) {
      await ctx.setMode('split')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '分栏预览出现大纲'
      })
      await ctx.hoverPreviewOutline()
      await ctx.clickPreviewOutline('第9节')
      await ctx.waitForNode(
        async () => (await ctx.previewScrollTop()) > 0,
        '分栏里预览滚到第 9 节'
      )
      await ctx.waitForNode(async () => (await ctx.scrollTop()) > 0, '编辑器跟随滚动')
    }
  },

  {
    id: 'preview-outline/traps',
    area: 'preview-outline',
    title: '代码围栏与引用里的 # 不算标题:目录只有真正的三节,重复标题也不混',
    tags: ['preview-outline', 'trap'],
    fixture: OUTLINE_TRAPS,
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '预览大纲出现'
      })
      const ticks = await ctx.previewOutlineTicks()
      eq(ticks.length, 3, '只有三个真标题出了刻度')
      const rows = await ctx.previewOutlineRows()
      eq(
        rows.map((row) => row.text),
        ['甲节', '乙节', '丙节'],
        '围栏/引用里的标题都不进目录'
      )

      await ctx.clickPreviewOutline('乙节')
      await waitActive(ctx, '乙节')
    }
  },

  {
    id: 'preview-outline/keyboard',
    area: 'preview-outline',
    title: '键盘聚焦刻度即展开目录;ArrowDown 进入第一个条目,Escape 收起',
    tags: ['preview-outline', 'keyboard'],
    fixture: BASIC,
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '预览大纲出现'
      })
      await ctx.cdp.eval(`document.querySelector('.preview-outline-handle').focus()`)
      // 卡片是 120ms 的 opacity 过渡;这里用 Node 侧的轮询间隔给渲染进程留出推进动画的时间,
      // 不用固定 sleep,也不直接断言过渡中的中间值。
      await ctx.waitForNode(
        async () => (await ctx.previewOutlineCardOpacity()) === '1',
        '聚焦刻度后目录展开',
        { timeout: 5000, interval: 200 }
      )
      eq(
        await ctx.cdp.eval(
          `document.querySelector('.preview-outline-handle')?.getAttribute('aria-expanded')`
        ),
        'true',
        '刻度按钮报告展开状态'
      )

      await ctx.press('ArrowDown')
      await ctx.cdp.waitFor(
        `document.activeElement?.classList.contains('preview-outline-jump') === true`,
        { message: 'ArrowDown 聚焦第一个目录条目' }
      )

      await ctx.press('Escape')
      await ctx.cdp.waitFor(
        `document.querySelector('.preview-outline')?.classList.contains('is-open') === false`,
        { message: 'Escape 收起目录' }
      )
      await ctx.waitForNode(
        async () => (await ctx.previewOutlineCardOpacity()) === '0',
        'Escape 后卡片隐藏',
        { timeout: 5000, interval: 200 }
      )
    }
  },

  {
    id: 'preview-outline/note-switch-resets-folds',
    area: 'preview-outline',
    title: '换到另一篇笔记再回来:预览折叠重置,正文重新完整显示',
    tags: ['preview-outline', 'fold', 'note'],
    fixture: FOLD,
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '预览大纲出现'
      })
      await ctx.clickPreviewFold('可折叠节')
      eq((await ctx.previewFoldState('可折叠节')).folded, true, '当前笔记里折起一节')

      await ctx.cdp.eval(
        `[...document.querySelectorAll('.notes-row-main')]
          .find((el) => el.textContent?.includes('E2E 链接目标'))?.click()`
      )
      await ctx.cdp.waitFor(`document.querySelector('.notes-title')?.value === 'E2E 链接目标'`, {
        message: '打开另一篇笔记'
      })
      await ctx.ensureMainNote()
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '回到主笔记的预览'
      })

      eq((await ctx.previewFoldState('可折叠节')).folded, false, '换笔记后折叠状态归零')
      includes(await ctx.previewText(), '折叠节正文。', '正文重新完整显示')
    }
  },

  {
    id: 'preview-outline/reapply-after-edit',
    area: 'preview-outline',
    title: '分栏里继续编辑正文后:预览仍保持折叠,折叠箭头也没有重复叠加',
    tags: ['preview-outline', 'fold', 'edit'],
    fixture: FOLD,
    async run(ctx, t) {
      await ctx.setMode('split')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '分栏预览出现大纲'
      })
      await ctx.clickPreviewFold('可折叠节')
      eq((await ctx.previewFoldState('可折叠节')).folded, true, '先折起一节')

      await ctx.setCursor('另一个节正文。', '另一个节正文。'.length)
      await ctx.typeText('补充。')
      await ctx.waitSaved()

      await ctx.waitForNode(async () => {
        const state = await ctx.previewFoldState('可折叠节')
        return state !== null && state.folded === true
      }, '重渲染后折叠状态仍在')
      excludes(await ctx.previewText(), '折叠节正文。', '重渲染后折起的内容仍然是收起的')
      eq(await ctx.previewFoldButtonCount(), 3, '每轮重放只保留一份折叠箭头')
    }
  },

  {
    id: 'preview-outline/ticks-edge-scroll',
    area: 'preview-outline',
    title:
      '刻度太多时栏高封顶,贴上下缘自动滚;换节时高亮滑到下一根,快出窗口才一起滚;不改正文也不滚预览',
    tags: ['preview-outline', 'scroll'],
    fixture: TICKS_MANY,
    async run(ctx, t) {
      await ctx.setMode('preview')
      await ctx.cdp.waitFor(`document.querySelector('.preview-outline-handle') !== null`, {
        message: '预览右上角出现大纲刻度'
      })

      const before = await ctx.cdp.json(`(() => {
        const pane = document.querySelector('.notes-preview')
        const handle = document.querySelector('.preview-outline-handle')
        const strip = document.querySelector('.preview-outline-strip')
        if (pane === null || handle === null || strip === null) return null
        return {
          handleHeight: handle.getBoundingClientRect().height,
          paneHeight: pane.getBoundingClientRect().height,
          tickCount: strip.querySelectorAll('.preview-outline-tick').length,
          fadeTop: strip.classList.contains('fade-top'),
          fadeBottom: strip.classList.contains('fade-bottom'),
          previewTop: pane.scrollTop
        }
      })()`)
      ok(before !== null, `量得到刻度栏:${JSON.stringify(before)}`)
      ok(before.handleHeight <= 168, `刻度栏应封顶,实际高度 ${before.handleHeight}`)
      ok(
        before.handleHeight < before.paneHeight / 2,
        `刻度栏应明显短于预览栏:栏 ${before.handleHeight},预览 ${before.paneHeight}`
      )
      eq(before.tickCount, 71, '窗外的刻度仍留在 DOM 里')
      eq(before.fadeTop, false, '停在顶上时上面没有更多')
      eq(before.fadeBottom, true, '底下还有被裁掉的刻度')
      const bodyBefore = await ctx.body()
      eq(before.previewTop, 0, '预览还停在文首')

      const edge = await ctx.cdp.json(`(() => {
        const strip = document.querySelector('.preview-outline-strip')
        const r = strip.getBoundingClientRect()
        return { x: r.x + r.width / 2, bottom: r.bottom - 4, top: r.y + 4 }
      })()`)
      await ctx.cdp.mouse('mouseMoved', edge.x, edge.bottom)
      await ctx.cdp.waitFor(
        `document.querySelector('.preview-outline-strip')?.scrollTop > 40`,
        { message: '指针停在下缘时刻度栏向下滚' }
      )
      const mid = await ctx.cdp.json(`(() => {
        const strip = document.querySelector('.preview-outline-strip')
        return {
          scrollTop: strip.scrollTop,
          fadeTop: strip.classList.contains('fade-top'),
          previewTop: document.querySelector('.notes-preview').scrollTop
        }
      })()`)
      ok(mid.scrollTop > 40, `下缘应滚出一截,实际 scrollTop=${mid.scrollTop}`)
      eq(mid.fadeTop, true, '滚开之后上面也有被裁掉的刻度')
      eq(mid.previewTop, 0, '贴边滚动不带动预览')

      // 指针还停在下缘。这时换当前节,栏要继续贴边滚,不能被拉去对准新的高亮。
      const early = await ctx.previewHeadingOffset('刻度2')
      ok(early !== null, '找得到刻度2')
      await ctx.cdp.eval(`(() => {
        const el = document.querySelector('.notes-preview')
        el.scrollTop = ${Number(early) + 6}
        el.dispatchEvent(new Event('scroll'))
      })()`)
      await waitActive(ctx, '刻度2')
      const stillEdging = await ctx.cdp.eval(
        `document.querySelector('.preview-outline-strip').scrollTop`
      )
      ok(
        stillEdging >= mid.scrollTop - 1,
        `贴边翻看时换了当前节,栏不被拉回去:滚到 ${stillEdging},之前是 ${mid.scrollTop}`
      )
      await ctx.cdp.eval(`(() => {
        const el = document.querySelector('.notes-preview')
        el.scrollTop = 0
        el.dispatchEvent(new Event('scroll'))
      })()`)
      await waitActive(ctx, '开头')

      await ctx.cdp.mouse('mouseMoved', edge.x, edge.top)
      await ctx.cdp.waitFor(
        `document.querySelector('.preview-outline-strip')?.scrollTop < 2`,
        { message: '指针停在上缘时刻度栏滚回开头', timeout: 12000 }
      )

      await ctx.leavePreviewOutline()
      // 离开时高亮从贴边翻看到的位置滑回文首那根,不能在滑到一半时量。
      await ctx.waitForNode(async () => {
        const parked = await ctx.cdp.json(`(() => {
          const strip = document.querySelector('.preview-outline-strip')
          const tick = strip?.querySelector('.preview-outline-tick.is-active')
          const thumb = strip?.querySelector('.preview-outline-thumb')
          if (!strip || !tick || !thumb) return null
          const running = thumb.getAnimations().some((animation) => animation.playState === 'running')
          const gap = Math.abs(thumb.getBoundingClientRect().top - tick.getBoundingClientRect().top)
          return { running, aligned: gap <= 1 }
        })()`)
        return parked !== null && parked.running === false && parked.aligned === true
      }, '离开后高亮滑回当前刻度')
      const after = await ctx.cdp.json(`(() => {
        const strip = document.querySelector('.preview-outline-strip')
        const tick = strip.querySelector('.preview-outline-tick.is-active')
        const s = strip.getBoundingClientRect()
        const t = tick.getBoundingClientRect()
        return {
          visible: t.top >= s.top - 1 && t.bottom <= s.bottom + 1,
          previewTop: document.querySelector('.notes-preview').scrollTop
        }
      })()`)
      eq(after.visible, true, '离开后当前刻度回到可见范围')
      eq(after.previewTop, 0, '预览滚动位置不变')
      eq(await ctx.body(), bodyBefore, '正文不变')

      // 不走 previewScrollTo:它先睡 150ms,180ms 的滑动那时已经结束,读不到正在跑的动画。
      const nudge = async (title) => {
        const offset = await ctx.previewHeadingOffset(title)
        ok(offset !== null, `找得到${title}`)
        await ctx.cdp.eval(`(() => {
          const el = document.querySelector('.notes-preview')
          el.scrollTop = ${Number(offset) + 6}
          el.dispatchEvent(new Event('scroll'))
        })()`)
        await waitActive(ctx, title)
      }
      const thumbState = async () =>
        ctx.cdp.json(`(() => {
          const strip = document.querySelector('.preview-outline-strip')
          const tick = strip?.querySelector('.preview-outline-tick.is-active')
          const thumb = strip?.querySelector('.preview-outline-thumb')
          if (!strip || !tick || !thumb) return null
          const s = strip.getBoundingClientRect()
          const t = thumb.getBoundingClientRect()
          const tickTop = tick.getBoundingClientRect().top
          const running = thumb.getAnimations().some((animation) => animation.playState === 'running')
          return {
            scrollTop: strip.scrollTop,
            aligned: Math.abs(t.top - tickTop) <= 1,
            centered: Math.abs(t.top + t.height / 2 - (s.top + s.height / 2)) <= 8,
            running,
            fadeTop: strip.classList.contains('fade-top'),
            fadeBottom: strip.classList.contains('fade-bottom'),
            atStart: strip.scrollTop <= 1,
            atEnd: strip.scrollHeight - strip.clientHeight - strip.scrollTop <= 1
          }
        })()`)

      await nudge('刻度40')
      const sliding = await thumbState()
      ok(sliding !== null && sliding.running === true, `换到靠后的节时高亮正在滑过去:${JSON.stringify(sliding)}`)
      await ctx.waitForNode(async () => {
        const parked = await thumbState()
        if (parked !== null && parked.aligned && parked.centered && parked.fadeTop && parked.fadeBottom) return true
        throw new Error(JSON.stringify(parked))
      }, '稳住后高亮停在栏的中段,两头仍有渐隐')
      const held = (await thumbState()).scrollTop

      await nudge('刻度41')
      const next = await thumbState()
      eq(next.scrollTop, held, '下一根还在窗口里,栏不动')
      ok(next.running === true, '高亮滑向下一根,不是栏被拖动')
      await ctx.waitForNode(async () => {
        const parked = await thumbState()
        if (parked !== null && parked.aligned && parked.scrollTop === held) return true
        throw new Error(JSON.stringify(parked))
      }, '滑完后高亮对准下一根,栏仍停在原处')

      // 刻度55 离底部的剩余已经放得进 160px 的窗口。旧规则会把栏贴到底,高亮就被拖离中段。
      await nudge('刻度55')
      await ctx.waitForNode(async () => {
        const parked = await thumbState()
        if (
          parked !== null &&
          parked.aligned &&
          parked.centered &&
          parked.fadeTop &&
          parked.fadeBottom &&
          parked.atEnd === false &&
          parked.scrollTop > held
        ) {
          return true
        }
        throw new Error(JSON.stringify(parked))
      }, '末尾那截放得进窗口时,高亮仍停在中段,不提前贴底')

      await nudge('刻度2')
      await ctx.waitForNode(async () => {
        const parked = await thumbState()
        if (parked !== null && parked.atStart && parked.fadeTop === false && parked.aligned) return true
        throw new Error(JSON.stringify(parked))
      }, '靠近开头时整段露出来,上面不再假装还有')

      // 最后几节后面没有正文,滚不到预览顶部,当前节会停在更前面的某一节。直接滚到底。
      // 不再要求栏提前贴底:高亮还在中段时下缘渐隐留着,只有居中已经碰到底才整段露出。
      await ctx.cdp.eval(`(() => {
        const el = document.querySelector('.notes-preview')
        el.scrollTop = el.scrollHeight
        el.dispatchEvent(new Event('scroll'))
      })()`)
      await ctx.waitForNode(async () => {
        const parked = await thumbState()
        if (parked === null || parked.aligned !== true) throw new Error(JSON.stringify(parked))
        const clear = parked.atEnd ? parked.fadeBottom === false : parked.centered && parked.fadeBottom === true
        if (clear) return true
        throw new Error(JSON.stringify(parked))
      }, '靠近末尾时高亮仍对准当前刻度,并且停在没被渐隐盖住的那一段里')
    }
  }
]
