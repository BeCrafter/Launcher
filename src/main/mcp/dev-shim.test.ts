// 开发态 shim:内容必须真的能跑起来 —— 它是「开发环境也能安装到 PATH」的全部依据
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { devShimPath, devShimScript, writeDevShim } from './dev-shim'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'launcher-shim-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('devShimPath', () => {
  it('落在该 checkout 的 node_modules/.cache 下(每副本一份 ⇒ 路径即身份,且不进包)', () => {
    expect(devShimPath('/repo/Launcher')).toBe('/repo/Launcher/node_modules/.cache/launcher-mcp')
  })
})

describe('devShimScript', () => {
  it('两条绝对路径都写进正文,且以 sh 开头可执行', () => {
    const s = devShimScript('/electron/bin', '/repo/out/main/launcher-mcp.js')
    expect(s.startsWith('#!/bin/sh')).toBe(true)
    expect(s).toContain('"/electron/bin"')
    expect(s).toContain('"/repo/out/main/launcher-mcp.js"')
    expect(s).toContain('ELECTRON_RUN_AS_NODE=1')
    // stdout 属于 MCP 协议本身:所有提示必须走 stderr
    expect(s).not.toMatch(/^\s*echo\s+"[^"]*"\s*$/m)
  })
})

describe('writeDevShim', () => {
  it('目录不存在时建出来,可执行位为 755', () => {
    const shim = join(dir, 'node_modules', '.cache', 'launcher-mcp')
    writeDevShim(shim, '/electron/bin', '/repo/out/main/launcher-mcp.js')
    expect(existsSync(shim)).toBe(true)
    expect(statSync(shim).mode & 0o777).toBe(0o755)
  })

  it('重复写 = 幂等覆盖(「修复指向」就靠它重建)', () => {
    const shim = join(dir, 'shim')
    writeDevShim(shim, '/old/electron', '/old/entry.js')
    writeDevShim(shim, '/new/electron', '/new/entry.js')
    const body = readFileSync(shim, 'utf8')
    expect(body).toContain('"/new/entry.js"')
    expect(body).not.toContain('/old/entry.js')
  })

  // 真跑一次:用 /bin/sh 当「electron」的替身,验证 shim 的转调链路(参数透传 + 入口缺失时报错)
  it('真机执行:入口存在 → 透传参数给「二进制」;入口缺失 → 退非零且提示在 stderr', () => {
    const fakeBin = join(dir, 'fake-electron')
    writeFileSync(fakeBin, '#!/bin/sh\necho "ran:$ELECTRON_RUN_AS_NODE:$*"\n')
    chmodSync(fakeBin, 0o755)

    const entry = join(dir, 'entry.js')
    writeFileSync(entry, '// dev entry\n')
    const shim = join(dir, 'shim')
    writeDevShim(shim, fakeBin, entry)

    // 「二进制」收到的参数顺序 = <入口> [透传参数…],与打包版 `exec "$BIN" "$ENTRY"` 同形
    const out = execFileSync(shim, ['--stdio'], { encoding: 'utf8' })
    expect(out.trim()).toBe(`ran:1:${entry} --stdio`)

    rmSync(entry)
    let failed = false
    try {
      execFileSync(shim, [], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      failed = true
      const e = err as { status?: number; stderr?: string }
      expect(e.status).not.toBe(0)
      expect(e.stderr ?? '').toContain('找不到')
    }
    expect(failed).toBe(true)
  })
})
