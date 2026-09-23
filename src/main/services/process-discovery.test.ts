import { describe, expect, it, vi } from 'vitest'
import type { DockerContainer } from '../../shared/models'
import type { DockerService } from './docker-service'
import { createProcessDiscovery, toServicesPayload, type ScanResult } from './process-discovery'
import type { ShellRunner, ShellRunResult } from './shell-runner'

const ok = (stdout = ''): ShellRunResult => ({ code: 0, signal: null, stdout, stderr: '', timedOut: false, error: null })
const fail = (stderr: string): ShellRunResult => ({ code: 1, signal: null, stdout: '', stderr, timedOut: false, error: null })
const timedOut = (stdout = ''): ShellRunResult => ({ code: null, signal: 'SIGTERM', stdout, stderr: '', timedOut: true, error: null })

const LSOF = [
  'p2900',
  'crapportd',
  'u501',
  'f8',
  'PTCP',
  'n*:49168',
  'f9',
  'PTCP',
  'n*:49168',
  'p3001',
  'cnode',
  'u501',
  'f12',
  'PTCP',
  'n127.0.0.1:5173',
  'p4001',
  'credis-server',
  'u501',
  'f3',
  'PTCP',
  'n*:6379'
].join('\n')

const PS = [
  ' 2900 wangming 3-04:00:00 /usr/libexec/rapportd',
  ' 3001 wangming 00:42 /usr/local/bin/node /work/vite --port 5173',
  ' 4001 wangming 01:10 /usr/local/opt/redis/bin/redis-server 127.0.0.1:6379'
].join('\n')

const container = (): DockerContainer => ({
  id: 'docker:abc123',
  containerId: 'abc123',
  name: 'nginx-web',
  image: 'nginx:latest',
  status: 'running',
  statusText: 'Up 3 hours',
  portsRaw: '0.0.0.0:8080->80/tcp'
})

/** ps 的异常形态(2026-09-23:ps 失败此前会把整张表静默清空 → 端口页整片白) */
type PsFault = 'exit' | 'timeout' | 'garbage' | 'partial'

function harness(opts?: { lsofFail?: boolean; lsofTimeout?: boolean; psFault?: PsFault; dockerAvailable?: boolean }) {
  const calls: string[][] = []
  let lsofFailOnce = opts?.lsofFail ?? false
  let lsofTimeoutOnce = opts?.lsofTimeout ?? false
  let psFault = opts?.psFault
  const runner: ShellRunner = {
    async run(file, args = []) {
      calls.push([file, ...args])
      // 超时被杀时 stdout 可能是半截表:必须与「完整结果」区分开
      if (file === 'lsof') {
        if (lsofTimeoutOnce) return timedOut(LSOF.split('\n').slice(0, 6).join('\n'))
        return lsofFailOnce ? fail('lsof: operation not permitted') : ok(LSOF)
      }
      if (file === 'ps') {
        if (psFault === 'exit') return fail('ps: not permitted')
        if (psFault === 'timeout') return timedOut(PS.split('\n')[0])
        if (psFault === 'garbage') return ok('   PID USER     ELAPSED COMMAND\n     1 root       1-00:00 launchd\n')
        if (psFault === 'partial') return ok(PS.split('\n').slice(0, 2).join('\n')) // 少列一个已退出的 pid
        return ok(PS)
      }
      if (file === 'brew') return ok('Name Status User File\nredis started wangming\nnginx none\n')
      return ok('')
    }
  }
  const docker: DockerService = {
    refresh: async () =>
      opts?.dockerAvailable
        ? { available: true, containers: [container()], reason: null }
        : { available: false, containers: [], reason: 'daemon-down' as const },
    action: async () => {}
  }
  const onChange = vi.fn<(r: ScanResult) => void>()
  const discovery = createProcessDiscovery({ runner, docker, onChange, pollMs: 30, brewRefreshMs: 0, brewPath: 'brew', dockerRefreshMs: 0 })
  return {
    discovery,
    onChange,
    calls,
    setLsofFail: (v: boolean) => (lsofFailOnce = v),
    setLsofTimeout: (v: boolean) => (lsofTimeoutOnce = v),
    setPsFault: (v: PsFault | undefined) => (psFault = v)
  }
}

describe('process-discovery.scanOnce', () => {
  it('lsof+ps 合成:去重/IPv4 双栈、字段补全、分类与 dev 识别', async () => {
    const h = harness()
    const r = await h.discovery.scanOnce()
    expect(r.error).toBeNull()
    expect(r.services).toHaveLength(3) // rapportd 双栈去重为 1
    const byPort = Object.fromEntries(r.services.map((s) => [s.port, s]))
    expect(byPort[49168]).toMatchObject({ name: 'rapportd', pid: 2900, user: 'wangming', uptime: '3d 4h', kind: 'process', type: 'process' })
    expect(byPort[5173]).toMatchObject({ name: 'node', kind: 'dev', type: 'node', cmd: '/usr/local/bin/node /work/vite --port 5173' })
    expect(byPort[6379]).toMatchObject({ name: 'redis-server', kind: 'brew', type: 'brew' })
    expect(byPort[5173].id).toBe('3001:5173')
  })

  it('ps 缺失的 pid 视为已死 → 丢弃;lsof 失败 → 保留上次数据 + error', async () => {
    const h = harness()
    await h.discovery.scanOnce()
    h.setLsofFail(true)
    const r = await h.discovery.scanOnce()
    expect(r.error).toContain('operation not permitted')
    expect(r.services).toHaveLength(3) // 上次结果保留
  })

  // ── 扫描失败不得清空列表(2026-09-23 修复:ps 失败会让端口页整片变白) ──
  it('ps 失败(非 0 退出)→ 保留上次数据 + error,绝不清空整张表', async () => {
    const h = harness()
    await h.discovery.scanOnce()
    h.setPsFault('exit')
    const r = await h.discovery.scanOnce()
    expect(r.error).toContain('ps')
    expect(r.services).toHaveLength(3) // ← 修复前是 []:空 psMap 过筛把每一行都滤掉了
  })

  it('ps 超时 → 同上(半截 stdout 不作数)', async () => {
    const h = harness()
    await h.discovery.scanOnce()
    h.setPsFault('timeout')
    const r = await h.discovery.scanOnce()
    expect(r.error).toContain('timed out')
    expect(r.services).toHaveLength(3)
  })

  it('ps 退出码 0 但输出形态不认识 → 视为失败(而不是拿空 psMap 过筛)', async () => {
    const h = harness()
    await h.discovery.scanOnce()
    h.setPsFault('garbage')
    const r = await h.discovery.scanOnce()
    expect(r.error).toContain('not understood')
    expect(r.services).toHaveLength(3)
  })

  it('ps 少列一个已退出的 pid → 仍按「进程已死」丢弃该行,不触发失败兜底', async () => {
    const h = harness({ psFault: 'partial' })
    const r = await h.discovery.scanOnce()
    expect(r.error).toBeNull()
    // redis-server(4001) 不在 ps 输出里 → 只丢这一行;其余两行照旧(不是整张表清空)
    expect(r.services.map((s) => s.port)).toEqual([5173, 49168])
  })

  it('lsof 超时 → 保留上次数据 + error(即使 stdout 已有半截表,也不解析)', async () => {
    const h = harness()
    await h.discovery.scanOnce()
    h.setLsofTimeout(true)
    const r = await h.discovery.scanOnce()
    expect(r.error).toContain('timed out')
    // 半截输出里第 1 个进程是完整的(rapportd),解析它就会得到 1 条 → 保留上次的 3 条才对
    expect(r.services).toHaveLength(3)
  })

  it('失败态不重复推送(此前每 3s 重推同一份空表,UI 反复被清空)', async () => {
    const h = harness()
    await h.discovery.scanOnce()
    h.setPsFault('exit')
    await h.discovery.scanOnce()
    const after = h.onChange.mock.calls.length // 成功 1 次 + 失败 1 次
    expect(after).toBe(2)
    await h.discovery.scanOnce()
    await h.discovery.scanOnce()
    expect(h.onChange.mock.calls.length).toBe(after) // 失败内容未变 → 不再推
    h.setPsFault(undefined)
    await h.discovery.scanOnce()
    expect(h.onChange.mock.calls.length).toBe(after + 1) // 恢复 → 推一次
  })

  it('docker 可用时容器条目并入(降级时无痕迹)', async () => {
    const withDocker = harness({ dockerAvailable: true })
    const r1 = await withDocker.discovery.scanOnce()
    expect(r1.dockerAvailable).toBe(true)
    expect(r1.containers).toHaveLength(1)

    const noDocker = harness({ dockerAvailable: false })
    const r2 = await noDocker.discovery.scanOnce()
    expect(r2.dockerAvailable).toBe(false)
    expect(r2.containers).toEqual([])
  })

  it('结果集合变化才推送;不变不重复推送', async () => {
    const h = harness()
    await h.discovery.scanOnce()
    expect(h.onChange).toHaveBeenCalledTimes(1)
    await h.discovery.scanOnce()
    expect(h.onChange).toHaveBeenCalledTimes(1) // 内容未变
    h.setLsofFail(true)
    await h.discovery.scanOnce()
    expect(h.onChange).toHaveBeenCalledTimes(2) // 错误态变化也推送
  })

  it('轮询门控:未激活/未开启时不扫描,激活立即扫', async () => {
    const h = harness()
    h.discovery.start()
    await new Promise((r) => setTimeout(r, 120))
    const afterStart = h.onChange.mock.calls.length // 启动初扫 1 次;未激活不再扫
    expect(afterStart).toBe(1)
    h.discovery.setActive(true)
    await new Promise((r) => setTimeout(r, 50))
    expect(h.onChange.mock.calls.length).toBe(afterStart) // 内容未变 → 不新增推送,但已扫描
    expect(h.calls.filter((c) => c[0] === 'lsof').length).toBeGreaterThanOrEqual(2)
    h.discovery.setPolling(false)
    const lsofCount = h.calls.filter((c) => c[0] === 'lsof').length
    await new Promise((r) => setTimeout(r, 130))
    expect(h.calls.filter((c) => c[0] === 'lsof').length).toBe(lsofCount) // 暂停后不再扫描
    h.discovery.stop()
  })
})

describe('process-discovery.toServicesPayload', () => {
  it('error 随 payload 带出(renderer 据此区分「扫描失败」与「真的没有端口」)', async () => {
    const h = harness()
    const healthy = await h.discovery.scanOnce()
    expect(toServicesPayload(healthy, true).error).toBeNull()

    h.setPsFault('exit')
    const broken = await h.discovery.scanOnce()
    const p = toServicesPayload(broken, true)
    expect(p.error).toContain('ps')
    expect(p.services).toHaveLength(3) // 带 error 的同时仍是上次成功的数据
    expect(p.polling).toBe(true)
  })
})
