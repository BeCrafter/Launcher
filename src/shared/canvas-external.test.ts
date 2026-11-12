import { describe, expect, it } from 'vitest'
import {
  canvasExternalData,
  canvasPreviewExtensions,
  gltfSiblingNames,
  isCanvasPreviewExt,
  isCanvasPreviewName,
  readCanvasExternal,
  resolveCanvasExternalRead
} from './canvas-external'

describe('isCanvasPreviewName', () => {
  it('可预览的类型可以嵌', () => {
    for (const name of ['说明.pdf', '片.mp4', '稿.pptx', '文.docx', '模型.glb', '图.apng', '片.AVI']) {
      expect(isCanvasPreviewName(name)).toBe(true)
    }
  })

  it('白板、素材库、旧版 Office 和打不开的压缩包不嵌', () => {
    for (const name of ['板.excal', '板.excalidraw', '库.excalidrawlib', '旧.doc', '旧.ppt', '旧.xls', '包.rar']) {
      expect(isCanvasPreviewName(name)).toBe(false)
    }
  })

  it('没有扩展名的不嵌', () => {
    expect(isCanvasPreviewName('说明')).toBe(false)
    expect(isCanvasPreviewName('')).toBe(false)
  })
})

describe('canvas preview extensions', () => {
  it('类型按钮里的扩展名都能预览,选择框也收了压缩包和文本', () => {
    expect(isCanvasPreviewExt('pdf')).toBe(true)
    expect(isCanvasPreviewExt('doc')).toBe(false)
    const all = canvasPreviewExtensions()
    expect(all).toContain('mp4')
    expect(all).toContain('zip')
    expect(all).toContain('txt')
    expect(all).not.toContain('doc')
    expect(all).not.toContain('rar')
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('resolveCanvasExternalRead', () => {
  const embed = { source: '/tmp/片.mp4', project: '片.mp4', host: 'this-mac' }

  it('原文件还在,读原文件', () => {
    expect(resolveCanvasExternalRead(embed, { sourcePresent: true })).toEqual({
      kind: 'source',
      path: '/tmp/片.mp4'
    })
  })

  it('原文件不在,读项目副本', () => {
    expect(resolveCanvasExternalRead(embed, { sourcePresent: false })).toEqual({
      kind: 'project',
      path: '片.mp4'
    })
  })

  it('路径还在就读原文件,不管记的是哪台电脑', () => {
    expect(
      resolveCanvasExternalRead(
        { source: '/tmp/片.mp4', project: '片.mp4', host: 'other-mac' },
        { sourcePresent: true }
      )
    ).toEqual({ kind: 'source', path: '/tmp/片.mp4' })
  })

  it('两边都没有就是找不到', () => {
    expect(
      resolveCanvasExternalRead(
        { source: '/tmp/片.mp4', project: '', host: 'other-mac' },
        { sourcePresent: false }
      )
    ).toEqual({ kind: 'missing' })
  })
})

describe('readCanvasExternal', () => {
  it('缺字段或项目路径不合法就当没有', () => {
    expect(readCanvasExternal(null)).toBeNull()
    expect(readCanvasExternal({ embed: { source: '/a', host: 'h' } })).toEqual({
      source: '/a',
      project: '',
      host: 'h'
    })
    expect(readCanvasExternal({ embed: { source: '/a', project: '../x', host: 'h' } })).toBeNull()
    expect(readCanvasExternal({ embed: { source: '', project: '', host: 'h' } })).toBeNull()
  })

  it('写回去的形状只有这三条', () => {
    expect(canvasExternalData({ source: '/a/片.mp4', project: '', host: 'h' })).toEqual({
      embed: { source: '/a/片.mp4', project: '', host: 'h' }
    })
  })
})

describe('gltfSiblingNames', () => {
  it('只收同目录的相对路径', () => {
    const text = JSON.stringify({
      buffers: [{ uri: '模型.bin' }, { uri: 'data:application/octet-stream,AA' }, { uri: '../逃.bin' }],
      images: [{ uri: '贴图.png' }, { uri: '/abs.png' }, { uri: 'https://example.com/a.png' }]
    })
    expect(gltfSiblingNames(text)).toEqual(['模型.bin', '贴图.png'])
  })

  it('解不开或没有外部引用就是空的', () => {
    expect(gltfSiblingNames('不是 json')).toEqual([])
    expect(gltfSiblingNames(JSON.stringify({ buffers: [{ byteLength: 4 }] }))).toEqual([])
  })

  it('带目录的 uri 不收,避免把子目录外的文件带进来', () => {
    expect(gltfSiblingNames(JSON.stringify({ images: [{ uri: 'tex/a.png' }] }))).toEqual([])
  })
})
