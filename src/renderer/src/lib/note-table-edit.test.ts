import { describe, expect, it } from 'vitest'
import {
  addTableColumn,
  cellFromEditText,
  cellToEditText,
  addTableRow,
  parseTableBlock,
  removeTableColumn,
  removeTableRow,
  renderTableBlock,
  setTableCell,
  setTableOptionInBody,
  setTableOptionsInBody,
  setTableWidthInBody,
  splitRow
} from './note-table-edit'

const TABLE = ['| 端口 | 进程 |', '|:--|--:|', '| 8080 | node |', '| 6379 | redis |'].join('\n')
const BODY = `前言\n\n${TABLE}\n\n后记`

describe('parseTableBlock', () => {
  it('读出表头、对齐与正文行', () => {
    const t = parseTableBlock(BODY.split('\n'), 2)!
    expect(t.header).toEqual(['端口', '进程'])
    expect(t.aligns).toEqual(['left', 'right'])
    expect(t.rows).toEqual([
      ['8080', 'node'],
      ['6379', 'redis']
    ])
    expect(t.from).toBe(2)
    expect(t.to).toBe(5)
  })

  it('没有分隔行就不是表格', () => {
    expect(parseTableBlock(['| a | b |', '| c | d |'], 0)).toBeNull()
  })

  it('起点不是表格行 → null', () => {
    expect(parseTableBlock(BODY.split('\n'), 0)).toBeNull()
  })

  it('单元格里的 \\| 是字面竖线,不算分隔', () => {
    expect(splitRow('| a \\| b | c |')).toEqual(['a | b', 'c'])
  })

  it('行尾越界不炸', () => {
    expect(parseTableBlock(['| a |'], 0)).toBeNull()
    expect(parseTableBlock([], 0)).toBeNull()
  })
})

describe('renderTableBlock', () => {
  it('列宽按最长内容对齐,分隔行跟着变长', () => {
    const out = renderTableBlock({
      from: 0,
      to: 0,
      header: ['a', 'bbbb'],
      aligns: [null, null],
      rows: [['ccc', 'd']]
    })
    expect(out.split('\n')).toEqual(['| a    | bbbb |', '| ---- | ---- |', '| ccc  | d    |'])
  })

  it('正文行缺列时补齐(源文允许少写几格)', () => {
    const out = renderTableBlock({ from: 0, to: 0, header: ['a', 'b'], aligns: [null, null], rows: [['x']] })
    expect(out.split('\n')[2]).toBe('| x    |      |')
  })

  it('对齐标记写回分隔行', () => {
    const out = renderTableBlock({
      from: 0,
      to: 0,
      header: ['a', 'b', 'c'],
      aligns: ['left', 'center', 'right'],
      rows: []
    })
    expect(out.split('\n')[1]).toBe('| :--- | :--: | ---: |')
  })

  it('单元格里的裸竖线会被转义回去(否则写回时把行拆坏)', () => {
    const out = renderTableBlock({ from: 0, to: 0, header: ['a'], aligns: [null], rows: [['x|y']] })
    expect(out).toContain('x\\|y')
  })

  it('解析 → 序列化 → 再解析,内容不变', () => {
    const t1 = parseTableBlock(TABLE.split('\n'), 0)!
    const t2 = parseTableBlock(renderTableBlock(t1).split('\n'), 0)!
    expect(t2.header).toEqual(t1.header)
    expect(t2.rows).toEqual(t1.rows)
    expect(t2.aligns).toEqual(t1.aligns)
  })
})

describe('setTableCell', () => {
  it('改表头', () => {
    const out = setTableCell(BODY, 2, 0, 1, '程序')!
    expect(parseTableBlock(out.split('\n'), 2)!.header).toEqual(['端口', '程序'])
  })

  it('改正文(row 从 1 起)', () => {
    const out = setTableCell(BODY, 2, 2, 0, '9999')!
    expect(parseTableBlock(out.split('\n'), 2)!.rows[1][0]).toBe('9999')
  })

  it('**只动表格那几行**,前后文逐字节不变', () => {
    const out = setTableCell(BODY, 2, 1, 1, 'node2')!
    const lines = out.split('\n')
    expect(lines.slice(0, 2)).toEqual(['前言', ''])
    expect(lines.slice(-2)).toEqual(['', '后记'])
  })

  it('坐标越界 → null(不猜)', () => {
    expect(setTableCell(BODY, 2, 9, 0, 'x')).toBeNull()
    expect(setTableCell(BODY, 2, 0, 9, 'x')).toBeNull()
    expect(setTableCell(BODY, 99, 0, 0, 'x')).toBeNull()
  })

  it('清空一个单元格(删掉内容,格子还在)', () => {
    const out = setTableCell(BODY, 2, 1, 1, '')!
    expect(parseTableBlock(out.split('\n'), 2)!.rows[0][1]).toBe('')
  })
})

describe('增删行列', () => {
  it('在某行之后插一行', () => {
    const out = addTableRow(BODY, 2, 1)!
    const t = parseTableBlock(out.split('\n'), 2)!
    expect(t.rows).toHaveLength(3)
    expect(t.rows[1]).toEqual(['', ''])
  })

  it('row=0 插在表头之后、正文最前', () => {
    const out = addTableRow(BODY, 2, 0)!
    expect(parseTableBlock(out.split('\n'), 2)!.rows[0]).toEqual(['', ''])
  })

  it('row 超过行数时插到末尾', () => {
    const out = addTableRow(BODY, 2, 99)!
    expect(parseTableBlock(out.split('\n'), 2)!.rows[2]).toEqual(['', ''])
  })

  it('删一行', () => {
    const out = removeTableRow(BODY, 2, 1)!
    const t = parseTableBlock(out.split('\n'), 2)!
    expect(t.rows).toEqual([['6379', 'redis']])
  })

  it('**表头删不得** —— 删了这张表就不成立了', () => {
    expect(removeTableRow(BODY, 2, 0)).toBeNull()
  })

  it('在某列之后插一列', () => {
    const out = addTableColumn(BODY, 2, 0)!
    const t = parseTableBlock(out.split('\n'), 2)!
    expect(t.header).toEqual(['端口', '', '进程'])
    expect(t.rows[0]).toEqual(['8080', '', 'node'])
  })

  it('删一列', () => {
    const out = removeTableColumn(BODY, 2, 0)!
    const t = parseTableBlock(out.split('\n'), 2)!
    expect(t.header).toEqual(['进程'])
    expect(t.rows[0]).toEqual(['node'])
  })

  it('**只剩一列时拒绝再删**', () => {
    const one = ['| a |', '|---|', '| 1 |'].join('\n')
    expect(removeTableColumn(one, 0, 0)).toBeNull()
  })

  it('删列时正文行比表头短也不会错位', () => {
    const ragged = ['| a | b | c |', '|---|---|---|', '| 1 |'].join('\n')
    const out = removeTableColumn(ragged, 0, 1)!
    const t = parseTableBlock(out.split('\n'), 0)!
    expect(t.header).toEqual(['a', 'c'])
    expect(t.rows[0]).toEqual(['1', ''])
  })

  it('增删之后表格仍然解析得回来(结构没坏)', () => {
    let body = BODY
    body = addTableRow(body, 2, 1)!
    body = addTableColumn(body, 2, 1)!
    body = removeTableRow(body, 2, 2)!
    body = removeTableColumn(body, 2, 0)!
    const t = parseTableBlock(body.split('\n'), 2)!
    expect(t).not.toBeNull()
    expect(t.header).toHaveLength(2)
    expect(t.rows).toHaveLength(2)
  })
})

describe('引用 / 提示块里的表格:整段重排那条路也认前缀', () => {
  // 引用里每一行都带 `> `。这些函数以前只认行首是 `|` 的行,于是引用里的表格
  // 连「是不是表格」都判不出来 —— 双击改格子、加行加列在那边全都做不了。
  const Q = ['> 前言', '>', '> | a | b |', '> |---|---|', '> | 1 | 2 |', '>', '> 后记'].join('\n')

  /** 重排会补对齐空白,所以断言一律「剥前缀 → 解析回来」,不比对字面 */
  const parseQuoted = (out: string, line = 2) =>
    parseTableBlock(
      out.split('\n').slice(line).map((l) => l.replace(/^>\s?/, '')),
      0
    )!

  it('改一格:只动那一格,前缀与前后文都留着', () => {
    const out = setTableCell(Q, 2, 1, 1, 'x')!
    const lines = out.split('\n')
    expect(parseQuoted(out).rows[0]).toEqual(['1', 'x'])
    // 每一行都还带着前缀
    expect(lines[2]!.startsWith('> ')).toBe(true)
    expect(lines[4]!.startsWith('> ')).toBe(true)
    expect(lines.slice(0, 2)).toEqual(['> 前言', '>'])
    expect(lines.slice(-2)).toEqual(['>', '> 后记'])
  })

  it('改表头', () => {
    const out = setTableCell(Q, 2, 0, 0, '端口')!
    expect(parseQuoted(out).header).toEqual(['端口', 'b'])
    expect(out.split('\n')[2]!.startsWith('> ')).toBe(true)
  })

  it('加一行 / 删一行:每一行都带前缀', () => {
    const added = addTableRow(Q, 2, 1)!
    expect(added.split('\n').filter((l) => l.startsWith('> |')).length).toBe(4)
    const removed = removeTableRow(Q, 2, 1)!
    expect(removed.split('\n').filter((l) => l.startsWith('> |')).length).toBe(2)
  })

  it('加一列 / 删一列', () => {
    const added = addTableColumn(Q, 2, 0)!
    expect(parseQuoted(added).header).toEqual(['a', '', 'b'])
    expect(added.split('\n')[2]!.startsWith('> ')).toBe(true)
    const removed = removeTableColumn(Q, 2, 0)!
    expect(parseQuoted(removed).header).toEqual(['b'])
  })

  it('**嵌套引用**里的表格同样认(`> > `)', () => {
    const body = ['> > | a | b |', '> > |---|---|', '> > | 1 | 2 |'].join('\n')
    const out = setTableCell(body, 0, 1, 0, 'x')!
    expect(out.split('\n')[2]!.startsWith('> > ')).toBe(true)
    expect(
      parseTableBlock(
        out.split('\n').map((l) => l.replace(/^> >\s?/, '')),
        0
      )!.rows[0]
    ).toEqual(['x', '2'])
  })

  it('引用后面紧跟的正文不会被吃掉', () => {
    const out = setTableCell(Q, 2, 1, 1, 'x')!
    expect(out.endsWith('> 后记')).toBe(true)
  })

  it('正文里的表格一字不改(回归)', () => {
    const out = setTableCell(BODY, 2, 1, 1, 'node2')!
    expect(parseTableBlock(out.split('\n'), 2)!.rows[0]).toEqual(['8080', 'node2'])
    // 前缀是空的,所以不该凭空多出 `> `
    expect(out.split('\n').some((l) => l.startsWith('>'))).toBe(false)
  })
})

describe('单元格里的换行(<br>)', () => {
  it('源文 → 编辑框:各种写法的 <br> 都还原成换行', () => {
    expect(cellToEditText('甲<br>乙')).toBe('甲\n乙')
    expect(cellToEditText('甲<br/>乙')).toBe('甲\n乙')
    expect(cellToEditText('甲<BR />乙')).toBe('甲\n乙')
  })

  it('没有 <br> 时原样', () => {
    expect(cellToEditText('甲')).toBe('甲')
  })

  it('编辑框 → 源文:换行变 <br>,逐行去空白', () => {
    expect(cellFromEditText('甲\n乙')).toBe('甲<br>乙')
    expect(cellFromEditText('  甲  \n  乙  ')).toBe('甲<br>乙')
  })

  it('三行以上', () => {
    expect(cellFromEditText('甲\n乙\n丙')).toBe('甲<br>乙<br>丙')
  })

  it('往返一致(编辑两次不会越改越乱)', () => {
    for (const src of ['甲<br>乙', '甲', '甲<br>乙<br>丙']) {
      expect(cellFromEditText(cellToEditText(src))).toBe(src)
    }
  })

  it('写进去的 <br> 不会把表格拆散 —— 它仍然是一行', () => {
    const out = setTableCell('| a |\n|---|\n| x |', 0, 1, 0, cellFromEditText('甲\n乙'))!
    expect(out.split('\n')).toHaveLength(3)
    expect(parseTableBlock(out.split('\n'), 0)!.rows[0][0]).toBe('甲<br>乙')
  })
})

describe('setTableWidthInBody(表格宽度只能住在围栏选项里)', () => {
  const PLAIN = ['前言', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '后记'].join('\n')

  it('没包围栏的表:就地包一层,宽度写进选项', () => {
    const out = setTableWidthInBody(PLAIN, { line: 2, to: 4, fenced: false }, 520)!
    expect(out.split('\n').slice(2, 8)).toEqual([
      '```table width=520',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '```',
      ''
    ])
    // 前后文逐字节不变
    expect(out.split('\n').slice(0, 2)).toEqual(['前言', ''])
    expect(out.split('\n').slice(-1)).toEqual(['后记'])
  })

  it('已经有围栏:只改/加 width,别的选项原样保留', () => {
    const body = ['```table border=none', '| a |', '|---|', '```'].join('\n')
    expect(setTableWidthInBody(body, { line: 1, to: 2, fenced: true }, 400)).toBe(
      ['```table border=none width=400', '| a |', '|---|', '```'].join('\n')
    )
  })

  it('已有 width 时替换,而不是叠加', () => {
    const body = ['```table width=300', '| a |', '|---|', '```'].join('\n')
    expect(setTableWidthInBody(body, { line: 1, to: 2, fenced: true }, 500)).toBe(
      ['```table width=500', '| a |', '|---|', '```'].join('\n')
    )
  })

  it('宽度夹到合理区间', () => {
    const body = ['```table', '| a |', '|---|', '```'].join('\n')
    expect(setTableWidthInBody(body, { line: 1, to: 2, fenced: true }, 5)).toContain('width=160')
    expect(setTableWidthInBody(body, { line: 1, to: 2, fenced: true }, 1e9)).toContain('width=2400')
  })

  it('没围栏又没宽度 → null(没什么可改的,不凭空包一层)', () => {
    expect(setTableWidthInBody(PLAIN, { line: 2, to: 4, fenced: false }, null)).toBeNull()
  })

  it('区间对不上 → null', () => {
    expect(setTableWidthInBody(PLAIN, { line: 2, to: 99, fenced: false }, 400)).toBeNull()
  })
})

describe('setTableOptionInBody(列宽 / 行高与宽度走同一条路)', () => {
  const PLAIN = ['前言', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '后记'].join('\n')

  it('没包围栏的表:就地包一层,列宽写进选项', () => {
    const out = setTableOptionInBody(PLAIN, { line: 2, to: 4, fenced: false }, 'cols', '220,auto')!
    expect(out.split('\n').slice(2, 8)).toEqual([
      '```table cols=220,auto',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '```',
      ''
    ])
    expect(out.split('\n').slice(0, 2)).toEqual(['前言', ''])
    expect(out.split('\n').slice(-1)).toEqual(['后记'])
  })

  it('**改列宽不会把 border=none 抹掉** —— 只动自己那个键', () => {
    const body = ['```table border=none width=520', '| a |', '|---|', '```'].join('\n')
    expect(setTableOptionInBody(body, { line: 1, to: 2, fenced: true }, 'cols', '200,300')).toBe(
      ['```table border=none width=520 cols=200,300', '| a |', '|---|', '```'].join('\n')
    )
  })

  it('已有同一个键时替换,而不是叠加', () => {
    const body = ['```table cols=100,100', '| a |', '|---|', '```'].join('\n')
    expect(setTableOptionInBody(body, { line: 1, to: 2, fenced: true }, 'cols', '220,180')).toBe(
      ['```table cols=220,180', '| a |', '|---|', '```'].join('\n')
    )
  })

  it('宽度与列宽互不干扰', () => {
    const body = ['```table cols=100,100', '| a |', '|---|', '```'].join('\n')
    expect(setTableOptionInBody(body, { line: 1, to: 2, fenced: true }, 'width', '600')).toBe(
      ['```table cols=100,100 width=600', '| a |', '|---|', '```'].join('\n')
    )
  })

  it('删掉一个键(value=null)后围栏空掉时不留尾空格', () => {
    const body = ['```table width=400', '| a |', '|---|', '```'].join('\n')
    expect(setTableOptionInBody(body, { line: 1, to: 2, fenced: true }, 'width', null)).toBe(
      ['```table', '| a |', '|---|', '```'].join('\n')
    )
  })

  it('行高同样走这条路', () => {
    const body = ['```table', '| a |', '|---|', '| 1 |', '```'].join('\n')
    expect(setTableOptionInBody(body, { line: 1, to: 3, fenced: true }, 'rows', '48,120')).toBe(
      ['```table rows=48,120', '| a |', '|---|', '| 1 |', '```'].join('\n')
    )
  })

  it('没围栏又没值 → null(不凭空包一层)', () => {
    expect(setTableOptionInBody(PLAIN, { line: 2, to: 4, fenced: false }, 'cols', null)).toBeNull()
  })

  it('一次写多个键(列宽 + 整表宽度)—— 没围栏时也只包一层', () => {
    const out = setTableOptionsInBody(PLAIN, { line: 2, to: 4, fenced: false }, [
      ['cols', '200,300'],
      ['width', '500']
    ])!
    expect(out.split('\n').slice(2, 8)).toEqual([
      '```table cols=200,300 width=500',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '```',
      ''
    ])
  })

  it('**引用里的表格**:插进去的围栏必须带 `> ` 前缀,否则会插到引用外面', () => {
    const body = ['前言', '', '> | a | b |', '> |---|---|', '> | 1 | 2 |', '', '后记'].join('\n')
    const out = setTableOptionsInBody(body, { line: 2, to: 4, fenced: false }, [['cols', '100,200']])!
    expect(out.split('\n').slice(2, 8)).toEqual([
      '> ```table cols=100,200',
      '> | a | b |',
      '> |---|---|',
      '> | 1 | 2 |',
      '> ```',
      ''
    ])
    // 前缀一路带着,前后文一字不动
    expect(out.split('\n').slice(0, 2)).toEqual(['前言', ''])
    expect(out.split('\n').slice(-1)).toEqual(['后记'])
  })

  it('**嵌套引用**里的表格:`> > ` 也要带着', () => {
    const body = ['> > | a |', '> > |---|', '> > | 1 |'].join('\n')
    const out = setTableOptionsInBody(body, { line: 0, to: 2, fenced: false }, [['width', '300']])!
    expect(out.split('\n')[0]).toBe('> > ```table width=300')
    expect(out.split('\n')[4]).toBe('> > ```')
  })

  it('引用里**已经包了围栏**的表:改选项时前缀不丢', () => {
    const body = ['> ```table border=none', '> | a |', '> |---|', '> ```'].join('\n')
    expect(setTableOptionsInBody(body, { line: 1, to: 2, fenced: true }, [['cols', '100,200']])).toBe(
      ['> ```table border=none cols=100,200', '> | a |', '> |---|', '> ```'].join('\n')
    )
  })

  it('**连写两次不会叠出第二层围栏**(这正是之前把源码写坏的那个形态)', () => {
    const body = ['> | a | b |', '> |---|---|', '> | 1 | 2 |'].join('\n')
    const once = setTableOptionsInBody(body, { line: 0, to: 2, fenced: false }, [['width', '300']])!
    // 包完之后表格下移一行,而且现在「有围栏」了 —— 再改一次应该只改那一行
    const twice = setTableOptionsInBody(once, { line: 1, to: 3, fenced: true }, [['width', '400']])!
    expect(twice.split('\n').filter((l) => l.includes('```table'))).toHaveLength(1)
    expect(twice.split('\n')[0]).toBe('> ```table width=400')
    expect(twice.split('\n')).toHaveLength(5)
  })

  it('前缀对不上时**什么都不做**(宁可不动,也不写坏)', () => {
    const body = ['```table', '> | a |', '> |---|', '> ```'].join('\n')
    expect(setTableOptionsInBody(body, { line: 1, to: 2, fenced: true }, [['width', '300']])).toBeNull()
  })

  it('缩进的表格照样带缩进', () => {
    const body = ['  | a |', '  |---|', '  | 1 |'].join('\n')
    const out = setTableOptionsInBody(body, { line: 0, to: 2, fenced: false }, [['width', '300']])!
    expect(out.split('\n')[0]).toBe('  ```table width=300')
  })

  it('多键写时,已有的同键被替换、别的键保留', () => {
    const body = ['```table border=none cols=100,100', '| a |', '|---|', '```'].join('\n')
    expect(
      setTableOptionsInBody(body, { line: 1, to: 2, fenced: true }, [
        ['cols', '220,180'],
        ['width', '400']
      ])
    ).toBe(['```table border=none cols=220,180 width=400', '| a |', '|---|', '```'].join('\n'))
  })
})

describe('容器矩阵:回写要落在容器**里面**', () => {
  // 表格住的那一层可能是引用(`> `)、嵌套引用(`> > `)、折叠块、对齐块……
  // 插围栏时前缀要带上、行号要准 —— 少一样都会把源码写乱。
  const CASES: Array<[string, string[], number]> = [
    [
      '折叠块(两行形态)',
      ['<details>', '<summary>t</summary>', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '</details>'],
      3
    ],
    [
      '折叠块(一行形态)',
      ['<details><summary>t</summary>', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '</details>'],
      2
    ],
    ['提示块', ['> [!NOTE]', '> 正文', '>', '> | a | b |', '> |---|---|', '> | 1 | 2 |'], 3],
    ['引用', ['> | a | b |', '> |---|---|', '> | 1 | 2 |'], 0],
    ['嵌套引用', ['> > | a | b |', '> > |---|---|', '> > | 1 | 2 |'], 0],
    ['对齐块', ['<div align="center">', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '</div>'], 2],
    ['正文', ['| a | b |', '|---|---|', '| 1 | 2 |'], 0]
  ]

  it.each(CASES)('%s:围栏插在容器里面,容器自己没被撑破', (_name, lines, at) => {
    const out = setTableOptionsInBody(lines.join('\n'), { line: at, to: at + 2, fenced: false }, [
      ['width', '300']
    ])!
    const got = out.split('\n')
    expect(got[at]!.endsWith('```table width=300')).toBe(true) // 开启围栏(前缀在不在都认)
    expect(got[at + 4]!.endsWith('```')).toBe(true) // 闭合围栏
    expect(got.filter((l) => l.includes('```table'))).toHaveLength(1) // 只插了一层
    expect(got.filter((l) => l.endsWith('```') && !l.includes('table'))).toHaveLength(1)
  })

  it.each(CASES)('%s:再改一次不叠第二层', (_name, lines, at) => {
    const body = lines.join('\n')
    const once = setTableOptionsInBody(body, { line: at, to: at + 2, fenced: false }, [['width', '300']])!
    // 包完之后表格下移一行,而且现在「有围栏」了
    const twice = setTableOptionsInBody(once, { line: at + 1, to: at + 3, fenced: true }, [
      ['width', '400']
    ])!
    expect(twice.split('\n').filter((l) => l.includes('```table'))).toHaveLength(1)
    expect(twice.split('\n')[at]!.endsWith('```table width=400')).toBe(true)
  })
})
