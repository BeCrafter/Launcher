import { describe, expect, it } from 'vitest'
import {
  canvasLibraryPickerOptions,
  isCanvasLibraryName,
  isCanvasLibraryText,
  readCanvasLibrary
} from './canvas-library'

const library = (version: number): string =>
  JSON.stringify({ type: 'excalidrawlib', version, libraryItems: [] })

function file(name: string, text: string) {
  return { name, text: () => Promise.resolve(text) }
}

describe('canvas library files', () => {
  it('选择框只接受素材库扩展名,并且不提供所有文件', () => {
    const options = canvasLibraryPickerOptions()
    expect(options.excludeAcceptAllOption).toBe(true)
    expect(options.multiple).toBe(false)
    expect(options.types).toEqual([
      {
        description: 'Excalidraw library',
        accept: { 'application/vnd.excalidrawlib+json': ['.excalidrawlib'] }
      }
    ])
  })

  it('扩展名不区分大小写,图片和其他后缀都拒绝', () => {
    expect(isCanvasLibraryName('库.excalidrawlib')).toBe(true)
    expect(isCanvasLibraryName('库.EXCALIDRAWLIB')).toBe(true)
    expect(isCanvasLibraryName('照片.png')).toBe(false)
    expect(isCanvasLibraryName('场景.excalidraw')).toBe(false)
    expect(isCanvasLibraryName('库.excalidrawlib.png')).toBe(false)
  })

  it('只认 excalidrawlib,版本 1 和 2', () => {
    expect(isCanvasLibraryText(library(1))).toBe(true)
    expect(isCanvasLibraryText(library(2))).toBe(true)
    expect(isCanvasLibraryText(library(3))).toBe(false)
  })

  it('图片、场景文件和坏 JSON 都不是素材库', () => {
    expect(isCanvasLibraryText('\x89PNG')).toBe(false)
    expect(isCanvasLibraryText('')).toBe(false)
    expect(isCanvasLibraryText('{')).toBe(false)
    expect(
      isCanvasLibraryText(JSON.stringify({ type: 'excalidraw', version: 2, elements: [] }))
    ).toBe(false)
    expect(isCanvasLibraryText('null')).toBe(false)
    expect(isCanvasLibraryText('[]')).toBe(false)
  })

  it('扩展名不对就不读内容', async () => {
    const photo = file('照片.png', library(2))
    let read = false
    expect(
      await readCanvasLibrary({
        name: photo.name,
        text: () => {
          read = true
          return photo.text()
        }
      })
    ).toBeNull()
    expect(read).toBe(false)
  })

  it('扩展名对但内容不是素材库时返回 null', async () => {
    expect(await readCanvasLibrary(file('库.excalidrawlib', '\x89PNG'))).toBeNull()
    expect(await readCanvasLibrary(file('库.EXCALIDRAWLIB', library(2)))).not.toBeNull()
  })
})
