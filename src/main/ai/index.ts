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
import { devShimPath, writeDevShim } from '../mcp/dev-shim'

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
 * 期望被链接到 PATH 的那个脚本。
 *
 * - 打包:应用包内(asar 外面)的 `Contents/Resources/launcher-mcp`,自带定位逻辑;
 * - 开发:没有那个布局,故用**生成件** —— `<checkout>/node_modules/.cache/launcher-mcp`
 *   (见 mcp/dev-shim.ts)。两种模式下这个路径都是真实文件,于是「链接是否指向本副本」的
 *   判据(realpath 相等)对两者一视同仁;开发态每 checkout 一份,天然不会张冠李戴。
 *
 * ⚠ 开发态返回的是**将要生成**的 shim 路径:文件还不存在时 inspect 得到 missing(界面照常
 *   给「安装到 PATH」按钮),写入只发生在用户点按钮时(writeDevShim)。
 */
function mcpScriptPath(): string {
  return app.isPackaged ? join(dirname(app.getAppPath()), MCP_BIN_NAME) : devShimPath(app.getAppPath())
}

/** 开发态的 stdio 入口(electron-vite 的第二个 main 入口产物) */
function devEntryPath(): string {
  return join(app.getAppPath(), 'out', 'main', 'launcher-mcp.js')
}

/**
 * stdio 形态的挂载命令。
 *
 * 打包产物里 `Contents/Resources/launcher-mcp` 是自带可执行脚本(内部 exec 应用主程序 +
 * ELECTRON_RUN_AS_NODE=1),所以命令里只需要**一个**路径,不再是以前那两个(二进制 + 脚本)。
 *
 * 给短形式还是完整路径,判据是 **PATH 上那条链接的真实状态**,不是「安装来源是不是 brew」——
 * 链接可能被删、被挪、指向另一个副本,猜的迟早猜错(猜错的后果是用户拿到一条 command not found)。
 * 链接不在时:打包态给包内脚本路径,开发态给「二进制 + out/main 入口」的两路径形式。
 */
function stdioCommandOf(linked: boolean): string {
  // 展示的是**要运行的命令本身**(不是某一家客户端的配置语法)
  if (linked) return MCP_BIN_NAME
  if (!app.isPackaged) return `env ELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${devEntryPath()}"`
  return mcpScriptPath()
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
    const link = inspectMcpLink(mcpScriptPath())
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
      const expected = mcpScriptPath()
      // 开发态:先把转调 shim 写出来(「修复」= 重写一遍,故 checkout 移动后点一下即可重建);
      // 打包态指向的是包内自带脚本,无需生成任何东西
      if (!app.isPackaged) writeDevShim(expected, process.execPath, devEntryPath())
      const r = installMcpLink(expected)
      // 无论成败都回读**真实状态**,界面以它为准(不拿"我以为成功了"当结果)
      return { info: mcpInfo(), error: r.ok ? null : r.reason }
    },
    start: () => mcp.start(),
    stop: () => mcp.stop()
  }
}
