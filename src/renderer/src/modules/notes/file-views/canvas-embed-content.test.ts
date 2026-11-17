import { describe, expect, it, vi } from 'vitest'
import type { EmbedCard } from './canvas-embed-cards'
import {
  createCardContentLoader,
  mapWithLimit,
  type CardContentDeps
} from './canvas-embed-content'

function card(id: string, source: EmbedCard['source'], cacheKey = `${id}:key`): EmbedCard {
  return {
    id,
    kind: 'text',
    mode: 'text',
    badge: 'vault',
    token: 'TXT',
    accent: '#000',
    label: id,
    rect: { x: 0, y: 0, width: 100, height: 100, angle: 0 },
    source,
    cacheKey
  }
}

function deps(overrides: Partial<CardContentDeps> = {}): CardContentDeps {
  return {
    readNote: vi.fn(async () => null),
    readTextFile: vi.fn(async () => null),
    statFile: vi.fn(async () => ({ size: 10, mime: 'text/plain' })),
    readBytes: vi.fn(async () => null),
    probeExternal: vi.fn(async () => false),
    fetchExternalText: vi.fn(async () => null),
    fetchExternalBytes: vi.fn(async () => null),
    decodeImage: vi.fn(async () => ({ url: 'data:x', objectUrl: false })),
    loadImage: vi.fn(async () => ({}) as CanvasImageSource),
    loadImageBytes: vi.fn(async () => ({}) as CanvasImageSource),
    revokeUrl: vi.fn(),
    renderPdfFirstPage: vi.fn(async () => null),
    renderBoardThumbnail: vi.fn(async () => null),
    ...overrides
  }
}

const signal = () => new AbortController().signal

describe('createCardContentLoader', () => {
  it('笔记读正文并按 markdown 压成卡片文字', async () => {
    const loader = createCardContentLoader(
      deps({ readNote: vi.fn(async () => '# 标题\n正文一行') })
    )
    const noteCard = card('n', { kind: 'note', noteId: 'n' })
    const out = await loader.load([noteCard], { signal: signal(), theme: 'light' })
    expect(out.get('n')).toEqual({
      mode: 'text',
      heading: '标题',
      lines: ['正文一行'],
      mono: false
    })
  })

  it('同一缓存键只读一次,两块卡片都拿到内容', async () => {
    const readTextFile = vi.fn(async () => '正文')
    const loader = createCardContentLoader(deps({ readTextFile }))
    const source: EmbedCard['source'] = { kind: 'file', path: 'a.txt', fileKind: 'text' }
    const cards = [card('a', source, 'same'), card('b', source, 'same')]
    const out = await loader.load(cards, { signal: signal(), theme: 'light' })
    expect(readTextFile).toHaveBeenCalledTimes(1)
    expect(out.get('a')?.mode).toBe('text')
    expect(out.get('b')?.mode).toBe('text')
  })

  it('并发不超过上限', async () => {
    let active = 0
    let peak = 0
    const readTextFile = vi.fn(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return 'x'
    })
    const loader = createCardContentLoader(deps({ readTextFile }))
    const cards = Array.from({ length: 8 }, (_, index) =>
      card(`c${index}`, { kind: 'file', path: `${index}.txt`, fileKind: 'text' }, `k${index}`)
    )
    await loader.load(cards, { signal: signal(), theme: 'light', concurrency: 3 })
    expect(readTextFile).toHaveBeenCalledTimes(8)
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('单项超时静默回 failed,不影响其他卡片', async () => {
    const readTextFile = vi.fn(async (path: string) =>
      path === 'slow.txt' ? new Promise<string>(() => {}) : '快'
    )
    const loader = createCardContentLoader(deps({ readTextFile }))
    const out = await loader.load(
      [
        card('slow', { kind: 'file', path: 'slow.txt', fileKind: 'text' }, 'slow'),
        card('fast', { kind: 'file', path: 'fast.txt', fileKind: 'text' }, 'fast')
      ],
      { signal: signal(), theme: 'light', timeoutMs: 20 }
    )
    expect(out.get('slow')).toEqual({ mode: 'failed', reason: 'timeout' })
    expect(out.get('fast')?.mode).toBe('text')
  })

  it('一个读取出错不会拖垮整批', async () => {
    const readTextFile = vi.fn(async (path: string) => {
      if (path === 'bad.txt') throw new Error('io')
      return 'ok'
    })
    const loader = createCardContentLoader(deps({ readTextFile }))
    const out = await loader.load(
      [
        card('bad', { kind: 'file', path: 'bad.txt', fileKind: 'text' }, 'bad'),
        card('good', { kind: 'file', path: 'good.txt', fileKind: 'text' }, 'good')
      ],
      { signal: signal(), theme: 'light' }
    )
    expect(out.get('bad')).toEqual({ mode: 'failed', reason: 'error' })
    expect(out.get('good')?.mode).toBe('text')
  })

  it('已中止的批次不再读任何东西', async () => {
    const controller = new AbortController()
    controller.abort()
    const readTextFile = vi.fn(async () => 'x')
    const loader = createCardContentLoader(deps({ readTextFile }))
    const out = await loader.load(
      [card('a', { kind: 'file', path: 'a.txt', fileKind: 'text' })],
      { signal: controller.signal, theme: 'light' }
    )
    expect(readTextFile).not.toHaveBeenCalled()
    expect(out.size).toBe(0)
  })

  it('类型卡不读文件', async () => {
    const readTextFile = vi.fn(async () => 'x')
    const loader = createCardContentLoader(deps({ readTextFile }))
    const typeCard: EmbedCard = {
      ...card('w', { kind: 'web', url: 'https://example.com' }, 'web'),
      mode: 'type',
      cacheKey: null
    }
    const out = await loader.load([typeCard], { signal: signal(), theme: 'light' })
    expect(out.get('w')).toEqual({ mode: 'type' })
    expect(readTextFile).not.toHaveBeenCalled()
  })

  it('文件缺失回 missing,超大回 too-large', async () => {
    const loader = createCardContentLoader(
      deps({
        readTextFile: vi.fn(async () => null),
        statFile: vi.fn(async (path: string) => ({
          size: path === 'big.txt' ? 10 * 1024 * 1024 : 10,
          mime: 'text/plain'
        }))
      })
    )
    const out = await loader.load(
      [
        card('gone', { kind: 'file', path: 'gone.txt', fileKind: 'text' }, 'gone'),
        card('big', { kind: 'file', path: 'big.txt', fileKind: 'text' }, 'big')
      ],
      { signal: signal(), theme: 'light' }
    )
    expect(out.get('gone')).toEqual({ mode: 'failed', reason: 'missing' })
    expect(out.get('big')).toEqual({ mode: 'failed', reason: 'too-large' })
  })

  it('库外文件:原文件在就 fetch 原文件,否则读打包副本', async () => {
    const readTextFile = vi.fn(async () => '副本')
    const fetchExternalText = vi.fn(async () => '原文件')
    const loader = createCardContentLoader(
      deps({
        readTextFile,
        fetchExternalText,
        probeExternal: vi.fn(async () => true)
      })
    )
    const external: EmbedCard['source'] = {
      kind: 'external',
      path: '/tmp/a.txt',
      embed: { source: '/tmp/a.txt', project: '', host: 'h' },
      fileKind: 'text'
    }
    await loader.load([card('ext', external, 'ext')], { signal: signal(), theme: 'light' })
    expect(fetchExternalText).toHaveBeenCalledWith('/tmp/a.txt', expect.any(Number))
    expect(readTextFile).not.toHaveBeenCalled()
  })
})

describe('mapWithLimit', () => {
  it('保持输入顺序', async () => {
    const out = await mapWithLimit([30, 10, 20], 2, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, value))
      return value * 2
    })
    expect(out).toEqual([60, 20, 40])
  })
})
