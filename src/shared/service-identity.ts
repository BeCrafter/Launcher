// 端口服务的**持久身份键**(从 renderer/src/lib/svc-override.ts 搬来,主进程与 AI 工具层也要用)
//
// 身份键仿开源 LaunchManager 的 ServiceNameStore.identityKey(<port>:<小写可执行名> / <port>:docker:<容器名>),
// 刻意不用 PortService.id(=<pid>:<port>,重启即变)。
//
// 为什么放在 shared:笔记的「关联服务」需要跨重启稳定的键 —— 进程重启后 pid 变了,
// 但用户笔记里的关联不该跟着失效。渲染层(svc-override / 笔记 chip)与主进程(AI 工具的
// 松散目标解析)必须用同一份实现,否则两边算出的键会漂移。

import type { PortService } from './models'

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
