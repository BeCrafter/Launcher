import { describe, expect, it } from 'vitest'
import {
  MEDIA_MAX,
  MEDIA_MIN,
  clampMediaSize,
  joinMediaSize,
  mediaStyle,
  setEmbedSizeInBody,
  setFenceWidthInBody,
  setMediaSizeInBody,
  splitMediaSize
} from './note-media-size'

describe('splitMediaSize(Obsidian 的 `![alt|宽](url)`)', () => {
  it('只定宽', () => {
    expect(splitMediaSize('封面|300')).toEqual({ alt: '封面', width: 300, height: null })
  })

  it('宽高都定', () => {
    expect(splitMediaSize('封面|300x200')).toEqual({ alt: '封面', width: 300, height: 200 })
  })

  it('只定高(PDF 用)', () => {
    expect(splitMediaSize('|x400')).toEqual({ alt: '', width: null, height: 400 })
  })

  it('没有尺寸时原样返回', () => {
    expect(splitMediaSize('封面')).toEqual({ alt: '封面', width: null, height: null })
    expect(splitMediaSize('')).toEqual({ alt: '', width: null, height: null })
  })

  it('alt 里本身带竖线时,取**最后**一段数字', () => {
    expect(splitMediaSize('a|b|300')).toEqual({ alt: 'a|b', width: 300, height: null })
  })

  it('竖线后面不是数字就当普通 alt(不能误吞)', () => {
    expect(splitMediaSize('封面|大图')).toEqual({ alt: '封面|大图', width: null, height: null })
    expect(splitMediaSize('封面|300px')).toEqual({ alt: '封面|300px', width: null, height: null })
  })

  it('超出范围的尺寸会被夹住', () => {
    expect(splitMediaSize('|10').width).toBe(MEDIA_MIN)
    expect(splitMediaSize('|999999').width).toBe(MEDIA_MAX)
  })

  it('`|x` 后面没数字不算尺寸', () => {
    expect(splitMediaSize('|x')).toEqual({ alt: '|x', width: null, height: null })
  })
})

describe('joinMediaSize', () => {
  it('三种形态往返一致', () => {
    for (const alt of ['封面|300', '封面|300x200', '|x400', '封面']) {
      const parsed = splitMediaSize(alt)
      expect(joinMediaSize(parsed.alt, parsed)).toBe(alt)
    }
  })

  it('宽高都为 null 时把尺寸摘掉', () => {
    expect(joinMediaSize('封面', { width: null, height: null })).toBe('封面')
  })
})

describe('clampMediaSize', () => {
  it('夹到上下限并取整', () => {
    expect(clampMediaSize(0)).toBe(MEDIA_MIN)
    expect(clampMediaSize(1e9)).toBe(MEDIA_MAX)
    expect(clampMediaSize(300.6)).toBe(301)
  })

  it('NaN / Infinity 退回下限,不产出 `NaNpx`', () => {
    expect(clampMediaSize(Number.NaN)).toBe(MEDIA_MIN)
    expect(clampMediaSize(Number.POSITIVE_INFINITY)).toBe(MEDIA_MAX)
  })
})

describe('mediaStyle', () => {
  it('只给定了哪个就写哪个 —— 另一个交给 CSS 的 auto,不能写成 0', () => {
    expect(mediaStyle({ width: 300, height: null })).toEqual({ width: '300px', maxWidth: 'none' })
    expect(mediaStyle({ width: null, height: 400 })).toEqual({ height: '400px' })
    expect(mediaStyle({ width: 300, height: 200 })).toEqual({ width: '300px', maxWidth: 'none', height: '200px' })
  })

  it('**定了宽就必须解除 max-width** —— 否则预览那条 max-width:100% 会把图卡在栏宽上,拖了没反应', () => {
    expect(mediaStyle({ width: 463, height: null })?.maxWidth).toBe('none')
    // 只定高(如 PDF)不解除:它的宽度本来就该跟着栏宽走
    expect(mediaStyle({ width: null, height: 400 })?.maxWidth).toBeUndefined()
  })

  it('没有尺寸时返回 undefined(不产出空 style)', () => {
    expect(mediaStyle({ width: null, height: null })).toBeUndefined()
  })
})

describe('setMediaSizeInBody', () => {
  const SRC = 'assets/a.png'

  it('给没有尺寸的图加上宽', () => {
    const body = `前言\n\n![](${SRC})\n\n后记`
    expect(setMediaSizeInBody(body, { line: 2, src: SRC }, { width: 300, height: null })).toBe(
      `前言\n\n![|300](${SRC})\n\n后记`
    )
  })

  it('已有的尺寸会被替换,而不是叠加', () => {
    const body = `![封面|300](${SRC})`
    expect(setMediaSizeInBody(body, { line: 0, src: SRC }, { width: 450, height: null })).toBe(
      `![封面|450](${SRC})`
    )
  })

  it('去掉尺寸(拖回原始大小)', () => {
    const body = `![封面|300](${SRC})`
    expect(setMediaSizeInBody(body, { line: 0, src: SRC }, { width: null, height: null })).toBe(
      `![封面](${SRC})`
    )
  })

  it('PDF 的只定高', () => {
    const body = `![](assets/a.pdf)`
    expect(setMediaSizeInBody(body, { line: 0, src: 'assets/a.pdf' }, { width: null, height: 500 })).toBe(
      `![|x500](assets/a.pdf)`
    )
  })

  it('**只动那一行**,别的行逐字节不变', () => {
    const body = ['# 标题', '', `![](${SRC})`, '', '| a | b |', '|---|---|'].join('\n')
    const out = setMediaSizeInBody(body, { line: 2, src: SRC }, { width: 300, height: null })!
    expect(out.split('\n').filter((_, i) => i !== 2)).toEqual(body.split('\n').filter((_, i) => i !== 2))
  })

  it('同一行有多张图时按位置各改各的', () => {
    const body = `![](a.png) 中间 ![](b.png)`
    expect(setMediaSizeInBody(body, { line: 0, src: 'a.png' }, { width: 100, height: null })).toBe(
      `![|100](a.png) 中间 ![](b.png)`
    )
    expect(setMediaSizeInBody(body, { line: 0, src: 'b.png' }, { width: 200, height: null })).toBe(
      `![](a.png) 中间 ![|200](b.png)`
    )
  })

  it('同地址出现多次时,行号说了算', () => {
    const body = [`![](${SRC})`, '', `![](${SRC})`].join('\n')
    expect(setMediaSizeInBody(body, { line: 2, src: SRC }, { width: 300, height: null })).toBe(
      [`![](${SRC})`, '', `![|300](${SRC})`].join('\n')
    )
  })

  it('地址里有正则元字符也不会炸(它来自用户正文)', () => {
    const weird = 'assets/a+b (1).png'
    const body = `![](${weird})`
    expect(setMediaSizeInBody(body, { line: 0, src: weird }, { width: 300, height: null })).toBe(
      `![|300](${weird})`
    )
  })

  it('地址里带空格与中文照样找得到', () => {
    const cn = 'assets/Pasted image 20261009150211.png'
    expect(setMediaSizeInBody(`![](${cn})`, { line: 0, src: cn }, { width: 200, height: null })).toBe(
      `![|200](${cn})`
    )
  })

  it('找不到那张图 → null(调用方提示,不猜一个改上去)', () => {
    expect(setMediaSizeInBody('![](other.png)', { line: 0, src: SRC }, { width: 300, height: null })).toBeNull()
  })

  it('同地址多张、行号又对不上 → null(宁可不动)', () => {
    const body = [`![](${SRC})`, `![](${SRC})`].join('\n')
    expect(setMediaSizeInBody(body, { line: 7, src: SRC }, { width: 300, height: null })).toBeNull()
  })

  it('提示块里也能改(行号是源文的绝对行号)', () => {
    const body = ['> [!NOTE]', `> ![](${SRC})`, '> 正文'].join('\n')
    expect(setMediaSizeInBody(body, { line: 1, src: SRC }, { width: 300, height: null })).toBe(
      ['> [!NOTE]', `> ![|300](${SRC})`, '> 正文'].join('\n')
    )
  })

  it('`![]( x.png )` 这种带空白的写法也能改,且不会把空白吃掉', () => {
    const body = `![]( ${SRC} )`
    expect(setMediaSizeInBody(body, { line: 0, src: SRC }, { width: 300, height: null })).toBe(`![|300](${SRC})`)
  })
})

describe('setEmbedSizeInBody(网页嵌入的高度回写)', () => {
  const BODY = ['前言', '', '```embed', 'https://example.com', '```', '', '后记']

  it('没有 height 行时补一行,插在闭合围栏之前', () => {
    expect(setEmbedSizeInBody(BODY.join('\n'), { from: 2, to: 4 }, { width: null, height: 420 })).toBe(
      ['前言', '', '```embed', 'https://example.com', 'height: 420', '```', '', '后记'].join('\n')
    )
  })

  it('已有的 height 行会被改写,而不是叠加', () => {
    const body = ['```embed', 'https://example.com', 'height: 200', '```'].join('\n')
    expect(setEmbedSizeInBody(body, { from: 0, to: 3 }, { width: null, height: 500 })).toBe(
      ['```embed', 'https://example.com', 'height: 500', '```'].join('\n')
    )
  })

  it('**只动围栏内部**,前后文逐字节不变', () => {
    const out = setEmbedSizeInBody(BODY.join('\n'), { from: 2, to: 4 }, { width: null, height: 300 })!
    const lines = out.split('\n')
    expect(lines.slice(0, 2)).toEqual(BODY.slice(0, 2)) // 围栏之前
    // 围栏之后(闭合行 + 空行 + 后记):多插了一行,所以从 5 开始对
    expect(lines.slice(-3)).toEqual(BODY.slice(-3))
  })

  it('高度会被夹到**嵌入自己的**区间(不是图片那套 40–2400)', () => {
    // 两处必须同一组数:解析时夹一次、写回时再夹一次,否则会「拖到 40、渲染成 120」
    expect(setEmbedSizeInBody(BODY.join('\n'), { from: 2, to: 4 }, { width: null, height: 5 })).toContain('height: 120')
    expect(setEmbedSizeInBody(BODY.join('\n'), { from: 2, to: 4 }, { width: null, height: 1e9 })).toContain('height: 2000')
  })

  it('区间越界 / 起点不是围栏 → null(不猜)', () => {
    expect(setEmbedSizeInBody(BODY.join('\n'), { from: 2, to: 99 }, { width: null, height: 300 })).toBeNull()
    expect(setEmbedSizeInBody(BODY.join('\n'), { from: 1, to: 4 }, { width: null, height: 300 })).toBeNull()
    expect(setEmbedSizeInBody(BODY.join('\n'), { from: 4, to: 2 }, { width: null, height: 300 })).toBeNull()
  })

  it('~~~ 围栏也认', () => {
    const body = ['~~~embed', 'https://x.com', '~~~'].join('\n')
    expect(setEmbedSizeInBody(body, { from: 0, to: 2 }, { width: null, height: 300 })).toBe(
      ['~~~embed', 'https://x.com', 'height: 300', '~~~'].join('\n')
    )
  })
})

describe('setFenceWidthInBody(图表的宽度写进围栏信息串)', () => {
  const BODY = ['前言', '```mermaid', 'flowchart LR', '```', '后记'].join('\n')

  it('没写 width 时补上,语言名保留', () => {
    expect(setFenceWidthInBody(BODY, 1, 600)!.split('\n')[1]).toBe('```mermaid width=600')
  })

  it('已有的 width 替换而不是叠加', () => {
    const body = ['```mermaid width=300', 'flowchart LR', '```'].join('\n')
    expect(setFenceWidthInBody(body, 0, 500)!.split('\n')[0]).toBe('```mermaid width=500')
  })

  it('其它选项原样保留(它们不是我们写的)', () => {
    const body = ['```mermaid theme=dark', 'x', '```'].join('\n')
    expect(setFenceWidthInBody(body, 0, 400)!.split('\n')[0]).toBe('```mermaid theme=dark width=400')
  })

  it('**只动信息串那一行**,图源码逐字节不变', () => {
    const out = setFenceWidthInBody(BODY, 1, 600)!
    expect(out.split('\n').slice(2)).toEqual(BODY.split('\n').slice(2))
  })

  it('宽度夹到合理区间', () => {
    expect(setFenceWidthInBody(BODY, 1, 5)!).toContain('width=40')
    expect(setFenceWidthInBody(BODY, 1, 1e9)!).toContain('width=2400')
  })

  it('那一行不是围栏 → null', () => {
    expect(setFenceWidthInBody(BODY, 0, 600)).toBeNull()
    expect(setFenceWidthInBody(BODY, 99, 600)).toBeNull()
  })
})

describe('引用 / 提示块里的围栏:回写必须带前缀', () => {
  // 引用里的围栏行长这样:`> ```mermaid …`。写回去时不带前缀,围栏就跑到引用外面了
  // (表格那边踩过同一类,这里钉住)。

  it('图表拖宽:前缀留着,别的选项也留着', () => {
    const body = ['> ```mermaid width=300', '> flowchart LR', '>   A --> B', '> ```'].join('\n')
    expect(setFenceWidthInBody(body, 0, 420)).toBe(
      ['> ```mermaid width=420', '> flowchart LR', '>   A --> B', '> ```'].join('\n')
    )
  })

  it('嵌套引用(`> > `)同理', () => {
    const body = ['> > ```mermaid', '> > A --> B', '> > ```'].join('\n')
    expect(setFenceWidthInBody(body, 0, 360)!.split('\n')[0]).toBe('> > ```mermaid width=360')
  })

  it('波浪线围栏同样认', () => {
    const body = ['> ~~~mermaid', '> A --> B', '> ~~~'].join('\n')
    expect(setFenceWidthInBody(body, 0, 360)!.split('\n')[0]).toBe('> ~~~mermaid width=360')
  })

  it('正文里的围栏一字不改(回归)', () => {
    const body = ['```mermaid', 'A --> B', '```'].join('\n')
    expect(setFenceWidthInBody(body, 0, 360)).toBe(['```mermaid width=360', 'A --> B', '```'].join('\n'))
  })

  it('网页嵌入改高度:插进去的那一行也带前缀', () => {
    const body = ['> ```embed', '> https://example.com', '> ```'].join('\n')
    expect(setEmbedSizeInBody(body, { from: 0, to: 2 }, { width: null, height: 320 })).toBe(
      ['> ```embed', '> https://example.com', '> height: 320', '> ```'].join('\n')
    )
  })

  it('网页嵌入改已有的那一行:前缀不丢', () => {
    const body = ['> ```embed', '> https://example.com', '> height: 200', '> ```'].join('\n')
    expect(setEmbedSizeInBody(body, { from: 0, to: 3 }, { width: null, height: 320 })).toBe(
      ['> ```embed', '> https://example.com', '> height: 320', '> ```'].join('\n')
    )
  })
})

describe('表格行里的媒体尺寸:alt 的竖线必须转义', () => {
  // `|` 是列分隔符。写出 ![|259](x.mp4) 会把这一行拆成更多格,整张表当场崩掉,
  // 媒体渲染不出来。踩过:把表格里那个视频拖宽之后,它变成一个打不开的空框。

  it('表格行:转义', () => {
    const body = '| 视频 | ![](assets/a.mp4) |'
    expect(setMediaSizeInBody(body, { line: 0, src: 'assets/a.mp4' }, { width: 259, height: null })).toBe(
      '| 视频 | ![\\|259](assets/a.mp4) |'
    )
  })

  it('已经有转义的不会变成双反斜杠', () => {
    const body = '| 图片 | ![\\|80](assets/a.png) |'
    expect(setMediaSizeInBody(body, { line: 0, src: 'assets/a.png' }, { width: 120, height: null })).toBe(
      '| 图片 | ![\\|120](assets/a.png) |'
    )
  })

  it('引用里的表格行同样转义', () => {
    const body = '> | 视频 | ![](assets/a.mp4) |'
    expect(setMediaSizeInBody(body, { line: 0, src: 'assets/a.mp4' }, { width: 200, height: null })).toContain(
      '![\\|200]'
    )
  })

  it('**非表格行不转义**(否则 alt 会显示出反斜杠)', () => {
    const body = '正文里的图 ![](assets/a.png)'
    expect(setMediaSizeInBody(body, { line: 0, src: 'assets/a.png' }, { width: 300, height: null })).toBe(
      '正文里的图 ![|300](assets/a.png)'
    )
  })
})

describe('转义只发生在**表格行**里 —— 逐种容器点名', () => {
  const put = (body: string, src: string) =>
    setMediaSizeInBody(body, { line: 0, src }, { width: 200, height: null })!

  // 该转义的:alt 里的 `|` 会被当成列分隔符,把这一行拆开、整张表崩掉
  it.each([
    ['正文里的表格', '| 图 | ![](assets/a.png) |'],
    ['引用里的表格', '> | 图 | ![](assets/a.png) |'],
    ['嵌套引用里的表格', '> > | 图 | ![](assets/a.png) |'],
    ['提示块里的表格', '> | 图 | ![](assets/a.png) |'],
    ['带缩进的表格', '  | 图 | ![](assets/a.png) |']
  ])('%s:转义', (_n, body) => {
    expect(put(body, 'assets/a.png')).toContain('![\\|200]')
  })

  // 不该转义的:那里 `|` 只是普通字符,转义了反而会原样显示出反斜杠
  it.each([
    ['正文段落', '正文里的图 ![](assets/a.png)'],
    ['引用(非表格)', '> 引用里的图 ![](assets/a.png)'],
    ['提示块(非表格)', '> [!NOTE] 卡片里的图 ![](assets/a.png)'],
    ['列表项', '- 列表里的图 ![](assets/a.png)'],
    ['折叠块里', '![](assets/a.png)'],
    ['列表项', '- 列表里的图 ![](assets/a.png)']
  ])('%s:不转义', (_n, body) => {
    expect(put(body, 'assets/a.png')).toContain('![|200]')
    expect(put(body, 'assets/a.png')).not.toContain('\\|200')
  })

  it('判据是「行首是不是 `|`」,不是「是不是真表格」—— 误判也无害', () => {
    // 一行以 `|` 开头的普通段落(没有分隔行、不构成表格)也会被转义。
    // 但 `\|` 在行内解析里就是字面的 `|`(见 INLINE_EXT_RE 的转义分支),
    // 渲染结果一模一样 —— 只是源码里多一个反斜杠,不值得为它加一套表格识别。
    const out = put('| 这行其实不是表格,只是普通文字 ![](assets/a.png)', 'assets/a.png')
    expect(out).toContain('![\\|200]')
  })

  it('视频和图片走的是同一条路,行为一致', () => {
    expect(put('| 视频 | ![](assets/a.mp4) |', 'assets/a.mp4')).toContain('![\\|200]')
    expect(put('| 图片 | ![](assets/a.png) |', 'assets/a.png')).toContain('![\\|200]')
  })
})
