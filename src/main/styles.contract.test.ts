// 样式契约:把「改 CSS 时踩过的坑」钉成自动检查。
//
// 这些不是风格偏好,每一条都对应一次真实事故(2026-10-09/10 那一轮密集调整里踩的),
// 靠人工 review 拦不住 —— 它们全都「看起来没问题」。

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// 读的是 renderer 的样式目录。放在 src/main/ 是因为这里才有 node 类型
// (同 boot-theme.contract.test.ts —— 它也是从 main 侧读 renderer 的 base.css)
const STYLES_DIR = join(new URL('.', import.meta.url).pathname, '../renderer/src/styles')

function cssFiles(): string[] {
  return readdirSync(STYLES_DIR).filter((f) => f.endsWith('.css'))
}

function read(name: string): string {
  return readFileSync(join(STYLES_DIR, name), 'utf8')
}

/** 去掉注释,避免注释里的括号/选择器干扰判断 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 粗略切出每条规则(不处理嵌套 @media 的层级,对本文件的用途够用) */
function rulesOf(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stripComments(css))) !== null) {
    out.push({ selector: m[1].trim(), body: m[2].trim() })
  }
  return out
}

describe('CSS 契约:括号必须平衡', () => {
  it.each(cssFiles())('%s 的 {} 数量一致', (name) => {
    // 事故:用正则删一段旧规则时,`.*?` 一路匹配到了某条规则的闭合大括号,
    // 把它吃掉了。该规则未闭合 → **其后所有规则都被解析器丢弃** ——
    // 表现为「新加的样式全都不生效」,而单看那段 diff 完全看不出问题。
    const css = stripComments(read(name))
    const open = (css.match(/\{/g) ?? []).length
    const close = (css.match(/\}/g) ?? []).length
    expect(open, `${name}: { ${open} 个, } ${close} 个`).toBe(close)
  })
})

describe('CSS 契约:悬停不得改变布局', () => {
  /**
   * 会改变元素尺寸/位置的属性。悬停时改这些,鼠标扫过就会「跳」。
   *
   * 只检查**选择器以 `:hover` 结尾**的规则,也就是「被悬停的那个元素自己」——
   * 后代元素(如 `.row:hover .row-acts`)的变化只要不撑大父元素就是允许的,
   * 那属于设计而非事故。
   */
  const LAYOUT_PROPS = [
    'width',
    'height',
    'min-width',
    'min-height',
    'max-width',
    'max-height',
    'padding',
    'margin',
    'display',
    'position',
    'font-size',
    'line-height',
    'letter-spacing',
    'gap',
    'flex',
    'border-width'
  ]

  it.each(cssFiles())('%s 里以 :hover 结尾的规则不含布局属性', (name) => {
    // 事故一:悬停时改 border-color,只要那行有边框就实打实跳 1px
    //   (遗留规则 .notes-row:hover { border-color } —— 行早已改成 border: 0)
    // 事故二:悬停时把 18px 高的行内按钮显示出来,超过行内容区的 16px,行高 28 → 30
    const bad: string[] = []
    for (const { selector, body } of rulesOf(read(name))) {
      if (!/:hover\s*$/.test(selector)) continue
      for (const prop of LAYOUT_PROPS) {
        // 匹配 `prop:` 或 `prop-xxx:`(如 border-width / padding-top)
        const re = new RegExp(`(?:^|;)\\s*${prop}(?:-[a-z]+)?\\s*:`, 'i')
        if (re.test(body)) bad.push(`${selector} { ${body} } → 含 ${prop}`)
      }
    }
    expect(bad, `悬停改布局会让鼠标扫过时抖动:\n${bad.join('\n')}`).toEqual([])
  })
})

describe('CSS 契约:标签页内容不得被 overflow 裁掉', () => {
  it('rail 的自绘滚动条骑在分割线上,rail 不能设 overflow: hidden', () => {
    // 事故:.notes-rail-scrollbar 用 right: -2px 跨在 rail 的 border-right 上,
    // 一旦给 .notes-rail 加上 overflow: hidden,滚动条就会被裁掉半边(只剩 2px)。
    const css = stripComments(read('notes.css'))
    const railRule = rulesOf(css).find((r) => r.selector === '.notes-rail')
    expect(railRule).toBeDefined()
    expect(railRule!.body).not.toMatch(/overflow\s*:/)
  })
})

// ── 样式类名两边对齐 ──
//
// 下面两组守的是同一类问题:**class 名在 TS 里是字符串,在 CSS 里也是字符串**。
// 打错一个字母,TypeScript 不报、测试不红、界面上只是「没变色」——
// 而「没变色」在一个本来就五颜六色的代码块里几乎看不出来。

const RENDERER = join(new URL('.', import.meta.url).pathname, '../renderer/src')

function readSrc(rel: string): string {
  return readFileSync(join(RENDERER, rel), 'utf8')
}

/** 从源码文本里抓出形如 `class: 'tk-xxx'` 的 class 字面量 */
function classLiterals(src: string, prefix: string): Set<string> {
  const out = new Set<string>()
  const re = new RegExp(`['"\`](${prefix}[a-z0-9-]*)['"\`]`, 'g')
  for (const m of src.matchAll(re)) out.add(m[1])
  return out
}

/** 从 CSS 文本里抓出所有用到的类选择器 */
function classesInCss(css: string, prefix: string): Set<string> {
  const out = new Set<string>()
  const re = new RegExp(`\\.(${prefix}[a-z0-9-]*)`, 'g')
  for (const m of stripComments(css).matchAll(re)) out.add(m[1])
  return out
}

describe('CSS 契约:代码高亮词表两边对齐', () => {
  /**
   * `tk-*` 的 class 有两个来源:
   *   · `lib/code-tokens.ts` —— 语法 tag → class,编辑器与预览共用;
   *   · `modules/notes/editor-marks.ts` —— 语法树没覆盖到的几处(表格分隔符、
   *     任务标记、提示块标记),只在编辑器里用。
   * 两边都必须有 CSS 定义 —— 漏一个的表现只是「这个 token 不上色」,
   * 在一堆彩色 token 里根本看不出来。
   */
  const TOKEN_SOURCES = ['lib/code-tokens.ts', 'modules/notes/editor-marks.ts']

  /** 由模板串拼出来的 class(静态扫描看不见),这里点名 */
  const DYNAMIC_TOKENS = [
    'tk-callout',
    'tk-callout-note',
    'tk-callout-tip',
    'tk-callout-important',
    'tk-callout-warning',
    'tk-callout-caution'
  ]

  const allCss = (): string => cssFiles().map(read).join('\n')

  const usedTokens = (): Set<string> => {
    const out = new Set<string>(DYNAMIC_TOKENS)
    for (const rel of TOKEN_SOURCES) for (const c of classLiterals(readSrc(rel), 'tk-')) out.add(c)
    return out
  }

  it('用到的每个 tk-* 都在 CSS 里有定义', () => {
    const used = usedTokens()
    const defined = classesInCss(allCss(), 'tk-')
    const missing = [...used].filter((c) => !defined.has(c))
    expect(missing, `这些 class 没有配色,对应的 token 永远不会变色:\n${missing.join('\n')}`).toEqual([])
  })

  it('CSS 里没有用不上的 tk-* 死规则', () => {
    const used = usedTokens()
    const defined = classesInCss(allCss(), 'tk-')
    const dead = [...defined].filter((c) => !used.has(c))
    expect(dead, `这些 tk-* 规则没有任何地方在用:\n${dead.join('\n')}`).toEqual([])
  })
})

describe('CSS 契约:编辑区是源码模式,不是渲染视图', () => {
  /**
   * 事故:编辑区曾经把标题放大到 19px、给代码块加整块底色、给引用加竖条、
   * 把正文限宽居中 —— 结果它读起来像「一份渲染过的文档」而不是源码,
   * 用户明确要求改回**源码模式**。这条契约守的就是那个决定。
   *
   * 判据是「有没有改变排版」:改颜色、改字形(粗/斜/删除线)都不影响行高,允许;
   * 改字号、行高、内外边距、底色、圆角都会让行高参差或让某类行看起来被渲染过,禁止。
   */
  const LAYOUT_PROPS = [
    'font-size',
    'line-height',
    'padding',
    'margin',
    'background',
    'border-radius',
    'box-shadow',
    'display',
    'letter-spacing',
    'height',
    'width',
    'max-width'
  ]

  it('tk-* 只允许改颜色与字形,不许改排版', () => {
    const bad: string[] = []
    for (const { selector, body } of rulesOf(read('notes.css'))) {
      if (!selector.includes('.tk-')) continue
      for (const prop of LAYOUT_PROPS) {
        const re = new RegExp(`(?:^|;)\\s*${prop}(?:-[a-z]+)?\\s*:`, 'i')
        if (re.test(body)) bad.push(`${selector} { ${body} } → 含 ${prop}`)
      }
    }
    expect(
      bad,
      `编辑区的 token 样式只能上色与改字形;改排版会让行高参差,就不再是源码模式了:\n${bad.join('\n')}`
    ).toEqual([])
  })

  it('编辑器主题不限宽、不居中(那是文档版式)', () => {
    const src = readSrc('modules/notes/NoteEditor.tsx')
    expect(src).not.toContain('maxWidth')
    expect(src).not.toContain('margin: \'0 auto\'')
  })

  it('编辑器不注册行装饰(行装饰是「按语法树给某类行换外观」,必然破坏等高)', () => {
    // 要加回来的话,先读 notes.css 里那段注释:留白必须走 ::before/::after,
    // 直接给 .cm-line 加纵向 padding 会让 CodeMirror 的行高测量出偏差。
    expect(readSrc('modules/notes/NoteEditor.tsx')).not.toContain('Decoration.line')
  })

  it('编辑器用等宽字体,且中文有黑体回退(不能落到宋体)', () => {
    const src = readSrc('modules/notes/NoteEditor.tsx')
    expect(src).toContain('monospace')
    expect(src).toContain('Noto Sans SC')
  })
})

describe('CSS 契约:格子里的嵌套表格不能吃 width: 100%', () => {
  /*
   * 表格宽度 = 格子宽度,而格子宽度又由表格决定 —— 这是个解不开的环。
   * 浏览器只能按内容的「最大宽度」硬撑:一个 `| a | b |` 的小表会把格子顶到 1208px、
   * 外层表涨到 2541px(预览才 754px),角柄被推到屏幕外,看着像「表格特别宽而且没法调」。
   * 用户报过这一条。
   */
  it('单元格里的表格按内容收缩,不继承外层的整表宽度', () => {
    const css = stripComments(read('app-chrome.css'))
    const rule = css.match(/\.md-cell-body \.md-table-wrap \.md-table \{([^}]*)\}/)
    expect(rule).not.toBeNull()
    expect(rule![1]).toMatch(/width:\s*auto/)
  })

  it('外层是固定布局(cols=)时,嵌套表**跟着格子走**', () => {
    const css = stripComments(read('app-chrome.css'))
    expect(css).toMatch(/\.md-table\.md-table-fixed \.md-cell-body \.md-table \{[^}]*width:\s*100%/)
  })

  it('--md-table-w 必须在格子里掐断(它是会继承的)', () => {
    const css = stripComments(read('app-chrome.css'))
    expect(css).toMatch(/\.md-cell-body \{[^}]*--md-table-w:\s*initial/)
  })

  it('格子里那张表**自己**带了围栏宽度时,仍然听它的(留了出路)', () => {
    const css = stripComments(read('app-chrome.css'))
    expect(css).toMatch(/\.md-cell-body \.md-table-scope \.md-table-wrap \.md-table \{[^}]*var\(--md-table-w/)
  })
})

describe('CSS 契约:滚动同步的两端都还在', () => {
  it('预览侧产出 data-line', () => {
    // 联动滚动全靠它把「预览里的第几块」映射回「编辑器里的第几行」。
    // 谁把 lineAnchors 那条路删了,这里会先红,而不是等用户发现两边不同步。
    const src = readSrc('lib/markdown.tsx')
    expect(src).toContain('data-line={')
    expect(src).toContain('lineAnchors')
  })

  it('编辑器侧提供 topLine / scrollToLine / scrollMetrics', () => {
    const src = readSrc('modules/notes/NoteEditor.tsx')
    for (const m of ['topLine', 'scrollToLine', 'scrollMetrics']) expect(src).toContain(m)
  })

  it('预览侧收集锚点', () => {
    expect(readSrc('lib/scroll-sync.ts')).toContain('data-line')
  })
})
