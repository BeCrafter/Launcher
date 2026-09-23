// 端口服务覆写:别名 / Host / 路径 → 展示名、可连接 host 与完整 URL(应用新增,非 demo 移植)
// 身份键仿开源 LaunchManager 的 ServiceNameStore.identityKey(<port>:<小写可执行名> / <port>:docker:<容器名>),
// 刻意不用 PortService.id(=<pid>:<port>,重启即变)。

import type { ServiceOverride } from '@shared/settings'
import type { PortService } from '@shared/models'

/** 键里可用的程序名片段上限:保证整键远低于 shared/settings OVERRIDE_KEY_MAX(96),否则会被 normalize 丢弃 */
const KEY_STEM_MAX = 64

type SvcKeyFields = Pick<PortService, 'port' | 'command' | 'name' | 'cmd' | 'containerId'>

/**
 * 身份键(跨进程重启稳定):容器 = `<port>:docker:<容器名小写>`;进程 = `<port>:<程序名小写>`。
 * command 取自 lsof 的 c 字段(可执行文件名),实测最长 31 字符、超出截断;同前缀的长命令名
 * 理论上会碰撞,概率极低。command/name 同时为空时回退 cmd(几乎不会发生,但仍收窄长度)。
 */
export function serviceIdentityKey(svc: SvcKeyFields): string {
  if (svc.containerId !== undefined) {
    return `${svc.port}:docker:${svc.name.toLowerCase().slice(0, KEY_STEM_MAX)}`
  }
  const stem = svc.command || svc.name || svc.cmd
  return `${svc.port}:${stem.toLowerCase().slice(0, KEY_STEM_MAX)}`
}

/**
 * 卡片 React key(应用新增):**跨进程重启稳定** —— 端口 / 程序名 / 绑定地址都不随 PID 变。
 *
 * 刻意不用 `PortService.id`(=`<pid>:<port>`):进程一重启 id 就变,React 会销毁重建整张卡片 ——
 * 正在进行的「双击改名」被吞掉、组内其余卡片随之重排;而轮询每 3s 就会把新 pid 推上来,
 * 于是「重启过的服务」在界面上表现为闪一下。
 *
 * 三元组唯一性:同一 addr+port 不可能被两个进程同时监听(lsof 侧已按 pid:port:addr 去重)。
 */
export function cardKey(svc: Pick<PortService, 'port' | 'command' | 'addr' | 'containerId'>): string {
  if (svc.containerId !== undefined) return `docker:${svc.containerId}`
  return `${svc.port}:${svc.command}:${svc.addr}`
}

/** 由 lsof 的绑定地址推导可连接 host:通配/未指定类 → 127.0.0.1;`[::1]` 及其他地址原样(方括号是 URL 必需的) */
export function connectHost(addr: string): string {
  const a = addr.trim()
  if (a === '' || a === '*' || a === '0.0.0.0' || a === '::' || a === '[::]' || a === 'docker') {
    return '127.0.0.1'
  }
  return a
}

/** 生效 host:用户覆写优先(可写 ::1 / 主机名 / 局域网 IP) */
export function resolveHost(svc: Pick<PortService, 'addr'>, o: ServiceOverride | undefined): string {
  const h = o?.host?.trim()
  return h ? h : connectHost(svc.addr)
}

/** 展示名:别名优先,其次进程原名 */
export function displayName(svc: Pick<PortService, 'name'>, o: ServiceOverride | undefined): string {
  return o?.alias?.trim() || svc.name
}

/** 完整 URL:`http://{host}:{port}{path}`。IPv6 host 自动补方括号;path 自动补前导 `/`。 */
export function serviceUrl(
  svc: Pick<PortService, 'addr' | 'port'>,
  o: ServiceOverride | undefined
): string {
  let host = resolveHost(svc, o)
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`
  const raw = o?.path?.trim() ?? ''
  const path = raw !== '' && !raw.startsWith('/') ? `/${raw}` : raw
  return `http://${host}:${svc.port}${path}`
}

/** 能否安全交给 openExternal(main 侧 url-guard 只放行 https?,非法值会在那里被拒并静默吞掉) */
export function isOpenableUrl(u: string): boolean {
  try {
    new URL(u)
    return true
  } catch {
    return false
  }
}

/** 搜索谓词:别名 + 展示出来的 host + 原有全部字段(name/cmd/command/port/addr) */
export function matchesServiceQuery(
  svc: PortService,
  o: ServiceOverride | undefined,
  q: string
): boolean {
  const s = q.toLowerCase()
  return (
    svc.name.toLowerCase().includes(s) ||
    svc.cmd.toLowerCase().includes(s) ||
    svc.command.toLowerCase().includes(s) ||
    String(svc.port).includes(s) ||
    svc.addr.toLowerCase().includes(s) ||
    resolveHost(svc, o).toLowerCase().includes(s) ||
    (o?.alias?.toLowerCase().includes(s) ?? false)
  )
}
