import { describe, expect, it } from 'vitest'
import { updateBannerKind, type UpdateBannerInput } from './update-banner'

const base: UpdateBannerInput = {
  phase: 'available',
  mode: 'self',
  targetVersion: '0.4.0',
  dismissedVersion: null,
  postponed: false,
  hasError: false
}

describe('updateBannerKind', () => {
  it('自动检查发现的新版本弹 available', () => {
    expect(updateBannerKind(base)).toBe('available')
    expect(updateBannerKind({ ...base, mode: 'brew' })).toBe('available')
  })

  it('其它相位不弹', () => {
    const others = [
      'idle',
      'checking',
      'upToDate',
      'downloading',
      'verifying',
      'applying',
      'restarting',
      'error'
    ] as const
    for (const phase of others) {
      expect(updateBannerKind({ ...base, phase })).toBe('none')
    }
    expect(updateBannerKind({ ...base, phase: null })).toBe('none')
  })

  it('安装位置不支持应用内升级时不弹(命令在设置里)', () => {
    expect(updateBannerKind({ ...base, mode: 'none' })).toBe('none')
    expect(updateBannerKind({ ...base, mode: null })).toBe('none')
    expect(updateBannerKind({ ...base, hasError: true })).toBe('none')
  })

  it('点过稍后的那个版本不再弹,更新的版本照弹', () => {
    expect(updateBannerKind({ ...base, dismissedVersion: '0.4.0' })).toBe('none')
    expect(updateBannerKind({ ...base, targetVersion: '0.4.1', dismissedVersion: '0.4.0' })).toBe(
      'available'
    )
    expect(updateBannerKind({ ...base, targetVersion: null })).toBe('none')
  })

  it('ready 仍是就绪提示,稍后之后不弹', () => {
    expect(updateBannerKind({ ...base, phase: 'ready' })).toBe('ready')
    expect(updateBannerKind({ ...base, phase: 'ready', postponed: true })).toBe('none')
    // ready 与 available 的忽略状态互不影响
    expect(updateBannerKind({ ...base, phase: 'ready', mode: 'none', hasError: true })).toBe('ready')
  })
})
