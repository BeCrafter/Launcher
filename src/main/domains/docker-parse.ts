// docker 输出解析纯函数(阶段 3):`docker ps -a --format` 行 → DockerContainer
// 降级判定:CLI 不存在(ENOENT)/ 超时 / daemon 未运行(stderr 特征)→ 不可用,并给出原因供 UI 区分提示

import type { DockerContainer, DockerUnavailableReason } from '../../shared/models'

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

export interface DockerRunOutcome {
  code: number | null
  stderr: string
  error: string | null
  /** shell-runner 因超时 SIGTERM 掉子进程时为 true(此时 code 也是 null) */
  timedOut?: boolean
}

/**
 * 不可用原因分类 —— UI 据此区分「未装 CLI」与「daemon 未运行」两种提示。
 * ⚠ code === null 同时覆盖「spawn 失败」与「超时被杀」,故 timedOut 必须排在它前面判定。
 */
export function dockerUnavailableReason(r: DockerRunOutcome): DockerUnavailableReason | null {
  if (r.error !== null && /ENOENT/.test(r.error)) return 'cli-missing'
  if (r.timedOut) return 'timeout'
  if (r.code === null) return 'cli-missing' // 保留原语义:code 为 null ⇒ 不可用
  if (/command not found/i.test(r.stderr)) return 'cli-missing'
  return /Cannot connect to the Docker daemon|Is the docker daemon running|dial unix .*: connect: no such file/i.test(
    r.stderr
  )
    ? 'daemon-down'
    : null
}

/** daemon 未运行/CLI 缺失的识别(静默降级依据) */
export function isDockerUnavailable(code: number | null, stderr: string, error: string | null): boolean {
  return dockerUnavailableReason({ code, stderr, error }) !== null
}
