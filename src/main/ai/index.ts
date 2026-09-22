// AI 能力的装配点:把设置/密钥/引擎/工具/会话/MCP 组装成两个对外句柄
// (index.ts 只调这一个函数;launcher-mcp 独立进程不走这里,它自己装配 tools + stdio)

import { app } from 'electron'
import { dirname, join } from 'node:path'
import type { AiMcpInfo } from '../../shared/ipc'
import { installMcpLink, inspectMcpLink, MCP_BIN_NAME } from '../services/path-link'
import type { AiRunEvent } from '../../shared/ai'
import type { SettingsStore } from '../settings/store'
import type { CoreServices } from '../core-services'
import { createSecretStore, type SecretStore } from './secret-store'
import { createLlmClient, type LlmClient } from './llm'
import { createToolRegistry } from './tools'
import { createChatService, type ChatService } from './chat-service'
import { createMcpHttpEndpoint, MCP_HTTP_PORT, type McpHttpEndpoint } from '../mcp/http-endpoint'

export interface AiStack {
  chat: ChatService
  secrets: SecretStore
  llm: LlmClient
  mcp: McpHttpEndpoint
  mcpInfo(): AiMcpInfo
  /** 把 launcher-mcp 安装/修复到 PATH(用户显式点击;返回安装后的真实状态与失败原因) */
  installMcpLink(): { info: AiMcpInfo; error: string | null }
  start(): Promise<void>
  stop(): Promise<void>
}

/**
 * 期望被链接到 PATH 的那个脚本 —— 打包后在应用包内(asar 外面)。
 *
 * ⚠ dev 下返回空串:仓库里那份脚本假设的是**打包布局**(它去找隔壁的 MacOS/Launcher),
 *   把它链进 PATH 只会造出一条坏命令。空串同时让界面隐藏「安装到 PATH」按钮。
 */
function mcpScriptPath(): string {
  return app.isPackaged ? join(dirname(app.getAppPath()), MCP_BIN_NAME) : ''
}

/**
 * stdio 形态的挂载命令。
 *
 * 打包产物里 `Contents/Resources/launcher-mcp` 是自带的可执行脚本(内部 exec 应用主程序 +
 * ELECTRON_RUN_AS_NODE=1),所以命令里只需要**一个**路径,不再是以前那两个(二进制 + 脚本)。
 *
 * 给短形式还是完整路径,判据是 **PATH 上那条链接的真实状态**,不是「安装来源是不是 brew」——
 * 链接可能被删、被挪、指向另一个副本,猜的迟早猜错(猜错的后果是用户拿到一条 command not found)。
 * dev 下没有打包结构,回退成旧的两路径形式。
 */
function stdioCommandOf(linked: boolean): string {
  // 展示的是**要运行的命令本身**(不是某一家客户端的配置语法)
  if (!app.isPackaged) {
    const script = join(app.getAppPath(), 'out', 'main', 'launcher-mcp.js')
    return `env ELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${script}"`
  }
  return linked ? MCP_BIN_NAME : mcpScriptPath()
}

export function createAiStack(deps: {
  store: SettingsStore
  services: CoreServices
  home: string
  /** ${userData} —— 会话与密钥的落点 */
  userDataDir: string
  emit(ev: AiRunEvent): void
}): AiStack {
  const get = (): ReturnType<SettingsStore['get']> => deps.store.get()

  const secrets = createSecretStore({ path: join(deps.userDataDir, 'ai-keys.json') })

  const llm = createLlmClient({
    secrets,
    getProviders: () => get().aiProviders,
    getProviderId: () => get().aiProviderId,
    getTimeoutSec: () => get().aiRequestTimeout
  })

  const registry = createToolRegistry({
    agents: deps.services.agents,
    cron: deps.services.cron,
    discovery: deps.services.discovery,
    plists: deps.services.plists,
    launchctl: deps.services.launchctl,
    brew: deps.services.brew,
    home: deps.home
  })

  const chat = createChatService({
    llm,
    secrets,
    registry,
    getSettings: get,
    storePath: join(deps.userDataDir, 'ai-sessions.json'),
    emit: deps.emit
  })

  const mcp = createMcpHttpEndpoint({
    registry,
    getPermission: () => get().mcpPermission,
    getLanguage: () => get().language,
    log: (m) => console.log(`[mcp] ${m}`)
  })

  // PATH 检查是只读的,随时可重算;写入只在 installMcpLink() 里发生(用户显式点击才调)
  const mcpInfo = (): AiMcpInfo => {
    const expected = mcpScriptPath()
    // dev 下不检查也不提供安装(见 mcpScriptPath 的说明)
    const link = expected === '' ? { state: 'missing' as const, foundAt: null, expected: '' } : inspectMcpLink(expected)
    return {
      stdioCommand: stdioCommandOf(link.state === 'linked'),
      httpUrl: `http://127.0.0.1:${MCP_HTTP_PORT}/mcp`,
      httpRunning: mcp.running(),
      binName: MCP_BIN_NAME,
      link
    }
  }

  return {
    chat,
    secrets,
    llm,
    mcp,
    mcpInfo,
    installMcpLink: () => {
      const r = installMcpLink(mcpScriptPath())
      // 无论成败都回读**真实状态**,界面以它为准(不拿"我以为成功了"当结果)
      return { info: mcpInfo(), error: r.ok ? null : r.reason }
    },
    start: () => mcp.start(),
    stop: () => mcp.stop()
  }
}
