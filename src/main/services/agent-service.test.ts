import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { LaunchctlService } from './launchctl-service'
import { createAgentService } from './agent-service'
import type { PlistService } from './plist-service'

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-svc-'))
  const gonePath = join(dir, 'gone.plist')
  const herePath = join(dir, 'here.plist')
  writeFileSync(herePath, 'x')

  const print = vi.fn(async (label: string) => {
    if (label === 'com.a.gone') return { found: true, path: gonePath, pid: 42 }
    if (label === 'com.a.here') return { found: true, path: herePath, pid: 7 }
    if (label === 'com.a.sys') return { found: true, path: '/System/Library/LaunchAgents/com.a.sys.plist', pid: 1 }
    return { found: false, path: null, pid: null }
  })
  const launchctl = { print, domainOf: () => 'gui/501' } as unknown as LaunchctlService
  const plists = {
    dirs: () => [{ scope: 'user' as const, dir, privileged: false }]
  } as unknown as PlistService

  const svc = createAgentService({
    runner: {} as never,
    launchctl,
    plists,
    brew: {} as never,
    getXmlIndent: () => '  '
  })
  return { svc, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('agent-service.checkMissing(孤儿定向复核)', () => {
  it('目录内且文件已不存在 → 命中(带 path/pid)', async () => {
    const h = harness()
    try {
      const r = await h.svc.checkMissing([{ scope: 'user', label: 'com.a.gone' }])
      expect(r).toEqual([{ label: 'com.a.gone', scope: 'user', path: join(h.dir, 'gone.plist'), pid: 42 }])
    } finally {
      h.cleanup()
    }
  })

  it('文件仍在 / 路径在管理目录外 / 已不在 launchd → 均不命中', async () => {
    const h = harness()
    try {
      const r = await h.svc.checkMissing([
        { scope: 'user', label: 'com.a.here' },
        { scope: 'user', label: 'com.a.sys' },
        { scope: 'user', label: 'com.a.gone-but-unloaded' }
      ])
      expect(r).toEqual([])
    } finally {
      h.cleanup()
    }
  })
})
