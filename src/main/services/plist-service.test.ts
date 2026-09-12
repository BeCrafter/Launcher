// plist-service scanAll 记忆/单飞/失效(打开慢修复:抽屉 4 路并发 IPC 共享一次扫描)
// 注:system/daemon 作用域是硬编码系统目录,单测仅断言 user 作用域(由 home 注入临时目录隔离)
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPlistService } from './plist-service'
import type { ElevationExecutor } from './elevation'
import type { ShellRunner } from './shell-runner'

const PLIST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>com.test.memo</string></dict></plist>`

/** 合法 plist 但未定义任务(无 Label,如 Google keystone 的 <dict/> 占位) */
const EMPTY_DICT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict/></plist>`

/** 另一个任务(label 与 PLIST_XML 不同),用于覆盖冲突用例 */
const OTHER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>com.test.other</string></dict></plist>`

function harness(ttl: number) {
  const home = mkdtempSync(join(tmpdir(), 'plist-memo-'))
  const userDir = join(home, 'Library/LaunchAgents')
  mkdirSync(userDir, { recursive: true })
  const elevate: ElevationExecutor = { run: async () => ({ ok: true, cancelled: false, code: 0, stderr: '' }) }
  const runner: ShellRunner = { run: async () => ({ code: 0, signal: null, stdout: '', stderr: '', timedOut: false, error: null }) }
  const svc = createPlistService({ runner, elevate, home, memoTtlMs: ttl })
  const userLabels = (r: Awaited<ReturnType<typeof svc.scanAll>>): string[] =>
    r.valid.filter((p) => p.scope === 'user').map((p) => p.label)
  const userCount = (r: Awaited<ReturnType<typeof svc.scanAll>>): number =>
    r.valid.filter((p) => p.scope === 'user').length
  return { svc, home, userDir, userLabels, userCount, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

describe('plist-service.scanAll 记忆', () => {
  it('TTL 内重复调用共享结果(不再读目录)', async () => {
    const h = harness(60_000)
    try {
      writeFileSync(join(h.userDir, 'a.plist'), PLIST_XML)
      const r1 = await h.svc.scanAll()
      expect(h.userLabels(r1)).toEqual(['com.test.memo'])
      unlinkSync(join(h.userDir, 'a.plist'))
      const r2 = await h.svc.scanAll() // 目录已变,但 TTL 内 → 仍返回记忆
      expect(h.userCount(r2)).toBe(1)
    } finally {
      h.cleanup()
    }
  })

  it('write 后记忆失效 → 下次扫描读到新文件', async () => {
    const h = harness(60_000)
    try {
      const p = join(h.userDir, 'a.plist')
      await h.svc.scanAll()
      await h.svc.write('user', p, PLIST_XML)
      const r = await h.svc.scanAll()
      expect(h.userLabels(r)).toEqual(['com.test.memo'])
    } finally {
      h.cleanup()
    }
  })

  it('invalidate() 显式失效', async () => {
    const h = harness(60_000)
    try {
      writeFileSync(join(h.userDir, 'a.plist'), PLIST_XML)
      await h.svc.scanAll()
      unlinkSync(join(h.userDir, 'a.plist'))
      h.svc.invalidate()
      const r = await h.svc.scanAll()
      expect(h.userCount(r)).toBe(0)
    } finally {
      h.cleanup()
    }
  })

  it('TTL 过期后重新扫描', async () => {
    const h = harness(0)
    try {
      writeFileSync(join(h.userDir, 'a.plist'), PLIST_XML)
      await h.svc.scanAll()
      unlinkSync(join(h.userDir, 'a.plist'))
      const r = await h.svc.scanAll() // ttl=0 → 记忆立即过期,重扫
      expect(h.userCount(r)).toBe(0)
    } finally {
      h.cleanup()
    }
  })

  it('并发调用单飞(共享同一进行中的扫描)', async () => {
    const h = harness(60_000)
    try {
      writeFileSync(join(h.userDir, 'a.plist'), PLIST_XML)
      const [r1, r2, r3] = await Promise.all([h.svc.scanAll(), h.svc.scanAll(), h.svc.scanAll()])
      expect(r2).toBe(r1)
      expect(r3).toBe(r1)
      expect(h.userCount(r1)).toBe(1)
    } finally {
      h.cleanup()
    }
  })
})

describe('非任务 plist(合法 plist 但缺 Label)', () => {
  it('scanAll 静默跳过:既不在 valid 也不在 invalid', async () => {
    const h = harness(60_000)
    try {
      writeFileSync(join(h.userDir, 'com.google.keystone.agent.plist'), EMPTY_DICT_XML)
      writeFileSync(join(h.userDir, 'ok.plist'), PLIST_XML)
      const r = await h.svc.scanAll()
      expect(h.userLabels(r)).toEqual(['com.test.memo']) // 占位不出现在 agents
      expect(r.invalid.filter((i) => i.path.endsWith('com.google.keystone.agent.plist'))).toEqual([]) // 也不报错
    } finally {
      h.cleanup()
    }
  })

  it('写入时允许覆盖占位(标签为空)', async () => {
    const h = harness(60_000)
    try {
      const target = join(h.userDir, 'com.test.memo.plist')
      writeFileSync(target, EMPTY_DICT_XML)
      await h.svc.write('user', target, PLIST_XML)
      const r = await h.svc.scanAll()
      expect(h.userLabels(r)).toEqual(['com.test.memo'])
    } finally {
      h.cleanup()
    }
  })

  it('写入时允许覆盖同名任务自身(正常编辑)', async () => {
    const h = harness(60_000)
    try {
      const target = join(h.userDir, 'com.test.memo.plist')
      await h.svc.write('user', target, PLIST_XML)
      await h.svc.write('user', target, PLIST_XML) // 第二次 = 编辑自身
      expect(h.userLabels(await h.svc.scanAll())).toEqual(['com.test.memo'])
    } finally {
      h.cleanup()
    }
  })

  it('目标已被他人任务占用 → 拒绝覆盖,且原文件不变', async () => {
    const h = harness(60_000)
    try {
      const target = join(h.userDir, 'com.test.memo.plist')
      writeFileSync(target, OTHER_XML) // 文件名说 memo,Label 却是 other(改名/拷贝而来的错位文件)
      await expect(h.svc.write('user', target, PLIST_XML)).rejects.toThrow(/已被任务「com.test.other」占用/)
      // 原文件未被清掉
      const r = await h.svc.scanAll()
      expect(h.userLabels(r)).toEqual(['com.test.other'])
    } finally {
      h.cleanup()
    }
  })

  it('目标已存在但无法解析 → 拒绝覆盖', async () => {
    const h = harness(60_000)
    try {
      const target = join(h.userDir, 'broken.plist')
      writeFileSync(target, '<plist><dict><key>Label</key>')
      await expect(h.svc.write('user', target, PLIST_XML)).rejects.toThrow(/无法解析,拒绝覆盖/)
    } finally {
      h.cleanup()
    }
  })
})
