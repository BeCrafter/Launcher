import { describe, expect, it } from 'vitest'
import { noteFileIcon } from './note-file'

describe('noteFileIcon', () => {
  it('按扩展名分类,大小写不敏感', () => {
    expect(noteFileIcon('PNG')).toBe('fa-file-image')
    expect(noteFileIcon('pdf')).toBe('fa-file-pdf')
    expect(noteFileIcon('docx')).toBe('fa-file-word')
    expect(noteFileIcon('mp4')).toBe('fa-file-video')
    expect(noteFileIcon('flac')).toBe('fa-file-audio')
    expect(noteFileIcon('zip')).toBe('fa-file-zipper')
    expect(noteFileIcon('html')).toBe('fa-file-code')
  })

  it('不认识 / 无扩展名用通用图标', () => {
    expect(noteFileIcon('')).toBe('fa-file')
    expect(noteFileIcon('weird')).toBe('fa-file')
  })
})
