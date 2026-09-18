// Agents 门面服务(阶段 1):plist 扫描 + launchctl 状态 → Agent 列表与操作
// 机制对齐开源 AgentStore/PlistService/LaunchctlService;isBrew 纯启发式判定(见 brew-heuristic),
// brew 数据只在 brewAction(用户显式启停)时按需拉取;BrewManagedSupport 合并规则见 brew-agent-service
// id 约定:任务是 `<scope>:<label>`;非任务文件(占位/损坏)是 `<scope>:file:<fileName>`(label 为空,身份只能来自文件名);
// 草稿 id 同构 label 形态,落盘发生在 save

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { ELEVATION_CANCELLED, ELEVATION_FAILED } from '../../shared/ipc'
import type { Agent, AgentForm, AgentScope, DrawerStatusModel, LogLine, OpsState } from '../../shared/models'
import type { MissingAgent } from '../../shared/ipc'
import {
  formFromPlist,
  formIncompatibilities,
  plistFromForm,
  programShapeOf,
  scanCompatibility,
  unmanagedKeys,
  validateNewAgentInput
} from '../domains/agent-form'
import type {
  AgentDocument,
  FormCompatibility,
  CloneInput,
  ApplyMode,
  ApplyReport,
  RenameInput,
  SaveFormInput,
  SaveFailureKind,
  SaveOutcome,
  SaveXmlInput
} from '../../shared/models'
import { assertValidAgentLabel, validateAgentLabel } from '../domains/agent-label'
import { isBrewManaged } from '../domains/brew-heuristic'
import { parseLogText } from '../domains/log-lines'
import { patchPlistXml } from '../domains/plist-patch'
import { parsePlistXml, toPlistXml, type PlistDict } from '../domains/plist-xml'
import { matchBrewService, type BrewAgentService, type BrewServiceInfo } from './brew-agent-service'
import type { LaunchctlService } from './launchctl-service'
import type { PlistFile, PlistService } from './plist-service'
import type { ShellRunner } from './shell-runner'

/** 意图动作(用户语义):启动 / 停止 / 重启 / 开机自启开停 / 立即执行一次 —— 顺序逻辑在 main 内部完成 */
export type OpAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable'

export interface AgentService {
  list(): Promise<{ agents: Agent[] }>
  brewAction(kind: 'start' | 'stop', id: string): Promise<Agent>
  createDraft(scope: AgentScope, label: string): Promise<Agent>
  /** 文档读取(表单 + 原文 + 兼容报告 + revision) */
  readDocument(id: string): Promise<AgentDocument>
  saveForm(input: SaveFormInput): Promise<SaveOutcome>
  saveXml(input: SaveXmlInput): Promise<SaveOutcome>
  renameAgent(input: RenameInput): Promise<SaveOutcome>
  remove(id: string, expectedRevision: string): Promise<SaveOutcome>
  clone(input: CloneInput): Promise<SaveOutcome>
  ops(id: string, action: OpAction): Promise<OpsState>
  readStatus(id: string): Promise<DrawerStatusModel>
  readLogs(id: string, source: 'file' | 'system'): Promise<LogLine[]>
  clearLogs(id: string): Promise<{ cleared: string[]; failed: { path: string; error: string }[] }>
  validateXml(xml: string): Promise<{ ok: boolean; error: string | null }>
  /** 定向复核:候选条目是否「仍被 launchctl 加载、但管理目录内 plist 已不存在」 */
  checkMissing(candidates: { scope: AgentScope; label: string }[]): Promise<MissingAgent[]>
  /** 该 agent 的日志文件路径(stdout 优先,其次 stderr;均无 → null) */
  logFilePath(id: string): Promise<string | null>
}

export const agentId = (scope: AgentScope, label: string): string => `${scope}:${label}`

/** 非任务文件(占位/损坏)的 id 前缀:`:` 是 launchd 自己的域/job 分隔符,含 `:` 的 Label 无法 bootstrap,不会撞名 */
const FILE_ID_PREFIX = 'file:'
export const fileAgentId = (scope: AgentScope, fileName: string): string => `${scope}:${FILE_ID_PREFIX}${fileName}`

/** 文件记录 → 列表 id:任务取 label,非任务取文件名(其 label 为空,同作用域多个占位不能共用 id) */
const idFor = (pf: PlistFile): string => (pf.isTask ? agentId(pf.scope, pf.label) : fileAgentId(pf.scope, pf.fileName))

export function parseAgentId(id: string): { scope: AgentScope; label: string } | null {
  const idx = id.indexOf(':')
  if (idx <= 0) return null
  const scope = id.slice(0, idx) as AgentScope
  if (scope !== 'user' && scope !== 'system' && scope !== 'daemon') return null
  const label = id.slice(idx + 1)
  // 非任务文件不是「label 形态」的 id;此处一并挡住,防止草稿占用 file: 命名空间
  if (label === '' || label.startsWith(FILE_ID_PREFIX)) return null
  return { scope, label }
}

const LOG_TAIL_BYTES = 512 * 1024
const SYSTEM_LOG_MAX_LINES = 2000

/** `launchctl.list()` 的返回形状(域表 + per-domain 覆盖位) */
interface LaunchctlTables {
  gui: Map<string, { label: string; pid: number | null; lastExitCode: number | null }>
  system: Map<string, { label: string; pid: number | null; lastExitCode: number | null }>
  disabled: { gui: Set<string>; system: Set<string> }
}

export function createAgentService(deps: {
  runner: ShellRunner
  launchctl: LaunchctlService
  plists: PlistService
  brew: BrewAgentService
  getXmlIndent(): string
}): AgentService {
  const { runner, launchctl, plists, brew } = deps
  const drafts = new Map<string, Agent>() // 未落盘草稿(createDraft → save)

  /** gui 域(用户态 list)与 system 域(`print system` 服务表)按作用域取用 */
  const tableFor = (tables: LaunchctlTables, scope: AgentScope): LaunchctlTables['gui'] =>
    scope === 'daemon' ? tables.system : tables.gui

  /** print-disabled 覆盖位按作用域取用(域映射与 tableFor/domainOf 一致:system 作用域也属 gui 域) */
  const disabledFor = (tables: { disabled: { gui: Set<string>; system: Set<string> } }, scope: AgentScope): Set<string> =>
    scope === 'daemon' ? tables.disabled.system : tables.disabled.gui

  async function brewList(): Promise<BrewServiceInfo[]> {
    return brew.list().catch(() => [])
  }

  /** 批量 ps 补充运行中 pid 的 uptime(一次调用) */
  async function uptimesFor(pids: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>()
    if (pids.length === 0) return out
    const r = await runner.run('ps', ['-p', pids.join(','), '-o', 'pid=,etime='])
    for (const line of r.stdout.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(\S+)\s*$/)
      if (m) out.set(Number.parseInt(m[1], 10), etimeToText(m[2]))
    }
    return out
  }

  function etimeToText(etime: string): string {
    if (/\d+-\d+/.test(etime)) {
      const m = etime.match(/(\d+)-(\d+)/)!
      return `${m[1]}d ${m[2]}h`
    }
    const parts = etime.split(':')
    if (parts.length === 3) return `${Number(parts[0])}h ${Number(parts[1])}m`
    if (parts.length === 2) return `${Number(parts[0])}m`
    return etime
  }

  function buildAgent(pf: PlistFile, entries: Map<string, { pid: number | null; lastExitCode: number | null }>, tables: LaunchctlTables, uptimes: Map<number, string>): Agent {
    // 非任务文件(占位/损坏):没有 launchctl 身份,不查表、不判 brew/覆盖位 —— 显式早退,
    // 顺带避开 entries.get('') / disabledFor().has('') 这类空串 key 隐患
    if (!pf.isTask) {
      return {
        id: idFor(pf),
        label: '',
        fileName: pf.fileName,
        desc: pf.desc,
        status: 'stopped',
        pid: null,
        uptime: null,
        scope: pf.scope,
        tags: [],
        program: '',
        exitCode: null,
        restarts: 0,
        isNotTask: true,
        parseError: pf.parseError
      }
    }
    const entry = entries.get(pf.label)
    const program = typeof pf.value.Program === 'string' ? pf.value.Program : Array.isArray(pf.value.ProgramArguments) ? String(pf.value.ProgramArguments[0] ?? '') : ''
    return {
      id: agentId(pf.scope, pf.label),
      label: pf.label,
      desc: pf.desc,
      status: entry ? (entry.pid !== null ? 'running' : 'loaded') : 'stopped',
      pid: entry?.pid ?? null,
      uptime: entry?.pid ? (uptimes.get(entry.pid) ?? null) : null,
      scope: pf.scope,
      tags: [],
      program,
      exitCode: entry?.lastExitCode ?? null,
      restarts: 0,
      isBrew: isBrewManaged(pf.label, program),
      isDisabledByOverride: disabledFor(tables, pf.scope).has(pf.label)
    }
  }

  async function findAgent(id: string): Promise<{ scope: AgentScope; label: string; pf: PlistFile } | null> {
    const files = await plists.scanAll()
    const pf = files.find((p) => idFor(p) === id)
    if (!pf) return null
    // 作用域/label 取自记录而非 id 反解:非任务文件没有 label,只能靠记录本身
    return { scope: pf.scope, label: pf.label, pf }
  }

  /**
   * 代理写事务串行化(P1):CAS 的 fresh read 与写盘之间仍有 TOCTOU 窗口。
   * 写操作由用户驱动、频率极低,全局串行是最简单且无死锁风险的方案
   * (改名涉及新旧两个路径,按路径加锁需要多键顺序,得不偿失)。
   */
  let writeChain: Promise<unknown> = Promise.resolve()
  function withAgentWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = writeChain.then(fn, fn)
    writeChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /**
   * CAS(P1-1):必须基于 **fresh read** —— `scanAll` 会复用进行中的 pending 扫描,
   * 「invalidate + scanAll」在扫描未结束时仍会读到旧内容,revision 比对会假通过。
   * 返回 null = 通过;否则给出与磁盘一致的最新文档。
   */
  /**
   * 定位 + CAS 合一(P1):成功时返回 **fresh** 记录 —— 调用方的配置源必须用它。
   * 旧写法「casGuard 通过 → 再 findAgent」会重新命中缓存 memo/pending(可能仍是被外部改动前的快照),
   * 导致未修改字段被旧值覆盖。
   */
  async function locateFresh(
    id: string,
    expectedRevision: string | undefined,
    conflictMessage: string
  ): Promise<{ found: { scope: AgentScope; label: string; pf: PlistFile } | null } | { fail: SaveOutcome }> {
    const found = await findAgent(id)
    if (!found) {
      // 真草稿(createDraft 登记过)才允许「无文件」;其余 = 文件被外部删除,绝不静默重建
      if (!drafts.has(id) && parseAgentId(id)) {
        return { fail: { ok: false, kind: 'not-found', message: '文件已被外部删除:请重新加载列表,或另存为新任务' } }
      }
      return { found: null }
    }
    const fresh = await plists.readFresh(found.scope, found.pf.path)
    if (/ENOENT|no such file/i.test(fresh.parseError ?? '')) {
      return { fail: { ok: false, kind: 'not-found', message: '文件已被外部删除:请重新加载列表,或另存为新任务' } }
    }
    if (expectedRevision === undefined) {
      // 写路径必须带 revision(P1):缺省一律拒绝,旧调用方不得绕过 CAS
      return { fail: { ok: false, kind: 'invalid', message: '写操作必须携带 expectedRevision:请重新加载后再试' } }
    }
    if (revisionOf(fresh.xml) !== expectedRevision) {
      return { fail: { ok: false, kind: 'conflict', message: conflictMessage, latest: documentFromFresh(found.scope, fresh) } }
    }
    return { found: { scope: found.scope, label: found.pf.label, pf: fresh } }
  }

  /** 应用失败(曾载入却没载上)→ 按失败上报,不能给绿色「已保存」 */
  async function applyFailureOutcome(scope: AgentScope, path: string, report: ApplyReport): Promise<SaveOutcome | null> {
    if (report.wasLoaded !== true || report.applied) return null
    const detail = report.notes.join(' / ')
    return {
      ok: false,
      kind: 'write-failed',
      message: report.fileRolledBack
        ? `重新载入失败:已回滚到保存前配置(${detail})`
        : `重新载入失败且回滚未完成(${detail})`,
      latest: await readDocumentAt(scope, path),
      report
    }
  }

  /**
   * 写后回源:直接按**已知路径** fresh 读 —— 不走 findAgent(旧 pending 扫描可能还没有这份新文件/新 Label,
   * 会让新建/改名后的回源报 not found 或返回陈旧状态)
   */
  async function readDocumentAt(scope: AgentScope, path: string): Promise<AgentDocument> {
    return documentFromFresh(scope, await plists.readFresh(scope, path))
  }

  /** fresh 读取结果 → 文档(冲突分支的 latest 用它,避免再次落到缓存扫描) */
  function documentFromFresh(scope: AgentScope, pf: PlistFile): AgentDocument {
    return {
      id: idFor(pf),
      scope,
      path: pf.path,
      revision: revisionOf(pf.xml),
      sourceXml: pf.xml,
      form: pf.parseError ? null : formFromPlist(pf.value, pf.desc).form,
      compatibility: compatOf(pf),
      sourceShape: { program: programShapeOf(pf.value) }
    }
  }

  /** 非任务文件原地重写时没有「目标路径已存在」这层天然防重名,必须显式查:否则会出现两文件声称同一 Label */
  async function assertLabelFree(scope: AgentScope, label: string, selfPath: string): Promise<void> {
    // 必须 fresh:缓存/pending 视图可能漏掉刚被外部创建的同名文件。
    // 身份是 <scope>:<label> —— 不同作用域同 Label 合法共存(user 与 daemon 是不同 launchctl 域)
    const files = await plists.scanNow()
    const clash = files.find((p) => p.scope === scope && p.isTask && p.label === label && p.path !== selfPath)
    if (clash) throw new Error(`本作用域已存在同名任务「${label}」: ${clash.path}`)
  }

  /** 写后 scope+Label 唯一性复核(P1):查重与写入之间可能被外部插入同名文件 */
  async function verifyUniqueLabel(
    scope: AgentScope,
    label: string,
    writtenPath: string
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    if (label === '') return { ok: true }
    const files = await plists.scanNow()
    const dup = files.filter((p) => p.scope === scope && p.isTask && p.label === label && p.path !== writtenPath)
    if (dup.length === 0) return { ok: true }
    return { ok: false, message: `Label「${label}」在本作用域内被其他文件占用(${dup.map((d) => d.fileName).join(', ')})` }
  }

  /**
   * 原地写入 + Label 唯一性复核(P1):外部进程可能在「查重」与「写入」之间创建同名文件;
   * 写完 fresh 重扫,若出现多份同 Label → 回滚原内容并报冲突。
   */
  async function writeAtVerified(
    scope: AgentScope,
    path: string,
    xml: string,
    label: string,
    originalXml: string
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    await plists.writeAt(scope, path, xml)
    const check = await verifyUniqueLabel(scope, label, path)
    if (!check.ok) {
      await plists.writeAt(scope, path, originalXml).catch(() => {})
      return { ok: false, message: `${check.message}:已回滚原内容` }
    }
    return { ok: true }
  }

  async function listImpl(): Promise<{ agents: Agent[] }> {
    // brew 不在关键路径(brew services list 实测 11-13s):isBrew 用纯启发式判定,机制同源开源 AgentStore
    const [files, tables] = await Promise.all([plists.scanAll(), launchctl.list()])
    const runningPids = files
      .map((p) => (p.isTask ? (tableFor(tables, p.scope).get(p.label)?.pid ?? null) : null))
      .filter((p): p is number => p !== null)
    const uptimes = await uptimesFor(runningPids)
    // 每个 .plist 一行(含占位/损坏):文件在磁盘上存在就必须可见,置灰由渲染层负责
    const agents = files.map((pf) => buildAgent(pf, tableFor(tables, pf.scope), tables, uptimes))
    // 草稿(未落盘)不占列表行:保存后经 reload 出现
    return { agents }
  }

  // ─────────── 文档模型与写入事务(P0-2 / P0-3 / P0-4 / P1-1) ───────────

  /**
   * 表单 → 写盘 XML(复审 item 4/5 的最终形态):**节点级补丁**,只改写被改动的顶层键,
   * 其余部分(注释、键序、`<integer>`/`<real>` 写法、空行缩进)逐字节保留。
   * 结构无法安全扫描 → null(调用方按「锁表单、请用 XML 编辑」处理,绝不盲重建)。
   */
  function renderFormXml(
    baseXml: string,
    baseValue: PlistDict,
    merged: AgentForm,
    desc: string | undefined,
    dirtyFields?: readonly string[]
  ): string | null {
    const r = patchPlistXml({
      originalXml: baseXml,
      originalDict: baseValue,
      nextDict: plistFromForm(merged, baseValue, dirtyFields),
      indent: deps.getXmlIndent(),
      desc
    })
    return r.ok ? r.xml : null
  }

  /** 兼容报告 → 文档字段(去掉表单专用的 sourceShape,保留 entries 等可读说明) */
  const compatOf = (pf: PlistFile): Omit<FormCompatibility, 'sourceShape'> => {
    const c = scanCompatibility(pf.value, pf.xml)
    return {
      unsupportedPaths: c.unsupportedPaths,
      preservedTopLevelKeys: c.preservedTopLevelKeys,
      warnings: c.warnings,
      warningKeys: c.warningKeys,
      entries: c.entries
    }
  }

  const revisionOf = (xml: string): string => createHash('sha1').update(xml, 'utf8').digest('hex')

  const idleReport = (): ApplyReport => ({
    fileWritten: true,
    fileRolledBack: false,
    wasLoaded: null,
    nowLoaded: null,
    wasEnabled: null,
    nowEnabled: null,
    applied: false,
    notes: []
  })

  /** 写盘成功但回源失败时，不能让 renderer 继续使用旧文档快照。 */
  async function documentOutcome(scope: AgentScope, path: string, report: ApplyReport): Promise<SaveOutcome> {
    try {
      return { ok: true, document: await readDocumentAt(scope, path), report }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const notes = [...report.notes, `文件已写入但最新文档读取失败:${message}`]
      return {
        ok: false,
        kind: 'write-failed',
        message: notes.join(' / '),
        report: { ...report, fileWritten: true, notes }
      }
    }
  }

  function draftDocument(id: string, draft: Agent): AgentDocument {
    const xml = toPlistXml({ Label: draft.label }, { indent: deps.getXmlIndent(), desc: draft.desc })
    return {
      id,
      scope: draft.scope,
      path: plists.pathFor(draft.scope, draft.label),
      revision: revisionOf(xml),
      sourceXml: xml,
      form: formFromPlist({ Label: draft.label }, draft.desc).form,
      compatibility: { unsupportedPaths: [], preservedTopLevelKeys: [], warnings: [], entries: [] },
      sourceShape: { program: 'none' }
    }
  }

  async function readDocumentImpl(id: string): Promise<AgentDocument> {
    const found = await findAgent(id)
    if (!found) {
      const draft = drafts.get(id)
      if (!draft) throw new Error(`agent not found: ${id}`)
      return draftDocument(id, draft)
    }
    const pf = found.pf
    return {
      id: idFor(pf),
      scope: pf.scope,
      path: pf.path,
      revision: revisionOf(pf.xml),
      sourceXml: pf.xml,
      // 损坏文件没有可解析的字典:无表单,走 XML 修复
      form: pf.parseError ? null : formFromPlist(pf.value, pf.desc).form,
      compatibility: compatOf(pf),
      sourceShape: { program: programShapeOf(pf.value) }
    }
  }

  /** 抛出的内部错误 → 结构化失败(kind 供 UI 分支,message 供展示) */
  function outcomeFromError(err: unknown): { ok: false; kind: SaveFailureKind; message: string } {
    const message = err instanceof Error ? err.message : String(err)
    const kind: SaveFailureKind = message.includes(ELEVATION_CANCELLED)
      ? 'elevation-cancelled'
      : message.includes(ELEVATION_FAILED)
        ? 'elevation-failed'
        : message.includes('Label 不合法') || message.includes('配置不合法')
          ? 'invalid'
          : message.includes('表单不支持的键')
            ? 'unsupported'
            : 'write-failed'
    return { ok: false, kind, message }
  }

  /**
   * 应用运行态(P0-2):仅当保存前该任务已载入才 bootout → bootstrap;**不 kickstart**
   * (任务是否运行按用户独立意图,不因保存而偷偷运行)。bootstrap 失败时回滚文件并重新载入旧配置。
   */
  async function applyRuntime(
    scope: AgentScope,
    label: string,
    path: string,
    rollback: { path: string; xml: string } | null
  ): Promise<ApplyReport> {
    const before = await launchctl.list()
    const wasLoaded = tableFor(before, scope).has(label)
    const wasEnabled = !disabledFor(before, scope).has(label)
    const report: ApplyReport = { ...idleReport(), wasLoaded, nowLoaded: wasLoaded, wasEnabled, nowEnabled: wasEnabled }
    if (!wasLoaded) {
      report.notes.push('任务保存前未载入:只写文件,不动运行态')
      return report
    }
    try {
      await launchctl.bootout(path, scope)
      await launchctl.bootstrap(path, scope)
      report.applied = true
      const after = await launchctl.list()
      report.nowLoaded = tableFor(after, scope).has(label)
      report.nowEnabled = !disabledFor(after, scope).has(label)
      report.notes.push('已重新载入(未主动运行)')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      report.notes.push(`重新载入失败:${msg}`)
      if (rollback) {
        try {
          await plists.writeAt(scope, rollback.path, rollback.xml)
          report.fileRolledBack = true
          try {
            await launchctl.bootstrap(rollback.path, scope)
            report.nowLoaded = true
            const restored = await launchctl.list()
            report.nowEnabled = !disabledFor(restored, scope).has(label)
            report.notes.push('已回滚到保存前内容并重新载入')
          } catch (err2) {
            report.nowLoaded = false
            report.notes.push(`已回滚文件,但旧配置重新载入失败:${err2 instanceof Error ? err2.message : String(err2)}`)
          }
        } catch (err2) {
          report.nowLoaded = false
          report.nowEnabled = !disabledFor(await launchctl.list(), scope).has(label)
          report.notes.push(`回滚失败(文件未还原):${err2 instanceof Error ? err2.message : String(err2)}`)
        }
      } else {
        report.nowLoaded = false
        report.nowEnabled = !disabledFor(await launchctl.list(), scope).has(label)
      }
    }
    return report
  }

  /** label 校验 → 可读错误(null = 通过) */
  function validateAgentLabelFor(label: string): string | null {
    const r = validateAgentLabel(label)
    return r.ok ? null : `Label 不合法:${r.reason}`
  }

  /**
   * 改名事务本体(P0-4):写目标文件 → (按选择)迁移运行态 → 删除旧文件。
   * 迁移失败绝不删除旧文件,并尝试把旧任务重新载入。saveForm(改名)与 renameAgent 共用。
   */
  async function renameWithValue(
    found: { scope: AgentScope; label: string; pf: PlistFile },
    newLabel: string,
    value: PlistDict,
    applyMode: ApplyMode,
    desc?: string
  ): Promise<SaveOutcome> {
    const scope = found.scope
    const newPath = plists.pathFor(scope, newLabel)
    // 不只检查目标文件名：不同文件名也可能声明同一 Label，必须按 scope + Label 全局排重。
    await assertLabelFree(scope, newLabel, found.pf.path)
    if (existsSync(newPath)) return { ok: false, kind: 'invalid', message: `目标文件已存在:${newPath}` }
    const before = await launchctl.list()
    const wasLoaded = tableFor(before, scope).has(found.pf.label)
    const wasEnabled = !disabledFor(before, scope).has(found.pf.label)
    if (wasLoaded && applyMode === 'save') {
      return {
        ok: false,
        kind: 'invalid',
        message: '任务当前已载入:改名需同时迁移运行态(旧文件会被删除),请改用「保存并应用」'
      }
    }
    // 改名同样走补丁:原文件里除 Label 之外的节点逐字节保留(与表单保存同一条保真路径)
    const patched = patchPlistXml({
      originalXml: found.pf.xml,
      originalDict: found.pf.value,
      nextDict: { ...value, Label: newLabel },
      indent: deps.getXmlIndent(),
      desc
    })
    if (!patched.ok) {
      return { ok: false, kind: 'unsupported', message: `该文件的 XML 结构无法安全增量改写(${patched.reason}):请用 XML 编辑处理后再重命名` }
    }
    const xml = patched.xml
    await plists.write(scope, newPath, xml)
    // P1:查重与写入之间可能被外部插入同名文件 → 写后 fresh 复核;冲突则删掉刚写的新文件(旧文件未动)
    const unique = await verifyUniqueLabel(scope, newLabel, newPath)
    if (!unique.ok) {
      await plists.remove(scope, newPath).catch(() => {})
      return { ok: false, kind: 'conflict', message: `${unique.message}:已撤销本次改名` }
    }
    drafts.delete(agentId(scope, found.pf.label))
    const report: ApplyReport = { ...idleReport(), wasLoaded, nowLoaded: wasLoaded, wasEnabled, nowEnabled: wasEnabled }
    if (applyMode === 'saveAndApply' && wasLoaded) {
      try {
        await launchctl.bootout(found.pf.path, scope)
        await launchctl.bootstrap(newPath, scope)
        report.applied = true
        const after = await launchctl.list()
        report.nowLoaded = tableFor(after, scope).has(newLabel)
        report.nowEnabled = !disabledFor(after, scope).has(newLabel)
        report.notes.push('运行态已迁移到新 Label(未主动运行)')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        report.nowLoaded = false
        report.notes.push(`运行态迁移失败:${msg};开始清理未载入的新文件`)
        try {
          await plists.remove(scope, newPath)
          report.notes.push('未载入的新文件已清理')
        } catch (cleanupErr) {
          report.notes.push(`新文件清理失败:${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`)
        }
        try {
          await launchctl.bootstrap(found.pf.path, scope)
          report.nowLoaded = true
          report.notes.push('旧任务已重新载入')
        } catch (err2) {
          report.notes.push(`旧任务重新载入失败:${err2 instanceof Error ? err2.message : String(err2)}`)
        }
        return { ok: false, kind: 'write-failed', message: report.notes.join(' / '), report }
      }
    }
    // P1:删除旧文件也属于事务 —— 失败要回滚(卸载并删除新任务 → 重新载入旧任务),或给出可操作的半完成状态
    try {
      await plists.remove(scope, found.pf.path)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      report.notes.push(`旧文件删除失败:${msg}`)
      const done: string[] = []
      try {
        if (report.applied) {
          await launchctl.bootout(newPath, scope)
          done.push('新任务已卸载')
        }
        await plists.remove(scope, newPath)
        done.push('新文件已删除')
        if (report.applied) {
          await launchctl.bootstrap(found.pf.path, scope)
          report.nowLoaded = true
          done.push('旧任务已重新载入')
        }
        report.fileRolledBack = true
        report.applied = false
        report.notes.push(`已回滚:${done.join(' → ')}`)
        return { ok: false, kind: 'write-failed', message: `改名未完成(已回滚):${msg}`, report }
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2)
        report.notes.push(`回滚中断(${done.join(' → ') || '未开始'}):${msg2}`)
        return {
          ok: false,
          kind: 'write-failed',
          message:
            `改名半完成:新文件 ${newPath} 已写入${report.applied ? '且已载入' : ''},旧文件 ${found.pf.path} 仍在;` +
            `请手动处理(删除其一或重新载入)。${report.notes.join(' / ')}`,
          report
        }
      }
    }
    const applied = await applyFailureOutcome(scope, newPath, report)
    if (applied) return applied
    return documentOutcome(scope, newPath, report)
  }

  /** 新建 / 改名 / 非任务转正(表单路径):约束优先 —— 先校验,再写,最后按需迁移运行态 */
  async function identityTransaction(args: {
    id: string
    found: { scope: AgentScope; label: string; pf: PlistFile } | null
    parsed: { scope: AgentScope; label: string } | null
    label: string
    patch: Partial<AgentForm> & { label?: string; desc?: string }
    dirtyFields: string[]
    applyMode: ApplyMode
  }): Promise<SaveOutcome> {
    const { id, found, parsed, label, patch, dirtyFields, applyMode } = args
    const scope = found?.scope ?? parsed!.scope
    // 字段政策:UserName 仅 daemon 可编辑(其余作用域只能由 base 原样保留)
    if (scope !== 'daemon' && patch.userName !== undefined) {
      return { ok: false, kind: 'invalid', message: 'UserName 仅允许在 daemon(系统)作用域编辑' }
    }
    if (found && !found.pf.isTask && label === '') {
      return { ok: false, kind: 'invalid', message: '该文件未定义任务:请填写 Label 后再保存' }
    }
    const bad = validateAgentLabelFor(label)
    if (bad) return { ok: false, kind: 'invalid', message: bad }

    const baseValue: PlistDict = found ? found.pf.value : { Label: label }
    const baseDesc = found?.pf.desc ?? ''
    const compatibility = scanCompatibility(baseValue, found?.pf.xml ?? '')
    if (compatibility.unsupportedPaths.length > 0) {
      return {
        ok: false,
        kind: 'unsupported',
        message: `该 plist 含表单不支持的键:${compatibility.unsupportedPaths.join(', ')};为避免静默丢键已阻止保存,请切到 XML 编辑并保存`
      }
    }
    const mapping = formFromPlist(baseValue, baseDesc)
    const merged: AgentForm = {
      ...mapping.form,
      ...patch,
      label,
      desc: patch.desc ?? baseDesc,
      triggers: { ...mapping.form.triggers, ...(patch.triggers ?? {}) },
      keepAliveDict: { ...mapping.form.keepAliveDict, ...(patch.keepAliveDict ?? {}) }
    }
    // 约束优先(P1-2):不能从 HTML min/max 推断后端已经安全
    const problems = validateNewAgentInput(merged)
    if (problems.length > 0) return { ok: false, kind: 'invalid', message: `配置不合法:${problems.join(';')}` }
    const nextValue = plistFromForm(merged, baseValue, dirtyFields)
    let xml: string
    if (found) {
      const patched = patchPlistXml({
        originalXml: found.pf.xml,
        originalDict: baseValue,
        nextDict: nextValue,
        indent: deps.getXmlIndent(),
        desc: dirtyFields.includes('desc') ? merged.desc : undefined
      })
      if (!patched.ok) {
        return { ok: false, kind: 'unsupported', message: `该文件的 XML 结构无法安全增量改写(${patched.reason}):请用 XML 编辑保存` }
      }
      xml = patched.xml
    } else {
      xml = toPlistXml(nextValue, { indent: deps.getXmlIndent(), desc: merged.desc })
    }

    // ① 非任务文件补 Label 转正:原地重写、保留原文件名(第 37 条决策),身份变为 label
    if (found && !found.pf.isTask) {
      await assertLabelFree(scope, label, found.pf.path)
      // 写后 fresh 复核 Label 唯一性(外部进程可能在查重与写入之间抢名)
      const verified = await writeAtVerified(scope, found.pf.path, xml, label, found.pf.xml)
      if (!verified.ok) return { ok: false, kind: 'conflict', message: verified.message }
      drafts.delete(id)
      const report =
        applyMode === 'saveAndApply' ? await applyRuntime(scope, label, found.pf.path, null) : idleReport()
      const applied = await applyFailureOutcome(scope, found.pf.path, report)
      if (applied) return applied
      return documentOutcome(scope, found.pf.path, report)
    }
    // ② 已落盘任务改名:交给共享的改名事务
    if (found) {
      return await renameWithValue(
        found,
        label,
        nextValue,
        applyMode,
        dirtyFields.includes('desc') ? merged.desc : undefined
      )
    }
    // ③ 草稿落盘:扫描记忆过期等竞态下同名文件可能已在磁盘上 —— 以它为 base,非托管键按值保留
    const newPath = plists.pathFor(scope, label)
    let writeXml = xml
    let existingXml: string | null = null
    if (existsSync(newPath)) {
      const existing = await plists.read(scope, newPath).catch(() => null)
      if (existing) {
        // ⚠ 必须带 existing.xml:否则含 <data>/<date>/多注释的同名文件会绕过保真锁被重建
        const clash = scanCompatibility(existing.value, existing.xml).unsupportedPaths
        if (clash.length > 0) {
          return {
            ok: false,
            kind: 'unsupported',
            message: `同名文件已存在且含表单不支持的键:${clash.join(', ')};为避免静默丢键已阻止保存,请改用其他 Label 或切到 XML 编辑`
          }
        }
        const patched = renderFormXml(existing.xml, existing.value, merged, merged.desc)
        if (patched === null) {
          return {
            ok: false,
            kind: 'unsupported',
            message: '同名文件的 XML 结构无法安全增量改写:请改用其他 Label 或切到 XML 编辑'
          }
        }
        writeXml = patched
        existingXml = existing.xml
      }
    }
    await plists.write(scope, newPath, writeXml)
    const unique = await verifyUniqueLabel(scope, label, newPath)
    if (!unique.ok) {
      await plists.remove(scope, newPath).catch(() => {})
      return { ok: false, kind: 'conflict', message: `${unique.message}:已撤销本次新建` }
    }
    drafts.delete(id)
    const report =
      applyMode === 'saveAndApply'
        ? await applyRuntime(scope, label, newPath, existingXml !== null ? { path: newPath, xml: existingXml } : null)
        : idleReport()
    const applied = await applyFailureOutcome(scope, newPath, report)
    if (applied) return applied
      return documentOutcome(scope, newPath, report)
  }

  async function currentAgent(id: string): Promise<Agent> {
    const { agents } = await listImpl()
    const a = agents.find((x) => x.id === id)
    if (!a) throw new Error(`agent not found: ${id}`)
    return a
  }

  async function opsStateFor(pf: PlistFile, label: string): Promise<OpsState> {
    const tables = await launchctl.list()
    const entry = tableFor(tables, pf.scope).get(label)
    return {
      loaded: entry !== undefined,
      enabled: !disabledFor(tables, pf.scope).has(label),
      running: entry?.pid !== null && entry?.pid !== undefined
    }
  }

  /**
   * 意图动作:顺序逻辑集中在此层,UI 不再拼命令序列,也不需要因顺序问题置灰按钮。
   * 三个 launchd 维度(bootstrap/bootout · enable/disable · kickstart/kill)对用户不可见。
   */

  /** 启动:确保「已启用 → 已载入 → 运行中」——按需跳过已满足的步骤,结果确定为"正在运行" */
  async function intentStart(pf: PlistFile, tables: LaunchctlTables): Promise<void> {
    if (disabledFor(tables, pf.scope).has(pf.label)) {
      // launchd 硬约束:disable 阻塞 bootstrap,不启用无法载入 → 连带开启开机自启(UI 会可见地翻开关)
      await launchctl.enable(pf.label, pf.scope)
    }
    let entry = tableFor(tables, pf.scope).get(pf.label)
    if (entry === undefined) {
      await launchctl.bootstrap(pf.path, pf.scope)
      entry = tableFor(await launchctl.list(), pf.scope).get(pf.label)
    }
    // 载入后仍未运行(任务无 RunAtLoad/等触发条件)→ kickstart,让「启动」名副其实
    if (entry === undefined || entry.pid === null) {
      await launchctl.kickstart(pf.label, pf.scope)
    }
  }

  /** 停止:移出 launchd(进程随之终止,且不会被 KeepAlive 拉起);不改动「开机自启」 */
  async function intentStop(pf: PlistFile): Promise<void> {
    await launchctl.bootout(pf.path, pf.scope)
  }

  /** 重启:运行中 → kickstart -k(先杀再起);未载入 → 走启动序列 */
  async function intentRestart(pf: PlistFile, tables: LaunchctlTables): Promise<void> {
    const entry = tableFor(tables, pf.scope).get(pf.label)
    if (entry !== undefined && entry.pid !== null) {
      await launchctl.kickstart(pf.label, pf.scope, { kill: true })
      return
    }
    await intentStart(pf, tables)
  }

  return {
    list: listImpl,

    async brewAction(kind, id) {
      return withAgentWriteLock(async () => {
        const found = await findAgent(id)
        if (!found) throw new Error(`agent not found: ${id}`)
        const before = await currentAgent(id).catch(() => null)
        const brews = await brewList()
        const program = typeof found.pf.value.Program === 'string' ? found.pf.value.Program : ''
        const info = matchBrewService(found.label, program, brews, found.pf.path)
        if (!info) throw new Error(`not a brew-managed service: ${id}`)
        await brew.action(kind, info)
        // brew 的 stop 会移除 plist(条目从列表消失)→ 容错返回动作前状态并修正 status
        try {
          return await currentAgent(id)
        } catch {
          return { ...(before as Agent), status: kind === 'start' ? 'running' : 'stopped', pid: null, uptime: null }
        }
      })
    },

    async createDraft(scope, label) {
      // 新身份:label 必须合法(P0-1.1)。既有磁盘上的不规范 label 仍可展示,但不能由草稿创建
      assertValidAgentLabel(label)
      const draft: Agent = {
        id: agentId(scope, label),
        label,
        desc: '',
        status: 'stopped',
        pid: null,
        uptime: null,
        scope,
        tags: [],
        program: '',
        exitCode: null,
        restarts: 0
      }
      drafts.set(draft.id, draft)
      return { ...draft }
    },

    async readDocument(id) {
      return readDocumentImpl(id)
    },

    // P0-2/P0-3/P1-1:表单保存 —— CAS + 只覆盖用户触碰的字段 + 可选应用 + 返回最新文档
    async saveForm(input) {
      // P1:代理写事务串行化(CAS 的 fresh read → 写盘之间不允许插队)
      return withAgentWriteLock(async () => {
      try {
        const { id, expectedRevision, patch: requestedPatch, applyMode, dirtyFields } = input
        // IPC 也遵守 dirtyFields：不信任 renderer 额外夹带的旧字段，未标脏的键只能取磁盘最新值。
        const dirty = new Set(dirtyFields)
        const patch = Object.fromEntries(
          Object.entries(requestedPatch).filter(([key]) => key === 'label' || dirty.has(key))
        ) as Partial<AgentForm> & { label?: string; desc?: string }
        const located = await locateFresh(id, expectedRevision, '文件已被外部修改:请重新加载后再保存')
        if ('fail' in located) return located.fail
        const found = located.found
        const parsed = parseAgentId(id)
        if (!found && !parsed) return { ok: false, kind: 'not-found', message: `agent not found: ${id}` }
        const scope = found?.scope ?? parsed!.scope
        // 字段政策:UserName 仅 daemon 可编辑;其他作用域只允许由 base 原样保留
        if (scope !== 'daemon' && dirty.has('userName')) {
          return { ok: false, kind: 'invalid', message: 'UserName 仅允许在 daemon(系统)作用域编辑' }
        }
        const prevLabel = found?.pf.label ?? parsed!.label
        // 未触碰 Label 时保留磁盘原值；只有实际改名才规范化并走身份事务。
        const requestedLabel = patch.label
        const label = requestedLabel === undefined || requestedLabel === prevLabel ? prevLabel : requestedLabel.trim()
        const isTask = !!found && found.pf.isTask
        // 身份变更(新建/改名/非任务转正)→ 走专门事务(P0-4)
        if (!isTask || label !== prevLabel) {
          return await identityTransaction({ id, found, parsed, label, patch, dirtyFields: [...dirty], applyMode })
        }
        // 同身份:表单内容保存(磁盘上不规范 label 的老文件仍可改内容)
        const baseValue: PlistDict = found!.pf.value
        const baseDesc = found!.pf.desc
        const compatibility = scanCompatibility(baseValue, found!.pf.xml)
        if (compatibility.unsupportedPaths.length > 0) {
          return {
            ok: false,
            kind: 'unsupported',
            message: `该 plist 含表单不支持的键:${compatibility.unsupportedPaths.join(', ')};为避免静默丢键已阻止保存,请切到 XML 编辑并保存`
          }
        }
        const mapping = formFromPlist(baseValue, baseDesc)
        // patch 只含用户触碰的字段(dirtyFields 由渲染层上报):未触碰的键取保存时的磁盘最新值
        const merged: AgentForm = {
          ...mapping.form,
          ...patch,
          label,
          desc: patch.desc ?? baseDesc,
          triggers: { ...mapping.form.triggers, ...(patch.triggers ?? {}) },
          keepAliveDict: { ...mapping.form.keepAliveDict, ...(patch.keepAliveDict ?? {}) }
        }
        const problems = validateNewAgentInput(merged, {
          requireExecutable: dirty.has('program') || dirty.has('args'),
          validateNice: dirty.has('nice'),
          validateThrottle: dirty.has('throttleInterval'),
          validateSchedule: dirty.has('triggers') || dirty.has('sciEntries'),
          validatePaths: dirty.has('workingDir') || dirty.has('stdout') || dirty.has('stderr') || dirty.has('stdin'),
          validateUserName: dirty.has('userName')
        })
        if (problems.length > 0) {
          return { ok: false, kind: 'invalid', message: `配置不合法:${problems.join(';')}` }
        }
        const xml = renderFormXml(found!.pf.xml, baseValue, merged, dirty.has('desc') ? merged.desc : undefined, [...dirty])
        if (xml === null) {
          return {
            ok: false,
            kind: 'unsupported',
            message: '该文件的 XML 结构无法安全增量改写(注释/节点形态异常):请用 XML 编辑保存'
          }
        }
        await plists.write(scope, found!.pf.path, xml)
        drafts.delete(id)
        const report =
          applyMode === 'saveAndApply'
            ? await applyRuntime(scope, found!.pf.label, found!.pf.path, { path: found!.pf.path, xml: found!.pf.xml })
            : idleReport()
        const applied = await applyFailureOutcome(scope, found!.pf.path, report)
        if (applied) return applied
        return documentOutcome(scope, found!.pf.path, report)
      } catch (err) {
        return outcomeFromError(err)
      }
      })
    },

    /**
     * XML 保存(P0-3/P0-4):CAS → 校验 → 写盘 → 可选应用 → **返回整份最新文档**。
     * 已有任务的 Label 不允许在 XML 里改/删(改名是专门事务);非任务文件补 Label 保留原文件名、返回新 id。
     */
    async saveXml(input) {
      // P1:代理写事务串行化(CAS 的 fresh read → 写盘之间不允许插队)
      return withAgentWriteLock(async () => {
      try {
        const { id, expectedRevision, xml, applyMode } = input
        const lint = await plists.lint(xml)
        if (!lint.ok) return { ok: false, kind: 'invalid', message: `plist 校验失败:${lint.error}` }
        const located = await locateFresh(id, expectedRevision, '文件已被外部修改:请重新加载后再保存')
        if ('fail' in located) return located.fail
        const found = located.found
        const parsed = parseAgentId(id)
        if (!found && !parsed) return { ok: false, kind: 'not-found', message: `agent not found: ${id}` }
        const parsedXml = parsePlistXml(xml)
        if (!parsedXml.ok) return { ok: false, kind: 'invalid', message: `plist 校验失败:${parsedXml.error}` }
        const newLabel = typeof parsedXml.value.Label === 'string' ? parsedXml.value.Label : ''
        if (found && found.pf.isTask && newLabel !== found.pf.label) {
          return {
            ok: false,
            kind: 'rename-required',
            message: `XML 不能修改 Label(当前「${found.pf.label}」→「${newLabel || '(空)'}」):请回到「编辑」页修改 Label(即重命名该任务)`,
            latest: await readDocumentImpl(id)
          }
        }
        if (found && !found.pf.isTask && newLabel !== '') {
          const check = validateAgentLabelFor(newLabel)
          if (check) return { ok: false, kind: 'invalid', message: check }
        }
        if (!found && newLabel === '') {
          return { ok: false, kind: 'invalid', message: 'XML 缺少 Label:launchd 任务必须有 Label' }
        }
        if (!found) {
          const check = validateAgentLabelFor(newLabel)
          if (check) return { ok: false, kind: 'invalid', message: check }
        }
        const scope = found?.scope ?? parsed!.scope
        const target = found?.pf.path ?? plists.pathFor(scope, newLabel)
        // 非任务文件:原地重写、保留原文件名(第 37 条决策);其余走覆盖守卫
        if (found && !found.pf.isTask) {
          // 转正会产生新身份 → 必须查重(否则两个文件可声明同一 Label,agentId 不再唯一)
          if (newLabel !== '') await assertLabelFree(scope, newLabel, found.pf.path)
          const verified = await writeAtVerified(scope, target, xml, newLabel, found.pf.xml)
          if (!verified.ok) return { ok: false, kind: 'conflict', message: verified.message }
        }
        else await plists.write(scope, target, xml)
        drafts.delete(id)
        const report =
          applyMode === 'saveAndApply'
            ? await applyRuntime(scope, found?.pf.label ?? newLabel, target, found ? { path: found.pf.path, xml: found.pf.xml } : null)
            : idleReport()
        const applied = await applyFailureOutcome(scope, target, report)
        if (applied) return applied
        // 非任务转正(补了 Label)后身份变化 → 返回新 id 的文档(P0-4);其余保持原身份
        return documentOutcome(scope, target, report)
      } catch (err) {
        return outcomeFromError(err)
      }
      })
    },

    /**
     * 重命名事务(P0-4):校验 → 写目标文件 → (按选择)迁移运行态 → 删除旧文件。
     * 迁移失败绝不删除旧文件,并尝试把旧任务重新载入。
     */
    async renameAgent(input) {
      // P1:代理写事务串行化(CAS 的 fresh read → 写盘之间不允许插队)
      return withAgentWriteLock(async () => {
      try {
        const { id, expectedRevision, newLabel, applyMode, dirtyFields = [], patch = {} } = input
        const located = await locateFresh(id, expectedRevision, '文件已被外部修改:请重新加载后再重命名')
        if ('fail' in located) return located.fail
        const found = located.found
        if (!found || !found.pf.isTask) {
          return { ok: false, kind: 'not-found', message: '仅已落盘的任务可重命名' }
        }
        const bad = validateAgentLabelFor(newLabel)
        if (bad) return { ok: false, kind: 'invalid', message: bad }
        if (newLabel === found.pf.label) return { ok: true, document: await readDocumentImpl(id), report: idleReport() }
        // 改名会按 parse→object→toPlistXml 重建整份 XML:先过与表单同一套保真判据
        const compat = scanCompatibility(found.pf.value, found.pf.xml)
        // 纯 Label 迁移只替换 Label 节点，未知 XML 节点不会被表单重建；
        // 若同时修改其它字段，则仍按 B 类规则锁定。
        if (dirtyFields.length > 0 && compat.unsupportedPaths.length > 0) {
          return {
            ok: false,
            kind: 'unsupported',
            message: `该 plist 含改名会丢失的内容(${compat.unsupportedPaths.join(', ')}):请改用 XML 编辑后再手动迁移`
          }
        }
        const dirty = new Set(dirtyFields)
        const mapping = formFromPlist(found.pf.value, found.pf.desc)
        const merged: AgentForm = {
          ...mapping.form,
          ...patch,
          label: newLabel,
          desc: dirty.has('desc') ? patch.desc ?? mapping.form.desc : mapping.form.desc,
          triggers: { ...mapping.form.triggers, ...(patch.triggers ?? {}) },
          keepAliveDict: { ...mapping.form.keepAliveDict, ...(patch.keepAliveDict ?? {}) }
        }
        const problems = validateNewAgentInput(merged, {
          requireExecutable: dirty.has('program') || dirty.has('args'),
          validateNice: dirty.has('nice'),
          validateThrottle: dirty.has('throttleInterval'),
          validateSchedule: dirty.has('triggers') || dirty.has('sciEntries'),
          validatePaths: dirty.has('workingDir') || dirty.has('stdout') || dirty.has('stderr') || dirty.has('stdin'),
          validateUserName: dirty.has('userName')
        })
        if (problems.length > 0) return { ok: false, kind: 'invalid', message: `配置不合法:${problems.join(';')}` }
        const value = dirtyFields.length > 0
          ? plistFromForm(merged, found.pf.value, dirtyFields)
          : { ...found.pf.value }
        value.Label = newLabel
        return await renameWithValue(
          found,
          newLabel,
          value,
          applyMode,
          dirty.has('desc') ? merged.desc : undefined
        )
      } catch (err) {
        return outcomeFromError(err)
      }
      })
    },

    async remove(id, expectedRevision) {
      // P1:代理写事务串行化(CAS 的 fresh read → 写盘之间不允许插队)
      return withAgentWriteLock(async () => {
      try {
        // P1:写路径必须带 revision(旧调用方不得绕过 CAS);草稿的 revision 来自未落盘文档
        if (typeof expectedRevision !== 'string' || expectedRevision === '') {
          return { ok: false, kind: 'invalid', message: '删除必须携带 expectedRevision:请重新加载后再试' }
        }
        const located = await locateFresh(id, expectedRevision, '文件已被外部修改:请重新加载后再删除')
        if ('fail' in located) return located.fail
        const found = located.found
        drafts.delete(id)
        if (!found) return { ok: true, removed: true, report: idleReport() }
        const tablesBeforeRemove = await launchctl.list()
        const loaded = tableFor(tablesBeforeRemove, found.scope).has(found.label)
        const enabledBeforeRemove = !disabledFor(tablesBeforeRemove, found.scope).has(found.label)
        if (found.scope !== 'user') {
          // 合并提权:一条命令完成条件化 bootout + rm;失败分阶段返回,由这里决定是否恢复运行态
          const r = await plists.removeWithBootout(found.scope, found.pf.path, loaded, launchctl.domainOf(found.scope))
          if (r.cancelled) return { ok: false, kind: 'elevation-cancelled', message: '已取消授权' }
          if (!r.fileDeleted) {
            const notes = [`删除文件失败:${r.stderr ?? ''}`]
            let restored = false
            if (r.bootoutDone) {
              try {
                await launchctl.bootstrap(found.pf.path, found.scope)
                restored = true
                notes.push('已重新载入原任务(plist 仍在)')
              } catch (err2) {
                notes.push(`重新载入失败:${err2 instanceof Error ? err2.message : String(err2)}`)
              }
            }
            return {
              ok: false,
              kind: 'write-failed',
              message: notes.join(' / '),
              report: {
                ...idleReport(),
                fileWritten: false,
                wasLoaded: loaded,
                nowLoaded: restored,
                wasEnabled: enabledBeforeRemove,
                nowEnabled: !disabledFor(await launchctl.list(), found.scope).has(found.label),
                notes
              }
            }
          }
        } else {
          if (loaded) await launchctl.bootout(found.pf.path, found.scope)
          try {
            await plists.remove(found.scope, found.pf.path)
          } catch (err) {
            // 运行态已卸载但文件没删掉 → 尝试把任务重新载入,别留下「文件在、任务没了」的半状态
            const notes = [`删除文件失败:${err instanceof Error ? err.message : String(err)}`]
            let restored = false
            if (loaded) {
              try {
                await launchctl.bootstrap(found.pf.path, found.scope)
                restored = true
                notes.push('已重新载入原任务(plist 仍在)')
              } catch (err2) {
                notes.push(`重新载入失败:${err2 instanceof Error ? err2.message : String(err2)}`)
              }
            }
            return {
              ok: false,
              kind: 'write-failed',
              message: notes.join(' / '),
              report: {
                ...idleReport(),
                fileWritten: false,
                wasLoaded: loaded,
                nowLoaded: restored,
                wasEnabled: enabledBeforeRemove,
                nowEnabled: !disabledFor(await launchctl.list(), found.scope).has(found.label),
                notes
              }
            }
          }
        }
        return { ok: true, removed: true, report: idleReport() }
      } catch (err) {
        return outcomeFromError(err)
      }
      })
    },

    // 克隆(P1):与其它写路径同规 —— 写锁 + CAS + fresh 目录探测 + 保真判据 + fresh 回源
    async clone(input) {
      return withAgentWriteLock(async () => {
        try {
          const { id, expectedRevision } = input
const located = await locateFresh(id, expectedRevision, '源文件已被外部修改:请重新加载后再克隆')
          if ('fail' in located) return located.fail
          const found = located.found
          if (!found) return { ok: false, kind: 'not-found', message: `agent not found: ${id}` }
          if (!found.pf.isTask) return { ok: false, kind: 'invalid', message: '该文件未定义 launchd 任务,无法克隆' }
          // 克隆同样走节点级补丁(只改 Label 节点),含 <data>/注释的文件也能安全克隆
          const scope = found.scope
          // 用 fresh 探测生成不冲突的 .copy 名(不依赖可能过期的缓存目录视图)
          let newLabel = `${found.pf.label}.copy`
          let newPath = plists.pathFor(scope, newLabel)
          let probe = await plists.readFresh(scope, newPath)
          let n = 1
          while (!probe.parseError && n < 50) {
            n += 1
            newLabel = `${found.pf.label}.copy${n}`
            newPath = plists.pathFor(scope, newLabel)
            probe = await plists.readFresh(scope, newPath)
          }
          assertValidAgentLabel(newLabel)
          const patched = patchPlistXml({
            originalXml: found.pf.xml,
            originalDict: found.pf.value,
            nextDict: { ...found.pf.value, Label: newLabel },
            indent: deps.getXmlIndent(),
            // 纯 Label 补丁不能规范化头部注释
            desc: undefined
          })
          if (!patched.ok) {
            return { ok: false, kind: 'unsupported', message: `该文件的 XML 结构无法安全增量改写(${patched.reason}):请先导出 XML` }
          }
          await plists.write(scope, newPath, patched.xml)
          const unique = await verifyUniqueLabel(scope, newLabel, newPath)
          if (!unique.ok) {
            await plists.remove(scope, newPath).catch(() => {})
            return { ok: false, kind: 'conflict', message: `${unique.message}:已撤销本次克隆` }
          }
          return documentOutcome(scope, newPath, idleReport())
        } catch (err) {
          return outcomeFromError(err)
        }
      })
    },

    // 启停/自启也进同一把锁:否则「保存并应用」的 bootout→bootstrap 会和「停止」交错,
    // 后者刚 bootout 就被前者重新 bootstrap(用户点了停止却看到任务又跑起来)
    async ops(id, action) {
      return withAgentWriteLock(async () => {
      const found = await findAgent(id)
      if (!found) throw new Error(`agent not found: ${id}`)
      // 非任务文件不是 launchd 任务:bootstrap 必失败(launchd 会报 error 5)。UI 已置灰,这里是兜底
      if (!found.pf.isTask) throw new Error('该文件未定义 launchd 任务,无法执行启停操作')
      const tables = await launchctl.list()
      if (action === 'start') await intentStart(found.pf, tables)
      else if (action === 'stop') await intentStop(found.pf)
      else if (action === 'restart') await intentRestart(found.pf, tables)
      else if (action === 'enable') await launchctl.enable(found.label, found.scope) // 开机自启:开
      else await launchctl.disable(found.label, found.scope) // 开机自启:关
      return opsStateFor(found.pf, found.label)
      })
    },



    async readStatus(id) {
      const found = await findAgent(id)
      if (!found) {
        // 草稿:返回零值状态,抽屉「状态」tab 可正常打开(尚无运行时)
        const draft = drafts.get(id)
        const parsed = parseAgentId(id)
        if (!draft || !parsed) throw new Error(`agent not found: ${id}`)
        return {
          state: 'stopped',
          pid: null,
          uptime: null,
          cpu: '0%',
          cpuWidth: '0%',
          mem: '0%',
          memWidth: '0%',
          exitCode: null,
          restarts: 0,
          startTime: '-',
          plistPath: plists.pathFor(parsed.scope, draft.label),
          workDir: '',
          scope: parsed.scope
        }
      }
      const tables = await launchctl.list()
      const entry = tableFor(tables, found.scope).get(found.label)
      const info = entry ? await launchctl.print(found.label, found.scope) : null
      let cpu = '0%'
      let mem = '0%'
      let startTime = '-'
      if (entry?.pid) {
        const r = await runner.run('ps', ['-p', String(entry.pid), '-o', '%cpu=,%mem=,lstart='])
        const line = r.stdout.trim()
        const m = line.match(/^([\d.]+)\s+([\d.]+)\s+(.*)$/)
        if (m) {
          cpu = `${Number(m[1]).toFixed(1)}%`
          mem = `${Number(m[2]).toFixed(1)}%`
          startTime = m[3].trim()
        }
      }
      const state: Agent['status'] = entry ? (entry.pid !== null ? 'running' : 'loaded') : 'stopped'
      return {
        state,
        pid: entry?.pid ?? null,
        uptime: entry?.pid ? (await uptimesFor([entry.pid])).get(entry.pid) ?? null : null,
        cpu,
        cpuWidth: `${Math.min(100, Number.parseFloat(cpu) || 0)}%`,
        mem,
        memWidth: `${Math.min(100, (Number.parseFloat(mem) || 0) * 10)}%`,
        exitCode: info?.lastExitCode ?? entry?.lastExitCode ?? null,
        restarts: info?.runs ?? 0,
        startTime,
        plistPath: found.pf.path,
        workDir: info?.workingDirectory ?? (typeof found.pf.value.WorkingDirectory === 'string' ? found.pf.value.WorkingDirectory : ''),
        scope: found.scope
      }
    },

    async readLogs(id, source) {
      const found = await findAgent(id)
      if (!found) {
        if (drafts.has(id)) return [] // 草稿尚无日志
        throw new Error(`agent not found: ${id}`)
      }
      if (source === 'system') {
        // log show 实测 2.8-31.8s 高度波动,必超默认 cmdTimeout(10s) → 显式放宽(每调用覆盖)
        // 历史 plist 的 Label 可能含引号/反斜杠(新建已受限,但既有文件仍可展示编辑):
        // 直接插值会**改变 predicate 语义**(读到别的任务的系统日志) → 按 predicate 字符串字面量转义
        const predLabel = found.label.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        const r = await runner.run('/usr/bin/log', [
          'show',
          '--predicate',
          `subsystem == "${predLabel}" OR process == "${predLabel}"`,
          '--last',
          '15m',
          '--style',
          'compact'
        ], { timeoutMs: 45_000 })
        const lines = r.stdout
          .split('\n')
          .filter((l) => l.trim() !== '' && !l.startsWith('Timestamp') && !/^-+$/.test(l.trim()))
        const capped = lines.slice(-SYSTEM_LOG_MAX_LINES)
        return capped.map((text) => ({ ts: extractTs(text), type: classify(text), text: stripTs(text) }))
      }
      const outPath = typeof found.pf.value.StandardOutPath === 'string' ? found.pf.value.StandardOutPath : ''
      const errPath = typeof found.pf.value.StandardErrorPath === 'string' ? found.pf.value.StandardErrorPath : ''
      const target = outPath !== '' ? outPath : errPath
      if (target === '') return []
      const chunks: LogLine[] = []
      for (const p of [outPath, errPath].filter((x) => x !== '')) {
        try {
          const { promises: fsp } = await import('node:fs')
          const st = await fsp.stat(p)
          if (st.size === 0) continue
          const start = Math.max(0, st.size - LOG_TAIL_BYTES)
          const fh = await fsp.open(p, 'r')
          try {
            const buf = Buffer.alloc(st.size - start)
            await fh.read(buf, 0, buf.length, start)
            let text = buf.toString('utf8')
            if (start > 0) text = text.slice(text.indexOf('\n') + 1)
            chunks.push(...parseLogText(text, formatTs(st.mtime), SYSTEM_LOG_MAX_LINES))
          } finally {
            await fh.close()
          }
        } catch {
          /* 文件不存在 */
        }
      }
      return chunks
    },

    async clearLogs(id) {
      const found = await findAgent(id)
      if (!found) throw new Error(`agent not found: ${id}`)
      const { promises: fsp } = await import('node:fs')
      // 逐文件上报结果:系统域日志通常不可写 → 界面必须知道「哪些没清掉」,不能假装成功
      const cleared: string[] = []
      const failed: { path: string; error: string }[] = []
      for (const key of ['StandardOutPath', 'StandardErrorPath']) {
        const p = found.pf.value[key]
        if (typeof p !== 'string' || p === '') continue
        try {
          await fsp.writeFile(p, '', 'utf8')
          cleared.push(p)
        } catch (err) {
          failed.push({ path: p, error: err instanceof Error ? err.message : String(err) })
        }
      }
      return { cleared, failed }
    },

    async validateXml(xml) {
      return plists.lint(xml)
    },

    async logFilePath(id) {
      const found = await findAgent(id)
      if (!found) return null
      const out = typeof found.pf.value.StandardOutPath === 'string' ? found.pf.value.StandardOutPath : ''
      const err = typeof found.pf.value.StandardErrorPath === 'string' ? found.pf.value.StandardErrorPath : ''
      const preferred = out !== '' ? out : err
      if (preferred !== '' && existsSync(preferred)) return preferred
      if (err !== '' && existsSync(err)) return err
      return preferred !== '' ? preferred : null
    },

    async checkMissing(candidates) {
      const dirs = plists.dirs()
      const out: MissingAgent[] = []
      for (const c of candidates) {
        const info = await launchctl.print(c.label, c.scope)
        if (!info.found) continue // 已不在 launchd 中(普通移除,非孤儿)
        const path = info.path ?? ''
        if (path === '') continue
        // 仅关心三个管理目录内的服务:辅助进程(ShipIt 等)的 print path 为 submitted/系统目录,天然被过滤
        if (!dirs.some((d) => path.startsWith(`${d.dir}/`))) continue
        if (existsSync(path)) continue // 文件仍在(如重命名/移动)→ 非孤儿
        out.push({ label: c.label, scope: c.scope, path, pid: info.pid })
      }
      return out
    }
  }
}

function extractTs(line: string): string {
  const m = line.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/)
  return m ? `${m[1]} ${m[2]}` : ''
}

function stripTs(line: string): string {
  return line.replace(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*/, '')
}

function classify(text: string): LogLine['type'] {
  if (/(error|fail|fatal|exception|denied|traceback)/i.test(text)) return 'err'
  if (/warn/i.test(text)) return 'warn'
  if (/(\bok\b|success|done|complete)/i.test(text)) return 'ok'
  return 'info'
}

function formatTs(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
