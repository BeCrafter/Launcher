// 小地图卡片的内容加载编排。
//
// 只做「哪块卡片读什么、怎么去重/限流/超时/中止」;真正碰 DOM 与 IPC 的实现放在
// canvas-embed-content-impl.ts。这样 node 单测能用假的 deps 跑编排,不会把
// pdfjs / Excalidraw / dataSource 拖进测试环境。
//
// 缓存按 cacheKey 存 Promise,组件生命周期内有效;换白板时由调用方清空。
// 嵌入的笔记/文件在别处被修改后,要重开白板才会更新 —— 小地图只在场景版本变化时刷新。

import { noteFileMime } from '@shared/notes'
import type { EmbedCard } from './canvas-embed-cards'
import { cardTextPreview, type CardTextKind } from './canvas-card-text'

const TEXT_MAX_BYTES = 2 * 1024 * 1024
const IMAGE_MAX_BYTES = 24 * 1024 * 1024
const PDF_MAX_BYTES = 24 * 1024 * 1024

export type CardContent =
  | { mode: 'text'; heading: string | null; lines: string[]; mono: boolean }
  | { mode: 'image'; image: CanvasImageSource }
  | { mode: 'pdf'; canvas: HTMLCanvasElement }
  | { mode: 'board'; canvas: HTMLCanvasElement }
  | { mode: 'type' }
  | {
      mode: 'failed'
      reason: 'missing' | 'too-large' | 'timeout' | 'error' | 'unsupported'
    }

export interface CardContentDeps {
  readNote(id: string): Promise<string | null>
  readTextFile(path: string): Promise<string | null>
  statFile(path: string): Promise<{ size: number; mime: string } | null>
  readBytes(path: string, maxBytes: number): Promise<Uint8Array | null>
  probeExternal(embed: { source: string; host: string }): Promise<boolean>
  fetchExternalText(abs: string, maxBytes: number): Promise<string | null>
  fetchExternalBytes(abs: string, maxBytes: number): Promise<Uint8Array | null>
  decodeImage(
    kind: 'psd' | 'tiff' | 'heic',
    bytes: Uint8Array
  ): Promise<{ url: string; objectUrl: boolean }>
  loadImage(url: string): Promise<CanvasImageSource>
  loadImageBytes(bytes: Uint8Array, mime: string): Promise<CanvasImageSource>
  revokeUrl(url: string): void
  renderPdfFirstPage(bytes: Uint8Array, maxWidth: number): Promise<HTMLCanvasElement | null>
  renderBoardThumbnail(path: string, theme: 'light' | 'dark'): Promise<HTMLCanvasElement | null>
}

export interface CardLoadOptions {
  signal: AbortSignal
  theme: 'light' | 'dark'
  concurrency?: number
  timeoutMs?: number
}

export interface CardContentLoader {
  load(cards: readonly EmbedCard[], opts: CardLoadOptions): Promise<Map<string, CardContent>>
  clear(): void
}

const DEFAULT_CONCURRENCY = 3
const DEFAULT_TIMEOUT_MS = 5000

/** 单项超时用的哨兵,避免和正常结果里的 null 混淆。 */
const TIMED_OUT = Symbol('timed-out')

export function createCardContentLoader(deps: CardContentDeps): CardContentLoader {
  const cache = new Map<string, Promise<CardContent>>()

  const contentFor = (card: EmbedCard, theme: 'light' | 'dark'): Promise<CardContent> => {
    const key = card.cacheKey
    if (key === null) return Promise.resolve({ mode: 'type' })
    // 子白板导出跟着主题走;同一张白板换主题后要重新导出。
    const cacheKey = card.mode === 'board' ? `${key}#${theme}` : key
    const hit = cache.get(cacheKey)
    if (hit !== undefined) return hit
    const started = loadCard(card, deps, theme).catch(
      (): CardContent => ({ mode: 'failed', reason: 'error' })
    )
    cache.set(cacheKey, started)
    return started
  }

  return {
    async load(cards, opts) {
      const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const results = new Map<string, CardContent>()
      const jobs: EmbedCard[] = []
      for (const card of cards) {
        if (card.mode === 'type') {
          results.set(card.id, { mode: 'type' })
          continue
        }
        jobs.push(card)
      }
      // 只有轮到某个 worker 时才真正发起读取:并发上限和 abort 都覆盖到「启动」。
      await mapWithLimit(jobs, concurrency, async (card) => {
        if (opts.signal.aborted) return
        const settled = await raceTimeout(contentFor(card, opts.theme), timeoutMs)
        if (opts.signal.aborted) return
        results.set(
          card.id,
          settled === TIMED_OUT ? { mode: 'failed', reason: 'timeout' } : settled
        )
      })
      return results
    },
    clear() {
      cache.clear()
    }
  }
}

async function loadCard(
  card: EmbedCard,
  deps: CardContentDeps,
  theme: 'light' | 'dark'
): Promise<CardContent> {
  const source = card.source
  if (source.kind === 'web') return { mode: 'type' }

  if (source.kind === 'note') {
    const body = source.noteId === undefined ? null : await deps.readNote(source.noteId)
    if (body === null) return { mode: 'failed', reason: 'missing' }
    return textContent(body, 'note')
  }

  const fileKind = source.fileKind ?? 'unsupported'
  const textKind = textKindOf(card)
  if (card.mode === 'text') {
    if (textKind === null) return { mode: 'type' }
    const read = await readText(source, deps)
    if (read.kind === 'too-large') return { mode: 'failed', reason: 'too-large' }
    if (read.kind === 'missing') return { mode: 'failed', reason: 'missing' }
    return textContent(read.text, textKind)
  }

  if (card.mode === 'image') {
    const bytes = await readBytesFor(source, deps, IMAGE_MAX_BYTES)
    if (bytes === null) return { mode: 'failed', reason: 'too-large' }
    try {
      if (fileKind === 'psd' || fileKind === 'tiff' || fileKind === 'heic') {
        const decoded = await deps.decodeImage(fileKind, bytes)
        try {
          return { mode: 'image', image: await deps.loadImage(decoded.url) }
        } finally {
          if (decoded.objectUrl) deps.revokeUrl(decoded.url)
        }
      }
      const mime = mimeOf(source, deps)
      return { mode: 'image', image: await deps.loadImageBytes(bytes, await mime) }
    } catch {
      return { mode: 'failed', reason: 'error' }
    }
  }

  if (card.mode === 'pdf') {
    const bytes = await readBytesFor(source, deps, PDF_MAX_BYTES)
    if (bytes === null) return { mode: 'failed', reason: 'too-large' }
    const canvas = await deps.renderPdfFirstPage(bytes, 360)
    return canvas === null ? { mode: 'failed', reason: 'error' } : { mode: 'pdf', canvas }
  }

  if (card.mode === 'board') {
    if (source.path === undefined) return { mode: 'type' }
    const canvas = await deps.renderBoardThumbnail(source.path, theme)
    return canvas === null ? { mode: 'failed', reason: 'error' } : { mode: 'board', canvas }
  }

  return { mode: 'type' }
}

/** 库内文件先 stat 拿真实 MIME;库外只有路径,按扩展名推。 */
function mimeOf(source: EmbedCard['source'], deps: CardContentDeps): Promise<string> {
  const path = source.path ?? ''
  const at = path.lastIndexOf('.')
  const fromName = noteFileMime(at < 0 ? '' : path.slice(at + 1))
  if (source.kind !== 'file' || path === '') return Promise.resolve(fromName)
  return deps.statFile(path).then((stat) => stat?.mime ?? fromName)
}

function textKindOf(card: EmbedCard): CardTextKind | null {
  if (card.kind === 'markdown') return 'markdown'
  if (card.kind === 'text') return 'text'
  if (card.kind === 'code') return 'code'
  if (card.kind === 'csv') return 'csv'
  return null
}

function textContent(text: string, kind: CardTextKind): CardContent {
  const preview = cardTextPreview({ text, kind })
  return {
    mode: 'text',
    heading: preview.heading,
    lines: preview.lines,
    mono: preview.mono
  }
}

type TextRead = { kind: 'ok'; text: string } | { kind: 'too-large' } | { kind: 'missing' }

async function readText(
  source: EmbedCard['source'],
  deps: CardContentDeps
): Promise<TextRead> {
  if (source.kind === 'file' && source.path !== undefined) {
    const stat = await deps.statFile(source.path)
    if (stat !== null && stat.size > TEXT_MAX_BYTES) return { kind: 'too-large' }
    const text = await deps.readTextFile(source.path)
    return text === null ? { kind: 'missing' } : { kind: 'ok', text }
  }
  if (source.kind === 'external' && source.embed !== undefined) {
    const resolved = await resolveExternal(source.embed, deps)
    if (resolved === null) return { kind: 'missing' }
    const text = resolved.project
      ? await deps.readTextFile(resolved.path)
      : await deps.fetchExternalText(resolved.path, TEXT_MAX_BYTES)
    return text === null ? { kind: 'missing' } : { kind: 'ok', text }
  }
  return { kind: 'missing' }
}

async function readBytesFor(
  source: EmbedCard['source'],
  deps: CardContentDeps,
  maxBytes: number
): Promise<Uint8Array | null> {
  if (source.kind === 'file' && source.path !== undefined) {
    const stat = await deps.statFile(source.path)
    if (stat !== null && stat.size > maxBytes) return null
    return deps.readBytes(source.path, maxBytes)
  }
  if (source.kind === 'external' && source.embed !== undefined) {
    const resolved = await resolveExternal(source.embed, deps)
    if (resolved === null) return null
    if (resolved.project) return deps.readBytes(resolved.path, maxBytes)
    return deps.fetchExternalBytes(resolved.path, maxBytes)
  }
  return null
}

/** 库外文件:原文件还在就用原文件,否则用打包副本;都没有 → null。 */
async function resolveExternal(
  embed: { source: string; project: string; host: string },
  deps: CardContentDeps
): Promise<{ path: string; project: boolean } | null> {
  const present =
    embed.source === ''
      ? false
      : await deps.probeExternal({ source: embed.source, host: embed.host })
  if (embed.source !== '' && present) return { path: embed.source, project: false }
  if (embed.project !== '') return { path: embed.project, project: true }
  return null
}

/** 限并发、保持结果顺序;abort 后不再启动新任务。 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      out[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return out
}

async function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}
