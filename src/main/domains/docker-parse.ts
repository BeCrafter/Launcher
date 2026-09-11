// docker 输出解析纯函数(阶段 3):`docker ps -a --format` 行 → DockerContainer
// 降级判定:CLI 不存在(ENOENT)或 daemon 未运行(stderr 特征)→ 静默降级为不可用

import type { DockerContainer } from '../../shared/models'

/** `docker ps -a --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'` 输出解析 */
export function parseDockerPs(output: string): DockerContainer[] {
  const out: DockerContainer[] = []
  for (const line of output.split('\n')) {
    const t = line.replace(/\r$/, '').trim()
    if (t === '') continue
    const parts = t.split('\t')
    if (parts.length < 4) continue
    const [containerId, name, image, statusText] = parts
    const portsRaw = parts[4] ?? ''
    if (containerId === '' || name === '') continue
    out.push({
      id: `docker:${containerId}`,
      containerId,
      name,
      image,
      status: statusText.startsWith('Up') ? 'running' : 'exited',
      statusText,
      portsRaw
    })
  }
  return out
}

/** 从 Ports 列提取首个宿主机端口(`0.0.0.0:8080->80/tcp, :::8080->80/tcp` → 8080);无映射 → 0 */
export function portsRawToPort(portsRaw: string): number {
  const m = portsRaw.match(/:(\d+)->/)
  return m ? Number.parseInt(m[1], 10) : 0
}

/** daemon 未运行/CLI 缺失的识别(静默降级依据) */
export function isDockerUnavailable(code: number | null, stderr: string, error: string | null): boolean {
  if (error !== null && /ENOENT/.test(error)) return true
  if (code === null) return true
  return /Cannot connect to the Docker daemon|Is the docker daemon running|dial unix .*: connect: no such file|command not found/i.test(
    stderr
  )
}
