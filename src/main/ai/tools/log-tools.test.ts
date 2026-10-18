import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentService } from '../../services/agent-service'
import type { CrontabService } from '../../services/crontab-service'
import { createLogTools } from './log-tools'
import type { ToolContext, ToolDef } from '../tool-types'

const ctx: ToolContext = { sessionId: 'test', signal: new AbortController().signal, allowCustomLogPath: true }

function harness(configuredLog = '') {
  const dir = mkdtempSync(join(tmpdir(), 'log-tools-'))
  const agents = {
    list: async () => ({
      agents: [
        {
          id: 'user:com.user.x',
          label: 'com.user.x',
          scope: 'user',
          isNotTask: false,
          parseError: undefined
        }
      ]
    }),
    logPaths: async () => ({ stdout: configuredLog, stderr: '' }),
    readLogs: async () => []
  } as unknown as AgentService
  const cron = {
    list: async () => ({ jobs: [], headers: { user: { headerRaw: '', exists: false }, system: { headerRaw: '', exists: false } } }),
    readLog: async () => []
  } as unknown as CrontabService
  const tools = createLogTools({ agents, cron, home: dir, allowedLogRoots: [dir] })
  const tail = tools.find((t) => t.name === 'tail_log') as ToolDef
  return { dir, tail, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('tail_log 自定义日志路径', () => {
  it('允许读取允许根目录下的 .log 尾部', async () => {
    const h = harness()
    try {
      const p = join(h.dir, 'app.log')
      writeFileSync(p, 'line1\nline2\nline3\n')
      const r = await h.tail.execute({ path: p }, ctx)
      expect(r.isError).toBeFalsy()
      expect(r.lines.map((l) => l.text).join('\n')).toContain('line3')
    } finally {
      h.cleanup()
    }
  })

  it('拒绝允许根目录以外的路径', async () => {
    const h = harness()
    try {
      const p = join(tmpdir(), `outside-${Date.now()}.log`)
      writeFileSync(p, 'secret\n')
      try {
        const r = await h.tail.execute({ path: p }, ctx)
        expect(r.isError).toBe(true)
        expect(r.lines.map((l) => l.text).join('\n')).toContain('不允许读取')
      } finally {
        rmSync(p, { force: true })
      }
    } finally {
      h.cleanup()
    }
  })

  it('允许读取该任务 plist 已配置的日志路径(即使不在标准目录)', async () => {
    const h = harness()
    try {
      const p = join(h.dir, 'app.txt')
      writeFileSync(p, 'configured\n')
      // 让 logPaths 指向这个文件;home 的 Library/Logs 不存在,允许根目录是 h.dir,
      // 这里用 configured 分支验证「非 .log 也可以,只要它是任务配置的路径」
      const agents = {
        list: async () => ({ agents: [{ id: 'user:com.user.x', label: 'com.user.x', scope: 'user' }] }),
        logPaths: async () => ({ stdout: p, stderr: '' }),
        readLogs: async () => []
      } as unknown as AgentService
      const cron = { list: async () => ({ jobs: [], headers: {} }), readLog: async () => [] } as unknown as CrontabService
      const tail = createLogTools({ agents, cron, home: h.dir }).find((t) => t.name === 'tail_log') as ToolDef
      const r = await tail.execute({ label: 'com.user.x', path: p }, ctx)
      expect(r.isError).toBeFalsy()
      expect(r.lines.map((l) => l.text).join('\n')).toContain('configured')
    } finally {
      h.cleanup()
    }
  })

  it('拒绝非 .log 且未配置的路径', async () => {
    const h = harness()
    try {
      const p = join(h.dir, 'app.txt')
      writeFileSync(p, 'x\n')
      const r = await h.tail.execute({ path: p }, ctx)
      expect(r.isError).toBe(true)
      expect(r.lines.map((l) => l.text).join('\n')).toContain('.log')
    } finally {
      h.cleanup()
    }
  })

  it('MCP 上下文不允许自定义路径', async () => {
    const h = harness()
    try {
      const p = join(h.dir, 'app.log')
      writeFileSync(p, 'secret\n')
      const r = await h.tail.execute({ path: p }, { ...ctx, allowCustomLogPath: false })
      expect(r.isError).toBe(true)
      expect(r.lines.map((l) => l.text).join('\n')).toContain('内置聊天')
    } finally {
      h.cleanup()
    }
  })

  it('label 与 path 都缺 → 可读错误', async () => {
    const h = harness()
    try {
      const r = await h.tail.execute({}, ctx)
      expect(r.isError).toBe(true)
      expect(r.lines[0].text).toContain('缺少 label 或 path')
    } finally {
      h.cleanup()
    }
  })

  it('keyword 过滤与 lines 截断', async () => {
    const h = harness()
    try {
      const p = join(h.dir, 'app.log')
      writeFileSync(p, ['info a', 'error b', 'info c', 'error d'].join('\n'))
      const r = await h.tail.execute({ path: p, keyword: 'ERROR', lines: 1 }, ctx)
      expect(r.isError).toBeFalsy()
      const text = r.lines.map((l) => l.text).join('\n')
      expect(text).toContain('error d')
      expect(text).not.toContain('info c')
    } finally {
      h.cleanup()
    }
  })
})
