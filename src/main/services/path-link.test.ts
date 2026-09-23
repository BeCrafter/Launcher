// 链接检查/安装的边界:悬空、指向别处、PATH 里没有可写目录,都必须如实区分而不是猜
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  inspectMcpLink,
  installMcpLink,
  MCP_BIN_NAME,
  PATH_SENTINEL,
  parsePathOutput,
  probeLoginShellPath,
  resetShellPathCache,
  shellPath
} from './path-link'

let dir: string
/** 造一个"应用包内脚本"并返回其路径 */
const makeTarget = (name = 'target-mcp'): string => {
  const p = join(dir, name)
  writeFileSync(p, '#!/bin/sh\n')
  chmodSync(p, 0o755)
  return p
}
const makeBin = (name: string): string => {
  const d = join(dir, name)
  mkdirSync(d, { recursive: true })
  return d
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'launcher-link-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('inspectMcpLink', () => {
  it('PATH 上没有 → missing', () => {
    const info = inspectMcpLink(makeTarget(), makeBin('bin1'))
    expect(info.state).toBe('missing')
    expect(info.foundAt).toBeNull()
  })

  it('指向本应用脚本 → linked', () => {
    const target = makeTarget()
    const bin = makeBin('bin2')
    symlinkSync(target, join(bin, MCP_BIN_NAME))
    expect(inspectMcpLink(target, bin).state).toBe('linked')
  })

  it('目标不存在(悬空)→ dangling,而不是 missing', () => {
    const bin = makeBin('bin3')
    symlinkSync(join(dir, 'gone'), join(bin, MCP_BIN_NAME))
    const info = inspectMcpLink(makeTarget(), bin)
    expect(info.state).toBe('dangling')
    expect(info.foundAt).toBe(join(bin, MCP_BIN_NAME))
  })

  it('指向另一个副本 → foreign(不能当成 linked)', () => {
    const other = makeTarget('other-mcp')
    const mine = makeTarget('mine-mcp')
    const bin = makeBin('bin4')
    symlinkSync(other, join(bin, MCP_BIN_NAME))
    expect(inspectMcpLink(mine, bin).state).toBe('foreign')
  })

  it('PATH 里有空段/不存在的目录也不炸', () => {
    const info = inspectMcpLink(makeTarget(), `::${join(dir, 'nope')}:`)
    expect(info.state).toBe('missing')
  })
})

describe('installMcpLink', () => {
  it('缺失时建到可写的 PATH 目录', () => {
    const target = makeTarget()
    const bin = makeBin('bin5')
    const r = installMcpLink(target, bin)
    expect(r.ok).toBe(true)
    expect(inspectMcpLink(target, bin).state).toBe('linked')
  })

  it('悬空时就地修复(不制造第二份链接)', () => {
    const target = makeTarget()
    const bin = makeBin('bin6')
    const link = join(bin, MCP_BIN_NAME)
    symlinkSync(join(dir, 'gone'), link)
    expect(inspectMcpLink(target, bin).state).toBe('dangling')

    const r = installMcpLink(target, bin)
    expect(r.ok).toBe(true)
    expect(r.ok && r.path).toBe(link)
    expect(readlinkSync(link)).toBe(target)
    expect(inspectMcpLink(target, bin).state).toBe('linked')
  })

  it('优先 ~/.local/bin(若它在 PATH 上),避免跟包管理器抢位置', () => {
    const target = makeTarget()
    const brewBin = makeBin('brewbin')
    const localBin = join(dir, 'localbin')
    mkdirSync(localBin, { recursive: true })
    // HOME 指到 dir 之外会污染真实用户目录,故这里直接构造 ~/.local/bin 的场景
    const prevHome = process.env['HOME']
    process.env['HOME'] = dir
    const homeLocal = join(dir, '.local', 'bin')
    mkdirSync(homeLocal, { recursive: true })
    try {
      const r = installMcpLink(target, `${brewBin}:${homeLocal}`)
      expect(r.ok && r.path).toBe(join(homeLocal, MCP_BIN_NAME))
    } finally {
      process.env['HOME'] = prevHome
    }
    void localBin
  })

  it('PATH 里没有可写目录 → 如实失败,不假装成功', () => {
    const target = makeTarget()
    const ro = makeBin('readonly')
    chmodSync(ro, 0o555)
    try {
      const r = installMcpLink(target, ro)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.reason).toContain('可写')
      expect(existsSync(join(ro, MCP_BIN_NAME))).toBe(false)
    } finally {
      chmodSync(ro, 0o755)
    }
  })
})

// 2026-09-23 用户报告:打包应用点「安装到 PATH」只说「没有可写的目录」。
// 根因:判据用的是**应用自身**的 PATH —— Finder/Dock 启动的 .app 只有
// `/usr/bin:/bin:/usr/sbin:/sbin`(全 root 所有),必然一个都不可写。
// 链接是要给**用户终端**里的外部 Agent 用的,判据必须与用户终端一致。
describe('PATH 来源 = 用户登录 shell', () => {
  beforeEach(() => resetShellPathCache())
  afterEach(() => resetShellPathCache())

  it('parsePathOutput:从 rc 噪音里只抠哨兵之间那一段', () => {
    const p = '/opt/homebrew/bin:/usr/bin:/bin'
    expect(parsePathOutput(`nvm: loading…\ndone\n${PATH_SENTINEL}${p}${PATH_SENTINEL}\nbanner after\n`)).toBe(p)
  })

  it('parsePathOutput:无哨兵 / 空值 / 含换行 / 不像 PATH → 一律判探测失败', () => {
    expect(parsePathOutput('/usr/bin:/bin')).toBe('')
    expect(parsePathOutput(PATH_SENTINEL + PATH_SENTINEL)).toBe('')
    expect(parsePathOutput(`${PATH_SENTINEL}/usr/bin\n/bin${PATH_SENTINEL}`)).toBe('')
    expect(parsePathOutput(`${PATH_SENTINEL}noslash${PATH_SENTINEL}`)).toBe('')
  })

  it('真起一个 shell 问 PATH:哨兵法在真实 shell 上成立', () => {
    const p = probeLoginShellPath('/bin/sh', 5000)
    expect(p).toContain('/')
    expect(p).toContain(':')
  })

  it('会话内缓存;探测失败回退 process.env.PATH(不猜)', () => {
    let calls = 0
    const probe = (): string => {
      calls++
      return '/probed/bin'
    }
    expect(shellPath(probe)).toBe('/probed/bin')
    expect(shellPath(probe)).toBe('/probed/bin')
    expect(calls).toBe(1) // 第二次走缓存,不再起 shell

    resetShellPathCache()
    expect(shellPath(() => '')).toBe(process.env['PATH'])
  })
})

describe('installMcpLink:按需创建 ~/.local/bin', () => {
  it('目录在 PATH 上但还不存在 → 建出来再装(此前「不存在」等于「不可写」,直接失败)', () => {
    const target = makeTarget('local-target')
    const prevHome = process.env['HOME']
    process.env['HOME'] = dir
    const homeLocal = join(dir, '.local', 'bin') // 故意不预建
    try {
      const r = installMcpLink(target, `/usr/bin:/bin:${homeLocal}`)
      expect(r.ok).toBe(true)
      expect(r.ok && r.path).toBe(join(homeLocal, MCP_BIN_NAME))
      expect(readlinkSync(join(homeLocal, MCP_BIN_NAME))).toBe(target)
    } finally {
      process.env['HOME'] = prevHome
    }
  })

  it('不为 PATH 里任意不存在的目录新建目录(只对 ~/.local/bin 开口子)', () => {
    const target = makeTarget('ghost-target')
    const prevHome = process.env['HOME']
    process.env['HOME'] = dir
    const ro = makeBin('ro-ghost')
    chmodSync(ro, 0o555)
    const ghost = join(dir, 'ghost-bin') // 不是 ~/.local/bin,且不存在
    try {
      const r = installMcpLink(target, `${ro}:${ghost}`)
      expect(r.ok).toBe(false)
      expect(existsSync(ghost)).toBe(false)
    } finally {
      chmodSync(ro, 0o755)
      process.env['HOME'] = prevHome
    }
  })

  it('失败原因给出下一步(而不是只有一句「没有可写目录」)', () => {
    const target = makeTarget('cmd-target')
    const ro = makeBin('ro-cmd')
    chmodSync(ro, 0o555)
    try {
      const r = installMcpLink(target, ro)
      expect(r.ok).toBe(false)
      // 单行(进 toast 时 nowrap,多行会被窗口裁掉);引导到 ~/.local/bin 这一步
      expect(r.ok === false && r.reason).not.toContain('\n')
      expect(r.ok === false && r.reason).toContain('.local/bin')
      expect(r.ok === false && r.reason).toContain('PATH')
    } finally {
      chmodSync(ro, 0o755)
    }
  })
})
