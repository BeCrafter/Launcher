// 渲染层可用 API 契约(preload contextBridge 注入 window.launcher)

import type {
  AppInfo,
  BootPaintPhase,
  ContainerAction,
  MissingAgent,
  PickedFile,
  PickFileMode,
  CronUpdateResult,
  IpcEventChannel,
  KillOutcome,
  RestartOutcome,
  ServicesListPayload,
  SettingsPatch,
  UpdateCheckResult,
  AiApprovalInput,
  AiMcpInfo,
  AiSendInput,
  AiTestResult
} from './ipc'
import type {
  Agent,
  AgentDocument,
  AgentScope,
  CloneInput,
  CronJob,
  CronListPayload,
  CronLogFileInfo,
  CronScope,
  DrawerStatusModel,
  LogLine,
  OpsState,
  RenameInput,
  SaveFormInput,
  SaveOutcome,
  SaveXmlInput
} from './models'
import type { LauncherSettings, AiProviderId } from './settings'
import type { AiEngineState, AiMessage, AiSession, AiSkillInfo } from './ai'
import type {
  Note,
  NoteCreateInput,
  NoteMeta,
  NoteRemoveInput,
  NoteRenameInput,
  NoteSaveAssetInput,
  NoteSaveAssetResult,
  NoteSaveInput,
  NoteSaveOutcome,
  NotesListPayload
} from './notes'

export interface LauncherApi {
  appName: string
  versions: {
    electron: string
    node: string
    chrome: string
  }
  // 启动时由 main 经 additionalArguments 注入的首帧设置(免同步 IPC,无主题/语言闪烁)
  initialSettings: LauncherSettings
  getSettings: () => Promise<LauncherSettings>
  setSettings: (patch: SettingsPatch) => Promise<LauncherSettings>
  resetSettings: () => Promise<LauncherSettings>
  getAppInfo: () => Promise<AppInfo>
  openExternal: (url: string) => Promise<void>
  /** 原生文件选择:plist(含内容,用于导入)/ executable(仅路径,用于表单) */
  pickFile: (opts: { mode: PickFileMode; title?: string }) => Promise<PickedFile | null>
  /** 原生保存框 + 写文本(日志导出);取消 → null */
  saveTextFile: (opts: { suggestedName: string; content: string; title?: string }) => Promise<string | null>
  // 运行中 Agent 计数上报(menubarBadge 角标;数据在 renderer,阶段 1 换真实源后由 main 自算)
  reportBadgeCount: (count: number) => Promise<void>
  /**
   * 启动进度上报(单向上报,无回执):'splash' = 过渡页已产出第一帧,'app' = 应用已首次 commit。
   * main 据此决定**何时**把窗口显示出来 —— 详见 main/services/boot-gate.ts。
   */
  notifyBootPainted: (phase: BootPaintPhase) => void
  checkForUpdate: () => Promise<UpdateCheckResult>
  // Launch Agents(阶段 1:真实 launchctl/plist)
  agents: {
    list: () => Promise<{ agents: Agent[] }>
    brewAction: (kind: 'start' | 'stop', id: string) => Promise<Agent>
    createDraft: (scope: AgentScope, label: string) => Promise<Agent>
    /** 文档读取(表单 + 原文 + 兼容报告 + revision) */
    readDocument: (id: string) => Promise<AgentDocument>
    saveForm: (input: SaveFormInput) => Promise<SaveOutcome>
    saveXml: (input: SaveXmlInput) => Promise<SaveOutcome>
    renameAgent: (input: RenameInput) => Promise<SaveOutcome>
    remove: (id: string, expectedRevision: string) => Promise<SaveOutcome>
    clone: (input: CloneInput) => Promise<SaveOutcome>
    ops: (id: string, action: 'start' | 'stop' | 'restart' | 'enable' | 'disable') => Promise<OpsState>
    readStatus: (id: string) => Promise<DrawerStatusModel>
    readLogs: (id: string, source: 'file' | 'system') => Promise<LogLine[]>
    clearLogs: (id: string) => Promise<{ cleared: string[]; failed: { path: string; error: string }[] }>
    validateXml: (xml: string) => Promise<{ ok: boolean; error: string | null }>
    /** 定向复核:这些(scope,label)对是否「仍被加载但 plist 已不存在」 */
    checkMissing: (candidates: { scope: AgentScope; label: string }[]) => Promise<MissingAgent[]>
    /** 在访达中显示该 agent 的日志文件;无文件 → null */
    revealLog: (id: string) => Promise<string | null>
  }
  // 定时任务(阶段 2:真实 crontab 读写)
  cron: {
    list: () => Promise<CronListPayload>
    create: (job: Omit<CronJob, 'id'>) => Promise<CronJob>
    update: (job: CronJob, patch: Partial<CronJob>) => Promise<CronUpdateResult>
    remove: (job: CronJob) => Promise<void>
    readLog: (id: string, name?: string) => Promise<LogLine[]>
    /** 该任务已有的日志文件(新 → 旧),供日志抽屉的文件列表 */
    listLogs: (id: string) => Promise<CronLogFileInfo[]>
    /** 删除单个日志文件(文件名须属于该任务;已不存在按成功处理) */
    deleteLog: (id: string, name: string) => Promise<void>
    /** 清理超过保留期的日志文件,返回删除数量 */
    cleanupLogs: () => Promise<number>
    writeHeader: (scope: CronScope, text: string) => Promise<void>
  }
  // 端口服务(阶段 3:真实进程发现/终止)
  services: {
    list: () => Promise<ServicesListPayload>
    kill: (id: string, opts?: { privileged?: boolean }) => Promise<KillOutcome>
    restart: (id: string, opts?: { privileged?: boolean }) => Promise<RestartOutcome>
    containerAction: (id: string, action: ContainerAction) => Promise<void>
    setPolling: (enabled: boolean) => Promise<ServicesListPayload>
    setActive: (active: boolean) => Promise<void>
  }
  // main → renderer 推送订阅(白名单通道),返回退订函数
  onEvent: (channel: IpcEventChannel, cb: (payload: unknown) => void) => () => void
  // AI 助手(阶段 4:pi 引擎 + ToolRegistry + MCP)
  ai: {
    /** 引擎状态(协议/模型/有无 Key);Key 本体永不出 main */
    getState: () => Promise<AiEngineState>
    /**
     * 读回某协议已存的 API Key(明文)。
     * ⚠ 与「只回 hasKey 布尔」的克制相比,这是一处**刻意放宽**:设置页要能一直显示配好的 Key,
     *   否则用户无从确认自己当初填了什么。Key 仍然只存在于 safeStorage(不落设置文件),
     *   也只在打开设置页时按需取一次,不随引擎态广播到各处。
     */
    revealKey: (providerId: AiProviderId) => Promise<string>
    /** 写入某协议的 API Key(safeStorage 加密) */
    setKey: (providerId: AiProviderId, apiKey: string) => Promise<AiEngineState>
    clearKey: (providerId: AiProviderId) => Promise<AiEngineState>
    /** 用当前配置真连一次端点(testConnection 用于设置页的「测试连接」) */
    testConnection: (providerId: AiProviderId) => Promise<AiTestResult>
    listSessions: () => Promise<AiSession[]>
    createSession: () => Promise<AiSession>
    deleteSession: (id: string) => Promise<void>
    getMessages: (sessionId: string) => Promise<AiMessage[]>
    /** 发起一轮对话;过程经 onEvent(IPC_EVENTS.aiRunEvent) 流式推送 */
    send: (input: AiSendInput) => Promise<void>
    /** 中止当前运行 */
    abort: () => Promise<void>
    /** 应答授权卡(approve / cancel) */
    respondApproval: (input: AiApprovalInput) => Promise<void>
    skills: () => Promise<AiSkillInfo[]>
    /** 该协议的模型目录(仅 Anthropic 有内置目录,其余返回空 —— 模型名需用户自填) */
    catalog: (providerId: AiProviderId) => Promise<{ id: string; name: string }[]>
    mcpInfo: () => Promise<AiMcpInfo>
    /** 把 launcher-mcp 安装到 PATH(用户显式点击才调用);error 非空时如实带回原因 */
    installMcpLink: () => Promise<{ info: AiMcpInfo; error: string | null }>
  }
  // 笔记(阶段 5:一笔记一 .md + frontmatter,外部可编辑)
  notes: {
    list: () => Promise<NotesListPayload>
    read: (id: string) => Promise<Note | null>
    create: (input: NoteCreateInput) => Promise<Note>
    /** 写正文/元数据;带 expectedRevision 做 CAS,冲突回 conflict 而不是静默覆盖 */
    save: (input: NoteSaveInput) => Promise<NoteSaveOutcome>
    /** 改标题并重命名文件(显式动作;改标题本身不会自动改文件名) */
    rename: (input: NoteRenameInput) => Promise<NoteSaveOutcome>
    /** 删除:应用内走系统废纸篓,可恢复 */
    remove: (input: NoteRemoveInput) => Promise<NoteSaveOutcome>
    /** 全文检索(main 侧扫正文,含标题/标签/关联名) */
    search: (query: string, limit?: number) => Promise<NoteMeta[]>
    /** 生效目录(设置里为空时是默认路径) */
    dir: () => Promise<string>
    /** 在访达中显示(id 省略 → 打开目录本身) */
    reveal: (id?: string) => Promise<void>
    /** 图片/附件落盘,返回相对笔记目录的路径(如 assets/xxx.png) */
    saveAsset: (input: NoteSaveAssetInput) => Promise<NoteSaveAssetResult>
    /** 新建目录;返回目录 id(相对路径) */
    createFolder: (input: { parent: string; name: string }) => Promise<{ id: string }>
    /** 删除目录(连同其中的笔记进废纸篓) */
    removeFolder: (id: string) => Promise<NoteSaveOutcome>
    /** 目录改名 */
    renameFolder: (input: { id: string; name: string }) => Promise<{ id: string }>
    /** 移动到另一个目录(笔记与目录共用);parent 为空串 = 根层 */
    move: (input: { id: string; parent: string }) => Promise<{ ok: true; id: string; renamed?: { from: string; to: string } } | { ok: false; message: string }>
  }
}
