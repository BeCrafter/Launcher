// 笔记 / 文本文件在小地图卡片里画什么:把 Markdown 压成几行可读的纯文本。
//
// 纯函数,node 单测直接跑。小地图只有 180×120,正文最终只是几像素高的纹理,
// 这里不追求完整渲染,只保留「标题 + 几行正文」的形状。

export type CardTextKind = 'note' | 'markdown' | 'text' | 'code' | 'csv'

export interface CardTextPreview {
  heading: string | null
  lines: string[]
  mono: boolean
  truncated: boolean
}

const DEFAULT_MAX_LINES = 40
const DEFAULT_MAX_CHARS = 600

export function cardTextPreview(input: {
  text: string
  kind: CardTextKind
  maxLines?: number
  maxChars?: number
}): CardTextPreview {
  const maxLines = input.maxLines ?? DEFAULT_MAX_LINES
  const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS
  const source = stripFrontmatter(input.text.replace(/^﻿/, '').replace(/\r\n?/g, '\n'))
  const mono = input.kind === 'code'
  const rawLines =
    input.kind === 'code'
      ? codeLines(source)
      : input.kind === 'csv'
        ? csvLines(source)
        : markdownLines(source)

  let heading: string | null = null
  const lines: string[] = []
  for (const line of rawLines) {
    const text = line.trimEnd()
    if (text.trim() === '') {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
      continue
    }
    if (heading === null && input.kind !== 'code' && input.kind !== 'csv' && /^#{1,6}\s+/.test(text)) {
      heading = stripInline(text.replace(/^#{1,6}\s+/, '')).trim()
      continue
    }
    lines.push(text)
    if (lines.length >= maxLines) break
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  let truncated = lines.length >= maxLines
  let used = 0
  const clipped: string[] = []
  for (const line of lines) {
    if (used >= maxChars) {
      truncated = true
      break
    }
    const room = maxChars - used
    if (line.length > room) {
      clipped.push(line.slice(0, room))
      truncated = true
      break
    }
    clipped.push(line)
    used += line.length + 1
  }
  return { heading, lines: clipped, mono, truncated }
}

function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text
  const end = text.indexOf('\n---', 3)
  if (end < 0) return text
  const after = text.indexOf('\n', end + 4)
  return after < 0 ? '' : text.slice(after + 1)
}

function codeLines(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.replace(/\t/g, '  ').trimEnd())
}

function csvLines(source: string): string[] {
  return source
    .split('\n')
    .slice(0, 12)
    .map((line) => line.trimEnd().replace(/(?:,|\t|;)\s*/g, ' · '))
}

function markdownLines(source: string): string[] {
  const out: string[] = []
  let inFence = false
  for (const raw of source.split('\n')) {
    const line = raw.trimEnd()
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    if (/^\s*\|?\s*:?-{3,}/.test(line)) continue
    const cleaned = stripInline(
      line
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*[-*+]\s+/, '')
        .replace(/^\s*\d+\.\s+/, '')
    )
    out.push(cleaned)
  }
  return out
}

function stripInline(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
}
