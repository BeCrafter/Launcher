import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // 单测一律用桩代替真的 electron:它的入口在 import 时就会下载二进制,
      // 没装好/网络抖动的机器会连测试文件都加载不了(2026-10-21 发布踩到)。
      electron: fileURLToPath(new URL('./src/main/test/electron-stub.ts', import.meta.url)),
      '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
    }
  },
  test: {
    // scripts/ 与 packaging/ 下的纯逻辑(版本语义、安装器判定等)同样纳入测试;
    // 它们已在 tsconfig.node.json 的 include 里
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mjs', 'packaging/**/*.test.mjs']
  }
})
