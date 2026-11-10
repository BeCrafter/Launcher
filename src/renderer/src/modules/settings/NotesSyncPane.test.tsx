// 同步设置的呈现。协议是一排切换,字段两列,排除规则默认折起来。
// 切走再切回来,没选中那一枝的值还在;规则不是默认时一进来就是展开的。
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotesSyncStatus } from '@shared/ipc'
import { DEFAULT_SYNC_IGNORE } from '@shared/notes'
import type { LauncherSettings } from '@shared/settings'
import { makeSettings } from '../../test/fixtures'
import { useSettingsStore } from '../../state/settings-store'
import { NotesSyncPane } from './NotesSyncPane'

const idle: NotesSyncStatus = { phase: 'idle', lastSyncAt: 0, conflicts: [], errors: [], hasSecret: {} }

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  revealSecret: vi.fn()
}))

vi.mock('../../data', () => ({
  dataSource: (): unknown => ({
    notesSync: {
      status: mocks.status,
      revealSecret: mocks.revealSecret,
      onChanged: () => () => {},
      setSecret: vi.fn(),
      syncNow: vi.fn(),
      resolve: vi.fn(),
      test: vi.fn()
    }
  })
}))

async function mount(sync: Partial<LauncherSettings['notesSync']> = {}): Promise<void> {
  const settings = makeSettings()
  useSettingsStore.setState({
    settings: { ...settings, notesSync: { ...settings.notesSync, ...sync } }
  })
  render(<NotesSyncPane />)
  // 状态和已存的秘密都是异步回来的
  await act(async () => {
    await Promise.resolve()
  })
}

function field(label: string): HTMLInputElement {
  const input = screen.getByLabelText(label)
  if (!(input instanceof HTMLInputElement)) throw new Error(`${label} 不是输入框`)
  return input
}

beforeEach(() => {
  mocks.status.mockResolvedValue(idle)
  mocks.revealSecret.mockResolvedValue('')
  useSettingsStore.setState({ settings: null })
})

describe('同步设置的呈现', () => {
  it('一次只显示选中协议的字段,切走再切回来值还在', async () => {
    await mount({
      provider: 'github',
      github: { repo: 'owner/repo', branch: 'main', apiBaseUrl: '' },
      webdav: { url: 'https://dav.example/notes', username: 'me' }
    })

    expect(screen.getByRole('button', { name: 'GitHub', pressed: true })).toBeInTheDocument()
    expect(field('仓库').value).toBe('owner/repo')
    expect(screen.queryByLabelText('目录地址')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'WebDAV' }))
    expect(field('目录地址').value).toBe('https://dav.example/notes')
    expect(screen.queryByLabelText('仓库')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'GitHub' }))
    expect(field('仓库').value).toBe('owner/repo')
  })

  it('S3 的连接字段排成两列,路径风格跟在同一块里', async () => {
    await mount({ provider: 's3' })
    const endpoint = field('端点')
    const region = field('区域')
    expect(endpoint.closest('.sync-field')?.classList.contains('wide')).toBe(true)
    expect(region.closest('.sync-field')?.classList.contains('wide')).toBe(false)
    expect(screen.getByText('路径风格')).toBeInTheDocument()
  })

  it('排除规则默认收起,改过才展开,点一下能打开', async () => {
    await mount()
    const fold = screen.getByRole('button', { name: /不同步这些/ })
    expect(fold).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByDisplayValue(DEFAULT_SYNC_IGNORE)).toBeNull()
    expect(fold).toHaveTextContent('默认规则')

    fireEvent.click(fold)
    expect(fold).toHaveAttribute('aria-expanded', 'true')
    expect(document.querySelector('.sync-ignore textarea')).toHaveValue(DEFAULT_SYNC_IGNORE)
  })

  it('规则已经改过时,一进来就是展开的', async () => {
    await mount({ ignore: '*.log' })
    expect(screen.getByRole('button', { name: /不同步这些/ })).toHaveAttribute('aria-expanded', 'true')
    expect(document.querySelector('.sync-ignore textarea')).toHaveValue('*.log')
  })
})
