import { describe, expect, it, vi } from 'vitest'
import type { DockerContainer } from '../../shared/models'
import type { DockerService } from './docker-service'
import { createProcessDiscovery, type ScanResult } from './process-discovery'
import type { ShellRunner, ShellRunResult } from './shell-runner'

const ok = (stdout = ''): ShellRunResult => ({ code: 0, signal: null, stdout, stderr: '', timedOut: false, error: null })
const fail = (stderr: string): ShellRunResult => ({ code: 1, signal: null, stdout: '', stderr, timedOut: false, error: null })

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

function harness(opts?: { lsofFail?: boolean; dockerAvailable?: boolean }) {
  const calls: string[][] = []
  let lsofFailOnce = opts?.lsofFail ?? false
  const runner: ShellRunner = {
    async run(file, args = []) {
      calls.push([file, ...args])
      if (file === 'lsof') return lsofFailOnce ? fail('lsof: operation not permitted') : ok(LSOF)
      if (file === 'ps') return ok(PS)
      if (file === 'brew') return ok('Name Status User File\nredis started wangming\nnginx none\n')
      return ok('')
    }
  }
  const docker: DockerService = {
    refresh: async () => ({ available: opts?.dockerAvailable ?? false, containers: opts?.dockerAvailable ? [container()] : [] }),
    action: async () => {}
  }
  const onChange = vi.fn<(r: ScanResult) => void>()
  const discovery = createProcessDiscovery({ runner, docker, onChange, pollMs: 30, brewRefreshMs: 0, dockerRefreshMs: 0 })
  return { discovery, onChange, calls, setLsofFail: (v: boolean) => (lsofFailOnce = v) }
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
