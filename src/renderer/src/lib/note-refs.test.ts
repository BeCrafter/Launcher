// 关联解析的回退链。这是「关联耐用而不是脆」的全部依据:
// 一级精确键、二级快照特征、三级宽松匹配,都找不到才判失效。
// 每一级都对应一种真实退化(作用域改了 / 命令改了 / 程序名改了),所以逐级都要有例子。

import { describe, expect, it } from 'vitest'
import type { Agent, CronJob, PortService } from '@shared/models'
import type { NoteRef } from '@shared/notes'
import { resolveRef, type RefContext, type RefResolution } from './note-refs'

/** 断言「可解析」并把联合收窄 —— 直接取 res.target 在 stale 分支上过不了类型检查 */
function resolvable(res: RefResolution): Extract<RefResolution, { state: 'ok' | 'changed' }> {
  if (res.state === 'stale') throw new Error(`expected resolvable, got stale: ${res.reason}`)
  return res
}

function agent(patch: Partial<Agent> & { id: string }): Agent {
  return {
    label: '',
    desc: '',
    status: 'stopped',
    pid: null,
    uptime: null,
    scope: 'user',
    tags: [],
    program: '',
    exitCode: null,
    restarts: 0,
    ...patch
  }
}

function cron(patch: Partial<CronJob> & { id: string }): CronJob {
  return { user: '', expr: '0 2 * * *', cmd: 'backup.sh', desc: '', enabled: true, ...patch }
}

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

function ctx(patch: Partial<RefContext> = {}): RefContext {
  return { agents: [], crons: [], services: [], containers: [], overrides: {}, ...patch }
}

describe('agent 关联', () => {
  const a = agent({ id: 'user:com.foo.bar', label: 'com.foo.bar', scope: 'user' })

  it('一级:精确键命中', () => {
    const ref: NoteRef = { type: 'agent', key: 'user:com.foo.bar', label: 'com.foo.bar' }
    const res = resolveRef(ref, ctx({ agents: [a] }))
    expect(res).toEqual({ state: 'ok', label: 'com.foo.bar', target: { kind: 'agent', id: 'user:com.foo.bar' } })
  })

  it('二级:作用域变了(键里的 scope 变了)仍按 label 找回,标为 changed', () => {
    // 用户把任务从 user 域挪到了 daemon 域 → id 从 user:… 变成 daemon:…
    const moved = agent({ id: 'daemon:com.foo.bar', label: 'com.foo.bar', scope: 'daemon' })
    const ref: NoteRef = { type: 'agent', key: 'user:com.foo.bar', label: 'com.foo.bar' }
    const res = resolvable(resolveRef(ref, ctx({ agents: [moved] })))
    expect(res.state).toBe('changed')
    expect(res.target).toEqual({ kind: 'agent', id: 'daemon:com.foo.bar' })
  })

  it('同名跨作用域时**不猜**,判为失效(宁可不跳也不跳错)', () => {
    const ref: NoteRef = { type: 'agent', key: 'gone:x', label: 'dup' }
    const res = resolveRef(
      ref,
      ctx({
        agents: [
          agent({ id: 'user:dup', label: 'dup', scope: 'user' }),
          agent({ id: 'daemon:dup', label: 'dup', scope: 'daemon' })
        ]
      })
    )
    expect(res.state).toBe('stale')
  })

  it('找不到 → stale', () => {
    const ref: NoteRef = { type: 'agent', key: 'user:nope', label: 'nope' }
    expect(resolveRef(ref, ctx({ agents: [a] })).state).toBe('stale')
  })

  it('非任务文件(占位/损坏)用 fileName 当 label,仍能精确命中', () => {
    const ph = agent({ id: 'user:file:placeholder.plist', label: '', fileName: 'placeholder.plist', isNotTask: true })
    const ref: NoteRef = { type: 'agent', key: 'user:file:placeholder.plist', label: 'placeholder.plist' }
    const res = resolvable(resolveRef(ref, ctx({ agents: [ph] })))
    expect(res.state).toBe('ok')
    expect(res.label).toBe('placeholder.plist')
  })
})

describe('cron 关联', () => {
  const j = cron({ id: '3f9a1c07', expr: '0 2 * * *', cmd: '/usr/local/bin/backup.sh', desc: '每日备份' })
  const ref: NoteRef = { type: 'cron', key: '3f9a1c07', label: '每日备份', detail: '0 2 * * * · /usr/local/bin/backup.sh' }

  it('一级:精确键命中', () => {
    const res = resolvable(resolveRef(ref, ctx({ crons: [j] })))
    expect(res.state).toBe('ok')
    expect(res.target).toEqual({ kind: 'cron', id: '3f9a1c07' })
  })

  it('二级:命令改了(id 是内容哈希 → 失配)靠 detail 里的 expr+cmd 找回', () => {
    // 用户把日志参数加上了 → cmd 变了 → id 变了
    const changed = cron({ id: 'abcdef01', expr: '0 2 * * *', cmd: '/usr/local/bin/backup.sh --verbose', desc: '每日备份' })
    const res = resolvable(resolveRef(ref, ctx({ crons: [changed] })))
    // detail 里的 cmd 是旧值,精确匹配不上 → 落到三级按 label 子串
    expect(res.state).toBe('changed')
    expect(res.target).toEqual({ kind: 'cron', id: 'abcdef01' })
  })

  it('二级:expr 与 detail 完全一致时直接命中', () => {
    const same = cron({ id: 'zzz', expr: '0 2 * * *', cmd: '/usr/local/bin/backup.sh', desc: '改了说明' })
    const res = resolvable(resolveRef(ref, ctx({ crons: [same] })))
    expect(res.state).toBe('changed')
    expect(res.target).toEqual({ kind: 'cron', id: 'zzz' })
  })

  it('没有 detail 的旧关联也能靠 label 找回', () => {
    const noDetail: NoteRef = { type: 'cron', key: 'stale', label: '每日备份' }
    const res = resolvable(resolveRef(noDetail, ctx({ crons: [j] })))
    expect(res.state).toBe('changed')
  })

  it('找不到 → stale', () => {
    expect(resolveRef(ref, ctx({ crons: [] })).state).toBe('stale')
  })
})

describe('service 关联', () => {
  const s = svc({ port: 8080, command: 'node', name: 'node' })
  const ref: NoteRef = { type: 'service', key: '8080:node', label: 'node', detail: '127.0.0.1:8080' }

  it('一级:身份键命中,定位键用 cardKey(跨 PID 稳定)', () => {
    const res = resolvable(resolveRef(ref, ctx({ services: [s] })))
    expect(res.state).toBe('ok')
    expect(res.target).toEqual({ kind: 'service', cardKey: '8080:node:*' })
  })

  it('**关键**:进程重启(pid 变了、id 变了)后关联仍然有效', () => {
    const restarted = svc({ id: '9999:8080', pid: 9999, port: 8080, command: 'node' })
    const res = resolveRef(ref, ctx({ services: [restarted] }))
    expect(res.state).toBe('ok') // 不是 changed —— 身份键压根没变
  })

  it('二级:程序名变了(身份键里的 stem 变了)按端口+名字找回', () => {
    const renamed = svc({ id: '5:8080', port: 8080, command: 'nodejs', name: 'node' })
    const res = resolvable(resolveRef(ref, ctx({ services: [renamed] })))
    expect(res.state).toBe('changed')
    expect(res.target.kind).toBe('service')
  })

  it('覆写别名优先显示', () => {
    const res = resolvable(
      resolveRef(ref, ctx({ services: [s], overrides: { '8080:node': { alias: '我的前端' } } }))
    )
    expect(res.label).toBe('我的前端')
  })

  it('端口上换了个程序 → 找不到就 stale(不硬套到同端口的别的服务上)', () => {
    const other = svc({ port: 8080, command: 'python', name: 'python3' })
    expect(resolveRef(ref, ctx({ services: [other] })).state).toBe('stale')
  })

  it('找不到 → stale', () => {
    expect(resolveRef(ref, ctx({ services: [] })).state).toBe('stale')
  })
})

describe('未知类型', () => {
  it('原样保留、判为 stale(unknown-type),不抛异常', () => {
    const ref: NoteRef = { type: 'future-thing', key: 'k', label: 'L' }
    const res = resolveRef(ref, ctx())
    expect(res).toEqual({ state: 'stale', reason: 'unknown-type' })
  })
})
