import { describe, expect, it, vi } from 'vitest'
import type { LaunchctlService } from './launchctl-service'
import { createAgentService } from './agent-service'
import type { PlistService } from './plist-service'

function taskRec(label: string, scope: 'user' | 'daemon') {
  return {
    path: `/tmp/${label}.plist`,
    scope,
    fileName: `${label}.plist`,
    xml: '',
    value: { Label: label },
    label,
    desc: '',
    isTask: true
  }
}

describe('agent-service.snapshotRuntime', () => {
  it('按 pid 判运行中;带 @ 的 label 留在行里;一次 ps 补 cpu/mem', async () => {
    const calls: string[][] = []
    const runner = {
      run: async (_file: string, args: string[]) => {
        calls.push(args)
        return {
          code: 0,
          signal: null,
          stdout: '99666  1.5  2.0  01:02:03 Wed Nov 11 10:00:00 2026\n',
          stderr: '',
          timedOut: false,
          error: null
        }
      }
    }
    const label = 'homebrew.mxcl.postgresql@14'
    const tables = {
      gui: new Map(),
      system: new Map([[label, { label, pid: 99666, lastExitCode: 0 }]]),
      disabled: { gui: new Set<string>(), system: new Set<string>() }
    }
    const launchctl = {
      domainOf: () => 'system',
      list: vi.fn(async () => tables),
      print: vi.fn(async () => ({ found: false, path: null, pid: null }))
    } as unknown as LaunchctlService
    const rec = taskRec(label, 'daemon')
    const plists = {
      scanAll: async () => [rec],
      scanNow: async () => [rec],
      readFresh: async () => rec,
      dirs: () => [],
      pathFor: (_s: string, l: string) => `/tmp/${l}.plist`
    } as unknown as PlistService
    const svc = createAgentService({
      runner: runner as never,
      launchctl,
      plists,
      brew: {} as never,
      getXmlIndent: () => '  '
    })
    const first = await svc.list()
    expect(first.agents[0]).toMatchObject({ id: `daemon:${label}`, status: 'running', pid: 99666 })
    const snap = await svc.snapshotRuntime()
    expect(snap.epoch).toBe(first.epoch)
    expect(snap.rows).toEqual([
      {
        id: `daemon:${label}`,
        status: 'running',
        pid: 99666,
        uptime: '1h 2m',
        exitCode: 0,
        isDisabledByOverride: false,
        cpu: '1.5%',
        mem: '2.0%',
        startTime: 'Wed Nov 11 10:00:00 2026'
      }
    ])
    // list 一次、快照一次,都是全量 -eo,不是按 pid 逐个查
    expect(calls.filter((args) => args[0] === '-eo')).toHaveLength(2)
  })

  it('快照进行中若整表刷新,返回的是开始时的 epoch', async () => {
    let releasePs!: () => void
    const psGate = new Promise<void>((resolve) => {
      releasePs = resolve
    })
    let psCalls = 0
    const runner = {
      run: async (_file: string, args: string[]) => {
        psCalls += 1
        // 第二次是快照的 ps。卡在这里,让一次 list() 赶在返回前把 epoch 加一。
        if (psCalls > 1 && args.includes('pid=,%cpu=,%mem=,etime=,lstart=')) await psGate
        return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false, error: null }
      }
    }
    const tables = {
      gui: new Map([['com.a', { label: 'com.a', pid: 7, lastExitCode: 0 }]]),
      system: new Map(),
      disabled: { gui: new Set<string>(), system: new Set<string>() }
    }
    const launchctl = { list: vi.fn(async () => tables) } as unknown as LaunchctlService
    const rec = taskRec('com.a', 'user')
    const plists = { scanAll: async () => [rec] } as unknown as PlistService
    const svc = createAgentService({
      runner: runner as never,
      launchctl,
      plists,
      brew: {} as never,
      getXmlIndent: () => '  '
    })
    const listed = await svc.list()
    const pending = svc.snapshotRuntime()
    await vi.waitFor(() => expect(psCalls).toBe(2))
    const again = await svc.list()
    expect(again.epoch).toBe(listed.epoch + 1)
    releasePs()
    const snap = await pending
    expect(snap.epoch).toBe(listed.epoch)
  })
})
