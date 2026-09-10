// mock 数据源:demo 交互行为的服务化封装(逐行为移植自 agents.js/drawer.js/modals.js/crontab.js/services.js)
// 状态 = 就地修改 MOCK_DATA(与 demo 全局数组别名同一模式);后续阶段整体替换为 ipcDataSource。

import { MOCK_DATA } from './mock-data'
import type {
  Agent,
  AgentForm,
  CronJob,
  DrawerStatusModel,
  LogLine,
  OpsState
} from '@shared/models'
import type {
  AgentRepository,
  AgentScope,
  CronRepository,
  DataSource,
  LogStream,
  OpAction,
  ServiceRepository
} from '../ports'

const delay = <T>(v: T): Promise<T> => Promise.resolve(v)

// ── Agents ──

class MockAgentRepo implements AgentRepository {
  async list() {
    return delay({ agents: MOCK_DATA.agents, invalidPlists: MOCK_DATA.invalidPlists })
  }

  async toggle(id: string): Promise<Agent> {
    const a = MOCK_DATA.agents.find((x) => x.id === id)
    if (!a) throw new Error(`agent not found: ${id}`)
    if (a.status === 'running') {
      a.status = 'stopped'
      a.pid = null
      a.uptime = null
    } else {
      a.status = 'running'
      a.pid = Math.floor(Math.random() * 10000) + 1000
      a.uptime = '0m'
    }
    return delay(a)
  }

  async brewAction(kind: 'start' | 'stop', id: string): Promise<Agent> {
    const a = MOCK_DATA.agents.find((x) => x.id === id)
    if (!a) throw new Error(`agent not found: ${id}`)
    return delay(a) // demo brewAction 仅 toast,不改状态
  }

  async createDraft(scope: AgentScope, labelPrefix: string): Promise<Agent> {
    let label = labelPrefix + 'taskname'
    let idx = 1
    while (MOCK_DATA.agents.some((a) => a.id === label)) label = labelPrefix + 'taskname.' + idx++
    const draft: Agent = {
      id: label,
      label,
      desc: '',
      status: 'stopped',
      pid: null,
      uptime: null,
      scope: scope || 'user',
      tags: [],
      program: '',
      exitCode: null,
      restarts: 0
    }
    MOCK_DATA.agents.unshift(draft)
    return delay(draft)
  }

  async save(id: string, patch: Partial<AgentForm> & { label: string; desc: string }): Promise<Agent> {
    const entry = MOCK_DATA.agents.find((x) => x.id === id)
    if (!entry) throw new Error(`agent not found: ${id}`)
    entry.label = patch.label || entry.label
    entry.desc = patch.desc
    entry.program = patch.program ?? entry.program
    if (entry.label !== id) entry.id = entry.label // demo:Label 重命名即重指 id
    return delay(entry)
  }

  async remove(id: string): Promise<void> {
    const idx = MOCK_DATA.agents.findIndex((x) => x.id === id)
    if (idx > -1) MOCK_DATA.agents.splice(idx, 1)
  }

  async clone(id: string): Promise<Agent> {
    const src = MOCK_DATA.agents.find((x) => x.id === id)
    if (!src) throw new Error(`agent not found: ${id}`)
    const base = src.label
    let copy = base + '.copy'
    let idx = 1
    while (MOCK_DATA.agents.some((a) => a.id === copy)) copy = base + '.copy.' + idx++
    const clone = { ...src, id: copy, label: copy, status: 'stopped' as const, pid: null, uptime: null }
    MOCK_DATA.agents.unshift(clone)
    return delay(clone)
  }

  // demo drawerOpsAction 的状态机(不含提权分支——提权在调用方处理)
  async ops(id: string, action: OpAction): Promise<OpsState> {
    const s = MOCK_DATA.drawer.opsState
    if (action === 'load') {
      if (s.loaded) {
        s.loaded = false
        s.running = false
      } else {
        s.loaded = true
        s.enabled = true
        s.running = false
      }
    } else if (action === 'enable') {
      if (!s.loaded) return delay({ ...s }) // demo:未加载直接返回(调用方 toast loadFirst)
      s.enabled = !s.enabled
      if (!s.enabled) s.running = false
    } else if (action === 'kickstart') {
      if (!s.loaded) return delay({ ...s })
      s.running = true
    }
    return delay({ ...s })
  }

  // 阶段 1 前:全部卡片共用 MOCK_DATA.drawer 表单(demo populateDrawerDefaults 行为)
  async readForm(id: string): Promise<AgentForm> {
    return delay(JSON.parse(JSON.stringify(MOCK_DATA.drawer.form)) as AgentForm)
  }

  async readStatus(id: string): Promise<DrawerStatusModel> {
    return delay(JSON.parse(JSON.stringify(MOCK_DATA.drawer.status)) as DrawerStatusModel)
  }
}

// ── Crons ──

// demo cronLogPath:任务开启日志后 stdout/stderr 收敛目录
export function cronLogPath(id: string): string {
  return `~/Library/Logs/BeCrafter-Launcher/cron/${id}.log`
}

class MockCronRepo implements CronRepository {
  async list(): Promise<CronJob[]> {
    return delay(MOCK_DATA.crons)
  }

  async create(job: CronJob): Promise<CronJob> {
    MOCK_DATA.crons.unshift(job)
    return delay(job)
  }

  async update(id: string, patch: Partial<CronJob>): Promise<CronJob> {
    const j = MOCK_DATA.crons.find((x) => x.id === id)
    if (!j) throw new Error(`cron not found: ${id}`)
    Object.assign(j, patch)
    return delay(j)
  }

  async remove(id: string): Promise<void> {
    const idx = MOCK_DATA.crons.findIndex((x) => x.id === id)
    if (idx > -1) MOCK_DATA.crons.splice(idx, 1)
  }

  // demo cronLogLines:近 3 天窗口的模拟日志
  async readLog(id: string): Promise<LogLine[]> {
    const j = MOCK_DATA.crons.find((x) => x.id === id)
    if (!j) return delay([])
    const day = 86400000
    const now = Date.now()
    const ts = (offset: number): string =>
      new Date(now - offset).toISOString().slice(0, 19).replace('T', ' ')
    const cmdBase = j.cmd.split('/').pop() ?? ''
    const rows: [string, LogLine['type'], string][] = [
      [ts(2 * day + 3600000), 'info', `[INFO] cron registered: ${j.expr} → ${j.cmd}`],
      [ts(2 * day + 1790000), 'ok', `[OK] run started (pid ${1000 + (j.id.charCodeAt(1) || 65) * 7})`],
      [ts(2 * day + 1780000), 'ok', `[OK] run finished in 8.3s, exit 0`],
      [ts(day + 3600000), 'info', `[INFO] scheduled trigger matched (${j.expr})`],
      [ts(day + 3000000), 'warn', `[WARN] retry #1 — transient failure, re-running`],
      [ts(day + 2990000), 'ok', `[OK] retry succeeded: ${cmdBase}`],
      [ts(day / 2), 'info', `[INFO] heartbeat: cron dispatch alive`],
      [ts(3600000), 'ok', `[OK] last run completed successfully (exit 0)`],
      [ts(600000), 'err', `[ERR] stderr: permission denied on /var/tmp/${cmdBase}.tmp`],
      [ts(300000), 'warn', `[WARN] stdout: 3 lines truncated (retention window)`],
      [ts(0), 'info', `[INFO] log tail — retained; older than 3 天 auto-cleaned`]
    ]
    return delay(rows.map(([ts2, type, text]) => ({ ts: ts2, type, text })))
  }
}

// ── Services ──

class MockServiceRepo implements ServiceRepository {
  async list() {
    return delay({ services: MOCK_DATA.services, brewServices: MOCK_DATA.brewServices })
  }

  // demo killSvc:危险确认后仅 toast,不删数据
  async kill(id: string): Promise<void> {
    return delay(undefined)
  }
}

// ── Live logs(抽屉日志 tab 4.5s 轮询追加)──

class MockLogStream implements LogStream {
  private handlers = new Set<(line: LogLine) => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private cursor = 0

  subscribe(handler: (line: LogLine) => void): () => void {
    this.handlers.add(handler)
    this.ensureTimer()
    return () => {
      this.handlers.delete(handler)
      if (this.handlers.size === 0 && this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    }
  }

  private ensureTimer(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      const [type, text] = MOCK_DATA.liveLogs[this.cursor % MOCK_DATA.liveLogs.length]
      this.cursor++
      const line: LogLine = { ts: nowTs(), type, text }
      for (const h of this.handlers) h(line)
    }, 4500)
  }
}

export function nowTs(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function createMockDataSource(): DataSource {
  return {
    agents: new MockAgentRepo(),
    crons: new MockCronRepo(),
    services: new MockServiceRepo(),
    logs: new MockLogStream()
  }
}
