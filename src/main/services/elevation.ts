// 提权执行器:osascript `do shell script … with administrator privileges`(系统原生授权框)
// 安全约束:被执行的 sh 模板禁止出现双引号/反斜杠/换行(硬校验),因此 AppleScript 字符串
//   字面量可安全双引号直插;调用方必须使用「固定模板 + base64/纯数字 token」拼装,
//   不存在用户可控字符串进入命令的路径。
// 超时:不走 cmdTimeout(用户输密码耗时不可控),硬上限默认 300s。
// 取消识别:退出码非 0 且 stderr 含 (-128)(数字匹配,规避系统语言本地化差异)。

import { spawn, type ChildProcess } from 'node:child_process'

export interface ElevationResult {
  ok: boolean
  cancelled: boolean
  code: number | null
  stderr: string | null
}

export interface ElevationExecutor {
  run(sh: string): Promise<ElevationResult>
}

const UNSAFE_RE = /["\\\n\r]/

export function createElevationExecutor(deps?: {
  spawnImpl?: typeof spawn
  hardTimeoutMs?: number
}): ElevationExecutor {
  const spawnImpl = deps?.spawnImpl ?? spawn
  const hardTimeoutMs = deps?.hardTimeoutMs ?? 300_000

  return {
    run(sh) {
      return new Promise<ElevationResult>((resolve) => {
        if (UNSAFE_RE.test(sh)) {
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
