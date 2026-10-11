// serviceIdentityKey 的共享层覆盖:不依赖 renderer 别名,主进程与渲染层用的是同一份实现。
//
// 这里刻意重复一部分 svc-override.test.ts 的用例 —— 那两个测试守的是不同的事:
// 渲染层那份守「覆写键的形态没变」,这份守「主进程侧算出的键与渲染层一致」。
// 两边都过,才说明搬家没有让两处实现漂移。

import { describe, expect, it } from 'vitest'
import { serviceIdentityKey } from './service-identity'
import type { PortService } from './models'

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

  it('跨 PID 稳定 —— 笔记的关联服务靠这一条才不会在进程重启后失效', () => {
    const before = svc({ id: '1234:8080', pid: 1234, port: 8080, command: 'node' })
    const after = svc({ id: '9999:8080', pid: 9999, port: 8080, command: 'node' })
    expect(serviceIdentityKey(before)).toBe(serviceIdentityKey(after))
    expect(serviceIdentityKey(before)).not.toBe(before.id) // 不是 PortService.id(那是 pid:port)
  })
})
