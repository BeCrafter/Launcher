// docker 容器服务:ps -a 解析 + 容器启停;daemon 未运行/CLI 缺失 → 静默降级

import { isDockerUnavailable, parseDockerPs } from '../domains/docker-parse'
import type { ContainerAction } from '../../shared/ipc'
import type { DockerContainer } from '../../shared/models'
import type { ShellRunner } from './shell-runner'

export interface DockerService {
  refresh(): Promise<{ available: boolean; containers: DockerContainer[] }>
  action(id: string, action: ContainerAction): Promise<void>
}

export function createDockerService(deps: { runner: ShellRunner }): DockerService {
  return {
    async refresh() {
      const r = await deps.runner.run('docker', [
        'ps',
        '-a',
        '--format',
        '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
      ])
      if (isDockerUnavailable(r.code, r.stderr, r.error)) {
        return { available: false, containers: [] }
      }
      return { available: true, containers: parseDockerPs(r.stdout) }
    },

    async action(id, action) {
      const containerId = id.replace(/^docker:/, '')
      const r = await deps.runner.run('docker', [action, containerId])
      if (r.code !== 0) throw new Error(`docker ${action} failed: ${r.stderr || String(r.code)}`)
    }
  }
}
