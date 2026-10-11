import { describe, expect, it } from 'vitest'
import { alignOf, isAlignClose, isAlignOpen, setBlockAlign } from './note-align'

describe('识别包裹行', () => {
  it('只认自己写出去的那一种形态', () => {
    expect(isAlignOpen('<div align="center">')).toBe(true)
    expect(isAlignOpen('<p align="right">')).toBe(true)
    expect(isAlignOpen("<div align='left'>")).toBe(true)
    expect(isAlignOpen('  <div align="center">  ')).toBe(true)
  })

  it('别的东西一概不认(不解析 HTML)', () => {
    expect(isAlignOpen('<div class="x">')).toBe(false)
    expect(isAlignOpen('<div align="justify">')).toBe(false)
    expect(isAlignOpen('<span align="center">')).toBe(false)
    expect(isAlignOpen('普通文字 <div align="center">')).toBe(false)
  })

  it('alignOf 读出方向', () => {
    expect(alignOf('<div align="center">')).toBe('center')
    expect(alignOf('<p align="RIGHT">')).toBe('right')
    expect(alignOf('随便一行')).toBeNull()
  })

  it('闭合行', () => {
    expect(isAlignClose('</div>')).toBe(true)
    expect(isAlignClose('</p>')).toBe(true)
    expect(isAlignClose('</span>')).toBe(false)
  })
})

describe('setBlockAlign', () => {
  const BODY = ['前言', '', '这一行要居中', '', '后记'].join('\n')

  it('把选中的行包起来,前后各留一个空行', () => {
    expect(setBlockAlign(BODY, 2, 2, 'center')).toBe(
      ['前言', '', '<div align="center">', '', '这一行要居中', '', '</div>', '', '后记'].join('\n')
    )
  })

  it('**左对齐 = 只摘不包**(左对齐就是 Markdown 的默认)', () => {
    const wrapped = setBlockAlign(BODY, 2, 2, 'center')!
    const back = setBlockAlign(wrapped, 4, 4, 'left')!
    expect(back).toBe(BODY)
  })

  it('**反复换对齐不会套娃** —— 旧的包裹行会被摘掉', () => {
    const once = setBlockAlign(BODY, 2, 2, 'center')!
    const twice = setBlockAlign(once, 4, 4, 'right')!
    expect(twice.match(/<div align=/g)?.length).toBe(1)
    expect(twice).toContain('<div align="right">')
    expect(twice).not.toContain('center')
  })

  it('多行一起包', () => {
    const body = ['甲', '乙', '丙'].join('\n')
    const out = setBlockAlign(body, 0, 2, 'right')!
    expect(out).toBe(['<div align="right">', '', '甲', '乙', '丙', '', '</div>'].join('\n'))
  })

  it('区间非法 → null(不猜)', () => {
    expect(setBlockAlign(BODY, 2, 99, 'center')).toBeNull()
    expect(setBlockAlign(BODY, -1, 2, 'center')).toBeNull()
    expect(setBlockAlign(BODY, 3, 2, 'center')).toBeNull()
  })

  it('前后文逐字节不变', () => {
    const out = setBlockAlign(BODY, 2, 2, 'center')!
    expect(out.startsWith('前言\n\n')).toBe(true)
    expect(out.endsWith('\n\n后记')).toBe(true)
  })

  it('幂等:同一段用同一个方向连做两次,结果相同', () => {
    const once = setBlockAlign(BODY, 2, 2, 'center')!
    const twice = setBlockAlign(once, 4, 4, 'center')!
    expect(twice).toBe(once)
  })
})
