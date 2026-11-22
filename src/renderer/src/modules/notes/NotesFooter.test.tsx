import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GITHUB_REPO_URL } from '@shared/constants'
import { makeT } from '../../i18n'
import { mockLauncher } from '../../test/launcher-stub'
import { NotesFooter } from './NotesFooter'

describe('NotesFooter', () => {
  it('右侧是仓库链接:文字、href、新窗口与安全 rel 都对', () => {
    render(<NotesFooter />)

    const link = screen.getByRole('link', { name: 'BeCrafter/Launcher' })
    expect(link).toHaveAttribute('href', GITHUB_REPO_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
    expect(link).toHaveAttribute('title', makeT('zh-CN')('settings.about.openRepo'))
    expect(link.querySelector('i.fa-brands.fa-github')).not.toBeNull()
    expect(link.querySelector('i.fa-github')).toHaveAttribute('aria-hidden', 'true')
  })

  it('点击走主进程 openExternal,并阻止默认导航', () => {
    render(<NotesFooter />)

    // fireEvent.click 返回 false 表示默认行为被 preventDefault 掉了
    const notPrevented = fireEvent.click(screen.getByRole('link', { name: 'BeCrafter/Launcher' }))

    expect(notPrevented).toBe(false)
    expect(mockLauncher().openExternal).toHaveBeenCalledWith(GITHUB_REPO_URL)
  })

  it('底栏左侧留空:只由占位元素把链接推到右端', () => {
    const { container } = render(<NotesFooter />)

    const footer = container.querySelector('[data-notes-footer]')
    expect(footer).not.toBeNull()
    expect(footer?.firstElementChild).toHaveClass('notes-footer-spacer')
    expect(footer?.lastElementChild).toBe(container.querySelector('[data-notes-footer-link]'))
    expect(footer?.textContent).toBe('BeCrafter/Launcher')
  })
})
