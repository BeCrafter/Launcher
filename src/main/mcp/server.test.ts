// MCP 服务的契约测试:工具面随权限模式收窄、未知工具不泄漏存在性、专家提示词可拉取
import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Type } from '@earendil-works/pi-ai'
import type { McpPermission } from '../../shared/settings'
import { createLauncherMcpServer } from './server'
import type { ToolDef, ToolRegistry } from '../ai/tool-types'

const readonly: ToolDef = {
  name: 'list_services',
  label: '列出服务',
  description: '列出本机服务',
  parameters: Type.Object({ domain: Type.Optional(Type.String()) }),
  write: false,
  execute: async (args) => ({ lines: [{ level: 'ok', text: `domain=${String(args['domain'] ?? 'all')}` }] })
}

let wrote = 0
const writable: ToolDef = {
  name: 'write_plist',
  label: '写入 plist',
  description: '写入 plist',
  parameters: Type.Object({ label: Type.String() }),
  write: true,
  summarize: () => ({ detail: 'd', command: 'c' }),
  execute: async () => {
    wrote++
    return { lines: [{ level: 'ok', text: '已写入' }] }
  }
}

const failing: ToolDef = {
  name: 'tail_log',
  label: '看日志',
  description: '看日志',
  parameters: Type.Object({}),
  write: false,
  execute: async () => {
    throw new Error('权限不足')
  }
}

function registry(): ToolRegistry {
  const tools = [readonly, writable, failing]
  return {
    all: () => tools,
    get: (n) => tools.find((t) => t.name === n),
    readOnly: () => tools.filter((t) => !t.write),
    writable: () => tools.filter((t) => t.write)
  }
}

async function pair(permission: McpPermission): Promise<Client> {
  const server = createLauncherMcpServer({
    registry: registry(),
    getPermission: () => permission,
    sessionId: 'test'
  })
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(b), client.connect(a)])
  return client
}

describe('MCP server', () => {
  it('readOnly:只暴露只读工具,写工具完全不可见', async () => {
    const client = await pair('readOnly')
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['list_services', 'tail_log'])
    expect(tools.some((t) => t.name === 'write_plist')).toBe(false)
  })

  it('full:写工具出现并带破坏性标注', async () => {
    const client = await pair('full')
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('write_plist')
    const w = tools.find((t) => t.name === 'write_plist')
    expect(w?.annotations?.readOnlyHint).toBe(false)
    expect(w?.annotations?.destructiveHint).toBe(true)
    const r = tools.find((t) => t.name === 'list_services')
    expect(r?.annotations?.readOnlyHint).toBe(true)
  })

  it('参数 schema 原样透传(不二次转换)', async () => {
    const client = await pair('readOnly')
    const { tools } = await client.listTools()
    const t = tools.find((x) => x.name === 'list_services')
    expect(t?.inputSchema).toMatchObject({ type: 'object' })
    expect(Object.keys((t?.inputSchema as { properties?: object }).properties ?? {})).toContain('domain')
  })

  it('工具调用返回文本行,级别以 [ok]/[err] 前缀呈现', async () => {
    const client = await pair('readOnly')
    const res = await client.callTool({ name: 'list_services', arguments: { domain: 'gui' } })
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? ''
    expect(text).toContain('domain=gui')
    expect(text).toContain('[ok]')
    expect(res.isError).toBeFalsy()
  })

  it('readOnly 下直接调用写工具被拒(不因不可见就放行)', async () => {
    const client = await pair('readOnly')
    const res = await client.callTool({ name: 'write_plist', arguments: { label: 'x' } })
    expect(res.isError).toBe(true)
    expect(wrote).toBe(0)
  })

  it('full 下写工具可调用', async () => {
    const client = await pair('full')
    const res = await client.callTool({ name: 'write_plist', arguments: { label: 'x' } })
    expect(res.isError).toBeFalsy()
    expect(wrote).toBe(1)
  })

  it('工具抛异常转成 isError 结果,不炸掉服务', async () => {
    const client = await pair('readOnly')
    const res = await client.callTool({ name: 'tail_log', arguments: {} })
    expect(res.isError).toBe(true)
    expect((res.content as { text: string }[])[0]?.text).toContain('权限不足')
  })

  it('未知工具与不可见工具回同一句话(不泄漏"存在但被藏起来")', async () => {
    const client = await pair('readOnly')
    const unknown = await client.callTool({ name: 'nope', arguments: {} })
    const hidden = await client.callTool({ name: 'write_plist', arguments: {} })
    expect((unknown.content as { text: string }[])[0]?.text).toBe('未知工具:nope')
    expect((hidden.content as { text: string }[])[0]?.text).toContain('full 权限模式')
  })

  it('专家提示词与 4 个技能以 MCP Prompts 暴露', async () => {
    const client = await pair('readOnly')
    const { prompts } = await client.listPrompts()
    expect(prompts.map((p) => p.name)).toEqual(['expert', 'sk-plist', 'sk-diag', 'sk-refactor', 'sk-import'])
    const expert = await client.getPrompt({ name: 'expert' })
    expect(expert.messages[0]?.content).toMatchObject({ type: 'text' })
    const withArg = await client.getPrompt({ name: 'sk-diag', arguments: { task: '为什么没跑' } })
    const text = (withArg.messages[0]?.content as { text: string }).text
    expect(text).toContain('诊断')
    expect(text).toContain('为什么没跑')
  })

  it('权限模式在每次请求时读取(改设置后无需重启服务)', async () => {
    let perm: McpPermission = 'readOnly'
    const server = createLauncherMcpServer({
      registry: registry(),
      getPermission: () => perm,
      sessionId: 'test'
    })
    const client = new Client({ name: 'c', version: '1.0.0' })
    const [a, b] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(b), client.connect(a)])

    expect((await client.listTools()).tools.some((t) => t.name === 'write_plist')).toBe(false)
    perm = 'full'
    expect((await client.listTools()).tools.some((t) => t.name === 'write_plist')).toBe(true)
  })
})
