// HTTP 环回端点的传输契约。
// 重点锁住一个会静默拖垮整条通道的行为:无状态模式下 **必须显式拒绝非 POST** ——
// 交给 transport 处理时它不给应答,MCP 客户端的 connect() 会一直挂着(实测卡满 90s 超时),
// 表现为"HTTP 通道连不上"而服务端日志一片正常。
import { afterEach, describe, expect, it } from 'vitest'
import { Type } from '@earendil-works/pi-ai'
import { createMcpHttpEndpoint, type McpHttpEndpoint } from './http-endpoint'
import type { ToolDef, ToolRegistry } from '../ai/tool-types'

const tools: ToolDef[] = [
  {
    name: 'list_services',
    label: '列出服务',
    description: '列出服务',
    parameters: Type.Object({}),
    write: false,
    execute: async () => ({ lines: [{ level: 'ok', text: 'ok' }] })
  }
]
const registry: ToolRegistry = {
  all: () => tools,
  get: (n) => tools.find((t) => t.name === n),
  readOnly: () => tools,
  writable: () => []
}

let ep: McpHttpEndpoint | null = null
afterEach(async () => {
  await ep?.stop()
  ep = null
})

async function start(port: number): Promise<string> {
  ep = createMcpHttpEndpoint({ registry, getPermission: () => 'readOnly',
      getLanguage: () => 'zh-CN', port, log: () => {} })
  await ep.start()
  return `http://127.0.0.1:${port}/mcp`
}

const initBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } }
})

describe('MCP HTTP 端点', () => {
  it('GET 返回 405 而不是挂起(客户端 connect() 靠它让路)', async () => {
    const url = await start(17801)
    const res = await fetch(url, { method: 'GET', headers: { accept: 'text/event-stream' } })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
    const body = (await res.json()) as { error?: { message?: string } }
    expect(body.error?.message).toContain('POST')
  })

  it('DELETE 同样 405', async () => {
    const url = await start(17802)
    expect((await fetch(url, { method: 'DELETE' })).status).toBe(405)
  })

  it('POST initialize 返回 SSE 帧的 JSON-RPC 结果', async () => {
    const url = await start(17803)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: initBody
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('"serverInfo"')
    expect(text).toContain('launcher')
  })

  it('running() 反映真实监听状态', async () => {
    ep = createMcpHttpEndpoint({ registry, getPermission: () => 'readOnly',
      getLanguage: () => 'zh-CN', port: 17804, log: () => {} })
    expect(ep.running()).toBe(false)
    await ep.start()
    expect(ep.running()).toBe(true)
    await ep.stop()
    expect(ep.running()).toBe(false)
  })

  it('端口被占时不抛异常(只降级为未监听,不阻断应用启动)', async () => {
    const url = await start(17805)
    const second = createMcpHttpEndpoint({ registry, getPermission: () => 'readOnly',
      getLanguage: () => 'zh-CN', port: 17805, log: () => {} })
    await expect(second.start()).resolves.toBeUndefined()
    expect(second.running()).toBe(false)
    // 原端点仍可用
    expect((await fetch(url, { method: 'GET' })).status).toBe(405)
    await second.stop()
  })
})
