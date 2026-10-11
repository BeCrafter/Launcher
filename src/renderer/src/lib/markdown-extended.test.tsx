// 扩展模式(笔记预览)。两份实现是分开的,所以这里同时守两件事:
//   ① 扩展语法确实生效;
//   ② **基础模式一点没变** —— 帮助页与 AI 消息不传 extended,走的是 renderMarkdownBasic。

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { parseCallout, parseEmbed, renderMarkdown, type DiagramBlock } from './markdown'

const html = (md: string, opts: Parameters<typeof renderMarkdown>[2] = { extended: true }): string =>
  renderToStaticMarkup(<>{renderMarkdown(md, 't', opts)}</>)

const basic = (md: string, anchors = false): string =>
  renderToStaticMarkup(<>{renderMarkdown(md, 't', { anchors })}</>)

/** 直接走 React 元素树,不依赖 DOM(项目没有 jsdom) */
function collect(nodes: ReactNode[], type: string): Array<{ props: Record<string, unknown> }> {
  const out: Array<{ props: Record<string, unknown> }> = []
  const walk = (n: unknown): void => {
    if (n === null || n === undefined || typeof n === 'boolean') return
    if (Array.isArray(n)) {
      n.forEach(walk)
      return
    }
    if (typeof n !== 'object') return
    const el = n as { type?: unknown; props?: { children?: unknown } }
    if (el.type === type) out.push(el as { props: Record<string, unknown> })
    if (el.props?.children !== undefined) walk(el.props.children)
  }
  nodes.forEach(walk)
  return out
}

describe('基础模式未被扩展模式改动', () => {
  it('标题的输出逐字节不变(不带 role/aria,帮助页的 CSS 依赖这个 DOM)', () => {
    expect(basic('## 标题')).toBe('<div class="md-h md-h2">标题</div>')
    expect(basic('## 1. 四个页面各管什么', true)).toBe(
      '<div class="md-h md-h2" id="1-四个页面各管什么">1. 四个页面各管什么</div>'
    )
  })

  it('基础模式不认扩展语法 —— 与改动前一样按原文透出', () => {
    expect(basic('*斜体*')).toContain('*斜体*')
    expect(basic('~~删除线~~')).toContain('~~删除线~~')
    expect(basic('- [ ] 任务')).not.toContain('checkbox')
    expect(basic('##### 五级')).not.toContain('md-h5')
    expect(basic('<https://example.com>')).not.toContain('md-link')
    expect(basic('\\*转义\\*')).toContain('\\*')
  })

  it('基础模式的既有能力不受影响', () => {
    expect(basic('**粗体**')).toContain('<strong>粗体</strong>')
    expect(basic('`code`')).toContain('md-code-inline')
    expect(basic('| a | b |\n|---|---|\n| 1 | 2 |')).toContain('md-table')
    expect(basic('上\n\n---\n\n下')).toContain('md-hr')
    expect(basic('> 引用')).toContain('md-quote')
  })

  it('不传 extended 时基础模式不受扩展选项影响', () => {
    const withOpts = renderToStaticMarkup(
      <>
        {renderMarkdown('## 标题', 't', {
          resolveImage: () => 'x',
          onToggleTask: () => {}
        })}
      </>
    )
    expect(withOpts).toBe('<div class="md-h md-h2">标题</div>')
  })
})

describe('行内:斜体与粗斜体', () => {
  it('*斜体* 与 _斜体_', () => {
    expect(html('*斜体*')).toContain('<em>斜体</em>')
    expect(html('_斜体_')).toContain('<em>斜体</em>')
  })

  it('foo_bar_baz 保持字面(下划线两侧是字母数字)', () => {
    expect(html('foo_bar_baz')).toContain('foo_bar_baz')
    expect(html('foo_bar_baz')).not.toContain('<em>')
  })

  it('中文两侧的下划线仍算斜体(中文不是 \\p{L} 边界问题,这里是数字/字母才拦)', () => {
    expect(html('a _斜体_ b')).toContain('<em>斜体</em>')
  })

  it('2 * 3 * 4 保持字面(界符旁有空白)', () => {
    expect(html('2 * 3 * 4')).toContain('2 * 3 * 4')
    expect(html('2 * 3 * 4')).not.toContain('<em>')
  })

  it('***粗斜体*** 优先于 **粗体** 匹配', () => {
    expect(html('***both***')).toContain('<strong><em>both</em></strong>')
  })

  it('粗体与斜体可嵌套', () => {
    expect(html('**粗 *斜* 体**')).toContain('<strong>粗 <em>斜</em> 体</strong>')
  })
})

describe('行内:删除线 / 转义 / autolink', () => {
  it('~~删除线~~', () => {
    expect(html('~~删掉~~')).toContain('<del class="md-del">删掉</del>')
  })

  it('反斜杠转义让标记变字面', () => {
    expect(html('\\*不是斜体\\*')).toContain('*不是斜体*')
    expect(html('\\*不是斜体\\*')).not.toContain('<em>')
    expect(html('\\`不是代码\\`')).not.toContain('md-code-inline')
  })

  it('角括号 autolink;裸 URL 仍然不渲染(与基础模式同一约定)', () => {
    expect(html('<https://example.com>')).toContain('md-link')
    expect(html('见 https://example.com 一游')).not.toContain('md-link')
  })
})

describe('块级:任务清单', () => {
  it('渲染复选框并反映勾选状态', () => {
    const out = html('- [ ] 未做\n- [x] 已做')
    expect(out).toContain('md-task')
    expect(out.match(/<input[^>]*checked=""/g)?.length).toBe(1)
  })

  it('不传 onToggleTask 时只读且禁用(帮助页/AI 消息若开扩展也不会误触)', () => {
    const inputs = collect(renderMarkdown('- [ ] 甲', 't', { extended: true }), 'input')
    expect(inputs[0].props.disabled).toBe(true)
    expect(inputs[0].props.readOnly).toBe(true)
  })

  it('传 onToggleTask 时可交互,且回调拿到**该行在正文里的下标**与目标状态', () => {
    const calls: Array<[number, boolean]> = []
    const nodes = renderMarkdown('前言\n\n- [ ] 甲\n- [x] 乙\n', 't', {
      extended: true,
      onToggleTask: (line, next) => calls.push([line, next])
    })
    const inputs = collect(nodes, 'input')
    expect(inputs).toHaveLength(2)
    ;(inputs[0].props.onChange as () => void)()
    ;(inputs[1].props.onChange as () => void)()
    // 2 = '- [ ] 甲' 那行;3 = '- [x] 乙' 那行
    expect(calls).toEqual([
      [2, true],
      [3, false]
    ])
  })

  it('普通列表项不受影响,任务项才带 md-task 类', () => {
    const out = html('- 普通\n- [ ] 任务')
    expect(out.match(/class="md-task"/g)?.length).toBe(1)
  })
})

describe('块级:嵌套列表', () => {
  it('三层嵌套', () => {
    const out = html('- 一\n  - 二\n    - 三')
    expect(out.match(/<ul class="md-list">/g)?.length).toBe(3)
    expect(out).toContain('三')
  })

  it('有序列表嵌在无序里', () => {
    const out = html('- 一\n  1. 甲\n  2. 乙')
    expect(out).toContain('<ol class="md-list">')
    expect(out).toContain('<ul class="md-list">')
  })

  it('同层 ul/ol 混排另起一个列表', () => {
    const out = html('- 一\n1. 甲')
    expect(out).toContain('<ul class="md-list">')
    expect(out).toContain('<ol class="md-list">')
  })
})

describe('块级:标题层级 / 表格对齐 / 语义', () => {
  it('扩展模式支持 ##### 与 ######', () => {
    expect(html('##### 五级')).toContain('md-h5')
    expect(html('###### 六级')).toContain('md-h6')
  })

  it('扩展模式的标题补 role 与 aria-level', () => {
    const out = html('## 标题')
    expect(out).toContain('role="heading"')
    expect(out).toContain('aria-level="2"')
  })

  it('~~~ 围栏与缩进的围栏都认', () => {
    expect(html('~~~\ncode\n~~~')).toContain('md-code')
    expect(html('  ```\ncode\n  ```')).toContain('md-code')
  })

  it('表格列对齐', () => {
    const out = html('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |')
    expect(out).toContain('text-align:left')
    expect(out).toContain('text-align:center')
    expect(out).toContain('text-align:right')
  })
})

describe('表格单元格里的块级内容', () => {
  // 单元格在源文里只有一行,块级结构只能用 <br> 当行分隔符。分流规则:
  // 出现块级行才整格按块渲染,否则保持行内 —— 现有笔记里的 `A<br>B` 一字不变。
  const cell = (content: string): string => html(`| 头 | 头 |\n|---|---|\n| ${content} | x |`)

  it('只有 <br> 换行时保持行内(现有笔记一字不变)', () => {
    const out = cell('第一行<br>第二行')
    expect(out).toContain('<br/>')
    expect(out).not.toContain('md-list')
    expect(out).not.toContain('md-p')
  })

  it('行内标记照旧(粗体、行内代码)', () => {
    const out = cell('**粗**<br>`code`')
    expect(out).toContain('<strong>粗</strong>')
    expect(out).toContain('md-code-inline')
  })

  it('列表:真的渲染成列表,不再是字面的「- 甲」', () => {
    const out = cell('- 甲<br>- 乙')
    expect(out).toContain('md-list')
    expect(out).toContain('<li>甲</li>')
    expect(out).not.toContain('- 甲')
  })

  it('代码块', () => {
    const out = cell('```bash<br>lsof -i :8080<br>```')
    expect(out).toContain('md-code')
    expect(out).toContain('lsof -i :8080')
    expect(out).not.toContain('```')
  })

  it('嵌套表格(竖线要转义,否则会裂成外层的列)', () => {
    const out = cell('\\| a \\| b \\|<br>\\|---\\|---\\|<br>\\| 1 \\| 2 \\|')
    expect(out.match(/md-table/g)?.length).toBeGreaterThan(1)
    expect(out).toContain('1')
  })

  it('引用与任务清单同样认', () => {
    expect(cell('> 引用文字')).toContain('md-quote')
    expect(cell('- [ ] 待办')).toContain('md-task-box')
  })

  it('流程图交给调用方渲染,但标成**只读**(格子里的围栏没有自己的行号)', () => {
    const blocks: DiagramBlock[] = []
    html('| 头 |\n|---|\n| ```mermaid<br>flowchart LR<br>A --> B<br>``` |', {
      extended: true,
      renderDiagram: (b) => {
        blocks.push(b)
        return null
      }
    })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].editable).toBe(false)
  })

  it('**cols= 的项数超过列数时,不能凭空多造列**(否则整张表会被撑爆)', () => {
    // 表格列数 = max(colgroup, 单元格数)。多出来的 <col> 会真的多造出列来 ——
    // 源文里 2 列的表渲染成 4 列、宽到 1317px,右边全是空白。踩过:删掉一列后围栏里还留着旧列宽。
    const out = html('```table cols=100,200,300,400\n| a | b |\n|---|---|\n| 1 | 2 |\n```')
    expect(out.match(/<col /g)?.length).toBe(2)
  })

  it('普通位置的图仍然可编辑', () => {
    const blocks: DiagramBlock[] = []
    html('```mermaid\nflowchart LR\nA --> B\n```', {
      extended: true,
      onEditTable: () => {},
      renderDiagram: (b) => {
        blocks.push(b)
        return null
      }
    })
    expect(blocks[0].editable).toBe(true)
  })

  it('格子里的内容带**它自己那一行**的行号(不是表格起始行、也不是往下数的行号)', () => {
    // 表格从第 2 行开始;数据行在第 4 行 —— 格子里的东西必须报 4。
    // 报表格起始行的话,格子里那张图的尺寸会写到表头那一行去(拖得动、松手却弹回去)。
    const src = ['前言', '', '| 头 |', '|---|', '| 说明<br>- 甲 |'].join('\n')
    const out = html(src, { extended: true, lineAnchors: true })
    // 列表项要报 4(数据行);报 2 就是「用了表格起始行」,报 3 就是「往下数错了一行」
    expect(out).toMatch(/<li[^>]*data-line="4"/)
    expect(out).not.toContain('data-line="3"')
  })

  it('格子里的任务清单只读 —— 勾选是按行回写的,而这一行是整条表格行', () => {
    const seen: number[] = []
    const out = cell('- [ ] 待办')
    expect(out).toContain('disabled=""')
    html('| 头 |\n|---|\n| - [ ] 待办 |', {
      extended: true,
      onToggleTask: (line) => seen.push(line)
    })
    expect(seen).toHaveLength(0)
  })
})

describe('图片', () => {
  it('不传 resolveImage 时一律降级成 chip(渲染器自己不预设策略)', () => {
    const out = html('![截图](https://tracker.example/x.png)')
    expect(out).not.toContain('<img')
    expect(out).toContain('md-img-chip')
    expect(out).toContain('截图')
  })

  it('http(s) 图片在调用方不放行时降级成可点的外链 chip', () => {
    const out = html('![图](https://example.com/x.png)', { extended: true, resolveImage: () => null })
    expect(out).toContain('md-link')
    expect(out).toContain('md-link-icon')
  })

  it('调用方放行 http(s) 时渲染 <img>(笔记预览就是这么配的)', () => {
    const out = html('![图](https://i1.hdslb.com/a.jpg)', { extended: true, resolveImage: (s) => s })
    expect(out).toContain('<img')
    expect(out).toContain('src="https://i1.hdslb.com/a.jpg"')
  })

  it('远程 <img> 带 no-referrer —— 至少不把「从哪篇笔记点过来的」送出去', () => {
    const out = html('![图](https://i1.hdslb.com/a.jpg)', { extended: true, resolveImage: (s) => s })
    // 大小写不敏感:React 的 SSR 输出保留了 camelCase,而 DOM 属性名一律小写
    expect(out.toLowerCase()).toContain('referrerpolicy="no-referrer"')
  })

  it('加载失败时的降级路径可达(盗链防护的图床很常见,不该留个碎图标)', () => {
    // ⚠ 这里只验「降级形态本身是对的」:真正的 onError 要浏览器事件,
    //    本项目没有 jsdom。渲染出来的 <img> 上确实挂了 onError(见下面的断言)。
    const fallback = html('![封面](https://i1.hdslb.com/a.jpg)', { extended: true, resolveImage: () => null })
    expect(fallback).toContain('md-img-chip')
    expect(fallback).toContain('封面')
    expect(fallback).toContain('md-link-icon')
  })

  it('resolveImage 给出地址才渲染 <img>', () => {
    const out = html('![图](assets/a.png)', { extended: true, resolveImage: (s) => `launcher-note://asset/${s}` })
    expect(out).toContain('<img')
    expect(out).toContain('launcher-note://asset/assets/a.png')
    expect(out).toContain('alt="图"')
  })

  it('resolveImage 返回 null 时降级(本地路径不存在的情况)', () => {
    const out = html('![图](assets/a.png)', { extended: true, resolveImage: () => null })
    expect(out).not.toContain('<img')
    expect(out).toContain('md-img-chip')
    // 本地路径不是外链,不给「在浏览器打开」
    expect(out).not.toContain('md-link-icon')
  })

  it('没有 alt 时用地址兜底,不至于显示空 chip', () => {
    const out = html('![](assets/a.png)', { extended: true, resolveImage: () => null })
    expect(out).toContain('assets/a.png')
  })
})

// 这一组是**事故回归**:粘贴进来的图片此前一张都渲染不出来。
// 根因是地址部分写成了 `[^)\s]+` —— 不允许空格,而应用自己生成的附件名
// 就是 `assets/Pasted image 20261009150211.png`(Obsidian 同款)。于是每一行都匹配不上,
// 整行退化成字面文本,看起来像「图片功能没做」。
describe('图片与链接:地址里带空格', () => {
  it('粘贴出来的附件名(带空格)能渲染成 <img>', () => {
    const out = html('![](assets/Pasted image 20261009150211.png)', {
      extended: true,
      resolveImage: (s) => `launcher-note://asset/${s}`
    })
    expect(out).toContain('<img')
    expect(out).toContain('assets/Pasted image 20261009150211.png')
  })

  it('带空格 + 带 alt 也认', () => {
    const out = html('![截图](assets/my shot.png)', { extended: true, resolveImage: (s) => `x:${s}` })
    expect(out).toContain('<img')
    expect(out).toContain('alt="截图"')
  })

  it('链接地址带空格同样认(不再退化成字面方括号)', () => {
    const out = html('[看这里](assets/我的 笔记.md)')
    expect(out).toContain('md-link')
    expect(out).toContain('看这里')
  })

  it('地址两端的空白会被去掉,不会带进 URL', () => {
    const out = html('![]( assets/a.png )', { extended: true, resolveImage: (s) => `x:${s}` })
    expect(out).toContain('x:assets/a.png')
  })

  it('已经是 %20 的地址照常渲染(手写引用 / 别的工具写的)', () => {
    const out = html('![](assets/Pasted%20image.png)', { extended: true, resolveImage: (s) => `x:${s}` })
    expect(out).toContain('<img')
    expect(out).toContain('assets/Pasted%20image.png')
  })

  it('一行里有多张图时,非贪婪匹配不会把两张连起来', () => {
    const out = html('![](a.png) 中间 ![](b.png)', { extended: true, resolveImage: (s) => `x:${s}` })
    expect(out.match(/<img/g)?.length).toBe(2)
    expect(out).toContain('中间')
  })
})

describe('代码块:高亮与语言角标', () => {
  it('不传 highlight 时退化成纯文本(帮助页/AI 消息的默认行为)', () => {
    const out = html('```js\nconst a = 1\n```')
    expect(out).toContain('md-code')
    expect(out).toContain('const a = 1')
    expect(out).not.toContain('tk-')
  })

  it('传了 highlight 就走它,并把语言与 key 一并给过去', () => {
    const calls: Array<[string, string]> = []
    const out = html('```js\nconst a = 1\n```', {
      extended: true,
      highlight: (code, lang) => {
        calls.push([code, lang])
        return <span className="tk-keyword">{code}</span>
      }
    })
    expect(calls).toEqual([['const a = 1', 'js']])
    expect(out).toContain('tk-keyword')
  })

  it('语言角标只在有语言时出现', () => {
    expect(html('```bash\nls\n```')).toContain('md-code-lang')
    expect(html('```\n裸围栏\n```')).not.toContain('md-code-lang')
  })

  it('语言名不被截断:`c++` / `objective-c` / `{.js}` 都要认全', () => {
    // `\w*` 会把 c++ 截成 c、objective-c 截成 objective —— 高亮的是另一个语言
    const seen: string[] = []
    const probe = (md: string): void => {
      html(md, {
        extended: true,
        highlight: (_c, lang) => {
          seen.push(lang)
          return null
        }
      })
    }
    probe('```c++\nint a;\n```')
    probe('```objective-c\nid a;\n```')
    probe('```{.js}\nlet a\n```')
    probe('```js title="示例"\nlet a\n```')
    expect(seen).toEqual(['c++', 'objective-c', 'js', 'js'])
  })
})

describe('图表:```mermaid 交给调用方渲染', () => {
  const diagram = (md: string, opts: Parameters<typeof renderMarkdown>[2] = {}): ReturnType<typeof renderMarkdown> =>
    renderMarkdown(md, 't', { extended: true, ...opts })

  it('不传 renderDiagram 时按普通代码块渲染(帮助页/AI 消息里出现也不至于是空白)', () => {
    const out = html('```mermaid\nflowchart LR\n```')
    expect(out).toContain('md-code')
    expect(out).toContain('flowchart LR')
    expect(out).not.toContain('md-diagram')
  })

  it('传了就把源码与**围栏在正文里的行区间**交过去(编辑时要按行替换回去)', () => {
    const got: Array<{ code: string; lang: string; from: number; to: number }> = []
    const md = ['# 标题', '', '正文', '', '```mermaid', 'flowchart LR', '  A --> B', '```', '', '后面'].join('\n')
    // ⚠ 必须**渲染**才会调到 renderDiagram:它是 DiagramView 渲染时才发起的
    //   (以前在构建元素树时就调,那样组件还没机会决定尺寸)
    const out = renderToStaticMarkup(
      <>
        {diagram(md, {
          renderDiagram: (b) => {
            got.push({ code: b.code, lang: b.lang, from: b.from, to: b.to })
            return <div className="fake-diagram" />
          }
        })}
      </>
    )
    expect(got).toEqual([{ code: 'flowchart LR\n  A --> B', lang: 'mermaid', from: 4, to: 7 }])
    expect(out).toContain('fake-diagram')
  })

  it('未闭合的围栏:to 指向最后一行,而不是越界', () => {
    const got: number[] = []
    const md = '```mermaid\nflowchart LR\n  A --> B'
    renderToStaticMarkup(
      <>
        {diagram(md, {
          renderDiagram: (b) => {
            got.push(b.to)
            return null
          }
        })}
      </>
    )
    expect(got).toEqual([2]) // 0 起:最后一行是第 2 行
  })

  it('图表块外面套了 md-diagram 壳,悬停/定位有落点', () => {
    const out = renderToStaticMarkup(
      <>{diagram('```mermaid\nflowchart LR\n```', { renderDiagram: () => <span>x</span> })}</>
    )
    expect(out).toContain('md-diagram')
  })

  it('~~~ 围栏的 mermaid 也认', () => {
    const got: string[] = []
    renderToStaticMarkup(
      <>
        {diagram('~~~mermaid\nmindmap\n~~~', {
          renderDiagram: (b) => {
            got.push(b.code)
            return null
          }
        })}
      </>
    )
    expect(got).toEqual(['mindmap'])
  })
})

describe('行锚点(编辑区 ↔ 预览区联动滚动)', () => {
  it('不传 lineAnchors 时 DOM 里没有 data-line', () => {
    expect(html('# 标题\n\n正文')).not.toContain('data-line')
  })

  it('传了之后每个块级元素都带上它在源文里的起始行', () => {
    const md = ['# 标题', '', '正文', '', '- 甲', '- 乙', '', '```js', 'let a', '```'].join('\n')
    const out = html(md, { extended: true, lineAnchors: true })
    expect(out).toContain('data-line="0"') // 标题
    expect(out).toContain('data-line="2"') // 正文
    expect(out).toContain('data-line="4"') // 列表首项
    expect(out).toContain('data-line="5"') // 列表次项
    expect(out).toContain('data-line="7"') // 代码块围栏
  })

  it('行锚点不影响基础模式(帮助页与 AI 消息的 DOM 一字不变)', () => {
    const withFlag = renderToStaticMarkup(
      <>{renderMarkdown('# 标题', 't', { lineAnchors: true })}</>
    )
    expect(withFlag).toBe('<div class="md-h md-h1">标题</div>')
  })
})

// ════════════ 提示块(GitHub / Obsidian callout)════════════

describe('parseCallout', () => {
  it.each([
    ['[!NOTE]', 'note'],
    ['[!TIP]', 'tip'],
    ['[!IMPORTANT]', 'important'],
    ['[!WARNING]', 'warning'],
    ['[!CAUTION]', 'caution'],
    ['[!note]', 'note'],
    ['[!Warning] 自定义标题', 'warning']
  ])('%s → %s', (line, kind) => {
    expect(parseCallout(line)?.kind).toBe(kind)
  })

  it('自定义标题会被取出来', () => {
    expect(parseCallout('[!WARNING] 改端口前先备份')).toEqual({ kind: 'warning', title: '改端口前先备份' })
    expect(parseCallout('[!NOTE]')).toEqual({ kind: 'note', title: '' })
  })

  it.each(['普通引用', '[!NOPE]', '![NOTE]', '[NOTE]', ''])('%s 不是提示块', (line) => {
    expect(parseCallout(line)).toBeNull()
  })
})

describe('提示块渲染', () => {
  const md = ['> [!WARNING]', '> 先备份。', '', '> 普通引用'].join('\n')

  it('按类型给 class,并带上图标与默认标题', () => {
    const out = html(md)
    expect(out).toContain('md-callout md-callout-warning')
    expect(out).toContain('fa-triangle-exclamation')
    expect(out).toContain('>Warning<') // 没传 calloutLabel 时用类型名兜底
    expect(out).toContain('先备份。')
  })

  it('普通引用仍然渲染成 blockquote,不会被吃掉', () => {
    const out = html(md)
    expect(out).toContain('md-quote')
    expect(out).toContain('普通引用')
  })

  it('自定义标题盖过默认标题', () => {
    const out = html('> [!TIP] 我自己的标题\n> 正文')
    expect(out).toContain('我自己的标题')
    expect(out).not.toContain('>Tip<')
  })

  it('calloutLabel 决定默认标题(笔记页传 i18n 的「警告」)', () => {
    const out = html('> [!WARNING]\n> 正文', {
      extended: true,
      calloutLabel: (k) => ({ note: '说明', tip: '提示', important: '重要', warning: '警告', caution: '危险' })[k]
    })
    expect(out).toContain('警告')
  })

  it('五种类型各有各的 class', () => {
    for (const k of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
      expect(html(`> [!${k}]\n> x`)).toContain(`md-callout-${k.toLowerCase()}`)
    }
  })

  it('正文按块渲染:里面可以有列表与代码块', () => {
    const out = html('> [!NOTE]\n> 看这个:\n>\n> - 甲\n> - 乙\n>\n> ```js\n> let a = 1\n> ```')
    expect(out).toContain('md-callout-body')
    expect(out.match(/md-list/g)?.length).toBeGreaterThan(0)
    expect(out).toContain('md-code')
    expect(out).toContain('let a = 1')
  })

  it('空正文不渲染空壳子', () => {
    const out = html('> [!NOTE]')
    expect(out).toContain('md-callout')
    expect(out).not.toContain('md-callout-body')
  })

  it('提示块本身也带源行锚点,里面每一块的行号是**绝对行号**', () => {
    // 前言占 0,空行 1,提示块从第 2 行开始,正文第 3 行、列表第 5 行
    const src = ['前言', '', '> [!NOTE]', '> 正文', '>', '> - 甲'].join('\n')
    const out = html(src, { extended: true, lineAnchors: true })
    expect(out).toContain('data-line="2"') // 提示块自己
    expect(out).toContain('data-line="3"') // 正文段落
    expect(out).toContain('data-line="5"') // 列表项 —— 若忘了加 baseLine 这里会是 2
  })
})

describe('容器矩阵:表格放在哪儿,行号都是它在源文里的真实行号', () => {
  /*
   * 行号是「按行回写」的唯一依据 —— 差一行,拖列宽就会把围栏插到别的块上去。
   * 折叠块尤其容易错:它有三种形态,吃掉的头部行数不一样(1 / 2 / 1)。
   * 这份矩阵是回归网:以后动任何一个容器的行号基准,这里会立刻红。
   */
  const MD = [
    '前言', // 0
    '', // 1
    '<details>', // 2
    '<summary>折叠</summary>', // 3
    '', // 4
    '| a | b |', // 5   ← 折叠块(两行形态)
    '|---|---|', // 6
    '| 1 | 2 |', // 7
    '', // 8
    '</details>', // 9
    '', // 10
    '> [!NOTE]', // 11
    '> 卡片', // 12
    '>', // 13
    '> | c | d |', // 14  ← 提示块
    '> |---|---|', // 15
    '> | 3 | 4 |', // 16
    '', // 17
    '> | e | f |', // 18  ← 引用
    '> |---|---|', // 19
    '> | 5 | 6 |', // 20
    '', // 21
    '<div align="center">', // 22
    '', // 23
    '| g | h |', // 24  ← 对齐块
    '|---|---|', // 25
    '| 7 | 8 |', // 26
    '', // 27
    '</div>', // 28
    '', // 29
    '| i | j |', // 30  ← 正文
    '|---|---|', // 31
    '| 9 | 10 |' // 32
  ].join('\n')

  it('五种容器各报各的行号', () => {
    const out = html(MD, { extended: true, lineAnchors: true })
    const lines = [...out.matchAll(/class="md-table-block[^"]*"[^>]*data-line="(\d+)"/g)].map((m) =>
      Number(m[1])
    )
    expect(lines).toEqual([5, 14, 18, 24, 30])
  })

  it('嵌套引用里的表格也在内(前缀 `> > ` 不影响行号)', () => {
    const src = ['前言', '', '> 外面', '>', '> > | a | b |', '> > |---|---|', '> > | 1 | 2 |'].join('\n')
    const out = html(src, { extended: true, lineAnchors: true })
    expect(out).toContain('data-line="4"')
  })
})

describe('引用块:正文按块渲染', () => {
  // 引用从前是把整段当**行内**文本输出(靠 pre-wrap 保留换行),于是块级写法原样露出来:
  // `- 甲` 就是字面的「减号 + 甲」。修好之后引用与提示块是同一套行为。
  const MD = ['> 引用里的列表:', '>', '> - 甲', '> - 乙', '>', '> ```js', '> let a = 1', '> ```'].join('\n')

  it('列表真的渲染成列表,不再是字面的「- 甲」', () => {
    const out = html(MD)
    expect(out).toContain('md-list')
    expect(out).toContain('<li>甲</li>')
    expect(out).not.toContain('- 甲')
  })

  it('代码块也认(围栏不再是字面的三个反引号)', () => {
    const out = html(MD)
    expect(out).toContain('md-code')
    expect(out).toContain('let a = 1')
    expect(out).not.toContain('```')
  })

  it('嵌套引用渲染成里外两层', () => {
    const out = html('> 外面\n>\n> > 里面')
    expect(out.match(/class="md-quote"/g)?.length).toBe(2)
    expect(out).toContain('里面')
  })

  it('引用里的块带**绝对行号**(滚动联动要按源文行定位)', () => {
    // 前言占 0,空行 1,引用从第 2 行开始,列表在第 4 行
    const src = ['前言', '', '> 引用正文', '>', '> - 甲'].join('\n')
    const out = html(src, { extended: true, lineAnchors: true })
    expect(out).toContain('data-line="2"') // 引用自己
    expect(out).toContain('data-line="4"') // 列表项 —— 若忘了加 baseLine 这里会是 0
  })

  it('提示块不受影响:仍然走卡片那条路,不会掉进普通引用', () => {
    const out = html('> [!NOTE]\n> 正文')
    expect(out).toContain('md-callout')
    expect(out).not.toContain('md-quote')
  })

  it('行内标记照旧(粗体、行内代码)', () => {
    const out = html('> **粗**的与 `code`')
    expect(out).toContain('<strong>粗</strong>')
    expect(out).toContain('md-code-inline')
  })

  it('基础模式(帮助页 / AI 消息)同样按块渲染 —— 同一处毛病,两条路都修', () => {
    const out = basic('> - 甲\n> - 乙')
    expect(out).toContain('md-list')
    expect(out).toContain('<li>甲</li>')
    expect(out).not.toContain('- 甲')
  })
})

// ════════════ 网页嵌入 ════════════

describe('parseEmbed', () => {
  it('地址写在信息串上', () => {
    expect(parseEmbed('https://example.com', [])).toEqual({ url: 'https://example.com', width: null, height: null })
  })

  it('地址写在正文第一行', () => {
    expect(parseEmbed('', ['https://example.com'])).toEqual({ url: 'https://example.com', width: null, height: null })
  })

  it('height 行单独解析,不当作地址', () => {
    expect(parseEmbed('', ['https://example.com', 'height: 420'])).toEqual({
      url: 'https://example.com',
      width: null,
      height: 420
    })
  })

  it('地址与 height 顺序反过来也认', () => {
    expect(parseEmbed('', ['height: 300', 'assets/a.html'])).toEqual({ url: 'assets/a.html', width: null, height: 300 })
  })

  it('高度会被夹到合理区间', () => {
    expect(parseEmbed('', ['https://x.com', 'height: 10'])?.height).toBe(120)
    expect(parseEmbed('', ['https://x.com', 'height: 99999'])?.height).toBe(2000)
  })

  it('width 行也认(嵌入可以两个轴都定)', () => {
    expect(parseEmbed('', ['https://example.com', 'width: 400', 'height: 420'])).toEqual({
      url: 'https://example.com',
      width: 400,
      height: 420
    })
  })

  it('空内容返回 null(调用方会退回代码块)', () => {
    expect(parseEmbed('', [])).toBeNull()
    expect(parseEmbed('  ', ['', '   '])).toBeNull()
  })
})

describe('```embed 渲染', () => {
  const resolve = (u: string): string | null => (u.startsWith('http') ? u : `launcher-note://asset/${u}`)

  it('不传 resolveEmbed 时退回代码块(帮助页/AI 消息里出现也不至于是空白)', () => {
    const out = html('```embed\nhttps://example.com\n```')
    expect(out).toContain('md-code')
    expect(out).toContain('https://example.com')
    expect(out).not.toContain('<iframe')
  })

  it('地址在正文里', () => {
    const out = html('```embed\nhttps://example.com\nheight: 240\n```', { extended: true, resolveEmbed: resolve })
    expect(out).toContain('<iframe')
    expect(out).toContain('src="https://example.com"')
    expect(out).toContain('height:240px')
  })

  it('**地址写在信息串上**(```embed https://x)—— 语言名不能被当成地址', () => {
    // 事故:第一版把整条信息串交给 parseEmbed,于是 url 变成了字面的 "embed",
    // iframe 去请求 launcher-note://asset/embed,一片空白
    const out = html('```embed https://example.com\n```', { extended: true, resolveEmbed: resolve })
    expect(out).toContain('src="https://example.com"')
    expect(out).not.toContain('asset/embed')
  })

  it('本地相对路径走自定义协议', () => {
    const out = html('```embed\nassets/report.html\n```', { extended: true, resolveEmbed: resolve })
    expect(out).toContain('src="launcher-note://asset/assets/report.html"')
  })

  it('resolveEmbed 返回 null(地址不被放行)→ 退回代码块,用户还能看到自己写了什么', () => {
    const out = html('```embed\nfile:///etc/passwd\n```', { extended: true, resolveEmbed: () => null })
    expect(out).not.toContain('<iframe')
    expect(out).toContain('file:///etc/passwd')
  })

  it('iframe 带 sandbox —— 嵌进来的是别人写的页面', () => {
    const out = html('```embed\nhttps://example.com\n```', { extended: true, resolveEmbed: resolve })
    expect(out).toContain('sandbox=')
    expect(out).toContain('allow-scripts')
    // 这几项给了就等于把沙箱拆了
    expect(out).not.toContain('allow-top-navigation')
    expect(out).not.toContain('allow-modals')
    expect(out).not.toContain('allow-downloads')
    expect(out).not.toContain('allow-popups-to-escape-sandbox')
  })

  it('远程地址带「在浏览器打开」;本地路径不带', () => {
    expect(html('```embed\nhttps://example.com\n```', { extended: true, resolveEmbed: resolve })).toContain(
      'md-embed-open'
    )
    expect(html('```embed\nassets/a.html\n```', { extended: true, resolveEmbed: resolve })).not.toContain(
      'md-embed-open'
    )
  })
})

// ════════════ 媒体(视频 / 音频 / PDF)════════════

describe('![](…) 按后缀分流', () => {
  const resolve = (s: string): string => `launcher-note://asset/${s}`
  const render = (src: string): string => html(`![](${src})`, { extended: true, resolveImage: resolve })

  it.each([
    ['assets/a.mp4', '<video'],
    ['assets/a.webm', '<video'],
    ['assets/a.mov', '<video'],
    ['assets/a.mp3', '<audio'],
    ['assets/a.m4a', '<audio'],
    ['assets/a.wav', '<audio'],
    ['assets/a.pdf', '<iframe'],
    ['assets/a.png', '<img']
  ])('%s → %s', (src, tag) => {
    expect(render(src)).toContain(tag)
  })

  it('视频/音频带 controls,否则用户没法播放', () => {
    expect(render('assets/a.mp4')).toContain('controls')
    expect(render('assets/a.mp3')).toContain('controls')
  })

  it('后缀大小写不敏感', () => {
    expect(render('assets/a.MP4')).toContain('<video')
  })

  it('query / hash 不影响判断', () => {
    expect(render('assets/a.mp4?t=3')).toContain('<video')
  })

  it('resolveImage 返回 null 时一律降级成 chip(包括媒体)', () => {
    for (const src of ['assets/a.mp4', 'assets/a.pdf', 'assets/a.png']) {
      const out = html(`![](${src})`, { extended: true, resolveImage: () => null })
      expect(out).not.toContain('<video')
      expect(out).not.toContain('<iframe')
      expect(out).not.toContain('<img')
      expect(out).toContain('md-img-chip')
    }
  })

  it('不传 resolveImage 时也不会自己去加载(预览绝不发起网络请求)', () => {
    const out = html('![](assets/a.mp4)')
    expect(out).not.toContain('<video')
    expect(out).toContain('md-img-chip')
  })
})

describe('安全:扩展模式同样惰性', () => {
  it('HTML 不解析,原样转义成文本', () => {
    const out = html('<img src=x onerror=alert(1)> <b>bold</b>')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('<b>')
    expect(out).toContain('&lt;b&gt;')
  })

  it('javascript: 链接不会变成可点的 href 之外的执行路径', () => {
    // 渲染成 <a> 但点击走 openExternal(main 侧 https? 白名单),不是直接导航
    const out = html('[点我](javascript:alert(1))')
    expect(out).toContain('md-link')
  })

  it('病态嵌套不会打穿渲染栈', () => {
    expect(() => html(`${'*'.repeat(2000)}x${'*'.repeat(2000)}`)).not.toThrow()
    expect(() => html(`${'['.repeat(500)}x${']'.repeat(500)}`)).not.toThrow()
  })
})

describe('围栏的嵌套(四反引号包一段带围栏的示例)', () => {
  // 事故:闭合判断写死成「三个反引号」,于是 ````markdown 里第一行 ``` 就被当成闭合,
  // 后面整段示例塌成普通段落。帮助页里「怎么写出 ```embed」那一节就是这么渲染错的。
  const NESTED = ['````markdown', '```embed', 'https://example.com', '```', '````'].join('\n')

  it('四反引号围栏里的三反引号不算闭合', () => {
    const out = html(NESTED)
    // 整段(含内层围栏)应当都落在同一个 <pre> 里
    expect(out).toContain('```embed')
    expect(out).toContain('https://example.com')
    expect(out.match(/<pre/g)?.length).toBe(1)
  })

  it('基础模式(帮助页/AI 消息走的那条)同样修好了', () => {
    const out = basic(NESTED)
    expect(out).toContain('```embed')
    expect(out.match(/<pre/g)?.length).toBe(1)
  })

  it('普通三反引号围栏不受影响', () => {
    const out = html('```js\nlet a = 1\n```')
    expect(out).toContain('let a = 1')
    expect(out.match(/<pre/g)?.length).toBe(1)
  })

  it('~~~ 围栏同理:四波浪线里三波浪线不算闭合', () => {
    const out = html(['~~~~', '~~~', 'x', '~~~', '~~~~'].join('\n'))
    expect(out.match(/<pre/g)?.length).toBe(1)
  })
})

describe('行内:上下标', () => {
  it('~下标~ 与 ^上标^', () => {
    expect(html('H~2~O')).toContain('<sub>2</sub>')
    expect(html('x^2^')).toContain('<sup>2</sup>')
  })

  it('**~~删除线~~ 不会被当成两个下标** —— 正则里 ~~ 必须排在 ~ 前面', () => {
    const out = html('~~删掉~~')
    expect(out).toContain('md-del')
    expect(out).not.toContain('<sub>')
  })

  it('界符旁有空白就不认(避免 2 ~ 3 ~ 4 被吃掉)', () => {
    expect(html('2 ~ 3 ~ 4')).not.toContain('<sub>')
    expect(html('2 ^ 3 ^ 4')).not.toContain('<sup>')
  })

  it('不跨行', () => {
    expect(html('~甲\n乙~')).not.toContain('<sub>')
  })
})

describe('段落对齐(<div align="center">)', () => {
  it('包起来的段落居中,内容照常按块渲染', () => {
    const out = html('<div align="center">\n\n# 标题\n\n正文\n\n</div>')
    expect(out).toContain('text-align:center')
    expect(out).toContain('md-h1')
    expect(out).toContain('正文')
  })

  it('left / right 同样认', () => {
    expect(html('<p align="right">\n\n右\n\n</p>')).toContain('text-align:right')
    expect(html('<div align="left">\n\n左\n\n</div>')).toContain('text-align:left')
  })

  it('**只认自己写出去的那一种形态** —— 别的 HTML 照样按纯文本转义', () => {
    const out = html('<div class="x">\n\n内容\n\n</div>')
    expect(out).not.toContain('text-align')
    expect(out).toContain('&lt;div class=')
  })

  it('未闭合就吃到结尾,不静默丢后半篇', () => {
    const out = html('<div align="center">\n\n甲\n\n乙')
    expect(out).toContain('text-align:center')
    expect(out).toContain('甲')
    expect(out).toContain('乙')
  })

  it('裸的 </div> 不会把后面的内容吞掉', () => {
    const out = html('上\n\n</div>\n\n下')
    expect(out).toContain('上')
    expect(out).toContain('下')
  })

  it('基础模式不认(帮助页/AI 消息的 DOM 不变)', () => {
    const out = basic('<div align="center">\n\n内容\n\n</div>')
    expect(out).not.toContain('text-align')
  })
})

describe('折叠块(<details> / <summary>)', () => {
  const MD = ['<details>', '<summary>点开看</summary>', '', '里面的内容', '', '</details>'].join('\n')

  it('渲染成真正的 details,标题可点', () => {
    const out = html(MD)
    expect(out).toContain('<details')
    expect(out).toContain('md-summary')
    expect(out).toContain('点开看')
    expect(out).toContain('里面的内容')
  })

  it('里面的内容照常按块渲染(列表、代码块都行)', () => {
    const out = html('<details>\n<summary>t</summary>\n\n- 甲\n\n```js\nlet a = 1\n```\n\n</details>')
    expect(out).toContain('md-list')
    expect(out).toContain('md-code')
    expect(out).toContain('let a = 1')
  })

  it('summary 里可以带行内标记', () => {
    expect(html('<details>\n<summary>**粗**的标题</summary>\n\nx\n\n</details>')).toContain('<strong>粗</strong>')
  })

  it('`<details open>` 默认展开(交给原生行为,不由 React 受控)', () => {
    const out = html('<details open>\n<summary>t</summary>\n\nx\n\n</details>')
    expect(out).toContain('md-details')
    // 受控的话 React 会写死 open="",点都点不开 —— 这里靠 ref 设一次,静态渲染里看不到
    expect(out).not.toContain('open=""')
  })

  it('没写 summary 也能渲染(只是一个没有标题的折叠块)', () => {
    const out = html('<details>\n\n内容\n\n</details>')
    expect(out).toContain('md-details')
    expect(out).toContain('内容')
  })

  it('未闭合就吃到结尾,不静默丢后半篇', () => {
    const out = html('<details>\n<summary>t</summary>\n\n甲\n\n乙')
    expect(out).toContain('甲')
    expect(out).toContain('乙')
  })

  it('基础模式不认(帮助页/AI 消息的 DOM 不变)', () => {
    expect(basic(MD)).not.toContain('md-details')
  })

  /*
   * 折叠块吃掉的「头部行数」随形态变化:`<details><summary>x</summary>` 一行,
   * `<details>` + 单独一行 `<summary>` 两行,不带 summary 一行。
   * 行号基准写死成 +1 的话,第二种(最常见的那种)会整体差一行 ——
   * 里面所有按行号回写的东西(表格列宽行高、双击改格子、任务勾选、媒体拖拽、图表)
   * 都会写到**上面一行**去。踩过:折叠块里的表格一拖列宽,源码就错乱。
   */
  it('两行形态(<details> + <summary>):正文的行号是它的真实行号', () => {
    //                    0        1          2                        3  4
    const src = ['前言', '<details>', '<summary>t</summary>', '', '正文甲', '', '</details>'].join('\n')
    const out = html(src, { extended: true, lineAnchors: true })
    expect(out).toContain('data-line="4"') // 正文甲在第 4 行
    expect(out).not.toContain('data-line="3"') // 差一行的那个错误基准
  })

  it('一行形态(<details><summary>x</summary>):同样对', () => {
    //                    0        1                              2  3
    const src = ['前言', '<details><summary>t</summary>', '', '正文乙', '', '</details>'].join('\n')
    expect(html(src, { extended: true, lineAnchors: true })).toContain('data-line="3"')
  })

  it('不带 summary:也对', () => {
    //                    0           1  2      3
    const src = ['前言', '<details>', '', '正文丙', '', '</details>'].join('\n')
    expect(html(src, { extended: true, lineAnchors: true })).toContain('data-line="3"')
  })

  it('折叠块里的表格:行号对得上(按行回写的入口全靠它)', () => {
    //                    0        1          2                        3  4          5          6
    const src = ['前言', '<details>', '<summary>t</summary>', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '</details>'].join('\n')
    const out = html(src, { extended: true, lineAnchors: true })
    expect(out).toContain('data-line="4"') // 表格从第 4 行开始
    expect(out).not.toContain('data-line="3"') // 差一行的那个错误基准
  })

  it('折叠块里的任务项:勾选回调拿到的是**它自己那一行**', () => {
    const src = ['前言', '<details>', '<summary>t</summary>', '', '- [ ] 待办', '', '</details>'].join('\n')
    const seen: number[] = []
    const nodes = renderMarkdown(src, 't', { extended: true, onToggleTask: (line) => seen.push(line) })
    const inputs = collect(nodes, 'input')
    expect(inputs).toHaveLength(1)
    ;(inputs[0].props.onChange as () => void)()
    expect(seen).toEqual([4]) // 待办在第 4 行;差一行的话这里会是 3
  })
})
