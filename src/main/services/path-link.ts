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

import { accessSync, constants, existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { userInfo } from 'node:os'
import type { McpLinkState } from '../../shared/ipc'

/** 命令名(与 cask 的 binary stanza、脚本文案保持一致) */
export const MCP_BIN_NAME = 'launcher-mcp'

/**
 * 取**用户登录 shell** 的 PATH(懒探测 + 会话内缓存)。
 *
 * 为什么不能用 `process.env.PATH`:打包应用从 Finder/Dock 启动时它只有
 * `/usr/bin:/bin:/usr/sbin:/sbin` —— 四个目录全是 root 所有、一个字节都写不进去,
 * 于是「安装到 PATH」必然失败,还把用户打发去手动建链接(2026-09-23 用户实测报告)。
 * 而这整件事的目的恰恰是让**从用户终端启动的外部 Agent** 能找到 launcher-mcp,
 * 判据理应与用户终端一致,而不是与应用自身的启动环境一致。
 *
 * 探测失败(无 shell / 超时 / 输出不是 PATH)一律回退 `process.env.PATH`:宁可按旧行为
 * 保守判断,也不拿一个猜出来的目录去写文件。
 */
let shellPathCache: string | null = null

export function shellPath(probe: () => string = probeLoginShellPath): string {
  if (shellPathCache === null) {
    const probed = probe()
    shellPathCache = probed !== '' ? probed : (process.env['PATH'] ?? '')
  }
  return shellPathCache
}

/** 仅供测试:清掉会话缓存 */
export function resetShellPathCache(): void {
  shellPathCache = null
}

/** rc 文件会往 stdout 印东西,故把 PATH 夹在一对哨兵之间只取那一段(导出供测试构造噪音) */
export const PATH_SENTINEL = '__LAUNCHER_PATH__'
const SENTINEL = PATH_SENTINEL

/** 从带噪音的输出里抠出哨兵之间的内容(纯函数,便于单测) */
export function parsePathOutput(raw: string): string {
  const a = raw.indexOf(SENTINEL)
  if (a < 0) return ''
  const b = raw.indexOf(SENTINEL, a + SENTINEL.length)
  if (b < 0) return ''
  const value = raw.slice(a + SENTINEL.length, b).trim()
  // 非 PATH 的形态(带换行 / 完全没有分隔符与斜杠)一律判为探测失败
  if (value === '' || value.includes('\n') || !value.includes('/')) return ''
  return value
}

/**
 * 跑一次登录 shell 问 PATH。用 `-lic`(login + interactive)是为了同时覆盖
 * .zprofile/.zshrc 两条路径 —— 用户终端里生效的就是它俩的合成结果。
 * fish 的 `$PATH` 是列表,得用 `string join` 拼回冒号形式。
 */
export function probeLoginShellPath(
  shell = process.env['SHELL'] || userInfo().shell || '/bin/zsh',
  timeoutMs = 3000
): string {
  const cmd =
    basename(shell) === 'fish'
      ? `printf '${SENTINEL}%s${SENTINEL}' (string join : $PATH)`
      : `printf '${SENTINEL}%s${SENTINEL}' "$PATH"`
  try {
    // stdin 必须断开:交互式 shell 碰到继承来的 stdin 可能挂住等待输入
    const r = spawnSync(shell, ['-lic', cmd], { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] })
    return parsePathOutput(r.stdout ?? '')
  } catch {
    return ''
  }
}

/** PATH 条目 → 目录列表(丢掉空段) */
export function pathDirs(pathEnv: string): string[] {
  return pathEnv.split(':').filter((d) => d !== '')
}

export interface McpLinkInfo {
  state: McpLinkState
  /** 在 PATH 上命中的那个路径;missing 时为 null */
  foundAt: string | null
  /** 期望指向的目标(本应用包内的脚本) */
  expected: string
}

/** 允许注入 PATH(测试用);默认取用户登录 shell 的 PATH(见 shellPath) */
export function inspectMcpLink(expected: string, pathEnv = shellPath()): McpLinkInfo {
  // expected 自身也过一遍 realpath:调用方给的是 app 包内路径,而 /Applications 之类
  // 在某些机器上是符号链接,不归一化会跟 realpath(链接) 比不相等、误判成 foreign
  let realExpected = expected
  try {
    realExpected = realpathSync(expected)
  } catch {
    /* 还没打包/文件不在:保持原样,后续比较自然为 foreign */
  }

  for (const dir of pathDirs(pathEnv)) {
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
 * 能不能把链接落在这个目录里。
 * `allowCreate` = 目录还不存在时是否允许顺手建出来(仅对 `~/.local/bin` 开这个口子 ——
 * 它是约定的用户级 bin 目录,而往别人 PATH 里的任意不存在路径 mkdir 是越界行为)。
 * 建目录前要求**最近的已存在祖先**可写,否则 mkdir 本身就会失败。
 */
const installableDir = (dir: string, allowCreate: boolean): boolean => {
  if (writableDir(dir)) return true
  if (!allowCreate || existsSync(dir)) return false
  let p = dirname(dir)
  while (!existsSync(p)) {
    const up = dirname(p)
    if (up === p) return false
    p = up
  }
  return writableDir(p)
}

/** lstat 版的存在性判断:不跟随符号链接,所以「指向已不存在目标的悬空链接」也算在 */
const linkExists = (p: string): boolean => {
  try {
    lstatSync(p)
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
 *  ② 已有的 PATH 目录里,优先 `~/.local/bin`(用户自己的,不归任何包管理器;不存在则建)
 *  ③ 其余 PATH 目录(必须是**已存在且可写**的,不会为它们新建目录)
 * 都不行就如实返回失败原因与下一步(而不是假装成功)。
 *
 * @param pathEnv 默认取用户登录 shell 的 PATH —— 见 shellPath 的说明:链接是要给
 *                **用户终端里启动的外部 Agent** 用的,判据必须和用户终端一致。
 */
export function installMcpLink(expected: string, pathEnv = shellPath()): InstallResult {
  const dirs = pathDirs(pathEnv)
  const info = inspectMcpLink(expected, pathEnv)

  const home = process.env['HOME'] ?? ''
  const localBin = home ? join(home, '.local', 'bin') : ''

  const candidates: string[] = []
  if (info.foundAt) candidates.push(dirname(info.foundAt))
  // ~/.local/bin 不在 PATH 上时建了也没用,故只在它已在 PATH 里才优先
  if (localBin && dirs.includes(localBin)) candidates.push(localBin)
  candidates.push(...dirs.filter((d) => d !== localBin))

  const target = candidates.find((d) => installableDir(d, localBin !== '' && d === localBin))
  if (!target) {
    // 单行:这条会进 toast(white-space: nowrap),多行或过长会被窗口边缘裁掉。
    // 完整路径在弹窗上方本就可复制,这里只给「先建目录 + 加进 PATH」这一步引导
    return {
      ok: false,
      reason: 'PATH 中没有可写的目录;可 mkdir -p ~/.local/bin 并加入 shell PATH 后,按上方路径手动链接'
    }
  }

  const link = join(target, MCP_BIN_NAME)
  try {
    // 目录不存在就建出来(~/.local/bin 常见);已存在则空操作
    mkdirSync(target, { recursive: true })
    // 就地修复前先移除旧链接:symlinkSync 在该路径已存在时会 EEXIST。
    // ⚠ 必须用 unlink,不能用 rmSync(force) —— rmSync 删「悬空链接」的行为在 Node 小版本间
    //   变过:24.4.0 上它对目标不存在的链接是空操作(静默不删),22.x 与 24.20+ 正常,
    //   旧链接留下来就会让下面抛 EEXIST。unlink 不跟随符号链接,各版本行为一致。
    if (info.foundAt && dirname(info.foundAt) === target && linkExists(link)) unlinkSync(link)
    symlinkSync(expected, link)
    return { ok: true, path: link }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
