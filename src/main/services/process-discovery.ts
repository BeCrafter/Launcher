// 端口服务发现(阶段 3):lsof 扫描 + ps 补全 + 分类管线 + 变更推送
// - 轮询仅在「端口服务」页激活且用户未暂停时进行(resource 友好);启动扫一次给角标初值
// - 稳定 id = pid:port;结果集合变化才推送(diff);lsof 失败保留上次数据并记录 error
// - brew services list 极慢(实测 11-13s)且低频(10min)刷新,分类交叉用;docker 每 10s(不可用每 15s 重试),静默降级

import { classifyService } from '../domains/service-classify'
import { dedupeRows, etimeToUptime, parseLsofListen } from '../domains/lsof-parse'
import { portsRawToPort } from '../domains/docker-parse'
import type { DockerContainer, PortService } from '../../shared/models'
import { resolveBrewPath } from './brew-path'
import type { DockerService } from './docker-service'
import type { ShellRunner } from './shell-runner'

export interface ScanResult {
  services: PortService[]
  containers: DockerContainer[]
  dockerAvailable: boolean
  brewServices: string[]
  scannedAt: number
  error: string | null
}

export interface ProcessDiscovery {
  scanOnce(): Promise<ScanResult>
  /** 最近一次扫描结果(无副作用,供 IPC 立即读取) */
  getLast(): ScanResult
  start(): void
  stop(): void
  setActive(active: boolean): void
  setPolling(enabled: boolean): void
  readonly polling: boolean
  readonly active: boolean
}

const emptyResult = (): ScanResult => ({
  services: [],
  containers: [],
  dockerAvailable: false,
  brewServices: [],
  scannedAt: 0,
  error: null
})

export function createProcessDiscovery(deps: {
  runner: ShellRunner
  docker: DockerService
  onChange(r: ScanResult): void
  pollMs?: number
  brewRefreshMs?: number
  brewTimeoutMs?: number
  /** 覆盖 brew 可执行路径(默认 resolveBrewPath 自动探测;测试固定值) */
  brewPath?: string
  dockerRefreshMs?: number
  log?(m: string): void
}): ProcessDiscovery {
  const pollMs = deps.pollMs ?? 3000
  const brewRefreshMs = deps.brewRefreshMs ?? 600_000 // brew 极慢(11-13s),低频即可;名集合仅影响分类展示
  const brewTimeoutMs = deps.brewTimeoutMs ?? 45_000 // 超过默认 cmdTimeout(10s)必被 SIGTERM,显式放宽
  const brewFile = deps.brewPath ?? resolveBrewPath()
  const dockerRefreshMs = deps.dockerRefreshMs ?? 10_000
  const log = deps.log ?? ((): void => {})

  let last: ScanResult = emptyResult()
  let lastJson = ''
  let brewServices: string[] = []
  let lastBrewAt = 0
  let docker: { available: boolean; containers: DockerContainer[] } = { available: false, containers: [] }
  let lastDockerAt = 0
  let timer: ReturnType<typeof setInterval> | null = null
  let running = false
  let active = false
  let polling = true

  async function refreshBrewIfDue(): Promise<void> {
    // lastBrewAt 先置位 = 单飞:刷新期间后续调用立即返回,不会叠加并发 brew( brew 单次 13s)
    if (Date.now() - lastBrewAt < brewRefreshMs) return
    lastBrewAt = Date.now()
    const r = await deps.runner.run(brewFile, ['services', 'list'], { timeoutMs: brewTimeoutMs })
    if (r.code !== 0) return
    brewServices = r.stdout
      .split('\n')
      .slice(1)
      .map((l) => l.trim().split(/\s+/)[0] ?? '')
      .filter((n) => n !== '')
  }

  async function refreshDockerIfDue(): Promise<void> {
    // 可用时 10s 刷新;不可用时按 dockerRefreshMs 重试(避免 daemon 未启动时每轮空转 spawn)
    const interval = docker.available ? dockerRefreshMs : Math.max(dockerRefreshMs, 15_000)
    if (Date.now() - lastDockerAt < interval) return
    lastDockerAt = Date.now()
    try {
      docker = await deps.docker.refresh()
      if (!docker.available) log('docker unavailable, degraded')
    } catch (err) {
      docker = { available: false, containers: [] }
      log(`docker refresh failed: ${String(err)}`)
    }
  }

  function containerToService(c: DockerContainer): PortService {
    return {
      id: c.id,
      port: portsRawToPort(c.portsRaw),
      name: c.name,
      command: c.image,
      user: 'docker',
      cmd: c.image,
      status: c.status,
      addr: 'docker',
      proto: 'TCP',
      uptime: c.statusText,
      type: 'docker',
      kind: 'docker',
      evidence: c.image,
      containerId: c.containerId
    }
  }

  async function scanOnce(): Promise<ScanResult> {
    await refreshBrewIfDue().catch(() => {})
    await refreshDockerIfDue()

    const lsof = await deps.runner.run('lsof', ['-iTCP', '-sTCP:LISTEN', '-P', '-n', '-FpcuPn'])
    let services: PortService[] = []
    let error: string | null = null

    if (lsof.code !== 0 && lsof.stdout.trim() === '') {
      error = lsof.stderr.trim() || lsof.error || 'lsof failed'
      services = last.services // 保留上次数据
    } else {
      const rows = dedupeRows(parseLsofListen(lsof.stdout))
      const pids = [...new Set(rows.map((r) => r.pid))]
      const psMap = new Map<number, { user: string; etime: string; command: string }>()
      if (pids.length > 0) {
        const ps = await deps.runner.run('ps', ['-p', pids.join(','), '-o', 'pid=,user=,etime=,command='])
        for (const line of ps.stdout.split('\n')) {
          const m = line.match(/^\s*(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/)
          if (m) psMap.set(Number.parseInt(m[1], 10), { user: m[2], etime: m[3], command: m[4] })
        }
      }
      const brewSet = new Set(brewServices)
      services = rows
        .filter((r) => psMap.has(r.pid)) // ps 缺失 = 进程已死,丢弃
        .map((r) => {
          const ps = psMap.get(r.pid)!
          const cls = classifyService({ command: r.command, cmd: ps.command || r.command, port: r.port }, brewSet)
          return {
            id: `${r.pid}:${r.port}`,
            port: r.port,
            name: r.command,
            pid: r.pid,
            command: r.command,
            user: ps.user,
            cmd: ps.command || r.command,
            status: 'running' as const,
            addr: r.addr,
            proto: r.proto,
            uptime: etimeToUptime(ps.etime),
            type: cls.type,
            kind: cls.kind,
            evidence: cls.evidence
          }
        })
        .sort((a, b) => a.port - b.port)
    }

    const result: ScanResult = {
      services,
      containers: docker.available ? docker.containers : [],
      dockerAvailable: docker.available,
      brewServices,
      scannedAt: Date.now(),
      error
    }

    const json = JSON.stringify({
      s: result.services,
      c: result.containers,
      d: result.dockerAvailable,
      b: result.brewServices
    })
    const changed = json !== lastJson
    lastJson = json
    last = result
    if (changed || error !== null) deps.onChange(result)
    return result
  }

  async function tick(): Promise<void> {
    if (!active || !polling || running) return
    running = true
    try {
      await scanOnce()
    } catch (err) {
      log(`scan failed: ${String(err)}`)
    } finally {
      running = false
    }
  }

  return {
    scanOnce,
    getLast: () => last,
    start() {
      if (timer) return
      void scanOnce().catch((err) => log(`initial scan failed: ${String(err)}`))
      timer = setInterval(() => void tick(), pollMs)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
    setActive(v) {
      active = v
      if (v) void tick() // 回到页面立即扫一轮
    },
    setPolling(v) {
      polling = v
    },
    get polling() {
      return polling
    },
    get active() {
      return active
    }
  }
}
