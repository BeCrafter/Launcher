// 提权执行器:osascript `do shell script … with administrator privileges`(系统原生授权框)
//
// 安全模型(2026-09-18 收紧,依据 docs/design/agent-editor-remediation.md P0-1):
//   调用方只提交「command + argv」步骤,本模块负责 POSIX 单引号编码,并把整段脚本写入 0700 私有临时文件,
//   提权只执行 `sh '<脚本路径>'` —— **用户数据(路径 / Label / 文件名)永远不进入 AppleScript 字符串**。
//   旧入口「调用方自己拼 shell 串」已删除:仅拒绝双引号/反斜杠/换行挡不住 `;`、`$()`、空白等元字符。
//   `{ script }` 是逃生舱(管道/重定向等无法用 argv 表达者),调用方必须保证其中**不含任何用户数据**
//   (只能出现常量与 base64 载荷);含用户数据的路径一律走 command+argv。
// 超时:不走 cmdTimeout(用户输密码耗时不可控),硬上限默认 300s。
// 取消识别:退出码非 0 且 stderr 含 (-128)(数字匹配,规避系统语言本地化差异)。

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface ElevationResult {
  ok: boolean
  cancelled: boolean
  code: number | null
  stderr: string | null
}

/** 单步受控操作(argv 由本模块编码) */
export interface ElevationCommand {
  command: string
  args?: string[]
}

/** 逃生舱:无法用 argv 表达的管道/重定向等;⚠ 内容不得含用户数据 */
export interface ElevationRawScript {
  script: string
}

export type ElevationStep = ElevationCommand | ElevationRawScript

export interface ElevationRequest {
  steps: ElevationStep[]
  /** 步骤连接符:默认 '&&'(任一步失败即停);';' 用于「前一步可失败仍继续」(如 bootout 一个未加载的任务) */
  join?: '&&' | ';'
}

export interface ElevationExecutor {
  run(req: ElevationRequest): Promise<ElevationResult>
}

/** POSIX 单引号编码:任何字符都按字面量传递 */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** 命令名是开发者常量:仅当它完全落在安全字符集内才不加引号(脚本更可读;用户数据只出现在 args,一律 shQuote) */
const SAFE_COMMAND_RE = /^[A-Za-z0-9._/+-]+$/
const encodeCommand = (command: string): string => (SAFE_COMMAND_RE.test(command) ? command : shQuote(command))

const UNSAFE_RE = /["\\\n\r]/

export function createElevationExecutor(deps?: {
  spawnImpl?: typeof spawn
  hardTimeoutMs?: number
  /** 测试注入:覆盖临时脚本目录(mkdtemp 的父目录) */
  tmpParent?: string
}): ElevationExecutor {
  const spawnImpl = deps?.spawnImpl ?? spawn
  const hardTimeoutMs = deps?.hardTimeoutMs ?? 300_000
  const tmpParent = deps?.tmpParent ?? tmpdir()

  /** 步骤序列 → 脚本正文(用户数据全部经 shQuote) */
  const buildScript = (req: ElevationRequest): string => {
    const sep = req.join === ';' ? ' ; ' : ' && '
    return req.steps
      .map((s) => ('script' in s ? s.script : [encodeCommand(s.command), ...(s.args ?? []).map(shQuote)].join(' ')))
      .join(sep)
  }

  return {
    run(req) {
      let dir: string
      let scriptPath: string
      try {
        dir = mkdtempSync(join(tmpParent, 'launcher-elev-'))
        scriptPath = join(dir, 'run.sh')
        writeFileSync(scriptPath, `#!/bin/sh\n${buildScript(req)}\n`, { mode: 0o700 })
      } catch (err) {
        return Promise.resolve({ ok: false, cancelled: false, code: null, stderr: `无法创建提权脚本: ${String(err)}` })
      }
      // 提权串只含本模块生成的临时路径(无用户数据);UNSAFE_RE 作纵深防御
      const sh = `sh ${shQuote(scriptPath)}`
      const cleanup = (): void => {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          /* 尽力而为:残留的是 0700 空目录 */
        }
      }
      return new Promise<ElevationResult>((resolve) => {
        if (UNSAFE_RE.test(sh)) {
          cleanup()
          resolve({
            ok: false,
            cancelled: false,
            code: null,
            stderr: 'unsafe elevated command (quotes/backslash/newline not allowed)'
          })
          return
        }
        const script = `do shell script "${sh}" with administrator privileges`
        const child: ChildProcess = spawnImpl('/usr/bin/osascript', ['-e', script], {
          stdio: ['ignore', 'pipe', 'pipe']
        })

        let stderr = ''
        let settled = false
        const settle = (r: ElevationResult): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          cleanup()
          resolve(r)
        }
        const timer = setTimeout(() => {
          child.kill('SIGTERM')
          settle({ ok: false, cancelled: false, code: null, stderr: 'elevation timeout' })
        }, hardTimeoutMs)

        child.stderr?.setEncoding('utf8')
        child.stderr?.on('data', (c: string) => {
          stderr += c
        })
        child.on('error', (err) => {
          settle({ ok: false, cancelled: false, code: null, stderr: err.message })
        })
        child.on('close', (code) => {
          const text = stderr.trim() || null
          if (code === 0) {
            settle({ ok: true, cancelled: false, code: 0, stderr: text })
            return
          }
          settle({
            ok: false,
            cancelled: /\(-128\)/.test(stderr),
            code,
            stderr: text
          })
        })
      })
    }
  }
}
