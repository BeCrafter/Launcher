import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl } from './url-guard'

describe('isAllowedExternalUrl', () => {
  it('放行 http/https 网页', () => {
    expect(isAllowedExternalUrl('https://github.com/BeCrafter/Launcher')).toBe(true)
    expect(isAllowedExternalUrl('http://localhost:8080/x')).toBe(true)
    expect(isAllowedExternalUrl('HTTPS://EXAMPLE.COM')).toBe(true)
  })

  it('放行 x-apple.systempreferences 的 Apple 面板', () => {
    expect(isAllowedExternalUrl('x-apple.systempreferences:com.apple.LoginItems-Settings.extension')).toBe(true)
    expect(isAllowedExternalUrl('x-apple.systempreferences:com.apple.preferences.users')).toBe(true)
  })

  it('拒绝危险 scheme 与非 Apple 面板', () => {
    expect(isAllowedExternalUrl('file:///etc/hosts')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('x-apple.systempreferences:')).toBe(false)
    expect(isAllowedExternalUrl('x-apple.systempreferences:com.evil.payload')).toBe(false)
    expect(isAllowedExternalUrl('x-apple.systempreferences:com.apple.x/../../etc')).toBe(false)
    expect(isAllowedExternalUrl('')).toBe(false)
    expect(isAllowedExternalUrl(undefined)).toBe(false)
    expect(isAllowedExternalUrl(42)).toBe(false)
    expect(isAllowedExternalUrl({})).toBe(false)
  })
})
