import { describe, expect, it } from 'vitest'
import {
  decodeAlpha,
  decodeRoman,
  encodeAlpha,
  encodeRoman,
  type IndentOptions,
  indentMarkdownLine,
  indentMarkdownLines,
  isListLine,
  listMarkerOf,
  listSyntaxAt,
  parseListLine
} from './md-list-syntax'

describe('parseListLine:标准写法', () => {
  it('识别无序任务与内容', () => {
    const s = parseListLine('- [ ] 甲')!
    expect(s).toMatchObject({
      quote: '',
      indent: '',
      marker: '-',
      ordered: false,
      gap: ' ',
      task: true,
      checked: false,
      content: '甲',
      canonical: true
    })
    expect(s.taskFrom).toBe(2)
    expect(s.taskTo).toBe(5)
    expect(s.contentStart).toBe(6)
  })

  it('大写 X、`*` / `+`、有序任务都认', () => {
    expect(parseListLine('- [X] 甲')).toMatchObject({ checked: true, canonical: true })
    expect(parseListLine('* [ ] 甲')).toMatchObject({ marker: '*', task: true })
    expect(parseListLine('+ [x] 甲')).toMatchObject({ marker: '+', checked: true })
    expect(parseListLine('1. [ ] 甲')).toMatchObject({
      ordered: true,
      number: 1,
      task: true,
      // 上游只续无序任务,有序任务必须由自定义回车接管
      canonical: false
    })
    expect(parseListLine('3) [x] 甲')).toMatchObject({ ordered: true, number: 3, checked: true })
  })

  it('普通列表不是任务', () => {
    expect(parseListLine('- 普通项')).toMatchObject({ task: false, content: '普通项' })
  })
})

describe('parseListLine:宽松写法', () => {
  it('`-[]` / `-[x]` 没有空白也认', () => {
    const s = parseListLine('-[]')!
    expect(s).toMatchObject({ marker: '-', gap: '', task: true, checked: false, content: '', canonical: false })
    expect(s.taskFrom).toBe(1)
    expect(s.taskTo).toBe(3)

    expect(parseListLine('-[x] 甲')).toMatchObject({ gap: '', task: true, checked: true, content: '甲' })
  })

  it('括号里没有空格 / 全是空格都算未勾选', () => {
    expect(parseListLine('- [] 甲')).toMatchObject({ task: true, checked: false, content: '甲' })
    expect(parseListLine('- [  ] 甲')).toMatchObject({ task: true, checked: false })
    expect(parseListLine('- []')).toMatchObject({ task: true, checked: false })
  })

  it('`[x]文字`(括号后没有空白)也是任务', () => {
    expect(parseListLine('- [x]文字')).toMatchObject({
      task: true,
      checked: true,
      content: '文字',
      canonical: false
    })
  })

  it('行尾 `- [ ]` 上游不认,标记为非标准', () => {
    expect(parseListLine('- [ ]')).toMatchObject({ task: true, canonical: false })
    // 带尾随空白的标准空任务仍交给上游
    expect(parseListLine('- [ ] ')).toMatchObject({ task: true, canonical: true })
  })
})

describe('parseListLine:不能误判', () => {
  it('链接 / 引用式链接不是任务', () => {
    expect(parseListLine('- [text](https://x)')).toMatchObject({ task: false })
    expect(parseListLine('- [x](https://x)')).toMatchObject({ task: false })
    expect(parseListLine('- [x][ref]')).toMatchObject({ task: false })
    expect(parseListLine('- [](https://x)')).toMatchObject({ task: false })
  })

  it('括号内容不是空格或 x 时不算任务', () => {
    expect(parseListLine('- [y] 甲')).toMatchObject({ task: false })
    expect(parseListLine('- [x ] 甲')).toMatchObject({ task: false })
    expect(parseListLine('- [ x] 甲')).toMatchObject({ task: false })
  })

  it('没有列表标记、或标记后无空白又不是任务 → null', () => {
    expect(parseListLine('正文')).toBeNull()
    expect(parseListLine('-foo')).toBeNull()
    expect(parseListLine('-')).toBeNull()
    expect(parseListLine('1.[] 甲')).toBeNull()
    expect(parseListLine('-[text](https://x)')).toBeNull()
  })
})

describe('引用前缀', () => {
  it('引用 / 嵌套引用里的任务保留前缀', () => {
    expect(parseListLine('> - [ ] 甲')).toMatchObject({
      quote: '> ',
      task: true,
      canonical: true
    })
    expect(parseListLine('> > - [x] 甲')).toMatchObject({ quote: '> > ', checked: true })
    expect(parseListLine('   > - []')).toMatchObject({ quote: '   > ', task: true })
  })

  it('4 个前导空格是代码块,不是引用', () => {
    expect(parseListLine('    > - []')).toBeNull()
  })

  it('isListLine 只认顶格的列表行,顶格 a. / i. 不是列表', () => {
    expect(isListLine('- [ ] 甲')).toBe(true)
    expect(isListLine('   - []')).toBe(true)
    expect(isListLine('> - [ ] 甲')).toBe(false)
    expect(isListLine('1. 甲')).toBe(true)
    expect(isListLine('a. 注意')).toBe(false)
    expect(isListLine('i. 注意')).toBe(false)
  })
})

describe('字母与罗马数字', () => {
  it('字母是双射:a=1,z=26,aa=27', () => {
    expect(encodeAlpha(1)).toBe('a')
    expect(encodeAlpha(26)).toBe('z')
    expect(encodeAlpha(27)).toBe('aa')
    expect(decodeAlpha('aa')).toBe(27)
    expect(decodeAlpha('z')).toBe(26)
  })

  it('罗马数字用减法写法,非法组合不认', () => {
    expect(encodeRoman(1)).toBe('i')
    expect(encodeRoman(4)).toBe('iv')
    expect(encodeRoman(9)).toBe('ix')
    expect(encodeRoman(40)).toBe('xl')
    expect(decodeRoman('iii')).toBe(3)
    expect(decodeRoman('iiii')).toBeNull()
    expect(decodeRoman('abc')).toBeNull()
  })

  it('listSyntaxAt:顶格 a. 不是列表,落在 1. 下面才是', () => {
    expect(listSyntaxAt(['a. 注意'], 0)).toBeNull()
    expect(listSyntaxAt(['1. 甲', '  a. 乙'], 1)?.number).toBe(1)
    expect(listSyntaxAt(['1. 甲', '  a. 乙', '    i. 丙'], 2)?.style).toBe(2)
    // 字母档的 i. 是第 9 项,不是罗马数字的 1
    expect(listSyntaxAt(['1. 甲', '  i. 第九'], 1)?.number).toBe(9)
    // 十进制任何一层都认,旧笔记不因为缩进就被丢掉
    expect(listSyntaxAt(['1. 甲', '  2. 乙'], 1)?.number).toBe(2)
  })

  it('listMarkerOf 把 a. / i. 也当成有序', () => {
    expect(listMarkerOf('  a. 乙')).toBe('1. ')
    expect(listMarkerOf('    i. 丙')).toBe('1. ')
  })
})

describe('listMarkerOf', () => {
  it('任务统一显示为 `- [ ] `,有序显示为 `1. `', () => {
    expect(listMarkerOf('- [ ] 甲')).toBe('- [ ] ')
    expect(listMarkerOf('- [] 甲')).toBe('- [ ] ')
    expect(listMarkerOf('1. [x] 甲')).toBe('- [ ] ')
    expect(listMarkerOf('2) 甲')).toBe('1. ')
    expect(listMarkerOf('* 甲')).toBe('- ')
    expect(listMarkerOf('正文')).toBe('')
  })
})

describe('缩进', () => {
  it('增加 / 减少一级(2 空格)', () => {
    expect(indentMarkdownLine('- 甲', 'in')).toBe('  - 甲')
    expect(indentMarkdownLine('  - 甲', 'out')).toBe('- 甲')
    expect(indentMarkdownLine('   - 甲', 'out')).toBe(' - 甲')
    expect(indentMarkdownLine('\t- 甲', 'out')).toBe('- 甲')
  })

  it('缩进加在引用前缀之后', () => {
    expect(indentMarkdownLine('> - 甲', 'in')).toBe('>   - 甲')
    expect(indentMarkdownLine('>   - 甲', 'out')).toBe('> - 甲')
  })

  it('空行不动;没有可改的行时批量返回 null', () => {
    expect(indentMarkdownLine('   ', 'in')).toBe('   ')
    expect(indentMarkdownLines(['- 甲', ''], [0], 'out')).toBeNull()
    expect(indentMarkdownLines(['- 甲', ''], [0], 'in')).toEqual(new Map([[0, '  - 甲']]))
  })
})

describe('indentMarkdownLines:标记跟随上一级', () => {
  const plan = (
    lines: string[],
    targets: number[],
    dir: 'in' | 'out' = 'in',
    options: IndentOptions = {}
  ): Map<number, string> | null => indentMarkdownLines(lines, targets, dir, 2, options)

  it('上级 - → 本级 *', () => {
    expect(plan(['- 甲', '  - 乙'], [1])?.get(1)).toBe('    * 乙')
  })

  it('上级 * → 本级 +', () => {
    expect(plan(['* 甲', '* 乙'], [1])?.get(1)).toBe('  + 乙')
  })

  it('上级 + → 本级 -', () => {
    expect(plan(['+ 甲', '+ 乙'], [1])?.get(1)).toBe('  - 乙')
  })

  it('没有上级时落回基础标记 -', () => {
    expect(plan(['* 甲'], [0])?.get(0)).toBe('  - 甲')
    expect(plan(['- 甲', '  + 乙'], [1], 'out')?.get(1)).toBe('- 乙')
  })

  it('没有缩进可退时不动这一行(也不顺手归一标记)', () => {
    expect(plan(['* 甲'], [0], 'out')).toBeNull()
  })

  it('多选时逐行按各自的上一级算', () => {
    const out = plan(['* 甲', '* 乙', '* 丙'], [1, 2])
    expect(out?.get(1)).toBe('  + 乙')
    expect(out?.get(2)).toBe('  + 丙')
  })

  it('乱序传入也按行号升序处理,父项先更新', () => {
    const out = plan(['- 甲', '  - 乙'], [1, 0])
    expect(out?.get(0)).toBe('  - 甲')
    expect(out?.get(1)).toBe('    * 乙')
  })

  it('反缩进按新的上一级重算', () => {
    expect(plan(['- 甲', '  * 乙', '    + 丙'], [2], 'out')?.get(2)).toBe('  * 丙')
  })

  it('有序上级的无序孩子用 -;任务自身不改标记,但可作为上级', () => {
    expect(plan(['1. 甲', '  - 乙'], [1])?.get(1)).toBe('    - 乙')
    expect(plan(['- [ ] 甲'], [0])?.get(0)).toBe('  - [ ] 甲')
    expect(plan(['* [x] 甲'], [0])?.get(0)).toBe('  * [x] 甲')
    expect(plan(['- [ ] 甲', '  - 乙'], [1])?.get(1)).toBe('    * 乙')
    expect(plan(['* [x] 甲', '  - 乙'], [1])?.get(1)).toBe('    + 乙')
  })

  it('有序项缩进后按有序上级的个数换档:1. → a. → i. → 1.', () => {
    const lines = ['1. 甲', '  1. 乙', '    1. 丙', '      1. 丁']
    const out = plan(lines, [0, 1, 2, 3])
    // 顶格没有有序上级,档位不变,序号也不动
    expect(out?.get(0)).toBe('  1. 甲')
    expect(out?.get(1)).toBe('    a. 乙')
    expect(out?.get(2)).toBe('      i. 丙')
    expect(out?.get(3)).toBe('        1. 丁')
  })

  it('同一批里第二个有序项接着前一个编号', () => {
    const out = plan(['1. 甲', '1. 乙', '1. 丙'], [1, 2])
    expect(out?.get(1)).toBe('  a. 乙')
    expect(out?.get(2)).toBe('  b. 丙')
  })

  it('反缩进回到父列表时接上下一个十进制编号', () => {
    expect(plan(['1. 甲', '  a. 乙'], [1], 'out')?.get(1)).toBe('2. 乙')
  })

  it('上级是无序时有序项只缩进,不换档', () => {
    expect(plan(['- 甲', '  1. 乙'], [1])?.get(1)).toBe('    1. 乙')
  })

  it('分隔符跟着这一行:1) 缩进成 a)', () => {
    expect(plan(['1) 甲', '1) 乙'], [1])?.get(1)).toBe('  a) 乙')
  })

  it('有序任务只缩进,不写成 a. [ ]', () => {
    expect(plan(['1. 甲', '  1. [ ] 任务'], [1])?.get(1)).toBe('    1. [ ] 任务')
  })

  it('续行要落在上级的内容列之内', () => {
    expect(plan(['- 甲', '  续行', '  - 乙'], [2])?.get(2)).toBe('    * 乙')
    expect(plan(['- 甲', ' 段', '  - 乙'], [2])?.get(2)).toBe('    - 乙')
  })

  it('顶格内容结束列表上下文', () => {
    expect(plan(['- 甲', '', '普通段落', '    - 乙'], [3])?.get(3)).toBe('      - 乙')
    expect(plan(['- 甲', '```js', '- foo', '```', '  - 乙'], [4])?.get(4)).toBe('    - 乙')
  })

  it('分隔线不算上级,自身也不换标记', () => {
    expect(plan(['- - -', '  - 乙'], [1])?.get(1)).toBe('    - 乙')
    expect(plan(['- 甲', '  - - -'], [1])?.get(1)).toBe('    - - -')
  })

  it('skipMarker 里的行只缩进', () => {
    expect(plan(['- 甲'], [0], 'in', { skipMarker: new Set([0]) })?.get(0)).toBe('  - 甲')
  })

  it('引用内按引用后的上级算;跨引用上下文不算上级', () => {
    expect(plan(['> - 甲', '>   - 乙'], [1])?.get(1)).toBe('>     * 乙')
    expect(plan(['> - 甲', '  - 乙'], [1])?.get(1)).toBe('    - 乙')
  })

  it('没有任何行变化时返回 null', () => {
    expect(plan(['- 甲'], [0], 'out')).toBeNull()
  })
})
