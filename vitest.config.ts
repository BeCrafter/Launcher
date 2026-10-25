import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const path = (p: string): string => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // 单测一律用桩代替真的 electron:它的入口在 import 时就会下载二进制,
      // 没装好/网络抖动的机器会连测试文件都加载不了(2026-10-21 发布踩到)。
      electron: path('./src/main/test/electron-stub.ts'),
      '@renderer': path('./src/renderer/src'),
      '@shared': path('./src/shared'),
      // 与 electron.vite.config.ts / tsconfig.web.json 对齐(帮助文档 ?raw 内联)
      '@root': path('./')
    }
  },
  test: {
    // 根配置只做容器:两个 project 的 include 互斥,不会重复执行同一文件。
    // 环境按后缀分:.test.tsx → jsdom(组件),其余 → node(纯逻辑/主进程/脚本)。
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs', 'packaging/**/*.test.mjs']
        }
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/src/**/*.test.tsx'],
          setupFiles: ['./src/renderer/src/test/setup.ts'],
          // 让 `?raw` 能读到真实样式文本(勾选框定位契约);其余 CSS 不参与断言
          css: true
        }
      }
    ]
  }
})
