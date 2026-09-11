// brew services 集成(阶段 1;机制对齐开源 BrewServicesService + BrewManagedSupport)
// - `brew services list --json` 解析(name/status/user/file/exit_code)
// - 合并规则(纯函数 matchBrewService):label 前缀 `homebrew.mxcl.`(开源同款);
//   否则按可执行路径在 Homebrew 目录下推断公式名
// - 操作路由:brew 管理的条目 start/stop/restart 走 `brew services <action> <name>`;root 服务需提权

import { existsSync } from 'node:fs'
import { ELEVATION_CANCELLED, ELEVATION_FAILED } from '../../shared/ipc'
import type { ElevationExecutor } from './elevation'
import type { ShellRunner } from './shell-runner'

export interface BrewServiceInfo {
  name: string
  status: string
  user: string | null
  file: string | null
  exitCode: number | null
}

export type BrewActionKind = 'start' | 'stop' | 'restart'

export interface BrewAgentService {
  list(): Promise<BrewServiceInfo[]>
  action(kind: BrewActionKind, info: BrewServiceInfo): Promise<void>
}

const BREW_LABEL_PREFIX = 'homebrew.mxcl.'
const HOMEBREW_PATH_RE = /\/homebrew\/|\/opt\/homebrew\/|\/usr\/local\/(?:opt|Cellar)\//

/** brew 记录的 file 字段与 agent plist 文件名一致 → 精确命中(前缀无关;本机实测 brew 用 sh.brew.<name>) */
function matchByFile(plistPath: string, services: BrewServiceInfo[]): BrewServiceInfo | null {
  if (plistPath === '') return null
  const file = plistPath.slice(plistPath.lastIndexOf('/') + 1)
  return (
    services.find((s) => {
      const f = s.file ?? ''
      return f !== '' && f.slice(f.lastIndexOf('/') + 1) === file
    }) ?? null
  )
}

/** 匹配顺序:brew file 字段(精确)→ `homebrew.mxcl.` 前缀(开源原规则)→ Homebrew 安装路径推断(纯函数,可单测) */
export function matchBrewService(
  label: string,
  program: string,
  services: BrewServiceInfo[],
  plistPath = ''
): BrewServiceInfo | null {
  const byFile = matchByFile(plistPath, services)
  if (byFile) return byFile
  if (label.startsWith(BREW_LABEL_PREFIX)) {
    const name = label.slice(BREW_LABEL_PREFIX.length)
    return (
      services.find((s) => s.name === name) ?? { name, status: 'unknown', user: null, file: null, exitCode: null }
    )
  }
  if (!HOMEBREW_PATH_RE.test(program)) return null
  // 取最后一个 /opt|Cellar/<公式>/ 段(路径可能先出现 /opt/homebrew/ 前缀)
  const matches = [...program.matchAll(/\/(?:opt|Cellar)\/([^/]+)/g)]
  if (matches.length === 0) return null
  const formula = matches[matches.length - 1][1].replace(/\.rb$/, '').replace(/@[\d.]+$/, '')
  return services.find((s) => s.name === formula || s.name.replace(/@[\d.]+$/, '') === formula) ?? null
}

export function isBrewRootService(info: BrewServiceInfo): boolean {
  return info.user === 'root' || (info.file ?? '').startsWith('/Library/LaunchDaemons')
}

export function createBrewAgentService(deps: { runner: ShellRunner; elevate: ElevationExecutor }): BrewAgentService {
  let brewPath: string | null = null
  const resolveBrew = (): string => {
    if (brewPath) return brewPath
    for (const p of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
      if (existsSync(p)) {
        brewPath = p
        return p
      }
    }
    brewPath = 'brew'
    return brewPath
  }

  return {
    async list() {
      const r = await deps.runner.run(resolveBrew(), ['services', 'list', '--json'])
      if (r.code !== 0) return []
      try {
        const parsed = JSON.parse(r.stdout) as Record<string, unknown>[]
        if (!Array.isArray(parsed)) return []
        return parsed
          .filter((x) => typeof x?.name === 'string')
          .map((x) => ({
            name: x.name as string,
            status: typeof x.status === 'string' ? x.status : 'unknown',
            user: typeof x.user === 'string' ? x.user : null,
            file: typeof x.file === 'string' ? x.file : null,
            exitCode: typeof x.exit_code === 'number' ? x.exit_code : null
          }))
      } catch {
        return []
      }
    },

    async action(kind, info) {
      const safeName = info.name.replace(/[^A-Za-z0-9@._+-]/g, '')
      if (isBrewRootService(info)) {
        const r = await deps.elevate.run(`${resolveBrew()} services ${kind} ${safeName}`)
        if (!r.ok) {
          throw new Error(r.cancelled ? ELEVATION_CANCELLED : `${ELEVATION_FAILED}: ${r.stderr ?? ''}`)
        }
        return
      }
      const r = await deps.runner.run(resolveBrew(), ['services', kind, safeName])
      if (r.code !== 0) throw new Error(`brew services ${kind} failed: ${r.stderr || r.code}`)
    }
  }
}
