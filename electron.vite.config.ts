import { existsSync } from 'node:fs'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// 这个 worktree 自己的 node_modules 是空的,包在仓库根。Vite 会跟到真实路径,
// 但默认不放行项目目录以外的文件,图标和中文字体就会 403。
const repoModules = resolve('../../../node_modules')
const outsideModules = existsSync(resolve(repoModules, '@fortawesome')) ? repoModules : null

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // 两个入口:
        //  index        —— 应用主进程(package.json 的 main 指向 out/main/index.js)
        //  launcher-mcp —— MCP 的 stdio 形态,由外部 Agent(Electron 二进制 + ELECTRON_RUN_AS_NODE=1)拉起
        input: {
          index: resolve('src/main/index.ts'),
          'launcher-mcp': resolve('src/main/mcp/stdio-entry.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    server: outsideModules ? { fs: { allow: [resolve('.'), outsideModules] } } : undefined,
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        // 仓库根:帮助文档(docs/help.md / docs/install.md)以 `?raw` 内联进产物 —— 应用内离线可读,
        // 且与 GitHub 上的是同一份文件,不会分叉
        '@root': resolve('.')
      }
    },
    plugins: [react()]
  }
})
