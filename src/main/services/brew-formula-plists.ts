// brew services stop 会删掉 ~/Library/LaunchAgents 里的副本,但公式目录里还留着服务 plist。
// 列表只扫三个 Launch* 目录时,这条就会从界面上消失,再也点不了启动。
// 这里只做目录查找,不跑 `brew services list`(那条命令要十来秒)。

import { access, readdir } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { resolveBrewPath } from './brew-path'

/** 新版 Homebrew 写 `sh.brew.<formula>.plist`,旧版写 `homebrew.mxcl.<formula>.plist`。前者优先。 */
export const BREW_SERVICE_PLIST_PREFIXES = ['sh.brew.', 'homebrew.mxcl.'] as const

const DEFAULT_ROOTS = ['/opt/homebrew/opt', '/usr/local/opt']

/**
 * 要扫的 opt 目录。自定义 `HOMEBREW_PREFIX` 和非默认位置的 brew 也算进去，
 * 否则那边的服务一 `brew services stop` 就从列表里消失。
 */
export function brewOptRoots(env: { prefix?: string | null; brewBin?: string } = {}): string[] {
  const roots: string[] = []
  const add = (p: string): void => {
    const n = normalize(p)
    if (!roots.includes(n)) roots.push(n)
  }
  const prefix = env.prefix === undefined ? process.env.HOMEBREW_PREFIX : env.prefix
  if (prefix) add(join(prefix, 'opt'))
  const brewBin = env.brewBin ?? resolveBrewPath()
  if (brewBin !== 'brew') add(join(dirname(brewBin), '..', 'opt'))
  for (const root of DEFAULT_ROOTS) add(root)
  return roots
}

export function brewServicePlistNames(formula: string): string[] {
  return BREW_SERVICE_PLIST_PREFIXES.map((prefix) => `${prefix}${formula}.plist`)
}

/** `present` 里按优先级选一个服务 plist 文件名;都没有就返回 null。 */
export function pickBrewServicePlist(formula: string, present: readonly string[]): string | null {
  const have = new Set(present)
  for (const name of brewServicePlistNames(formula)) {
    if (have.has(name)) return name
  }
  return null
}

/** 当前已安装公式的服务 plist 绝对路径。同一公式只留优先级更高的那份。 */
export async function listBrewFormulaServicePlists(roots?: readonly string[]): Promise<string[]> {
  const found: string[] = []
  for (const root of roots ?? brewOptRoots()) {
    let formulas: string[]
    try {
      formulas = await readdir(root)
    } catch {
      continue
    }
    await Promise.all(
      formulas.map(async (formula) => {
        for (const name of brewServicePlistNames(formula)) {
          const path = join(root, formula, name)
          try {
            await access(path)
          } catch {
            continue
          }
          found.push(path)
          return
        }
      })
    )
  }
  found.sort()
  return found
}
