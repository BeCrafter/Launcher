import { describe, expect, it } from 'vitest'
import {
  PRERELEASE_WORDS,
  bumpStable,
  isDevVersion,
  isPrerelease,
  isStableVersion,
  latestStableVersion,
  nextDevNumber,
  parseVersion,
  resolveDevVersion,
  validateVersion
} from './release-version.mjs'

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

describe('bumpStable', () => {
  it('semver 语义:minor 清 patch、major 清 minor+patch', () => {
    expect(bumpStable('0.1.0', 'patch')).toEqual({ ok: true, version: '0.1.1' })
    expect(bumpStable('0.1.0', 'minor')).toEqual({ ok: true, version: '0.2.0' })
    expect(bumpStable('0.1.0', 'major')).toEqual({ ok: true, version: '1.0.0' })
    expect(bumpStable('0.1.9', 'minor')).toEqual({ ok: true, version: '0.2.0' })
    expect(bumpStable('1.4.9', 'major')).toEqual({ ok: true, version: '2.0.0' })
    expect(bumpStable('9.9.9', 'patch')).toEqual({ ok: true, version: '9.9.10' })
  })

  it('带后缀的当前版本先按 core 递增(rc 阶段继续发正式版)', () => {
    expect(bumpStable('0.2.0-rc.1', 'patch')).toEqual({ ok: true, version: '0.2.1' })
  })

  it('拒绝未知递增类型与畸形版本号', () => {
    expect(bumpStable('0.1.0', 'dev').ok).toBe(false)
    expect(bumpStable('0.1.0', 'hotfix').reason).toMatch(/major/)
    expect(bumpStable('0.1', 'patch').ok).toBe(false)
  })
})

describe('isStableVersion', () => {
  it('只有纯 X.Y.Z 算已发布的正式版', () => {
    expect(isStableVersion('0.1.0')).toBe(true)
    expect(isStableVersion(' 1.2.3 ')).toBe(true)
    // 带后缀的都不是 —— rc 也不代表"已经发布了一个版本"
    for (const v of ['0.1.0-rc.1', '0.1.0-dev.1', 'v0.1.0', '0.1', 'abc', '', null]) {
      expect(isStableVersion(v), `应拒绝 ${JSON.stringify(v)}`).toBe(false)
    }
  })
})

describe('latestStableVersion', () => {
  it('按数值而非字典序取最大', () => {
    // 字典序会把 0.9.0 判成最大(9 > 10),这是真踩过的坑
    expect(latestStableVersion(['v0.9.0', 'v0.10.0', 'v0.2.0'])).toBe('0.10.0')
  })

  it('忽略预发布与 dev tag', () => {
    expect(latestStableVersion(['v0.1.0', 'v0.2.0-rc.1', 'v0.3.0-dev.4'])).toBe('0.1.0')
  })

  it('一个正式版都没有时返回 null(不回退到 rc)', () => {
    expect(latestStableVersion(['v0.2.0-rc.1', 'v0.3.0-dev.1'])).toBeNull()
    expect(latestStableVersion([])).toBeNull()
    expect(latestStableVersion(undefined)).toBeNull()
  })
})

describe('isDevVersion', () => {
  it('只认 X.Y.Z-dev.N', () => {
    expect(isDevVersion('0.1.0-dev.1')).toBe(true)
    expect(isDevVersion('10.2.30-dev.999')).toBe(true)
    for (const v of ['0.1.0', '0.1.0-rc.1', '0.1.0-dev', '0.1.0-dev.x', 'v0.1.0-dev.1', null]) {
      expect(isDevVersion(v), `应拒绝 ${JSON.stringify(v)}`).toBe(false)
    }
  })
})

describe('nextDevNumber', () => {
  it('取该基线下已有序号的最大值 + 1', () => {
    expect(nextDevNumber([], '0.1.0')).toBe(1)
    expect(nextDevNumber(['v0.1.0-dev.1', 'v0.1.0-dev.2'], '0.1.0')).toBe(3)
    // 有洞也往最大值之后排,不复用已发过的号
    expect(nextDevNumber(['v0.1.0-dev.1', 'v0.1.0-dev.7'], '0.1.0')).toBe(8)
  })

  it('按数值而非字典序(dev.9 之后是 dev.10)', () => {
    expect(nextDevNumber(['v0.1.0-dev.9', 'v0.1.0-dev.10'], '0.1.0')).toBe(11)
  })

  it('只认同一个基线 —— 别的基线的 dev tag 不参与计数', () => {
    expect(nextDevNumber(['v0.2.0-dev.5'], '0.1.0')).toBe(1)
    // 基线的点号是字面量,不能当通配符用(否则 v0a1b0-dev.5 会污染 0.1.0 的计数)
    expect(nextDevNumber(['v0x1x0-dev.5'], '0.1.0')).toBe(1)
  })
})

describe('resolveDevVersion', () => {
  it('基线优先级:显式 > 最新正式版 tag > package.json > 0.1.0', () => {
    expect(resolveDevVersion({ tags: ['v0.2.0'], base: '9.9.9', fallback: '0.1.0' })).toMatchObject({
      ok: true,
      base: '9.9.9',
      version: '9.9.9-dev.1'
    })
    expect(resolveDevVersion({ tags: ['v0.2.0', 'v0.2.0-dev.3'], fallback: '0.1.0' })).toMatchObject({
      base: '0.2.0',
      version: '0.2.0-dev.4'
    })
    // 没有任何正式版 tag → 用 package.json 声明的版本,剥掉后缀只要 core
    expect(resolveDevVersion({ tags: [], fallback: '0.1.0' })).toMatchObject({
      base: '0.1.0',
      version: '0.1.0-dev.1'
    })
    expect(resolveDevVersion({ tags: ['v0.3.0-rc.1'], fallback: '0.5.0' })).toMatchObject({
      base: '0.5.0',
      version: '0.5.0-dev.1'
    })
    // 连 package.json 都读不出 → 兜底 0.1.0
    expect(resolveDevVersion({ tags: [], fallback: undefined })).toMatchObject({
      base: '0.1.0',
      version: '0.1.0-dev.1'
    })
  })

  it('显式基线必须也是纯 X.Y.Z', () => {
    const r = resolveDevVersion({ tags: [], base: '0.2.0-rc.1', fallback: '0.1.0' })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/X\.Y\.Z/)
  })
})
