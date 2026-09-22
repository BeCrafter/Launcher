// 链接检查/安装的边界:悬空、指向别处、PATH 里没有可写目录,都必须如实区分而不是猜
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inspectMcpLink, installMcpLink, MCP_BIN_NAME } from './path-link'

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
