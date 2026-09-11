// ported-from: docs/demo/js/services.js classifySvc/SVC_GROUP_META @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 端口服务分类管线(逐行为移植 services.js:① Brew Resolver ② COMMAND 映射 ③ 兜底 process)
import type { SvcFilter } from '../data/ports'
import type { DockerContainer, PortService, SvcType } from '@shared/models'
export type { SvcType }

/** 容器条目 → 卡片模型(端口取首个映射;无映射为 0,卡片隐藏端口标签) */
export function containerToService(c: DockerContainer): PortService {
  const m = c.portsRaw.match(/:(\d+)->/)
  return {
    id: c.id,
    port: m ? Number.parseInt(m[1], 10) : 0,
    name: c.name,
    command: c.image,
    user: 'docker',
    cmd: c.image,
    status: c.status,
    addr: 'docker',
    proto: 'TCP',
    uptime: c.statusText,
    type: 'docker',
    kind: 'docker',
    evidence: c.image,
    containerId: c.containerId
  }
}

const COMMAND_TYPES: Record<string, SvcType> = { node: 'node' }

export function classifySvc(s: Pick<PortService, 'command'>, brewManaged: ReadonlySet<string>): SvcType {
  if (brewManaged.has(s.command)) return 'brew'
  if (COMMAND_TYPES[s.command]) return COMMAND_TYPES[s.command]
  return 'process'
}

// demo SVC_GROUP_META(icon 含 fa-solid/fa-brands 前缀,与 demo 一致);docker 为阶段 3 新增组(fa-box 代 logo,差异记录)
export const SVC_GROUP_META: Record<SvcType, { icon: string; color: string; clsKey: string }> = {
  node: { icon: 'fa-brands fa-node-js', color: 'var(--blue)', clsKey: 'svc.cls.node' },
  brew: { icon: 'fa-solid fa-beer-mug-empty', color: 'var(--brew)', clsKey: 'svc.cls.brew' },
  process: { icon: 'fa-solid fa-terminal', color: 'var(--yellow)', clsKey: 'svc.cls.process' },
  docker: { icon: 'fa-solid fa-box', color: 'var(--cyan)', clsKey: 'svc.cls.docker' }
}

/** 生效分类:优先信后端 payload(type/kind),mock/旧数据回退本地判定 */
export function effectiveType(s: PortService, brewManaged: ReadonlySet<string>): SvcType {
  return s.type ?? classifySvc(s, brewManaged)
}

export function filterServices(
  services: PortService[],
  filter: SvcFilter,
  brewManaged: ReadonlySet<string>
): PortService[] {
  return services.filter((s) => {
    const type = effectiveType(s, brewManaged)
    if (filter === 'brew') return type === 'brew'
    if (filter === 'node') return type === 'node'
    if (filter === 'process') return type === 'process'
    return true
  })
}

// demo renderServices 分组顺序固定:node → brew → process;docker 容器组置末(阶段 3)
export const SVC_GROUP_ORDER: SvcType[] = ['node', 'brew', 'process', 'docker']
