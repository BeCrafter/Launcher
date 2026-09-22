import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

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
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
