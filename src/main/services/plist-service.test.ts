// plist-service scanAll 记忆/单飞/失效(打开慢修复:抽屉 4 路并发 IPC 共享一次扫描)
// + 非任务/异常 plist 的可见性:每个 .plist 恰好一条记录,解析失败与缺 Label 都不再被丢弃
// 注:system/daemon 作用域是硬编码系统目录,单测仅断言 user 作用域(由 home 注入临时目录隔离)
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPlistService, type PlistFile } from './plist-service'
import type { ElevationExecutor } from './elevation'
import type { ShellRunner } from './shell-runner'

const PLIST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>com.test.memo</string></dict></plist>`

/** 合法 plist 但未定义任务(无 Label,如 Google keystone 的 <dict/> 占位) */
const EMPTY_DICT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict/></plist>`

/** 合法 plist 但 Label 不是字符串(此前被 typeof 守卫静默吞掉) */
const NON_STRING_LABEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><integer>42</integer></dict></plist>`

/** 无法解析的坏 plist */
const BROKEN_XML = '<plist><dict><key>Label</key>'

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
  const userFiles = (r: Awaited<ReturnType<typeof svc.scanAll>>): PlistFile[] => r.filter((p) => p.scope === 'user')
  /** 用户作用域内的任务 label(非任务/损坏文件不计入) */
  const userLabels = (r: Awaited<ReturnType<typeof svc.scanAll>>): string[] =>
    userFiles(r)
      .filter((p) => p.isTask)
      .map((p) => p.label)
  const userCount = (r: Awaited<ReturnType<typeof svc.scanAll>>): number => userFiles(r).filter((p) => p.isTask).length
  const find = (r: Awaited<ReturnType<typeof svc.scanAll>>, fileName: string): PlistFile | undefined =>
    userFiles(r).find((p) => p.fileName === fileName)
  return { svc, home, userDir, userFiles, userLabels, userCount, find, cleanup: () => rmSync(home, { recursive: true, force: true }) }
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

describe('非任务/异常 plist(文件在磁盘上存在 → 必须在列表里可见)', () => {
  it('缺 Label 的合法 plist:进入扫描结果且 isTask=false', async () => {
    const h = harness(60_000)
    try {
      writeFileSync(join(h.userDir, 'com.google.keystone.agent.plist'), EMPTY_DICT_XML)
      writeFileSync(join(h.userDir, 'ok.plist'), PLIST_XML)
      const r = await h.svc.scanAll()
      expect(h.userLabels(r)).toEqual(['com.test.memo'])
      expect(h.find(r, 'com.google.keystone.agent.plist')).toMatchObject({ isTask: false, label: '' })
      // 是合法 plist,只是没定义任务 → 不是解析失败
      expect(h.find(r, 'com.google.keystone.agent.plist')?.parseError).toBeUndefined()
    } finally {
      h.cleanup()
    }
  })

  it('Label 非字符串(integer):同样 isTask=false,不再被静默吞掉', async () => {
    const h = harness(60_000)
    try {
      writeFileSync(join(h.userDir, 'numeric.plist'), NON_STRING_LABEL_XML)
      const r = await h.svc.scanAll()
      expect(h.find(r, 'numeric.plist')).toMatchObject({ isTask: false, label: '' })
      expect(h.find(r, 'numeric.plist')?.parseError).toBeUndefined()
    } finally {
      h.cleanup()
    }
  })

  it('无法解析:产出带 parseError 的记录,不抛错且保留原文供 XML 修复', async () => {
    const h = harness(60_000)
    try {
      writeFileSync(join(h.userDir, 'broken.plist'), BROKEN_XML)
      writeFileSync(join(h.userDir, 'ok.plist'), PLIST_XML)
      const r = await h.svc.scanAll()
      const broken = h.find(r, 'broken.plist')
      expect(broken?.isTask).toBe(false)
      expect(broken?.parseError).toBeTruthy()
      expect(broken?.xml).toBe(BROKEN_XML)
      expect(h.userLabels(r)).toEqual(['com.test.memo']) // 坏文件不影响同目录其它文件
    } finally {
      h.cleanup()
    }
  })

  it('read() 对非任务文件仍按「不是一个任务」拒绝', async () => {
    const h = harness(60_000)
    try {
      const target = join(h.userDir, 'com.google.keystone.agent.plist')
      writeFileSync(target, EMPTY_DICT_XML)
      await expect(h.svc.read('user', target)).rejects.toThrow(/未定义任务/)
    } finally {
      h.cleanup()
    }
  })

  it('写入时允许覆盖占位(标签为空且可解析)', async () => {
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

  // ⚠ 损坏文件的 isTask 也是 false:覆盖守卫必须连「可解析」一起判,否则新建/改名会静默清掉别人的坏 plist
  it('目标已存在但无法解析 → 拒绝覆盖', async () => {
    const h = harness(60_000)
    try {
      const target = join(h.userDir, 'broken.plist')
      writeFileSync(target, BROKEN_XML)
      await expect(h.svc.write('user', target, PLIST_XML)).rejects.toThrow(/无法解析,拒绝覆盖/)
      expect(h.find(await h.svc.scanAll(), 'broken.plist')?.parseError).toBeTruthy() // 原文件仍在
    } finally {
      h.cleanup()
    }
  })

  it('writeAt 跳过覆盖守卫:可原地修复损坏文件', async () => {
    const h = harness(60_000)
    try {
      const target = join(h.userDir, 'broken.plist')
      writeFileSync(target, BROKEN_XML)
      await h.svc.writeAt('user', target, PLIST_XML) // 不抛错
      expect(h.userLabels(await h.svc.scanAll())).toEqual(['com.test.memo'])
    } finally {
      h.cleanup()
    }
  })
})
