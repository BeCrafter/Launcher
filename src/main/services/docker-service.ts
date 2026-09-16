// docker 容器服务:ps -a 解析 + 容器启停;daemon 未运行/CLI 缺失 → 降级为不可用并带回原因

import { dockerUnavailableReason, parseDockerPs } from '../domains/docker-parse'
import type { ContainerAction } from '../../shared/ipc'
import type { DockerContainer, DockerUnavailableReason } from '../../shared/models'
import { resolveDockerPath } from './docker-path'
import type { ShellRunner } from './shell-runner'

export interface DockerRefreshResult {
  available: boolean
  containers: DockerContainer[]
  /** 不变式:available === (reason === null) */
  reason: DockerUnavailableReason | null
}

export interface DockerService {
  refresh(): Promise<DockerRefreshResult>
  action(id: string, action: ContainerAction): Promise<void>
}

// docker ps 冷启动(Docker Desktop VM 唤醒)可远超默认 cmdTimeout(5s;超过即 SIGTERM →
// shell-runner 回 code:null → 旧 isDockerUnavailable 直接吞成「不可用」)。取 12s:
//   - 覆盖「CLI 在但偏慢」,比默认宽 2.4×;
//   - 上限约束:scanOnce() 在跑 lsof 之前 **await** refreshDockerIfDue(process-discovery.ts),
//     所以这个超时是整张端口列表刷新的下限 —— 45s(brew 那种)会把 3s 轮询拖成 45s。
//     日后若要容忍冷启动,正确做法是解耦(fire-and-forget),不是继续加大这个值。
const DOCKER_TIMEOUT_MS = 12_000

export function createDockerService(deps: {
  runner: ShellRunner
  /** 覆盖 docker 可执行路径(默认 resolveDockerPath 自动探测;测试固定值) */
  dockerPath?: string
  timeoutMs?: number
}): DockerService {
  const bin = deps.dockerPath ?? resolveDockerPath()
  const timeoutMs = deps.timeoutMs ?? DOCKER_TIMEOUT_MS

  return {
    async refresh() {
      const r = await deps.runner.run(
        bin,
        ['ps', '-a', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'],
        { timeoutMs }
      )
      const reason = dockerUnavailableReason(r)
      if (reason !== null) return { available: false, containers: [], reason }
      return { available: true, containers: parseDockerPs(r.stdout), reason: null }
    },

    async action(id, action) {
      const containerId = id.replace(/^docker:/, '')
      const r = await deps.runner.run(bin, [action, containerId], { timeoutMs })
      if (r.code !== 0) throw new Error(`docker ${action} failed: ${r.stderr || String(r.code)}`)
    }
  }
}
