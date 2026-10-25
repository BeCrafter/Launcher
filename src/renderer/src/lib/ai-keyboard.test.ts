import { describe, expect, it } from 'vitest'
import { shouldSendOnEnter, type EnterKeyLike } from './ai-keyboard'

const enter = (patch: Partial<EnterKeyLike> = {}): EnterKeyLike => ({
  key: 'Enter',
  shiftKey: false,
  keyCode: 13,
  nativeEvent: { isComposing: false, keyCode: 13 },
  ...patch
})

describe('shouldSendOnEnter', () => {
  it('普通 Enter 发送', () => {
    expect(shouldSendOnEnter(enter(), false, false)).toBe(true)
  })

  it('Shift+Enter 换行,不发送', () => {
    expect(shouldSendOnEnter(enter({ shiftKey: true }), false, false)).toBe(false)
  })

  it('输入法组词中的 Enter 不发送(选词/确认候选)', () => {
    expect(
      shouldSendOnEnter(enter({ nativeEvent: { isComposing: true, keyCode: 229 } }), false, false)
    ).toBe(false)
    expect(shouldSendOnEnter(enter({ keyCode: 229 }), false, false)).toBe(false)
    expect(shouldSendOnEnter(enter(), true, false)).toBe(false)
  })

  it('compositionend 刚结束的同一拍不发送(旧 WebKit 顺序差异)', () => {
    expect(shouldSendOnEnter(enter(), false, true)).toBe(false)
  })

  it('其他按键不触发发送', () => {
    expect(shouldSendOnEnter(enter({ key: 'a' }), false, false)).toBe(false)
  })
})
