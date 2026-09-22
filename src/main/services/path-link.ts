// PATH 上的 `launcher-mcp` 链接检查与安装
//
// 背景:Homebrew cask 的 `binary` stanza 会把应用包内的 launcher-mcp 脚本 symlink 进 PATH,
// 但这条链接可能失效或压根不存在 —— 应用被挪到 ~/Applications、brew 重装、用户清理过 PATH,
// 都会让挂在外部 Agent 里的那串命令变成 "command not found"。
// 此前 MCP 弹窗只按「安装来源是否 brew」猜链接存在,猜错就把用户送进一个没头没尾的报错。
//
// ⚠ 本模块**只读检查**是自动的;写入(建链接)一律由用户显式点按钮触发 ——
//   往 PATH 里放可执行文件是应用之外可见的动作,且那个链接在 brew 装的情况下归 brew 管
//   (卸载时要靠它清理),应用不该在启动时静默跟包管理器抢所有权。

import { accessSync, constants, lstatSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { McpLinkState } from '../../shared/ipc'

/** 命令名(与 cask 的 binary stanza、脚本文案保持一致) */
export const MCP_BIN_NAME = 'launcher-mcp'


export interface McpLinkInfo {
  state: McpLinkState
  /** 在 PATH 上命中的那个路径;missing 时为 null */
  foundAt: string | null
  /** 期望指向的目标(本应用包内的脚本) */
  expected: string
}

/** 允许注入 PATH(测试用) */
export function inspectMcpLink(expected: string, pathEnv = process.env['PATH'] ?? ''): McpLinkInfo {
  // expected 自身也过一遍 realpath:调用方给的是 app 包内路径,而 /Applications 之类
  // 在某些机器上是符号链接,不归一化会跟 realpath(链接) 比不相等、误判成 foreign
  let realExpected = expected
  try {
    realExpected = realpathSync(expected)
  } catch {
    /* 还没打包/文件不在:保持原样,后续比较自然为 foreign */
  }

  for (const dir of pathEnv.split(':').filter((d) => d !== '')) {
    const candidate = join(dir, MCP_BIN_NAME)
    try {
      lstatSync(candidate)
    } catch {
      continue // 该目录下没有这个名字
    }
    try {
      return {
        state: realpathSync(candidate) === realExpected ? 'linked' : 'foreign',
        foundAt: candidate,
        expected
      }
    } catch {
      // lstat 成功但 realpath 失败 = 悬空链接(目标已不存在)
      return { state: 'dangling', foundAt: candidate, expected }
    }
  }
  return { state: 'missing', foundAt: null, expected }
}

export type InstallResult = { ok: true; path: string } | { ok: false; reason: string }

const writableDir = (dir: string): boolean => {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 建/修 PATH 上的 launcher-mcp 链接。**只在用户点按钮时调用。**
 *
 * 落点策略(按优先级):
 *  ① 已经命中过的那个目录(悬空/指向别处时**就地修**)—— 不制造第二份,免得 PATH 上并存两个
 *  ② 已有的可写 PATH 目录里,优先 `~/.local/bin`(用户自己的,不归任何包管理器)
 *  ③ 其余可写 PATH 目录
 * 都不行就如实返回失败原因,让用户手动执行(而不是假装成功)。
 */
export function installMcpLink(expected: string, pathEnv = process.env['PATH'] ?? ''): InstallResult {
  const dirs = pathEnv.split(':').filter((d) => d !== '')
  const info = inspectMcpLink(expected, pathEnv)

  const candidates: string[] = []
  if (info.foundAt) candidates.push(dirname(info.foundAt))
  const home = process.env['HOME'] ?? ''
  const localBin = home ? join(home, '.local', 'bin') : ''
  // ~/.local/bin 不在 PATH 上时建了也没用,故只在它已在 PATH 里才优先
  if (localBin && dirs.includes(localBin)) candidates.push(localBin)
  candidates.push(...dirs.filter((d) => d !== localBin))

  const target = candidates.find((d) => writableDir(d))
  if (!target) {
    return { ok: false, reason: 'PATH 中没有可写的目录,请手动创建符号链接' }
  }

  const link = join(target, MCP_BIN_NAME)
  try {
    if (target === localBin) mkdirSync(target, { recursive: true })
    // 就地修复前先移除旧链接:符号链接已存在时 symlinkSync 会 EEXIST
    if (info.foundAt && dirname(info.foundAt) === target) rmSync(link, { force: true })
    symlinkSync(expected, link)
    return { ok: true, path: link }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
