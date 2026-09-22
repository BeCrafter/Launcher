// AI 能力的装配点:把设置/密钥/引擎/工具/会话/MCP 组装成两个对外句柄
// (index.ts 只调这一个函数;launcher-mcp 独立进程不走这里,它自己装配 tools + stdio)

import { app } from 'electron'
import { join } from 'node:path'
import type { AiMcpInfo } from '../../shared/ipc'
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
  start(): Promise<void>
  stop(): Promise<void>
}

/** stdio 形态的挂载命令:用应用自带的 Electron 二进制当 Node 跑打包内的 launcher-mcp 脚本。
 *  这样无需额外签名/编译一个独立可执行文件,产物里也不用多带一份 Node 运行时。 */
function stdioCommand(): string {
  const exe = process.execPath
  const script = join(app.getAppPath(), 'out', 'main', 'launcher-mcp.js')
  const quote = (s: string): string => `"${s}"`
  return `claude mcp add launcher -- env ELECTRON_RUN_AS_NODE=1 ${quote(exe)} ${quote(script)}`
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
    getModelId: () => get().aiModelId,
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
    log: (m) => console.log(`[mcp] ${m}`)
  })

  return {
    chat,
    secrets,
    llm,
    mcp,
    mcpInfo: () => ({
      stdioCommand: stdioCommand(),
      httpUrl: `http://127.0.0.1:${MCP_HTTP_PORT}/mcp`,
      httpRunning: mcp.running()
    }),
    start: () => mcp.start(),
    stop: () => mcp.stop()
  }
}
