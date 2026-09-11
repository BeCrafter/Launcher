import { describe, expect, it, vi } from 'vitest'
import { createBrewAgentService, matchBrewService, type BrewServiceInfo } from './brew-agent-service'
import type { ElevationExecutor } from './elevation'
import type { ShellRunner } from './shell-runner'

const svc = (name: string, file: string | null = null): BrewServiceInfo => ({ name, status: 'started', user: 'wangming', file, exitCode: 0 })

describe('matchBrewService', () => {
  it('file 字段精确匹配(前缀无关:sh.brew.* 实测标签)', () => {
    const s = [svc('redis', '~/Library/LaunchAgents/sh.brew.redis.plist')]
    const hit = matchBrewService('sh.brew.redis', '/usr/local/opt/redis/bin/redis-server', s, '/Users/x/Library/LaunchAgents/sh.brew.redis.plist')
    expect(hit?.name).toBe('redis')
  })

  it('homebrew.mxcl. 前缀(开源原规则)+ 未在列表也视为 brew 管理', () => {
    const hit = matchBrewService('homebrew.mxcl.php@7.1', '/usr/local/opt/php@7.1/bin/php-fpm', [])
    expect(hit).toMatchObject({ name: 'php@7.1', status: 'unknown' })
  })

  it('Homebrew 安装路径推断公式名(含 @版本归一)', () => {
    const s = [svc('postgresql@16', null)]
    expect(matchBrewService('org.postgres', '/opt/homebrew/opt/postgresql@16/bin/postgres', s)?.name).toBe('postgresql@16')
  })

  it('非 brew 进程不误判', () => {
    expect(matchBrewService('com.apple.foo', '/usr/sbin/foo', [svc('redis', null)], '/Users/x/Library/LaunchAgents/com.apple.foo.plist')).toBeNull()
  })
})

describe('brew-agent-service.action 路由', () => {
  const elevate = { run: vi.fn(async () => ({ ok: true, cancelled: false, code: 0, stderr: '' })) } as unknown as ElevationExecutor

  it('用户级服务 → runner.run(brew services <kind> <name>),超时放宽 45s', async () => {
    const run = vi.fn(async () => ({ code: 0, signal: null, stdout: '', stderr: '', timedOut: false, error: null }))
    const brew = createBrewAgentService({
      runner: { run } as unknown as ShellRunner,
      elevate
    })
    await brew.action('stop', { name: 'php@7.1', status: 'started', user: 'wangming', file: null, exitCode: null })
    expect(run).toHaveBeenCalledWith(expect.stringMatching(/brew$/), ['services', 'stop', 'php@7.1'], { timeoutMs: 45_000 })
  })

  it('root 服务 → 提权通道', async () => {
    const run = vi.fn(async () => ({ code: 0, signal: null, stdout: '', stderr: '', timedOut: false, error: null }))
    const elevateRun = vi.fn(async () => ({ ok: true, cancelled: false, code: 0, stderr: '' }))
    const brew = createBrewAgentService({
      runner: { run } as unknown as ShellRunner,
      elevate: { run: elevateRun } as unknown as ElevationExecutor
    })
    await brew.action('start', { name: 'mysql', status: 'stopped', user: 'root', file: '/Library/LaunchDaemons/homebrew.mxcl.mysql.plist', exitCode: null })
    expect(elevateRun).toHaveBeenCalledWith(expect.stringMatching(/brew services start mysql/))
    expect(run).not.toHaveBeenCalled()
  })

  it('list 走绝对路径并放宽超时', async () => {
    const run = vi.fn(async () => ({ code: 1, signal: null, stdout: '', stderr: '', timedOut: false, error: null }))
    const brew = createBrewAgentService({ runner: { run } as unknown as ShellRunner, elevate })
    const out = await brew.list()
    expect(out).toEqual([])
    expect(run).toHaveBeenCalledWith(expect.not.stringMatching(/^brew$/), ['services', 'list', '--json'], { timeoutMs: 45_000 })
  })
})
