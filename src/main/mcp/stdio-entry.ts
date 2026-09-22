// launcher-mcp:stdio 形态的独立入口(外部 Agent 按需拉起,不要求本应用在跑)
//
// 为什么是独立进程而不是应用内的一个函数:stdio 的调用方是外部 Agent(Claude Code /
// Claude Desktop),它自己 spawn 子进程并通过 stdin/stdout 说话 —— 应用在不在跑都无所谓。
// 本文件**不依赖 Electron**(只借它的 Node 运行:ELECTRON_RUN_AS_NODE=1)。
//
// 权限模式:stdio 进程以用户身份运行,应用管不着它的能力上界;这里读设置文件里的
// mcpPermission 只是让「默认只读」的意图对**新拉起的会话**成立,不是安全边界。

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { normalizeSettings, type Language, type McpPermission } from '../../shared/settings'
import { createShellRunner } from '../services/shell-runner'
import { createElevationExecutor } from '../services/elevation'
import { createCoreServices } from '../core-services'
import { createToolRegistry } from '../ai/tools'
import { createLauncherMcpServer } from './server'

function readConfig(): { permission: McpPermission; language: Language } {
  const home = homedir()
  const path = process.env['LAUNCHER_CONFIG_PATH'] ?? join(home, '.config', 'launcher', 'config.json')
  try {
    const s = normalizeSettings(JSON.parse(readFileSync(path, 'utf8')))
    return { permission: s.mcpPermission, language: s.language }
  } catch {
    // 没有设置文件 / 读不动 → 回只读 + 中文:外部 Agent 的默认姿态就是不给写
    return { permission: 'readOnly', language: 'zh-CN' }
  }
}

async function main(): Promise<void> {
  const home = homedir()
  const runner = createShellRunner({ getTimeoutMs: () => 10_000 })
  const elevate = createElevationExecutor()
  const services = createCoreServices({
    runner,
    elevate,
    home,
    // 独立进程没有设置存储:取与默认设置一致的固定值即可(xmlIndent 只影响新建草稿的排版)
    getXmlIndent: () => '  ',
    getCronRetainDays: () => 3,
    log: (m) => console.error(`[launcher-mcp] ${m}`)
  })
  const registry = createToolRegistry({
    agents: services.agents,
    cron: services.cron,
    discovery: services.discovery,
    plists: services.plists,
    launchctl: services.launchctl,
    brew: services.brew,
    home
  })

  const server = createLauncherMcpServer({
    registry,
    getPermission: () => readConfig().permission,
    getLanguage: () => readConfig().language,
    sessionId: `stdio-${process.pid}`
  })
  await server.connect(new StdioServerTransport())
  // stdout 属于协议本身:任何日志都走 stderr,否则会污染 JSON-RPC 流
  console.error('[launcher-mcp] ready')
}

main().catch((err: unknown) => {
  console.error(`[launcher-mcp] 启动失败:${err instanceof Error ? err.stack : String(err)}`)
  process.exit(1)
})
