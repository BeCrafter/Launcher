// 单测专用的 electron 桩。vitest.config.ts 把 `electron` 指到这里。
//
// 为什么需要:真正的 electron 入口在 **import 时**就会检查/下载二进制。2026-10-21 的
// v0.2.2 发布流水线上,GitHub 返回 502,notes-protocol.test.ts 只因为间接 import 了
// electron 就整个文件失败 —— 而单测根本不启动 Electron,不该为下载埋单。
//
// 这里不模拟任何 API:测试一旦真的访问 electron.* 就立刻抛错,并告诉它正确写法。
// 需要具体行为的测试,请在自己的文件里 vi.mock('electron', () => ({ ... }))。

function unavailable(member: string): never {
  throw new Error(
    `单测访问了未 mock 的 electron.${member} —— 请在该测试文件里 vi.mock('electron', ...)。` +
      `(vitest 已把 electron 指向桩,避免 import 时下载二进制)`
  )
}

function makeStub(name: string): unknown {
  return new Proxy(function () {} as () => void, {
    get(_target, prop) {
      // 别跟运行时的探针较劲:await 会读 then,util.inspect 会读 Symbol.toStringTag
      if (prop === 'then' || typeof prop === 'symbol') return undefined
      return unavailable(`${name}.${prop}`)
    },
    apply() {
      return unavailable(name)
    },
    construct() {
      return unavailable(`new ${name}`)
    }
  })
}

// 与 src/main、src/preload 里实际用到的命名导出保持一致;新增导入时这里也要补。
export const app = makeStub('app')
export const BrowserWindow = makeStub('BrowserWindow')
export const contextBridge = makeStub('contextBridge')
export const dialog = makeStub('dialog')
export const ipcMain = makeStub('ipcMain')
export const ipcRenderer = makeStub('ipcRenderer')
export const Menu = makeStub('Menu')
export const nativeImage = makeStub('nativeImage')
export const nativeTheme = makeStub('nativeTheme')
export const protocol = makeStub('protocol')
export const safeStorage = makeStub('safeStorage')
export const shell = makeStub('shell')
export const Tray = makeStub('Tray')
