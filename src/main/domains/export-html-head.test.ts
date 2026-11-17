import { describe, expect, it } from 'vitest'
import { injectExportHead } from './export-html-head'

describe('injectExportHead', () => {
  it('插在 head 开头', () => {
    const out = injectExportHead('<html><head><title>x</title></head></html>')
    expect(out).toContain('<head><meta charset="utf-8"><title>x</title></head>')
  })

  it('没有 head 时插在 doctype 之后', () => {
    const out = injectExportHead('<!doctype html><html><body>x</body></html>')
    expect(out.startsWith('<!doctype html><meta charset="utf-8">')).toBe(true)
  })

  it('没有 head/doctype 时插在最前面', () => {
    const out = injectExportHead('<p>x</p>')
    expect(out).toBe('<meta charset="utf-8"><p>x</p>')
  })

  it('<header> 不会被当成 <head>', () => {
    const out = injectExportHead('<!doctype html><html><header class="x">h</header></html>')
    expect(out).toContain('<header class="x">h</header>')
    expect(out.indexOf('charset')).toBeLessThan(out.indexOf('<header'))
  })
})
