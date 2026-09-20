import { describe, expect, it } from 'vitest'
import { archOf, archOfUname, compareVersions, parseArgs, parseVersion, plistVersion, zipUrl } from './lib.mjs'

describe('archOfUname', () => {
  it('与 install.sh 同源：uname -m 输出 → 产物架构', () => {
    expect(archOfUname('arm64')).toBe('arm64')
    expect(archOfUname('x86_64')).toBe('x64')
    expect(archOfUname('  arm64\n')).toBe('arm64') // 命令行输出常带换行
  })

  it('其他架构回 null（由调用方回退或报错）', () => {
    for (const bad of ['i386', 'ppc', '', null, undefined]) expect(archOfUname(bad)).toBeNull()
  })
})

describe('archOf（兜底：uname 取不到时用 Node 自身架构）', () => {
  it('只认 arm64 / x64', () => {
    expect(archOf('arm64')).toBe('arm64')
    expect(archOf('x64')).toBe('x64')
    for (const bad of ['ia32', 'arm', 'ppc64', '', null]) expect(archOf(bad)).toBeNull()
  })
})

describe('zipUrl', () => {
  const BASE = 'https://repo.iskill.site/launcher'

  it('无版本 → latest 别名', () => {
    expect(zipUrl(BASE, null, 'arm64')).toBe(`${BASE}/Launcher-latest-arm64.zip`)
    expect(zipUrl(BASE, '', 'x64')).toBe(`${BASE}/Launcher-latest-x64.zip`)
    expect(zipUrl(BASE, undefined, 'arm64')).toBe(`${BASE}/Launcher-latest-arm64.zip`)
  })

  it('带版本 → 去 v 前缀（tag 是 v0.2.0，产物名是 Launcher-0.2.0-<arch>.zip）', () => {
    expect(zipUrl(BASE, '0.2.0', 'arm64')).toBe(`${BASE}/Launcher-0.2.0-arm64.zip`)
    expect(zipUrl(BASE, 'v0.2.0', 'x64')).toBe(`${BASE}/Launcher-0.2.0-x64.zip`)
    expect(zipUrl(BASE, '0.2.0-rc.1', 'arm64')).toBe(`${BASE}/Launcher-0.2.0-rc.1-arm64.zip`)
  })

  it('base 末尾斜杠被归一（LAUNCHER_R2_BASE 用户可能带斜杠）', () => {
    expect(zipUrl(`${BASE}/`, '0.1.0', 'arm64')).toBe(`${BASE}/Launcher-0.1.0-arm64.zip`)
    expect(zipUrl(`${BASE}///`, null, 'arm64')).toBe(`${BASE}/Launcher-latest-arm64.zip`)
  })
})

describe('parseVersion', () => {
  it('拆出三段与预发布后缀', () => {
    expect(parseVersion('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0, pre: null })
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: null })
    expect(parseVersion('1.2.3-rc.1')).toEqual({ major: 1, minor: 2, patch: 3, pre: 'rc.1' })
  })

  it('畸形输入回 null（调用方据此跳过比较）', () => {
    for (const bad of ['1.2', 'abc', '', null, undefined, '1.2.3.4']) {
      expect(parseVersion(bad)).toBeNull()
    }
  })
})

describe('compareVersions', () => {
  it('按段比较', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1)
    expect(compareVersions('0.2.0', '0.1.0')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.9.9', '0.10.0')).toBe(-1) // 数字比较,不是字典序
  })

  it('正式版 > 同号预发布（决定「已是最新」的判断方向）', () => {
    expect(compareVersions('0.2.0-rc.1', '0.2.0')).toBe(-1)
    expect(compareVersions('0.2.0', '0.2.0-rc.1')).toBe(1)
    expect(compareVersions('0.2.0-rc.1', '0.2.0-rc.2')).toBe(-1)
  })

  it('预发布段按数值比，不是字典序（rc.10 > rc.9）', () => {
    expect(compareVersions('0.2.0-rc.9', '0.2.0-rc.10')).toBe(-1)
    expect(compareVersions('0.2.0-rc.10', '0.2.0-rc.9')).toBe(1)
    expect(compareVersions('0.2.0-beta.1', '0.2.0-rc.1')).toBe(-1)
    expect(compareVersions('0.2.0-rc', '0.2.0-rc.1')).toBe(-1) // 段少者更小
  })

  it('任一方无法解析 → null（不要据此下结论）', () => {
    expect(compareVersions('0.1.0', 'nope')).toBeNull()
    expect(compareVersions(null, null)).toBeNull()
  })
})

describe('plistVersion', () => {
  it('从 Info.plist 原文取 CFBundleShortVersionString', () => {
    const xml = `<?xml version="1.0"?>\n<dict>\n  <key>CFBundleName</key><string>Launcher</string>\n  <key>CFBundleShortVersionString</key>\n  <string>0.1.0</string>\n</dict>`
    expect(plistVersion(xml)).toBe('0.1.0')
  })

  it('缺失或畸形回 null', () => {
    expect(plistVersion('<dict></dict>')).toBeNull()
    expect(plistVersion('')).toBeNull()
    expect(plistVersion(null)).toBeNull()
  })
})

describe('parseArgs', () => {
  it('无参数 = 默认命令（未装则装、已装则报状态）', () => {
    expect(parseArgs([])).toMatchObject({ cmd: null, help: false, force: false })
  })

  it('识别三个子命令与 help 别名', () => {
    expect(parseArgs(['install']).cmd).toBe('install')
    expect(parseArgs(['status']).cmd).toBe('status')
    expect(parseArgs(['uninstall']).cmd).toBe('uninstall')
    expect(parseArgs(['help']).help).toBe(true)
    expect(parseArgs(['-h']).help).toBe(true)
    expect(parseArgs(['--help']).help).toBe(true)
  })

  it('裸 --version / -v 视为「打印 CLI 版本」', () => {
    expect(parseArgs(['--version']).wantCliVersion).toBe(true)
    expect(parseArgs(['-v']).wantCliVersion).toBe(true)
  })

  it('install 的选项', () => {
    expect(parseArgs(['install', '--version', '0.2.0'])).toMatchObject({ cmd: 'install', version: '0.2.0' })
    expect(parseArgs(['install', '--version', 'v0.2.0'])).toMatchObject({ version: 'v0.2.0' })
    expect(parseArgs(['install', '--dir', '/tmp/x'])).toMatchObject({ dir: '/tmp/x' })
    expect(parseArgs(['install', '--force'])).toMatchObject({ force: true })
    expect(parseArgs(['install', '-f'])).toMatchObject({ force: true })
    expect(parseArgs(['--dir', '/tmp/x'])).toMatchObject({ cmd: null, dir: '/tmp/x' })
  })

  it('缺值/未知项回 error，而不是静默忽略', () => {
    expect(parseArgs(['install', '--version']).error).toMatch(/需要一个版本号/)
    expect(parseArgs(['install', '--dir']).error).toMatch(/需要一个目录路径/)
    expect(parseArgs(['bogus']).error).toMatch(/未知命令/)
    expect(parseArgs(['install', '--nope']).error).toMatch(/未知参数/)
  })
})
