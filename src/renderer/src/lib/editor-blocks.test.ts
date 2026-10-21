import { describe, expect, it } from 'vitest'
import { parseMarkdownBlocks } from './markdown-blocks'
import { suppressBlockWash } from './editor-blocks'

describe('hover wash during typing', () => {
  const blocks = parseMarkdownBlocks('# A\n\npara\n\n# B\n\ntail\n')
  const a = blocks.find((b) => b.kind === 'heading' && b.from === 0)!
  const b = blocks.find((b) => b.kind === 'heading' && b.from === 4)!

  it('suppresses the whole-block wash only when focused inside that block', () => {
    expect(suppressBlockWash(true, 0, a)).toBe(true)
    expect(suppressBlockWash(true, 2, a)).toBe(true)
    expect(suppressBlockWash(false, 0, a)).toBe(false)
    expect(suppressBlockWash(true, 0, b)).toBe(false)
    expect(suppressBlockWash(true, 6, a)).toBe(false)
  })
})
