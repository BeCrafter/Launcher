// launchd 日志轮转:copytruncate。
//
// launchd 不会轮转 StandardOutPath / StandardErrorPath。这里只处理 **user 作用域**
// 且路径位于 `~/Library/Logs/<Label>/` 下的日志(应用默认落点);system/daemon 的日志属主
// 可能是 root,应用不应该在后台静默提权去动它们;其他应用的日志目录也不碰。
//
// copytruncate:先复制到 .1,再把原文件截断为 0。服务进程仍持有原来的 fd,
// 只要它以 O_APPEND 打开(launchd 的常规行为),后续写入会从新的文件尾继续。
// 对非 O_APPEND 的写入者,截断后可能产生空洞 —— 这是 copytruncate 的已知取舍,
// 也是不重启服务就能轮转的唯一办法。
import { promises as fs } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { Agent } from '../../shared/models'
import type { AgentService } from './agent-service'

const MB = 1024 * 1024
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000

export interface AgentLogRotationResult {
  rotated: number
  skipped: number
  failed: { path: string; error: string }[]
}

export interface AgentLogRotation {
  rotateNow(): Promise<AgentLogRotationResult>
  start(): void
  stop(): void
}

export function createAgentLogRotation(deps: {
  agents: AgentService
  home: string
  getMaxMB(): number
  getKeep(): number
  intervalMs?: number
  log?(msg: string): void
}): AgentLogRotation {
  const log = deps.log ?? ((): void => {})
  let firstTimer: ReturnType<typeof setTimeout> | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const inside = (root: string, p: string): boolean => {
    const r = resolve(root)
    const q = resolve(p)
    return q === r || q.startsWith(r + sep)
  }

  async function rotateOne(p: string, keep: number): Promise<void> {
    // 最旧的一份直接丢弃,再把 .N-1 → .N、…、.1 → .2
    await fs.rm(`${p}.${keep}`, { force: true })
    for (let i = keep - 1; i >= 1; i -= 1) {
      const src = `${p}.${i}`
      const dst = `${p}.${i + 1}`
      try {
        await fs.rename(src, dst)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    }
    await fs.copyFile(p, `${p}.1`)
    await fs.truncate(p, 0)
  }

  async function rotateNow(): Promise<AgentLogRotationResult> {
    const result: AgentLogRotationResult = { rotated: 0, skipped: 0, failed: [] }
    const maxMB = deps.getMaxMB()
    if (!Number.isFinite(maxMB) || maxMB <= 0) return result
    const keep = Math.max(1, Math.trunc(deps.getKeep()))
    const maxBytes = maxMB * MB
    const root = join(deps.home, 'Library/Logs')
    // 根目录也 realpath(macOS 的 /var → /private/var);文件同样 realpath,
    // 防止 ~/Library/Logs 下有人放一个指向别处的 symlink 时被轮转。
    let realRoot = resolve(root)
    try {
      realRoot = await fs.realpath(root)
    } catch {
      /* 目录还不存在:先用 resolve 的路径比较,文件 stat 会失败并跳过 */
    }

    let agents: Agent[] = []
    try {
      agents = (await deps.agents.list()).agents
    } catch (err) {
      log(`skip: cannot list agents: ${err instanceof Error ? err.message : String(err)}`)
      return result
    }

    for (const agent of agents) {
      // system/daemon 日志可能有 root 属主;不在后台静默提权处理
      if (agent.scope !== 'user') {
        result.skipped += 1
        continue
      }
      let paths: { stdout: string; stderr: string }
      // list() 已经把 plist 里的日志路径带出来了;只有旧调用方/测试没填时才回退到逐条查找
      if (agent.logOut !== undefined || agent.logErr !== undefined) {
        paths = { stdout: agent.logOut ?? '', stderr: agent.logErr ?? '' }
      } else {
        try {
          paths = await deps.agents.logPaths(agent.id)
        } catch {
          result.skipped += 1
          continue
        }
      }
      for (const p of [paths.stdout, paths.stderr]) {
        if (p === '') continue
        const agentRoot = join(realRoot, agent.label)
        let realP: string
        try {
          realP = await fs.realpath(p)
        } catch {
          result.skipped += 1
          continue
        }
        // 只轮转该 Agent 自己的 ~/Library/Logs/<Label>/ 目录,不碰其他应用的日志
        if (!inside(agentRoot, realP)) {
          result.skipped += 1
          continue
        }
        try {
          const st = await fs.stat(realP)
          if (!st.isFile() || st.size <= maxBytes) {
            result.skipped += 1
            continue
          }
          await rotateOne(realP, keep)
          result.rotated += 1
          log(`rotated ${realP} (${st.size} bytes, keep ${keep})`)
        } catch (err) {
          result.failed.push({ path: realP, error: err instanceof Error ? err.message : String(err) })
        }
      }
    }
    return result
  }

  return {
    rotateNow,
    start() {
      if (firstTimer !== null || timer !== null) return
      // 启动后稍等再跑,避免和首屏 I/O 抢;之后每小时一轮
      firstTimer = setTimeout(() => {
        firstTimer = null
        void rotateNow().catch((err) => log(`rotation failed: ${String(err)}`))
      }, 5000)
      firstTimer.unref?.()
      timer = setInterval(() => {
        void rotateNow().catch((err) => log(`rotation failed: ${String(err)}`))
      }, deps.intervalMs ?? DEFAULT_INTERVAL_MS)
      timer.unref?.()
    },
    stop() {
      if (firstTimer !== null) clearTimeout(firstTimer)
      firstTimer = null
      if (timer !== null) clearInterval(timer)
      timer = null
    }
  }
}
