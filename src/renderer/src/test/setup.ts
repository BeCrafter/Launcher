// jsdom project 的全局 setup。执行顺序有要求:
//   DOM shim → window.launcher 桩 → store 重置
// 测试文件里在 beforeEach / 用例内播种状态,不要放模块顶层(会被这里的 beforeEach 冲掉)。

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { installDomShims } from './dom'
import { installLauncherStub } from './launcher-stub'
import { resetRendererStores } from './stores'

// 在任何测试文件 import 应用模块之前先放好基线,避免模块初始化时读到 undefined。
installDomShims()
installLauncherStub()

beforeEach(() => {
  // 重新装一遍:afterEach 的 restoreAllMocks 可能把上一轮 spy 还原掉
  installDomShims()
  installLauncherStub()
  resetRendererStores()
})

afterEach(() => {
  // globals:false 时 Testing Library 不会自动注册 cleanup
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})
