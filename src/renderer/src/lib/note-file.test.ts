import { describe, expect, it } from 'vitest'
import { fileKind, noteFileIcon } from './note-file'

describe('fileKind', () => {
  it('已知类型一一对应', () => {
    expect(fileKind('js')).toBe('code')
    expect(fileKind('ts')).toBe('code')
    expect(fileKind('css')).toBe('code')
    expect(fileKind('json')).toBe('code')
    expect(fileKind('txt')).toBe('text')
    expect(fileKind('md')).toBe('markdown')
    expect(fileKind('csv')).toBe('csv')
    expect(fileKind('tsv')).toBe('csv')
    expect(fileKind('html')).toBe('html')
    expect(fileKind('png')).toBe('image')
    expect(fileKind('svg')).toBe('image')
    expect(fileKind('pdf')).toBe('pdf')
    expect(fileKind('mp4')).toBe('video')
    expect(fileKind('wav')).toBe('audio')
    expect(fileKind('docx')).toBe('docx')
    expect(fileKind('xlsx')).toBe('xlsx')
    expect(fileKind('pptx')).toBe('pptx')
    expect(fileKind('doc')).toBe('legacy-office')
    expect(fileKind('zip')).toBe('archive')
    expect(fileKind('tar')).toBe('archive')
    expect(fileKind('tgz')).toBe('archive')
    expect(fileKind('gz')).toBe('archive')
    expect(fileKind('rar')).toBe('archive-unsupported')
    expect(fileKind('7z')).toBe('archive-unsupported')
    expect(fileKind('glb')).toBe('model')
    expect(fileKind('stl')).toBe('model')
    expect(fileKind('psd')).toBe('psd')
    expect(fileKind('tiff')).toBe('tiff')
    expect(fileKind('heic')).toBe('heic')
  })

  it('大小写不敏感', () => {
    expect(fileKind('PNG')).toBe('image')
    expect(fileKind('HTML')).toBe('html')
  })

  it('无扩展名的文本类文件名兜底;其余未知 → unsupported', () => {
    expect(fileKind('', 'Makefile')).toBe('code')
    expect(fileKind('', 'LICENSE')).toBe('text')
    expect(fileKind('', 'README')).toBe('text')
    expect(fileKind('weird')).toBe('unsupported')
    expect(fileKind('', 'unknown')).toBe('unsupported')
  })
})

describe('noteFileIcon', () => {
  it('每个 kind 都有图标,且未知扩展名用通用图标', () => {
    expect(noteFileIcon('PNG')).toBe('fa-file-image')
    expect(noteFileIcon('pdf')).toBe('fa-file-pdf')
    expect(noteFileIcon('docx')).toBe('fa-file-word')
    expect(noteFileIcon('xlsx')).toBe('fa-file-excel')
    expect(noteFileIcon('pptx')).toBe('fa-file-powerpoint')
    expect(noteFileIcon('mp4')).toBe('fa-file-video')
    expect(noteFileIcon('flac')).toBe('fa-file-audio')
    expect(noteFileIcon('zip')).toBe('fa-file-zipper')
    expect(noteFileIcon('html')).toBe('fa-file-code')
    expect(noteFileIcon('csv')).toBe('fa-file-csv')
    expect(noteFileIcon('glb')).toBe('fa-cube')
    expect(noteFileIcon('', 'Dockerfile')).toBe('fa-file-code')
  })

  it('不认识 / 无扩展名用通用图标', () => {
    expect(noteFileIcon('')).toBe('fa-file')
    expect(noteFileIcon('weird')).toBe('fa-file')
  })
})
