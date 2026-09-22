// Launcher MCP 服务(内置聊天与外部 Agent 共用同一份 ToolRegistry —— ai-capability.md「单一工具源」)
//
// 传输有两种形态,是「用哪套」而不是「切到哪套」(见 demo 的接入弹窗):
//  - stdio:外部 Agent 按需拉起 launcher-mcp 子进程,不要求本应用在跑;
//  - HTTP:由本应用在 127.0.0.1 上监听,要求本应用在跑。
// ⚠ 权限模式(mcpPermission)只对 **HTTP 连接** 名副其实:stdio 是用户自己在终端拉起的进程,
// 以用户身份运行,应用管不着它。弹窗里的说明按此如实写。

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import type { McpPermission } from '../../shared/settings'
import { APP_NAME, APP_VERSION } from '../../shared/constants'
import { EXPERT_PROMPT } from '../ai/prompts/expert'
import { SKILLS } from '../ai/skills'
import type { ToolDef, ToolRegistry } from '../ai/tool-types'

/** typebox schema 就是 JSON Schema;剥掉符号键交给 MCP(它只要纯对象) */
function toJsonSchema(schema: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>
}

function visibleTools(registry: ToolRegistry, permission: McpPermission): ToolDef[] {
  // readOnly 是默认闸门:外部 Agent 不改动任何配置
  return permission === 'full' ? registry.all() : registry.readOnly()
}

export function createLauncherMcpServer(deps: {
  registry: ToolRegistry
  /** 权限模式在**每次请求时**读取:设置里改完立刻生效,不必重启服务 */
  getPermission(): McpPermission
  /** 工具调用的会话标识(审计/日志用) */
  sessionId: string
}): Server {
  const server = new Server(
    { name: 'launcher', version: APP_VERSION },
    {
      capabilities: { tools: {}, prompts: {} },
      instructions:
        'BeCrafter Launcher 的本机服务管理能力(macOS launchd / crontab / 端口服务)。' +
        '写操作工具仅在权限模式为 full 时可见;即使可见,执行仍需应用侧授权。'
    }
  )

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: visibleTools(deps.registry, deps.getPermission()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: toJsonSchema(t.parameters),
      // 写工具标记为破坏性:客户端据此在界面上提示用户
      annotations: t.write
        ? { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
        : { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    }))
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const name = req.params.name
    const def = deps.registry.get(name)
    if (!def) {
      // 工具不存在 / 权限不足对外都回同一句话:不泄漏"存在但被藏起来"的信息
      return { content: [{ type: 'text', text: `未知工具:${name}` }], isError: true }
    }
    if (def.write && deps.getPermission() !== 'full') {
      return { content: [{ type: 'text', text: `工具 ${name} 需要 full 权限模式(设置 › AI 助手)` }], isError: true }
    }
    try {
      const result = await def.execute((req.params.arguments ?? {}) as Record<string, unknown>, {
        sessionId: deps.sessionId,
        signal: extra.signal
      })
      const text = result.lines
        .map((l) => (l.level === '' || l.level === 'info' ? l.text : `[${l.level}] ${l.text}`))
        .join('\n')
      return {
        content: [{ type: 'text', text: text === '' ? '（无输出）' : text }],
        ...(result.isError ? { isError: true } : {})
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        isError: true
      }
    }
  })

  // 专家提示词与技能以 MCP Prompts 暴露:外部 Agent 拉到的与内置聊天同一份设定
  server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: [
      {
        name: 'expert',
        title: `${APP_NAME} 服务管理专家`,
        description: '常驻角色与边界(macOS 服务管理专家)'
      },
      ...SKILLS.map((s) => ({
        name: s.id,
        title: s.nameKey,
        description: s.descKey,
        arguments: [{ name: 'task', description: '用户的具体诉求(可选)', required: false }]
      }))
    ]
  }))

  server.setRequestHandler(GetPromptRequestSchema, (req) => {
    const name = req.params.name
    if (name === 'expert') {
      return { messages: [{ role: 'user', content: { type: 'text', text: EXPERT_PROMPT } }] }
    }
    const skill = SKILLS.find((s) => s.id === name)
    if (!skill) throw new Error(`未知提示词:${name}`)
    const taskArg = req.params.arguments?.['task']
    const text = taskArg
      ? `${EXPERT_PROMPT}\n\n---\n\n${skill.task}\n\n用户诉求:${taskArg}`
      : `${EXPERT_PROMPT}\n\n---\n\n${skill.task}`
    return { messages: [{ role: 'user', content: { type: 'text', text } }] }
  })

  return server
}
