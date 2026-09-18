// plist-service scanAll 记忆/单飞/失效(打开慢修复:抽屉 4 路并发 IPC 共享一次扫描)
// + 非任务/异常 plist 的可见性:每个 .plist 恰好一条记录,解析失败与缺 Label 都不再被丢弃
// 注:system/daemon 作用域是硬编码系统目录,单测仅断言 user 作用域(由 home 注入临时目录隔离)
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
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

// ── P0-1.2:目录逃逸防线(不依赖 join 的语义;Label 由 agent-label 校验,readdir 来的文件名靠这里兜底) ──
describe('plist-service 路径围栏', () => {
  it('pathFor:含路径分隔符的 label 逃不出管理目录', () => {
    const h = harness(1000)
    try {
      expect(() => h.svc.pathFor('user', '../../etc/evil')).toThrow(/不在 user 管理目录内/)
      // 'a/b' 经 join 归入子目录(不构成逃逸)—— 这类输入由 Label 校验层拒绝(见 agent-label.test.ts)
      expect(h.svc.pathFor('user', 'a/b')).toBe(join(h.userDir, 'a', 'b.plist'))
      expect(h.svc.pathFor('user', 'com.ok')).toBe(join(h.userDir, 'com.ok.plist'))
    } finally {
      h.cleanup()
    }
  })

  it('writeAt / remove:目标在管理目录之外一律拒绝且零写盘', async () => {
    const h = harness(1000)
    try {
      await expect(h.svc.writeAt('user', '/etc/evil.plist', PLIST_XML)).rejects.toThrow(/不在 user 管理目录内/)
      await expect(h.svc.writeAt('user', join(h.userDir, '../escape.plist'), PLIST_XML)).rejects.toThrow(
        /不在 user 管理目录内/
      )
      await expect(h.svc.remove('user', '/etc/evil.plist')).rejects.toThrow(/不在 user 管理目录内/)
      expect(existsSync(join(h.home, 'Library/escape.plist'))).toBe(false)
    } finally {
      h.cleanup()
    }
  })
})

// ── P1 复审:提权写入/删除的事务顺序与中止条件 ──
describe('plist-service 提权事务', () => {
  function elevHarness(result: { ok: boolean; stderr?: string }) {
    const home = mkdtempSync(join(tmpdir(), 'plist-elev-'))
    const requests: { steps: { command?: string; args?: string[]; script?: string }[] }[] = []
    const elevate: ElevationExecutor = {
      run: async (req) => {
        requests.push(req as never)
        return { ok: result.ok, cancelled: false, code: result.ok ? 0 : 1, stderr: result.stderr ?? null }
      }
    }
    const runner: ShellRunner = {
      run: async () => ({ code: 0, signal: null, stdout: '', stderr: '', timedOut: false, error: null })
    }
    const svc = createPlistService({ runner, elevate, home, memoTtlMs: 1000 })
    return { svc, requests, cleanup: () => rmSync(home, { recursive: true, force: true }) }
  }

  it('特权写入:先 chown/chmod **临时文件**,最后才 mv(权限步骤失败时目标保持完整)', async () => {
    const h = elevHarness({ ok: true })
    try {
      await h.svc.writeAt('daemon', '/Library/LaunchDaemons/com.t.plist', PLIST_XML)
      const steps = h.requests[0].steps as { command: string; args: string[] }[]
      expect(steps.map((s) => s.command)).toEqual(['chown', 'chmod', 'mv'])
      const tmp = steps[0].args[1]
      expect(steps[1].args[1]).toBe(tmp) // chmod 同一个临时文件
      expect(steps[2].args).toEqual([tmp, '/Library/LaunchDaemons/com.t.plist']) // 最后才覆盖目标
    } finally {
      h.cleanup()
    }
  })

  it('特权删除:bootout 与 rm 通过 command+argv 串行执行,不把路径拼进 raw script', async () => {
    const h = elevHarness({ ok: true })
    try {
      await h.svc.removeWithBootout('daemon', '/Library/LaunchDaemons/com.t.plist', true, 'system')
      const steps = h.requests[0].steps as { command: string; args: string[] }[]
      expect(steps).toEqual([
        { command: 'launchctl', args: ['bootout', 'system', '/Library/LaunchDaemons/com.t.plist'] },
        { command: 'rm', args: ['-f', '/Library/LaunchDaemons/com.t.plist'] }
      ])
    } finally {
      h.cleanup()
    }
  })

  it('特权写入:暂存文件在 0700 随机私有目录内,且提权后被清理(P0)', async () => {
    const h = elevHarness({ ok: true })
    try {
      await h.svc.writeAt('daemon', '/Library/LaunchDaemons/com.t.plist', PLIST_XML)
      const steps = h.requests[0].steps as { command: string; args: string[] }[]
      const staging = steps[0].args[1]
      // 位于 mkdtemp 生成的 launcher-elev-XXXX 私有目录,而不是可预测的全局 tmpdir 文件名
      expect(staging).toMatch(/\/launcher-elev-[^/]+\//)
      expect(staging.endsWith('/com.t.plist')).toBe(true)
      // 提权结束后整目录被清理(不留 root 拥有的暂存文件)
      const dir = staging.slice(0, staging.lastIndexOf('/'))
      expect(existsSync(dir)).toBe(false)
    } finally {
      h.cleanup()
    }
  })

  it('特权删除:提权失败 → 抛出(不静默当成功)', async () => {
    const h = elevHarness({ ok: false, stderr: 'Operation not permitted' })
    try {
      await expect(
        h.svc.removeWithBootout('daemon', '/Library/LaunchDaemons/com.t.plist', true, 'system')
      ).rejects.toThrow(/Operation not permitted/)
    } finally {
      h.cleanup()
    }
  })
})
