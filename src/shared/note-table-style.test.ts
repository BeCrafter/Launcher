import { describe, expect, it } from 'vitest'
import {
  clampTableCol,
  clampTableRow,
  joinSizeList,
  mergeTableOptions,
  parseTableOptions,
  tableCssVars,
  type TableOptions
} from './note-table-style'

/** 只有 border/color/width 的期望值写起来太吵 —— 补全成完整形状 */
const opts = (o: Partial<TableOptions>): TableOptions => ({
  border: null,
  color: null,
  width: null,
  cols: null,
  rows: null,
  layout: false,
  ...o
})

describe('parseTableOptions', () => {
  it('四个边框档位', () => {
    for (const b of ['none', 'thin', 'medium', 'thick']) {
      expect(parseTableOptions(`border=${b}`).border).toBe(b)
    }
  })

  it('大小写不敏感', () => {
    expect(parseTableOptions('border=NONE').border).toBe('none')
  })

  it('十六进制颜色', () => {
    expect(parseTableOptions('color=#8b5cf6').color).toBe('#8b5cf6')
    expect(parseTableOptions('color=#abc').color).toBe('#abc')
  })

  it('颜色关键字也认', () => {
    expect(parseTableOptions('color=tomato').color).toBe('tomato')
  })

  it('两个一起写,顺序无所谓', () => {
    expect(parseTableOptions('border=thick color=#123456')).toEqual(opts({ border: 'thick', color: '#123456' }))
    expect(parseTableOptions('color=#123456 border=thick')).toEqual(opts({ border: 'thick', color: '#123456' }))
  })

  it('认不出的值**忽略**而不是报错 —— 一个写错的词不该把整张表变成错误提示', () => {
    expect(parseTableOptions('border=huge')).toEqual(opts({}))
    expect(parseTableOptions('color=javascript:alert(1)')).toEqual(opts({}))
    expect(parseTableOptions('color=url(x)')).toEqual(opts({}))
  })

  it('多余的空格与空串不炸', () => {
    expect(parseTableOptions('   ')).toEqual(opts({}))
    expect(parseTableOptions('')).toEqual(opts({}))
    expect(parseTableOptions('  border=none   color=red  ')).toEqual(opts({ border: 'none', color: 'red' }))
  })

  it('没有 = 的裸词忽略(除了 layout —— 它是唯一一个裸词开关)', () => {
    expect(parseTableOptions('border=none junk')).toEqual(opts({ border: 'none' }))
    expect(parseTableOptions('layout')).toEqual(opts({ layout: true }))
    expect(parseTableOptions('LAYOUT cols=200')).toEqual(opts({ layout: true, cols: [200] }))
  })
})

describe('列宽 / 行高', () => {
  it('逗号分隔,auto 是「这一列按内容自动」', () => {
    expect(parseTableOptions('cols=220,auto,180').cols).toEqual([220, null, 180])
  })

  it('空项也当 auto(手写时容易多打一个逗号)', () => {
    expect(parseTableOptions('rows=48,,120').rows).toEqual([48, null, 120])
  })

  it('整串都是 auto = 没覆盖 —— 免得平白把表格切成固定布局', () => {
    expect(parseTableOptions('cols=auto,auto').cols).toBeNull()
  })

  it('认不出的项按 auto 处理,不丢掉整串', () => {
    expect(parseTableOptions('cols=220,wide,180').cols).toEqual([220, null, 180])
  })

  it('宽度夹到区间里', () => {
    expect(parseTableOptions('cols=5').cols).toEqual([40])
    expect(parseTableOptions('cols=99999').cols).toEqual([2400])
    expect(parseTableOptions('rows=1').rows).toEqual([24])
  })

  it('columns 是 cols 的别名', () => {
    expect(parseTableOptions('columns=200').cols).toEqual([200])
  })

  it('joinSizeList 是它的反向(写回围栏时用)', () => {
    expect(joinSizeList([220, null, 180])).toBe('220,auto,180')
    expect(joinSizeList([48.4])).toBe('48')
  })

  it('夹取函数自己也要能夹(拖拽时直接调它们)', () => {
    expect(clampTableCol(5)).toBe(40)
    expect(clampTableCol(99999)).toBe(2400)
    expect(clampTableRow(1)).toBe(24)
    expect(clampTableRow(99999)).toBe(1200)
  })
})

describe('tableCssVars', () => {
  it('边框档位换算成像素', () => {
    expect(tableCssVars(opts({ border: 'none' }))).toEqual({ '--md-table-bw': '0px' })
    expect(tableCssVars(opts({ border: 'thick' }))).toEqual({ '--md-table-bw': '3px' })
  })

  it('没写的项不产出变量(留给全局默认)', () => {
    expect(tableCssVars(opts({ color: '#abc' }))).toEqual({ '--md-table-bc': '#abc' })
    expect(tableCssVars(opts({}))).toEqual({})
  })

  it('列宽 / 行高不进 CSS 变量 —— 它们要变成 <colgroup> 与 <tr> 的行内样式', () => {
    expect(tableCssVars(opts({ cols: [200], rows: [48] }))).toEqual({})
  })
})

describe('mergeTableOptions', () => {
  it('单表没写的落回全局', () => {
    expect(mergeTableOptions(opts({ border: 'thin', color: '#111' }), opts({ border: 'none' }))).toEqual(
      opts({ border: 'none', color: '#111' })
    )
  })

  it('单表全没写就是全局原样', () => {
    const base = opts({ border: 'medium', color: '#222', cols: [200, null] })
    expect(mergeTableOptions(base, opts({}))).toEqual(base)
  })

  it('列宽 / 行高同样按「单表优先」合并', () => {
    const merged = mergeTableOptions(opts({ cols: [200, null] }), opts({ cols: [120, 300] }))
    expect(merged.cols).toEqual([120, 300])
  })
})
