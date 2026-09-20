import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
    }
  },
  test: {
    // scripts/ 与 packaging/ 下的纯逻辑(版本语义、安装器判定等)同样纳入测试;
    // 它们已在 tsconfig.node.json 的 include 里
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs', 'packaging/**/*.test.mjs']
  }
})
