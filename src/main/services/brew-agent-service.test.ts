import { describe, expect, it } from 'vitest'
import { matchBrewService, type BrewServiceInfo } from './brew-agent-service'

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
