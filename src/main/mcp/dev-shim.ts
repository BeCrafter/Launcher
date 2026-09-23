// 开发态的 launcher-mcp 转调脚本(打包版没有这个文件 —— 那里用的是 Contents/Resources/launcher-mcp)
//
// 为什么需要它:打包布局里 `Contents/Resources/launcher-mcp` 是自带定位逻辑的脚本(解开自身符号
// 链接 → 找隔壁 MacOS/ 的二进制 + app.asar 里的入口),开发态没有那个布局,只有
// `out/main/launcher-mcp.js`(electron-vite 的第二个 main 入口)+「拿 Electron 二进制当 Node 跑」
// 这一层。所以开发态原本直接不支持「安装到 PATH」(`mcpScriptPath()` 返回空串,界面连按钮都不给)。
//
// 生成位置:每个 checkout 自己一份(`<appPath>/node_modules/.cache/`)——
//   ① 路径本身就是身份:两个 checkout 各装各的,和打包版按 app 路径判断归属同理(见 path-link);
//   ② 不进包:electron-builder 的 files 只收 `out/**` 与 package.json;
//   ③ 不脏仓库:node_modules 本就在 .gitignore 里。
// ⚠ checkout 被移动、或跑了 `npm ci`(会清掉 node_modules/.cache)之后这份 shim 即失效 ——
//   届时界面显示「悬空」并给出「修复指向」按钮,点一下即重建(不静默留一条坏命令)。

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MCP_BIN_NAME } from '../services/path-link'

/** shim 的生成位置(每 checkout 一份;目录不存在时由 writeDevShim 建) */
export function devShimPath(appPath: string): string {
  return join(appPath, 'node_modules', '.cache', MCP_BIN_NAME)
}

/**
 * shim 正文。stdout 属于 MCP 协议本身,故所有提示都写 stderr;
 * 入口不存在时给一句能自解释的话,而不是让 Electron 抛它自己的错。
 */
export function devShimScript(electronPath: string, entryPath: string): string {
  return `#!/bin/sh
# launcher-mcp —— 开发态 shim(由 Launcher 生成,可随时删除;重新点「安装到 PATH」会重建)
# 打包版对应物是 Contents/Resources/launcher-mcp;开发态没有那个布局,故这里直接转调:
#   ELECTRON_RUN_AS_NODE=1 <开发用 Electron 二进制> <checkout>/out/main/launcher-mcp.js
if [ ! -f "${entryPath}" ]; then
  echo "launcher-mcp: 找不到 ${entryPath}" >&2
  echo "launcher-mcp: 先跑一次 npm run dev 生成 out/main,或本 checkout 已被移动(重新点「安装到 PATH」重建)" >&2
  exit 1
fi
exec env ELECTRON_RUN_AS_NODE=1 "${electronPath}" "${entryPath}" "$@"
`
}

/** 写入并置可执行位(幂等:重复调用即「修复」) */
export function writeDevShim(shimPath: string, electronPath: string, entryPath: string): void {
  mkdirSync(dirname(shimPath), { recursive: true })
  writeFileSync(shimPath, devShimScript(electronPath, entryPath), 'utf8')
  chmodSync(shimPath, 0o755)
}
