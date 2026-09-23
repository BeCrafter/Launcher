import { describe, expect, it } from 'vitest'
import {
  cardKey,
  connectHost,
  displayName,
  isOpenableUrl,
  matchesServiceQuery,
  resolveHost,
  serviceIdentityKey,
  serviceUrl
} from './svc-override'
import type { PortService } from '@shared/models'

function svc(patch: Partial<PortService> = {}): PortService {
  return {
    id: '1234:8080',
    port: 8080,
    name: 'node',
    command: 'node',
    user: 'tester',
    cmd: 'node server.js',
    status: 'running',
    addr: '*',
    proto: 'TCP',
    uptime: '2h',
    ...patch
  }
}

describe('connectHost', () => {
  it('通配/未指定类地址回环到 127.0.0.1', () => {
    for (const a of ['', '*', '0.0.0.0', '::', '[::]', 'docker']) {
      expect(connectHost(a)).toBe('127.0.0.1')
    }
  })

  it('IPv6 回环与其他地址原样保留', () => {
    expect(connectHost('[::1]')).toBe('[::1]')
    expect(connectHost('192.168.1.5')).toBe('192.168.1.5')
  })
})

describe('serviceIdentityKey', () => {
  it('进程 = 端口:小写程序名', () => {
    expect(serviceIdentityKey(svc({ port: 8080, command: 'node' }))).toBe('8080:node')
    expect(serviceIdentityKey(svc({ port: 8080, command: 'Node' }))).toBe('8080:node')
  })

  it('程序名为空时回退到完整命令行', () => {
    const s = svc({ port: 8080, command: '', name: '', cmd: 'python3 -m http.server' })
    expect(serviceIdentityKey(s)).toBe('8080:python3 -m http.server')
  })

  it('超长回退值被收窄(保证整键低于 OVERRIDE_KEY_MAX)', () => {
    const s = svc({ port: 8080, command: '', name: '', cmd: 'x'.repeat(500) })
    expect(serviceIdentityKey(s)).toHaveLength('8080:'.length + 64)
  })

  it('容器 = 端口:docker:容器名', () => {
    const s = svc({ port: 5432, name: 'My-PG', containerId: 'abc123' })
    expect(serviceIdentityKey(s)).toBe('5432:docker:my-pg')
  })
})

describe('cardKey(卡片 React key)', () => {
  it('跨 PID 稳定:进程重启后同一服务仍是同一张卡片', () => {
    const before = svc({ pid: 1234, port: 8080, command: 'node', addr: '*' })
    const after = svc({ id: '9999:8080', pid: 9999, port: 8080, command: 'node', addr: '*' })
    expect(cardKey(before)).toBe(cardKey(after))
    expect(cardKey(before)).not.toBe(before.id) // 不是 PortService.id(那是 pid:port)
  })

  it('同端口不同程序 / 不同绑定地址 不撞键', () => {
    const keys = [
      cardKey(svc({ port: 5000, command: 'node', addr: '127.0.0.1' })),
      cardKey(svc({ port: 5000, command: 'python', addr: '127.0.0.1' })),
      cardKey(svc({ port: 5000, command: 'node', addr: '*' }))
    ]
    expect(new Set(keys).size).toBe(3)
  })

  it('容器用 containerId(与容器名/端口漂移无关)', () => {
    const a = svc({ port: 5432, name: 'pg', containerId: 'abc123' })
    const b = svc({ port: 5433, name: 'pg-renamed', containerId: 'abc123' })
    expect(cardKey(a)).toBe(cardKey(b))
    expect(cardKey(a)).toBe('docker:abc123')
  })
})

describe('resolveHost', () => {
  it('无覆写时由绑定地址推导', () => {
    expect(resolveHost(svc({ addr: '*' }), undefined)).toBe('127.0.0.1')
    expect(resolveHost(svc({ addr: '[::1]' }), undefined)).toBe('[::1]')
  })

  it('覆写优先,空覆写回退推导值', () => {
    expect(resolveHost(svc({ addr: '*' }), { host: 'my-nas.local' })).toBe('my-nas.local')
    expect(resolveHost(svc({ addr: '*' }), { host: '  ' })).toBe('127.0.0.1')
  })
})

describe('displayName', () => {
  it('别名优先,空别名回退进程名', () => {
    expect(displayName(svc({ name: 'node' }), undefined)).toBe('node')
    expect(displayName(svc({ name: 'node' }), { alias: '我的前端' })).toBe('我的前端')
    expect(displayName(svc({ name: 'node' }), { alias: '  ' })).toBe('node')
  })
})

describe('serviceUrl', () => {
  it('默认 host + 无路径', () => {
    expect(serviceUrl(svc({ port: 8080, addr: '*' }), undefined)).toBe('http://127.0.0.1:8080')
  })

  it('路径自动补前导斜杠', () => {
    expect(serviceUrl(svc({ port: 8080 }), { path: '/api' })).toBe('http://127.0.0.1:8080/api')
    expect(serviceUrl(svc({ port: 8080 }), { path: 'api' })).toBe('http://127.0.0.1:8080/api')
  })

  it('IPv6 host 自动补方括号', () => {
    expect(serviceUrl(svc({ port: 8080, addr: '[::1]' }), undefined)).toBe('http://[::1]:8080')
    expect(serviceUrl(svc({ port: 8080 }), { host: '::1' })).toBe('http://[::1]:8080')
  })

  it('覆写 host 原样使用(主机名 / 局域网 IP)', () => {
    expect(serviceUrl(svc({ port: 8080 }), { host: 'my-nas.local' })).toBe('http://my-nas.local:8080')
  })
})

describe('isOpenableUrl', () => {
  it('合法 http(s) 放行', () => {
    expect(isOpenableUrl('http://127.0.0.1:8080/api')).toBe(true)
    expect(isOpenableUrl('https://my-nas.local:8443')).toBe(true)
  })

  it('残缺/越界端口/无 scheme 一律拒绝', () => {
    expect(isOpenableUrl('http://')).toBe(false)
    expect(isOpenableUrl('http://127.0.0.1:99999')).toBe(false)
    expect(isOpenableUrl('127.0.0.1:8080')).toBe(false)
  })
})

describe('matchesServiceQuery', () => {
  it('别名与原名都可命中', () => {
    const s = svc({ name: 'node', cmd: 'node server.js', command: 'node', port: 8080 })
    const o = { alias: '我的前端' }
    expect(matchesServiceQuery(s, o, '我的前端')).toBe(true)
    expect(matchesServiceQuery(s, o, 'node')).toBe(true)
    expect(matchesServiceQuery(s, o, '8080')).toBe(true)
    expect(matchesServiceQuery(s, o, 'zzz')).toBe(false)
  })

  it('自定义 host 可被检索(卡片上显示的就是它)', () => {
    expect(matchesServiceQuery(svc(), { host: 'my-nas.local' }, 'my-nas')).toBe(true)
  })

  it('大小写不敏感', () => {
    expect(matchesServiceQuery(svc({ name: 'Redis' }), undefined, 'REDIS')).toBe(true)
  })
})
