// MCP 的 HTTP 环回端点(127.0.0.1,仅在应用运行时可用)
//
// 这是权限模式**唯一名副其实**的闸门:本机任意进程都可能连上来,故每次请求都重新读
// mcpPermission 决定暴露哪些工具(stdio 那条路由用户自己拉起进程,应用管不着)。
// 监听地址恒为 127.0.0.1:不提供对外监听开关 —— 暴露到局域网等于把本机服务管理能力交出去。

import { createServer, type Server as HttpServer } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Language, McpPermission } from '../../shared/settings'
import type { ToolRegistry } from '../ai/tool-types'
import { createLauncherMcpServer } from './server'

export const MCP_HTTP_PORT = 7788

export interface McpHttpEndpoint {
  /** 是否在监听(接入弹窗据此如实显示) */
  running(): boolean
  start(): Promise<void>
  stop(): Promise<void>
}

export function createMcpHttpEndpoint(deps: {
  registry: ToolRegistry
  getPermission(): McpPermission
  getLanguage(): Language
  port?: number
  log?(msg: string): void
}): McpHttpEndpoint {
  const port = deps.port ?? MCP_HTTP_PORT
  const log = deps.log ?? ((): void => {})
  let server: HttpServer | null = null

  const handler: Parameters<typeof createServer>[1] = (req, res) => {
    // 无状态模式下不存在「服务端主动推送」的通道:GET(开 SSE 流)与 DELETE(结束会话)一律 405。
    // ⚠ 不能交给 transport 处理 —— 不给应答会让客户端的 connect() 一直挂着(实测卡满 90s 超时)。
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' })
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method Not Allowed: 本端点是无状态模式,仅接受 POST' },
          id: null
        })
      )
      return
    }
    // 无状态模式:每个请求现造 server+transport,既省去会话管理,也让权限变更即时生效
    const mcp = createLauncherMcpServer({
      registry: deps.registry,
      getPermission: deps.getPermission,
      getLanguage: deps.getLanguage,
      sessionId: `http-${Date.now().toString(36)}`
    })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    void mcp
      .connect(transport)
      .then(() => transport.handleRequest(req, res))
      .catch((err: unknown) => {
        log(`MCP HTTP 处理失败:${err instanceof Error ? err.message : String(err)}`)
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' })
        }
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null }))
      })
  }

  return {
    running: () => server !== null,
    async start() {
      if (server) return
      return new Promise<void>((resolve) => {
        const s = createServer(handler)
        s.on('error', (err) => {
          // 端口被占(另一个实例/别的程序)不该阻断应用启动:MCP 是附加能力
          log(`MCP HTTP 端点启动失败(端口 ${port}):${err.message}`)
          server = null
          resolve()
        })
        // 只绑环回地址:即使本机有多个网卡也不会对外暴露
        s.listen(port, '127.0.0.1', () => {
          server = s
          log(`MCP HTTP 端点在 http://127.0.0.1:${port}/mcp 监听`)
          resolve()
        })
      })
    },
    async stop() {
      const s = server
      server = null
      if (!s) return
      await new Promise<void>((resolve) => s.close(() => resolve()))
    }
  }
}
