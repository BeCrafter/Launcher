// 抽屉 store 的异步竞态与身份保真(P2 复审项):
// - 慢响应不得污染当前抽屉(status / 日志源切换)
// - 历史 Label 不因展示层 trim 被误判为改名
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  readDocument: vi.fn(),
  readStatus: vi.fn(),
  readLogs: vi.fn(),
  clearLogs: vi.fn(),
  saveForm: vi.fn(),
  saveXml: vi.fn(),
  list: vi.fn()
}))

vi.mock('../lib/utils', () => ({ showToast: mocks.toast, copyText: vi.fn() }))
vi.mock('../data', () => ({
  dataSource: (): unknown => ({
    agents: {
      list: mocks.list,
      readDocument: mocks.readDocument,
      readStatus: mocks.readStatus,
      readLogs: mocks.readLogs,
      readForm: vi.fn(),
      readXml: vi.fn(),
      clearLogs: mocks.clearLogs,
      ops: vi.fn(),
      clone: vi.fn(),
      remove: vi.fn(),
      saveForm: mocks.saveForm,
      saveXml: mocks.saveXml
    }
  })
}))

import { useDrawerStore } from './drawer-store'
import type { Agent, AgentDocument, DrawerStatusModel } from '@shared/models'

const agent = (id: string, label: string): Agent => ({
  id,
  label,
  desc: '',
  status: 'stopped',
  pid: null,
  uptime: null,
  scope: 'user',
  tags: [],
  program: '/bin/echo',
  exitCode: null,
  restarts: 0
})

const docOf = (label: string): AgentDocument => ({
  id: `user:${label}`,
  scope: 'user',
  path: `/tmp/${label}.plist`,
  revision: `rev-${label}`,
  sourceXml: '<plist/>',
  form: {
    label,
    desc: '',
    processType: '',
    program: '/bin/echo',
    args: [],
    workingDir: '',
    userName: '',
    nice: 0,
    throttleInterval: null,
    env: {},
    triggers: { runAtLoad: false, keepAlive: false, watchPaths: false, startCalendarInterval: false, startInterval: 0 },
    keepAliveMode: 'bool',
    keepAliveDict: { crashed: null, successfulExit: null },
    watchPaths: [],
    sciEntries: [],
    stdout: '',
    stderr: ''
  },
  compatibility: { unsupportedPaths: [], preservedTopLevelKeys: [], warnings: [], entries: [] },
  sourceShape: { program: 'arguments' }
})

/** 最小可用状态模型;uptime 作标记位,便于断言「换成了哪一份」 */
const statusOf = (marker: string): DrawerStatusModel => ({
  state: 'loaded',
  pid: null,
  uptime: marker,
  cpu: '0%',
  cpuWidth: '0%',
  mem: '0M',
  memWidth: '0%',
  exitCode: null,
  restarts: 0,
  startTime: '',
  plistPath: '',
  workDir: '',
  scope: 'user'
})

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('drawer-store 异步竞态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue({ agents: [] })
    mocks.readDocument.mockImplementation(async (id: string) => docOf(id.split(':')[1]))
    mocks.readStatus.mockResolvedValue(null)
    mocks.readLogs.mockResolvedValue([])
    mocks.clearLogs.mockResolvedValue({ cleared: [], failed: [] })
    useDrawerStore.setState({ open: false, agentId: null, document: null, form: null, logLines: [], statusModel: null, requestVersion: 0 })
  })

  it('loadLogs:换源后旧响应不得覆盖当前来源', async () => {
    await useDrawerStore.getState().openFor(agent('user:a', 'a'))
    // file 源:慢请求(挂起)
    let resolveFile!: (v: unknown) => void
    mocks.readLogs.mockReturnValueOnce(new Promise((r) => (resolveFile = r)))
    const slow = useDrawerStore.getState().loadLogs('file')
    // system 源:快请求,先落地
    const sysLine = { ts: 't', type: 'info' as const, text: 'system-line' }
    mocks.readLogs.mockResolvedValueOnce([sysLine])
    await useDrawerStore.getState().loadLogs('system')
    // file 的慢响应此刻才回来 → 必须被丢弃
    resolveFile([{ ts: 't', type: 'info', text: 'file-line' }])
    await slow
    expect(useDrawerStore.getState().logSource).toBe('system')
    expect(useDrawerStore.getState().logLines).toEqual([sysLine])
  })

  it('换 agent 后,旧 status 响应不得写入新抽屉', async () => {
    await useDrawerStore.getState().openFor(agent('user:a', 'a'))
    let resolveOld!: (v: unknown) => void
    mocks.readStatus.mockReturnValueOnce(new Promise((r) => (resolveOld = r)))
    useDrawerStore.getState().setTab('status') // A 的慢 status 请求
    // 立即关闭并打开 B(B 的 status 立即返回)
    useDrawerStore.getState().close()
    await useDrawerStore.getState().openFor(agent('user:b', 'b'))
    mocks.readStatus.mockResolvedValueOnce(statusOf('B'))
    useDrawerStore.getState().setTab('status')
    await flush()
    resolveOld(statusOf('A')) // A 的慢响应此刻才回来
    await flush()
    expect(useDrawerStore.getState().statusModel?.uptime).toBe('B')
  })


  it('clearLog:清空过程中换 agent,不得清空新抽屉的日志', async () => {
    await useDrawerStore.getState().openFor(agent('user:a', 'a'))
    useDrawerStore.setState({ logLines: [{ ts: 't', type: 'info', text: 'a-line' }] })
    let resolveClear!: () => void
    mocks.clearLogs.mockReturnValueOnce(new Promise<void>((r) => (resolveClear = r)))
    const clearing = useDrawerStore.getState().clearLog()
    // 清空 A 期间切到 B(B 有日志)
    const bLine = { ts: 't', type: 'info' as const, text: 'b-line' }
    await useDrawerStore.getState().openFor(agent('user:b', 'b'))
    useDrawerStore.setState({ logLines: [bLine] })
    resolveClear()
    await clearing
    expect(useDrawerStore.getState().logLines).toEqual([bLine])
  })


  it('clearLog:有文件没清掉 → 保留列表(不假成功)', async () => {
    await useDrawerStore.getState().openFor(agent('user:a', 'a'))
    const aLine = { ts: 't', type: 'info' as const, text: 'a-line' }
    useDrawerStore.setState({ logLines: [aLine] })
    mocks.clearLogs.mockResolvedValueOnce({ cleared: [], failed: [{ path: '/var/log/root.log', error: 'EACCES' }] })
    await useDrawerStore.getState().clearLog()
    expect(useDrawerStore.getState().logLines).toEqual([aLine]) // 保留,不假装清空
  })

  it('clearLog:清空成功后,清空前发起的读取不得再写回旧日志', async () => {
    await useDrawerStore.getState().openFor(agent('user:a', 'a'))
    // 慢读取(清空之前发起)
    let resolveRead!: (v: unknown) => void
    mocks.readLogs.mockReturnValueOnce(new Promise((r) => (resolveRead = r)))
    const slowRead = useDrawerStore.getState().loadLogs('file')
    // 清空成功 → logRequestVersion 递增
    mocks.clearLogs.mockResolvedValueOnce({ cleared: ['/tmp/a.log'], failed: [] })
    await useDrawerStore.getState().clearLog()
    expect(useDrawerStore.getState().logLines).toEqual([])
    // 慢读取此刻才返回 → 必须被丢弃
    resolveRead([{ ts: 't', type: 'info', text: 'stale-line' }])
    await slowRead
    expect(useDrawerStore.getState().logLines).toEqual([])
  })


  it('saveAndApply 成功后刷新 ops/status(不残留旧 running/PID)', async () => {
    mocks.list.mockResolvedValue({
      agents: [{ ...agent('user:a', 'a'), status: 'loaded', pid: null, isDisabledByOverride: false }]
    })
    await useDrawerStore.getState().openFor(agent('user:a', 'a'))
    useDrawerStore.setState({ ops: { loaded: true, enabled: true, running: true }, statusModel: statusOf('before') })
    mocks.readStatus.mockResolvedValueOnce(statusOf('after-apply'))
    mocks.saveForm.mockResolvedValueOnce({
      ok: true,
      document: docOf('a'),
      report: { fileWritten: true, fileRolledBack: false, wasLoaded: true, nowLoaded: true, applied: true, notes: [] }
    })
    await useDrawerStore.getState().save('saveAndApply')
    // 应用 = bootout → bootstrap:运行态应为「已载入未运行」
    expect(useDrawerStore.getState().ops).toMatchObject({ loaded: true, running: false })
    await flush()
    expect(useDrawerStore.getState().statusModel?.uptime).toBe('after-apply')
  })


  it('save:已载入任务只写文件 → 明确提示运行态漂移(不是普通「已保存」)', async () => {
    mocks.list.mockResolvedValue({ agents: [{ ...agent('user:a', 'a'), status: 'running', pid: 42 }] })
    await useDrawerStore.getState().openFor(agent('user:a', 'a'))
    mocks.saveForm.mockResolvedValueOnce({
      ok: true,
      document: docOf('a'),
      report: { fileWritten: true, fileRolledBack: false, wasLoaded: true, nowLoaded: true, applied: false, notes: [] }
    })
    await useDrawerStore.getState().save('save')
    const msgs = mocks.toast.mock.calls.map((c) => String(c[0]))
    expect(msgs.some((m) => m.includes('运行中的任务仍在使用旧配置'))).toBe(true)
  })

  it('applyDocumentImpl 不 trim 历史 Label(否则普通编辑会被误判为改名)', () => {
    useDrawerStore.getState().applyDocumentImpl(docOf(' legacy.label '))
    expect(useDrawerStore.getState().agentLabel).toBe(' legacy.label ')
    expect(useDrawerStore.getState().form?.label).toBe(' legacy.label ')
  })
})
