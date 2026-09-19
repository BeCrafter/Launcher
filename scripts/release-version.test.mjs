import { describe, expect, it } from 'vitest'
import { PRERELEASE_WORDS, isPrerelease, parseVersion, validateVersion } from './release-version.mjs'

describe('parseVersion', () => {
  it('接受 X.Y.Z 与 X.Y.Z-<后缀>', () => {
    expect(parseVersion('0.1.0')).toMatchObject({
      ok: true,
      major: 0,
      minor: 1,
      patch: 0,
      suffix: null
    })
    expect(parseVersion('10.20.30')).toMatchObject({ ok: true, major: 10, minor: 20, patch: 30 })
    expect(parseVersion('0.2.0-rc.1')).toMatchObject({ ok: true, suffix: 'rc.1' })
    expect(parseVersion('  0.2.0-rc1  ')).toMatchObject({ ok: true, suffix: 'rc1' })
  })

  it('拒绝畸形输入', () => {
    // v 前缀由调用方(strip)处理,此处只认裸版本号——避免两处各裁一次前缀
    for (const bad of ['v0.2.0', '0.2', '0.2.0.1', '0.2.0-', 'abc', '', '  ', null, undefined]) {
      expect(parseVersion(bad).ok, `应拒绝 ${JSON.stringify(bad)}`).toBe(false)
    }
  })
})

describe('validateVersion', () => {
  it('无后缀 = 正式版', () => {
    expect(validateVersion('0.1.0')).toEqual({ ok: true, prerelease: false })
  })

  it('Homebrew 认的四个预发布词全部放行', () => {
    for (const w of PRERELEASE_WORDS) {
      for (const v of [`0.2.0-${w}`, `0.2.0-${w}.1`, `0.2.0-${w}1`]) {
        expect(validateVersion(v), `应放行 ${v}`).toEqual({ ok: true, prerelease: true })
      }
    }
  })

  it('大小写不敏感(Homebrew 的 PRERELEASE_SUFFIX 带 (?i))', () => {
    expect(validateVersion('0.2.0-RC.1')).toEqual({ ok: true, prerelease: true })
  })

  it('拒绝 Homebrew 不认的后缀——它们会被判为比正式版更新', () => {
    for (const w of ['dev', 'next', 'canary', 'nightly', 'snapshot', 'hotfix']) {
      const r = validateVersion(`0.2.0-${w}`)
      expect(r.ok, `应拒绝 0.2.0-${w}`).toBe(false)
      // 失败原因必须说清后果,不能只报格式错——否则下次还会有人踩
      expect(r.reason).toMatch(/brew upgrade/)
      expect(r.reason).toMatch(/rc/)
    }
  })

  it('畸形版本号回具体原因', () => {
    const r = validateVersion('0.2')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/X\.Y\.Z/)
  })
})

describe('isPrerelease', () => {
  it('仅按后缀判定', () => {
    expect(isPrerelease('0.1.0')).toBe(false)
    expect(isPrerelease('0.2.0-rc.1')).toBe(true)
    // 畸形输入不算预发布(由 validateVersion 拒绝),避免误判成"可以发布"
    expect(isPrerelease('0.2')).toBe(false)
  })
})
