// draw.io iframe 的握手与消息协议(组件级)。
//
// E2E 用真 stub 页跑通了正常链路;这里补的是 E2E 不方便覆盖的边界:
// - configure 只回配置、不算握手完成;init 之前一直算加载中
// - 离线页有 15s 握手超时与「load 之后 8s 还没 init」的快失败
// - 在线页不能用 iframe load 判死(主程序是 load 之后才动态注入的)
// - 只处理自己 iframe 发来的、origin 允许的消息
// - exportXml:未握手直接 null;导出超时也 null,不让切文件卡住

import { act, fireEvent, render } from '@testing-library/react'
import { createRef, type ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DRAWIO_ONLINE_ORIGIN } from '@shared/drawio'
import { DrawioFrame, type DrawioFrameHandle } from './DrawioFrame'

type Props = Partial<ComponentProps<typeof DrawioFrame>>

function mount(props: Props = {}): {
  container: HTMLElement
  iframe: HTMLIFrameElement
  post: ReturnType<typeof vi.spyOn>
  ref: React.RefObject<DrawioFrameHandle | null>
  onError: ReturnType<typeof vi.fn>
  onReady: ReturnType<typeof vi.fn>
  onAutosave: ReturnType<typeof vi.fn>
  onSave: ReturnType<typeof vi.fn>
  onOpenLink: ReturnType<typeof vi.fn>
} {
  const onError = vi.fn()
  const onReady = vi.fn()
  const onAutosave = vi.fn()
  const onSave = vi.fn()
  const onOpenLink = vi.fn()
  const ref = createRef<DrawioFrameHandle>()
  const view = render(
    <DrawioFrame
      xml="<mxfile/>"
      mode="offline"
      dark
      onError={onError}
      onReady={onReady}
      onAutosave={onAutosave}
      onSave={onSave}
      onOpenLink={onOpenLink}
      ref={ref}
      {...props}
    />
  )
  const iframe = view.container.querySelector('iframe')
  if (iframe === null) throw new Error('没有渲染 iframe')
  const post = vi.spyOn(iframe.contentWindow as Window, 'postMessage')
  return {
    container: view.container,
    iframe,
    post,
    ref,
    onError,
    onReady,
    onAutosave,
    onSave,
    onOpenLink
  }
}

/** 模拟 iframe 发来一条消息。draw.io 真身两个方向都用 JSON 字符串。 */
function send(
  iframe: HTMLIFrameElement,
  message: unknown,
  { origin = 'launcher-drawio://app', source }: { origin?: string; source?: MessageEventSource | null } = {}
): void {
  const data = typeof message === 'string' ? message : JSON.stringify(message)
  const event = new MessageEvent('message', {
    data,
    origin,
    source: source === undefined ? (iframe.contentWindow as unknown as MessageEventSource) : source
  })
  act(() => {
    window.dispatchEvent(event)
  })
}

const posted = (post: {
  mock: { calls: unknown[][] }
}): Array<Record<string, unknown>> =>
  post.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)

afterEach(() => {
  vi.useRealTimers()
})

describe('configure 握手', () => {
  it('收到 configure 就回主题配置,但还停在加载中,等 init 才握手完成', () => {
    const { iframe, post, container, onReady } = mount()

    send(iframe, { event: 'configure' })

    const configure = posted(post).find((m) => m.action === 'configure')
    expect(configure).toBeDefined()
    const config = configure?.config as { customCss: string }
    expect(config.customCss).toContain(':root:root')
    expect(config.customCss).toContain('color-scheme: dark;')
    expect(config.customCss).toContain('--ge-panel-color: #151522;')
    expect(container.querySelector('.drawio-loading')).not.toBeNull()
    expect(onReady).not.toHaveBeenCalled()
  })

  it('JSON 字符串形式的消息也一样认(真实 draw.io 就是这么发的)', () => {
    const { iframe, post } = mount()
    send(iframe, '{"event":"configure"}')
    expect(posted(post).some((m) => m.action === 'configure')).toBe(true)
  })

  it('init 之后回 load 消息,并通知父组件可以用了', () => {
    const { iframe, post, container, onReady } = mount()

    send(iframe, { event: 'init' })

    expect(posted(post).at(-1)).toEqual({
      action: 'load',
      xml: '<mxfile/>',
      autosave: 1,
      dark: true
    })
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.drawio-loading')).toBeNull()
  })

  it('lightbox 不发 autosave', () => {
    const { iframe, post } = mount({ lightbox: true })
    send(iframe, { event: 'init' })
    expect(posted(post).at(-1)).toMatchObject({ action: 'load', autosave: 0 })
  })
})

describe('消息来源', () => {
  it('不是自己 iframe 发来的一律不理', () => {
    const { iframe, post, onAutosave } = mount()
    send(iframe, { event: 'autosave', xml: '<mxfile>劫持</mxfile>' }, { source: window as never })
    expect(onAutosave).not.toHaveBeenCalled()
    expect(posted(post)).toHaveLength(0)
  })

  it('在线页只接受 embed.diagrams.net 的 origin', () => {
    const { iframe, post } = mount({ mode: 'online' })
    send(iframe, { event: 'init' }, { origin: 'https://evil.example' })
    expect(posted(post)).toHaveLength(0)
    send(iframe, { event: 'init' }, { origin: DRAWIO_ONLINE_ORIGIN })
    expect(posted(post).at(-1)).toMatchObject({ action: 'load' })
  })

  it('坏消息(非 JSON、缺字段)不抛异常也不触发回调', () => {
    const { iframe, post, onAutosave } = mount()
    send(iframe, 'not json')
    send(iframe, { event: 'autosave' })
    expect(onAutosave).not.toHaveBeenCalled()
    expect(posted(post)).toHaveLength(0)
  })
})

describe('保存与导出', () => {
  it('autosave / save 分别交给对应回调', () => {
    const { iframe, onAutosave, onSave } = mount()
    send(iframe, { event: 'autosave', xml: '<mxfile>auto</mxfile>' })
    send(iframe, { event: 'save', xml: '<mxfile>manual</mxfile>' })
    expect(onAutosave).toHaveBeenCalledWith('<mxfile>auto</mxfile>')
    expect(onSave).toHaveBeenCalledWith('<mxfile>manual</mxfile>')
  })

  it('openLink 交给父组件(由应用决定用什么打开)', () => {
    const { iframe, onOpenLink } = mount()
    send(iframe, { event: 'openLink', href: 'https://example.com/a' })
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/a')
  })

  it('还没握手时导出直接给 null,不发消息', async () => {
    const { ref, post } = mount()
    await expect(ref.current?.exportXml()).resolves.toBeNull()
    expect(posted(post)).toHaveLength(0)
  })

  it('握手后导出:发 export 请求,收到 export 消息时 resolve', async () => {
    const { iframe, ref, post } = mount()
    send(iframe, { event: 'init' })

    let result: Promise<string | null> | null = null
    act(() => {
      result = ref.current?.exportXml() ?? null
    })
    expect(posted(post).at(-1)).toEqual({ action: 'export', format: 'xml' })

    send(iframe, { event: 'export', format: 'xml', xml: '<mxfile>final</mxfile>' })
    await expect(result!).resolves.toBe('<mxfile>final</mxfile>')
  })

  it('导出没人回:1.5 秒后给 null,不把切文件卡死', async () => {
    vi.useFakeTimers()
    const { iframe, ref } = mount()
    send(iframe, { event: 'init' })

    let result: Promise<string | null> | null = null
    act(() => {
      result = ref.current?.exportXml() ?? null
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    await expect(result!).resolves.toBeNull()
  })
})

describe('加载失败', () => {
  it('离线页 15 秒还没握手 → timeout', () => {
    vi.useFakeTimers()
    const { onError } = mount()
    act(() => {
      vi.advanceTimersByTime(15_000)
    })
    expect(onError).toHaveBeenCalledWith('timeout')
  })

  it('离线页 load 之后 8 秒还没 init → 立刻报 load(包坏了)', () => {
    vi.useFakeTimers()
    const { iframe, onError } = mount()
    act(() => {
      fireEvent.load(iframe)
    })
    act(() => {
      vi.advanceTimersByTime(8_000)
    })
    expect(onError).toHaveBeenCalledWith('load')
  })

  it('在线页 load 之后不判死(主程序还在下载,可能几十秒)', () => {
    vi.useFakeTimers()
    const { iframe, onError } = mount({ mode: 'online' })
    act(() => {
      fireEvent.load(iframe)
    })
    act(() => {
      vi.advanceTimersByTime(8_000)
    })
    expect(onError).not.toHaveBeenCalled()
    // 但总上限仍在:60 秒后才判超时
    act(() => {
      vi.advanceTimersByTime(52_000)
    })
    expect(onError).toHaveBeenCalledWith('timeout')
  })

  it('握手成功后不再误报超时', () => {
    vi.useFakeTimers()
    const { iframe, onError } = mount()
    send(iframe, { event: 'init' })
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(onError).not.toHaveBeenCalled()
  })
})
