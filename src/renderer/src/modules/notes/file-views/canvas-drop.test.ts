import { describe, expect, it } from 'vitest'
import { isCanvasDropImage, isCanvasDropPreview, isCanvasImageName, isCanvasImageType } from './canvas-drop'

describe('canvas drop files', () => {
  it('图片扩展名不区分大小写,场景和素材库拒绝', () => {
    expect(isCanvasImageName('一张图.PNG')).toBe(true)
    expect(isCanvasImageName('photo.jpeg')).toBe(true)
    expect(isCanvasImageName('icon.SVG')).toBe(true)
    expect(isCanvasImageName('场景.excalidraw')).toBe(false)
    expect(isCanvasImageName('白板.excal')).toBe(false)
    expect(isCanvasImageName('库.excalidrawlib')).toBe(false)
    expect(isCanvasImageName('图.png.excal')).toBe(false)
    expect(isCanvasImageName('说明.txt')).toBe(false)
  })

  it('只认图片 MIME', () => {
    expect(isCanvasImageType('image/png')).toBe(true)
    expect(isCanvasImageType('IMAGE/JPEG')).toBe(true)
    expect(isCanvasImageType('image/svg+xml')).toBe(true)
    expect(isCanvasImageType('application/vnd.excalidraw+json')).toBe(false)
    expect(isCanvasImageType('application/json')).toBe(false)
    expect(isCanvasImageType('text/plain')).toBe(false)
  })

  it('扩展名和类型有一个不是图片就拒绝,两个都空也拒绝', () => {
    expect(isCanvasDropImage({ name: '一张图.png', type: 'image/png' })).toBe(true)
    expect(isCanvasDropImage({ name: '一张图.png', type: '' })).toBe(true)
    expect(isCanvasDropImage({ name: '', type: 'image/png' })).toBe(true)
    expect(isCanvasDropImage({ name: '场景.excalidraw', type: 'application/json' })).toBe(false)
    expect(isCanvasDropImage({ name: '场景.excal', type: '' })).toBe(false)
    expect(isCanvasDropImage({ name: '库.excalidrawlib', type: 'application/json' })).toBe(false)
    expect(isCanvasDropImage({ name: '一张图.png', type: 'application/json' })).toBe(false)
    expect(isCanvasDropImage({ name: '场景.excalidraw', type: 'image/png' })).toBe(false)
    expect(isCanvasDropImage({ name: '', type: '' })).toBe(false)
    expect(isCanvasDropImage({ name: '说明.txt', type: 'text/plain' })).toBe(false)
  })

  it('可预览的文件可以嵌,白板、素材库和旧版 Office 不行', () => {
    expect(isCanvasDropPreview({ name: '说明.pdf', type: 'application/pdf' })).toBe(true)
    expect(isCanvasDropPreview({ name: '片.mp4', type: '' })).toBe(true)
    expect(isCanvasDropPreview({ name: '稿.pptx', type: '' })).toBe(true)
    expect(isCanvasDropPreview({ name: '文.docx', type: '' })).toBe(true)
    expect(isCanvasDropPreview({ name: '模型.glb', type: '' })).toBe(true)
    expect(isCanvasDropPreview({ name: '说明.txt', type: 'text/plain' })).toBe(true)
    expect(isCanvasDropPreview({ name: '板.excal', type: '' })).toBe(false)
    expect(isCanvasDropPreview({ name: '库.excalidrawlib', type: 'application/json' })).toBe(false)
    expect(isCanvasDropPreview({ name: '旧.doc', type: '' })).toBe(false)
    expect(isCanvasDropPreview({ name: '包.rar', type: '' })).toBe(false)
    expect(isCanvasDropPreview({ name: '', type: 'application/pdf' })).toBe(false)
  })

  it('名字和图片类型互相矛盾时不嵌', () => {
    expect(isCanvasDropPreview({ name: '说明.pdf', type: 'image/png' })).toBe(false)
    expect(isCanvasDropPreview({ name: '一张图.png', type: 'application/pdf' })).toBe(false)
    expect(isCanvasDropPreview({ name: '一张图.png', type: 'image/png' })).toBe(true)
  })
})
