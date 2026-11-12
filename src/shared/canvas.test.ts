import { describe, expect, it } from 'vitest'
import { parseCanvas } from './canvas'

describe('parseCanvas', () => {
  it('空文本是还没写过的新文件', () => {
    expect(parseCanvas('')).toEqual({ ok: true, blank: true })
    expect(parseCanvas('   \n')).toEqual({ ok: true, blank: true })
  })

  it('解不开的文本和非对象根都是无效', () => {
    expect(parseCanvas('{ 这不是 json')).toEqual({ ok: false, error: 'invalid' })
    expect(parseCanvas('[]')).toEqual({ ok: false, error: 'invalid' })
    expect(parseCanvas('"nope"')).toEqual({ ok: false, error: 'invalid' })
  })

  it('JSON Canvas 和缺少 type 的对象不当成空白板', () => {
    expect(parseCanvas('{ "nodes": [], "edges": [] }')).toEqual({ ok: false, error: 'invalid' })
    expect(parseCanvas('{ "elements": [] }')).toEqual({ ok: false, error: 'invalid' })
  })

  it('elements 不是数组或 appState 不是对象时无效', () => {
    expect(parseCanvas('{ "type": "excalidraw", "elements": {} }')).toEqual({
      ok: false,
      error: 'invalid'
    })
    expect(parseCanvas('{ "type": "excalidraw", "appState": [] }')).toEqual({
      ok: false,
      error: 'invalid'
    })
  })

  it('认一份 Excalidraw 场景,并把原文交给调用方', () => {
    const text = '{ "type": "excalidraw", "version": 2, "elements": [] }'
    const parsed = parseCanvas(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || parsed.blank) throw new Error('应该是一份场景')
    expect(parsed.data).toEqual({ type: 'excalidraw', version: 2, elements: [] })
  })
})
