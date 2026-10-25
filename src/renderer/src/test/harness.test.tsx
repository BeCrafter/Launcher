// 基建自检:先证明 DOM shim / launcher 桩 / store 重置真的可用,
// 再让具体组件测试依赖它们。

import { cleanup, render, screen } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { describe, expect, it, vi } from 'vitest'
import { IPC_EVENTS } from '@shared/ipc'
import { getCurrentLang } from '../i18n'
import { useAiStore } from '../state/ai-store'
import { useSettingsStore } from '../state/settings-store'
import { useUiStore } from '../state/ui-store'
import { makeEngineState, makeSettings } from './fixtures'
import { emitLauncherEvent, installLauncherStub, mockLauncher } from './launcher-stub'
import { resetRendererStores, setTestSettings } from './stores'

describe('DOM 环境', () => {
  it('补齐 jsdom 缺少的浏览器能力', () => {
    expect(typeof window.matchMedia).toBe('function')
    expect(window.matchMedia('(prefers-color-scheme: dark)').matches).toBe(false)
    expect(typeof window.ResizeObserver).toBe('function')
    expect(typeof window.IntersectionObserver).toBe('function')
    expect(typeof navigator.clipboard.writeText).toBe('function')
    expect(typeof URL.createObjectURL).toBe('function')
    expect(typeof Element.prototype.scrollIntoView).toBe('function')
  })

  it('render + jest-dom matcher 生效', () => {
    render(<div>hello</div>)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('cleanup 会移除 portal 内容', () => {
    render(createPortal(<div>portal</div>, document.body))
    expect(screen.getByText('portal')).toBeInTheDocument()
    cleanup()
    expect(screen.queryByText('portal')).not.toBeInTheDocument()
  })
})

describe('window.launcher 桩', () => {
  it('提供规范化设置与可退订的事件订阅', async () => {
    const launcher = mockLauncher()
    const settings = await launcher.getSettings()
    expect(settings).toEqual(makeSettings())
    expect(launcher.initialSettings).toEqual(makeSettings())

    const handler = vi.fn()
    const off = launcher.onEvent(IPC_EVENTS.settingsChanged, handler)
    emitLauncherEvent(IPC_EVENTS.settingsChanged, { language: 'en-US' })
    expect(handler).toHaveBeenCalledWith({ language: 'en-US' })
    off()
    emitLauncherEvent(IPC_EVENTS.settingsChanged, { language: 'zh-CN' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('允许按域覆盖默认实现', async () => {
    installLauncherStub({ ai: { skills: vi.fn(async () => []) } })
    const ai = mockLauncher().ai
    await expect(ai.skills()).resolves.toEqual([])
    // 未覆盖的默认值仍在:一层深合并而不是整块替换
    await expect(ai.getState()).resolves.toMatchObject({ configured: true })
  })

  it('setSettings 改变后续读数,且返回副本不污染桩', async () => {
    const launcher = mockLauncher()

    const clone = await launcher.getSettings()
    clone.language = 'en-US'
    await expect(launcher.getSettings()).resolves.toMatchObject({ language: 'zh-CN' })

    const updated = await launcher.setSettings({ language: 'en-US' })
    expect(updated.language).toBe('en-US')
    await expect(launcher.getSettings()).resolves.toMatchObject({ language: 'en-US' })
    // initialSettings 是「启动时那一份」,不随 setSettings 变
    expect(launcher.initialSettings.language).toBe('zh-CN')

    await launcher.resetSettings()
    await expect(launcher.getSettings()).resolves.toMatchObject({ language: 'zh-CN' })
  })

  it('重新 install 会丢弃上一轮订阅', () => {
    const stale = vi.fn()
    mockLauncher().onEvent(IPC_EVENTS.settingsChanged, stale)

    installLauncherStub()
    emitLauncherEvent(IPC_EVENTS.settingsChanged, { language: 'en-US' })

    expect(stale).not.toHaveBeenCalled()
  })

  it('未桩定的方法带路径同步抛错', () => {
    expect(() => mockLauncher().ai.mcpInfo()).toThrow(/window\.launcher\.ai\.mcpInfo 未桩定/)
  })
})

describe('store 重置', () => {
  it('本用例写入的状态', () => {
    useAiStore.setState({ engine: makeEngineState() })
    expect(useAiStore.getState().engine).not.toBeNull()
  })

  it('下一个用例看到初始状态', () => {
    expect(useAiStore.getState().engine).toBeNull()
    expect(useAiStore.getState().messages).toEqual([])
  })

  it('setTestSettings 同步语言与主题副作用', () => {
    setTestSettings({ language: 'en-US', theme: 'light' })

    expect(getCurrentLang()).toBe('en-US')
    expect(document.documentElement.lang).toBe('en-US')
    expect(document.body).toHaveClass('light-theme')
    expect(useSettingsStore.getState().settings?.language).toBe('en-US')
  })

  it('resetRendererStores 清设置、主题类、语言镜像与 storage', () => {
    setTestSettings({ language: 'en-US', theme: 'light' })
    useAiStore.setState({ engine: makeEngineState() })
    useUiStore.setState({ module: 'notes', searchQuery: 'probe' })
    localStorage.setItem('probe', '1')
    sessionStorage.setItem('probe', '1')

    resetRendererStores()

    expect(useAiStore.getState().engine).toBeNull()
    expect(useSettingsStore.getState().settings).toBeNull()
    expect(useUiStore.getState().module).toBe('agents')
    expect(useUiStore.getState().searchQuery).toBe('')
    expect(getCurrentLang()).toBe('zh-CN')
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(document.body).not.toHaveClass('light-theme')
    expect(localStorage.getItem('probe')).toBeNull()
    expect(sessionStorage.getItem('probe')).toBeNull()
  })
})
