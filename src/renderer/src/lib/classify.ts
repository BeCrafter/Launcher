// 端口服务分类管线(逐行为移植 services.js:① Brew Resolver ② COMMAND 映射 ③ 兜底 process)
import type { SvcFilter } from '../data/ports'
import type { PortService } from '@shared/models'

export type SvcType = 'brew' | 'node' | 'process'

const COMMAND_TYPES: Record<string, SvcType> = { node: 'node' }

export function classifySvc(s: Pick<PortService, 'command'>, brewManaged: ReadonlySet<string>): SvcType {
  if (brewManaged.has(s.command)) return 'brew'
  if (COMMAND_TYPES[s.command]) return COMMAND_TYPES[s.command]
  return 'process'
}

// demo SVC_GROUP_META(icon 含 fa-solid/fa-brands 前缀,与 demo 一致)
export const SVC_GROUP_META: Record<SvcType, { icon: string; color: string; clsKey: string }> = {
  node: { icon: 'fa-brands fa-node-js', color: 'var(--blue)', clsKey: 'svc.cls.node' },
  brew: { icon: 'fa-solid fa-beer-mug-empty', color: 'var(--brew)', clsKey: 'svc.cls.brew' },
  process: { icon: 'fa-solid fa-terminal', color: 'var(--yellow)', clsKey: 'svc.cls.process' }
}

export function filterServices(
  services: PortService[],
  filter: SvcFilter,
  brewManaged: ReadonlySet<string>
): PortService[] {
  return services.filter((s) => {
    const type = classifySvc(s, brewManaged)
    if (filter === 'brew') return type === 'brew'
    if (filter === 'node') return type === 'node'
    if (filter === 'process') return type === 'process'
    return true
  })
}

// demo renderServices 分组顺序固定:node → brew → process
export const SVC_GROUP_ORDER: SvcType[] = ['node', 'brew', 'process']
