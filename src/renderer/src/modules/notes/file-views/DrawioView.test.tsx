// draw.io 文件视图的状态分支。
//
// iframe 本身在 DrawioFrame.test.tsx 里测;这里把它换成一个会记录 props 的桩,
// 只看 DrawioView 怎么决定「显示加载 / 错误 / 提示条 / 编辑器」:
// - 内容不是图表 XML:给错误页,「用空白图表替换」把合法空白图交给上层写盘
// - 加载失败:重试换 key 重挂 iframe;离线和在线各自给对的出口
// - 选了离线但没装包:临时用在线,同时提示可以安装
// - 主题只在打开时取一次:编辑中切主题不重挂画布

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isDrawioText } from '@shared/drawio'
import type { DrawioStatus } from '@shared/drawio'
import { useDrawioStore } from '../../../state/drawio-store'
import { DrawioView } from './DrawioView'

const frameMock = vi.hoisted(() => ({
  mounts: 0,
  props: [] as Array<Record<string, unknown>>
}))

vi.mock('./DrawioFrame', async () => {
  const React = await import('react')
  return {
    DrawioFrame: (props: Record<string, unknown>) => {
      // 按真实挂载计数(key 变了才会重挂),普通重渲染不算
      const idRef = React.useRef<number | null>(null)
      if (idRef.current === null) {
        frameMock.mounts += 1
        idRef.current = frameMock.mounts
      }
      frameMock.props.push(props)
      return React.createElement(
        'div',
        {
          'data-testid': 'drawio-frame',
          'data-mode': props.mode,
          'data-dark': String(props.dark),
          'data-lightbox': String(props.lightbox ?? false)
        },
        React.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'frame-fail',
            onClick: () => (props.onError as ((reason: string) => void) | undefined)?.('timeout')
          },
          '模拟加载失败'
        )
      )
    }
  }
})

const installed: DrawioStatus = {
  installed: true,
  version: '32.6.10',
  stub: false,
  downloading: false
}
const missing: DrawioStatus = { ...installed, installed: false }

function seed(
  state: Partial<ReturnType<typeof useDrawioStore.getState>> = {}
): void {
  useDrawioStore.setState({
    status: installed,
    mode: 'offline',
    phase: 'idle',
    progress: null,
    error: null,
    ...state
  })
}

function renderView(
  props: Partial<Parameters<typeof DrawioView>[0]> = {}
): { onReplace: ReturnType<typeof vi.fn>; container: HTMLElement } {
  const onReplace = vi.fn()
  const view = render(
    <DrawioView
      text="<mxfile><diagram/></mxfile>"
      onAutosave={vi.fn()}
      onSave={vi.fn()}
      onReplace={onReplace}
      onOpenLink={vi.fn()}
      {...props}
    />
  )
  return { onReplace, container: view.container }
}

const frame = (): HTMLElement | null => screen.queryByTestId('drawio-frame')

beforeEach(() => {
  frameMock.mounts = 0
  frameMock.props = []
})

/** 让假 iframe 报一次加载失败(DrawioView 会切到错误页)。 */
function failFrame(): void {
  fireEvent.click(screen.getByTestId('frame-fail'))
}

describe('加载与内容', () => {
  it('状态还没读到时先给加载中,不急着挂 iframe', () => {
    seed({ status: null })
    const { container } = renderView()
    expect(container.querySelector('.drawio-loading')).not.toBeNull()
    expect(frame()).toBeNull()
  })

  it('合法图表:按有效模式挂 iframe', () => {
    seed({ mode: 'offline' })
    renderView()
    expect(frame()?.dataset.mode).toBe('offline')
    expect(frame()?.dataset.lightbox).toBe('false')
  })

  it('选了离线但没装包:临时用在线,并提示可以安装', () => {
    seed({ mode: 'offline', status: missing })
    const { container } = renderView()
    expect(frame()?.dataset.mode).toBe('online')
    const notice = container.querySelector('.drawio-notice')
    expect(notice).not.toBeNull()
    fireEvent.click(notice!.querySelector('.d-btn')!)
    return waitFor(() => expect(useDrawioStore.getState().phase).toBe('confirm'))
  })

  it('内容不是图表 XML:给错误页和「用空白图表替换」', () => {
    seed()
    const { onReplace } = renderView({ text: '# 这是一篇笔记' })
    expect(frame()).toBeNull()
    const button = screen.getByRole('button', { name: '用空白图表替换' })
    fireEvent.click(button)
    expect(onReplace).toHaveBeenCalledTimes(1)
    const xml = onReplace.mock.calls[0]?.[0] as string
    expect(isDrawioText(xml)).toBe(true)
    expect(xml).toContain('<mxGraphModel')
  })
})

describe('加载失败', () => {
  it('离线失败:重试会换 key 重挂 iframe,错误页消失', async () => {
    seed({ mode: 'offline' })
    const { container } = renderView()
    failFrame()
    await waitFor(() => expect(container.querySelector('.drawio-error')).not.toBeNull())
    expect(frame()).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(frame()).not.toBeNull())
    expect(frameMock.mounts).toBe(2)
    expect(container.querySelector('.drawio-error')).toBeNull()
  })

  it('离线失败又不想重试:可以切回在线', async () => {
    seed({ mode: 'offline' })
    renderView()
    failFrame()
    fireEvent.click(await screen.findByRole('button', { name: '切回在线' }))
    await waitFor(() => expect(useDrawioStore.getState().mode).toBe('online'))
    await waitFor(() => expect(frame()?.dataset.mode).toBe('online'))
  })

  it('在线失败且已装包:一键切到离线', async () => {
    seed({ mode: 'online', status: installed })
    renderView()
    failFrame()
    fireEvent.click(await screen.findByRole('button', { name: '切换到离线' }))
    await waitFor(() => expect(useDrawioStore.getState().mode).toBe('offline'))
    await waitFor(() => expect(frame()?.dataset.mode).toBe('offline'))
  })

  it('在线失败且没装包:还能点「安装离线组件」走下载确认', async () => {
    seed({ mode: 'online', status: missing })
    renderView()
    failFrame()
    const install = await screen.findByRole('button', { name: '安装离线组件' })
    expect(install).toBeEnabled()
    fireEvent.click(install)
    await waitFor(() => expect(useDrawioStore.getState().phase).toBe('confirm'))
  })
})

describe('主题快照', () => {
  it('打开时是浅色,之后切到深色也不重挂/不换 dark', async () => {
    document.body.classList.add('light-theme')
    seed()
    renderView()
    expect(frame()?.dataset.dark).toBe('false')

    act(() => {
      document.body.classList.remove('light-theme')
    })
    await waitFor(() => expect(document.body.classList.contains('light-theme')).toBe(false))
    // useEffectiveTheme 已经重渲染,但 darkRef 仍是打开时那份
    expect(frame()?.dataset.dark).toBe('false')
    expect(frameMock.mounts).toBe(1)
  })

  it('打开时是深色就不受后续浅色影响', async () => {
    seed()
    renderView()
    expect(frame()?.dataset.dark).toBe('true')

    act(() => {
      document.body.classList.add('light-theme')
    })
    await waitFor(() => expect(document.body.classList.contains('light-theme')).toBe(true))
    expect(frame()?.dataset.dark).toBe('true')
  })
})
