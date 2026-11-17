import { describe, expect, it } from 'vitest'
import { composeNoteMarkdown } from './note-export'

const base = {
  body: '新正文\n',
  meta: {} as Record<string, never>,
  createdIso: '2026-01-01T08:00:00+08:00',
  nowIso: '2026-11-17T12:00:00+08:00',
  touchUpdated: false
}

describe('composeNoteMarkdown', () => {
  it('保留未知 frontmatter 键与注释，只替换标题', () => {
    const raw = [
      '---',
      'title: 旧标题',
      'custom: keep-me',
      '# 注释也留着',
      'created: 2026-01-01T08:00:00+08:00',
      'updated: 2026-02-02T09:00:00+08:00',
      '---',
      '旧正文',
      ''
    ].join('\n')

    const out = composeNoteMarkdown({
      ...base,
      raw,
      body: '新正文\n',
      meta: { title: '新标题' }
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.text).toContain('title: 新标题')
    expect(out.text).toContain('custom: keep-me')
    expect(out.text).toContain('# 注释也留着')
    // 导出不动 updated
    expect(out.text).toContain('updated: 2026-02-02T09:00:00+08:00')
    expect(out.text.endsWith('新正文\n')).toBe(true)
  })

  it('保留 BOM 与 CRLF', () => {
    const raw = '﻿---\r\ntitle: A\r\ncreated: 2026-01-01T08:00:00+08:00\r\n---\r\n旧\r\n'
    const out = composeNoteMarkdown({ ...base, raw, body: '新\n' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.text.charCodeAt(0)).toBe(0xfeff)
    expect(out.text).toContain('\r\n')
    expect(out.text.includes('\n') && !out.text.includes('\r\n')).toBe(false)
    expect(out.text.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('无 frontmatter 且无 meta 时不凭空长出围栏', () => {
    const out = composeNoteMarkdown({ ...base, raw: '旧正文\n', body: '新正文\n' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.text).toBe('新正文\n')
  })

  it('无 frontmatter 但有 meta 时新建 frontmatter，并补 created', () => {
    const out = composeNoteMarkdown({
      ...base,
      raw: '旧正文\n',
      meta: { title: '标题', tags: ['a'] }
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.text.startsWith('---\n')).toBe(true)
    expect(out.text).toContain('title: 标题')
    expect(out.text).toContain('created: 2026-01-01T08:00:00+08:00')
    expect(out.text).toContain('tags:')
    // 导出不写 updated
    expect(out.text).not.toContain('updated:')
  })

  it('touchUpdated=true 时写 nowIso（保存路径）', () => {
    const raw = '---\ntitle: A\n---\n旧\n'
    const out = composeNoteMarkdown({
      ...base,
      raw,
      touchUpdated: true,
      meta: { title: 'A' }
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.text).toContain('updated: 2026-11-17T12:00:00+08:00')
  })

  it('有围栏但缺 created 时补 created，导出仍不动 updated', () => {
    const raw = '---\ntitle: A\nupdated: 2026-02-02T09:00:00+08:00\n---\n旧\n'
    const out = composeNoteMarkdown({ ...base, raw, meta: { title: 'B' } })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.text).toContain('created: 2026-01-01T08:00:00+08:00')
    expect(out.text).toContain('updated: 2026-02-02T09:00:00+08:00')
    expect(out.text).toContain('title: B')
  })

  it('未闭合围栏 + 有 meta → 拒绝（与保存一致）', () => {
    const out = composeNoteMarkdown({
      ...base,
      raw: '---\ntitle: A\n正文\n',
      meta: { title: 'B' }
    })
    expect(out).toEqual({ ok: false, error: 'frontmatter 围栏未闭合,无法改写元数据' })
  })

  it('未闭合围栏 + 无 meta → 整份当正文，照常导出', () => {
    const out = composeNoteMarkdown({
      ...base,
      raw: '---\ntitle: A\n正文\n',
      body: '新正文\n'
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.text).toBe('新正文\n')
  })
})
