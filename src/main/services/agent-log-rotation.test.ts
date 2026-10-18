import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Agent } from '../../shared/models'
import type { AgentService } from './agent-service'
import { createAgentLogRotation } from './agent-log-rotation'

function harness(opts: { scope?: Agent['scope']; maxMB?: number; keep?: number; logSubdir?: string } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'agent-log-rot-'))
  const logDir = join(home, 'Library/Logs', opts.logSubdir ?? 'com.test')
  mkdirSync(logDir, { recursive: true })
  const logPath = join(logDir, 'out.log')
  const scope = opts.scope ?? 'user'
  const agents = {
    list: async () => ({
      agents: [{ id: `${scope}:com.test`, label: 'com.test', scope, isNotTask: false, logOut: logPath, logErr: '' }]
    }),
    logPaths: async () => ({ stdout: logPath, stderr: '' })
  } as unknown as AgentService
  const rot = createAgentLogRotation({
    agents,
    home,
    getMaxMB: () => opts.maxMB ?? 0.001, // ~1KB
    getKeep: () => opts.keep ?? 3
  })
  return { home, logDir, logPath, rot, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

const content = (n: number, ch = 'x'): string => ch.repeat(n)

describe('agent-log-rotation copytruncate', () => {
  it('超过阈值 → 复制到 .1 并截断原文件', async () => {
    const h = harness()
    try {
      writeFileSync(h.logPath, content(4096, 'a'))
      const r = await h.rot?.rotateNow()
      expect(r?.rotated).toBe(1)
      expect(statSync(h.logPath).size).toBe(0)
      expect(readFileSync(`${h.logPath}.1`, 'utf8')).toHaveLength(4096)
    } finally {
      h.cleanup()
    }
  })

  it('保留 N 份:新 .1、旧 .1 → .2,最旧的被丢弃', async () => {
    const h = harness({ keep: 2 })
    try {
      writeFileSync(h.logPath, content(2048, 'a'))
      await h.rot.rotateNow()
      writeFileSync(h.logPath, content(2048, 'b'))
      await h.rot.rotateNow()
      writeFileSync(h.logPath, content(2048, 'c'))
      await h.rot.rotateNow()
      expect(readFileSync(`${h.logPath}.1`, 'utf8')[0]).toBe('c')
      expect(readFileSync(`${h.logPath}.2`, 'utf8')[0]).toBe('b')
      expect(existsSync(`${h.logPath}.3`)).toBe(false)
    } finally {
      h.cleanup()
    }
  })

  it('maxMB=0 关闭轮转', async () => {
    const h = harness({ maxMB: 0 })
    try {
      writeFileSync(h.logPath, content(4096, 'a'))
      const r = await h.rot.rotateNow()
      expect(r.rotated).toBe(0)
      expect(statSync(h.logPath).size).toBe(4096)
    } finally {
      h.cleanup()
    }
  })

  it('system/daemon 或被拒绝的路径不处理', async () => {
    const h1 = harness({ scope: 'daemon' })
    try {
      writeFileSync(h1.logPath, content(4096, 'a'))
      const r = await h1.rot.rotateNow()
      expect(r.rotated).toBe(0)
      expect(r.skipped).toBeGreaterThan(0)
      expect(statSync(h1.logPath).size).toBe(4096)
    } finally {
      h1.cleanup()
    }
  })

  it('日志不在 ~/Library/Logs/<Label>/ 下 → 不轮转(不碰其他应用的目录)', async () => {
    const h = harness({ logSubdir: 'other-app' })
    try {
      writeFileSync(h.logPath, content(4096, 'a'))
      const r = await h.rot.rotateNow()
      expect(r.rotated).toBe(0)
      expect(statSync(h.logPath).size).toBe(4096)
    } finally {
      h.cleanup()
    }
  })

  it('symlink 指向 ~/Library/Logs 之外 → 不轮转', async () => {
    const h = harness()
    const outsideDir = mkdtempSync(join(tmpdir(), 'agent-log-out-'))
    try {
      const outside = join(outsideDir, 'out.log')
      writeFileSync(outside, content(4096, 'a'))
      rmSync(h.logPath, { force: true })
      symlinkSync(outside, h.logPath)
      const r = await h.rot.rotateNow()
      expect(r.rotated).toBe(0)
      expect(statSync(outside).size).toBe(4096)
    } finally {
      h.cleanup()
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })
})
