// 守卫：shell 里 `$VAR` 后**紧跟**非 ASCII 字符时（典型是中文标点），bash 会把该字符的
// 多字节序列并进变量名 —— `$HAVE（` 被当成一个叫 `HAVE（` 的变量，在 `set -u` 下直接
// 报 unbound variable。
//
// 为什么需要专门的守卫：这个坑对现有检查全部免疫 ——
//   · `bash -n` 只做语法检查，不展开变量，看不出问题
//   · macOS / 开发机上的 C locale 不复现（字节 0xEF 不被当作字母）
//   · GitHub runner 是 UTF-8 locale，于是**只在 CI 上炸**（2026-09-22 实际踩到）
// 规矩在 scripts/install.sh 里早已写明：「变量一律写 ${VAR}」。这里把它变成不会退化的断言。

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** 会当 shell 跑的文件；.mjs 里的模板字符串不是 shell，不在守卫范围 */
const SCAN_DIRS = ['.github/workflows', 'scripts', 'packaging']
const SHELL_EXT = new Set(['.yml', '.yaml', '.sh', '.bash'])

function shellFiles(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...shellFiles(full))
    else if (SHELL_EXT.has(e.name.slice(e.name.lastIndexOf('.')))) out.push(full)
  }
  return out
}

/** 未加花括号的 `$VAR` / `$1`，且右边第一个字符不是 ASCII */
const UNBRACED_VAR = /\$(?:[A-Za-z_][A-Za-z0-9_]*|[0-9])+/g

export function findUnbracedBeforeNonAscii(text) {
  const hits = []
  for (const [i, line] of text.split('\n').entries()) {
    // 整行注释里可能是「错误写法」的示范（install.sh 就有一处），跳过
    if (line.trimStart().startsWith('#')) continue
    for (const m of line.matchAll(UNBRACED_VAR)) {
      const after = line.slice(m.index + m[0].length)
      if (after && after.codePointAt(0) > 127) {
        hits.push({ line: i + 1, token: `${m[0]}${after[0]}`, text: line.trim() })
      }
    }
  }
  return hits
}

describe('shell 变量名不被多字节字符吞掉', () => {
  it('检测函数能识别出这个坑', () => {
    expect(findUnbracedBeforeNonAscii('echo "已安装：$HAVE（x）"')).toHaveLength(1)
    expect(findUnbracedBeforeNonAscii('echo "未知参数：$1（见 -h）"')).toHaveLength(1)
    // 加了花括号 / 后面是 ASCII / 整行注释 —— 都不算问题
    expect(findUnbracedBeforeNonAscii('echo "已安装：${HAVE}（x）"')).toHaveLength(0)
    expect(findUnbracedBeforeNonAscii('echo "$VERSION ok"')).toHaveLength(0)
    expect(findUnbracedBeforeNonAscii('# 错误示范：$HAVE（会报 unbound variable）')).toHaveLength(0)
  })

  it('仓库里所有 shell 文件都不含该写法', () => {
    const offenders = []
    for (const dir of SCAN_DIRS) {
      for (const file of shellFiles(join(ROOT, dir))) {
        const text = readFileSync(file, 'utf8')
        // statSync 只为确认是常规文件（符号链接/目录已在上面排除）
        if (!statSync(file).isFile()) continue
        for (const hit of findUnbracedBeforeNonAscii(text)) {
          offenders.push(
            `${relative(ROOT, file)}:${hit.line}  ${hit.token}   ← ${hit.text.slice(0, 80)}`
          )
        }
      }
    }
    expect(
      offenders,
      `\n发现了会被 UTF-8 locale 下的 bash 误解析的写法（改成 \${VAR} 即可）：\n  ${offenders.join('\n  ')}\n`
    ).toEqual([])
  })
})
