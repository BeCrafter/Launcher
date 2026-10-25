import { describe, expect, it } from 'vitest'
import { cutUtf8, utf8Bytes } from './text'

describe('utf8Bytes', () => {
  it('按 UTF-8 计算字节数', () => {
    expect(utf8Bytes('')).toBe(0)
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('你好')).toBe(6)
    expect(utf8Bytes('😀')).toBe(4)
  })
})

describe('cutUtf8', () => {
  it('不超过上限时原样返回', () => {
    expect(cutUtf8('abc', 3)).toEqual({ text: 'abc', cut: false })
    expect(cutUtf8('你好', 6)).toEqual({ text: '你好', cut: false })
  })

  it('不切断多字节字符', () => {
    expect(cutUtf8('你好', 5)).toEqual({ text: '你', cut: true })
    expect(cutUtf8('😀😀', 5)).toEqual({ text: '😀', cut: true })
    expect(cutUtf8('a你b', 2)).toEqual({ text: 'a', cut: true })
  })

  it('上限为 0 或负数时返回空串', () => {
    expect(cutUtf8('abc', 0)).toEqual({ text: '', cut: true })
    expect(cutUtf8('abc', -1)).toEqual({ text: '', cut: true })
    expect(cutUtf8('', 0)).toEqual({ text: '', cut: false })
  })
})
