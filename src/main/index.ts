import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { APP_NAME } from '../shared/constants'
import { IPC_EVENTS } from '../shared/ipc'
import { createSettingsStore, defaultConfigPath, type SettingsStore } from './settings/store'
import { applyDockIcon } from './settings/appliers/dock'
import { windowBgColor } from './settings/appliers/appearance'
import { createTrayController } from './settings/appliers/tray'
import { createApplierRegistry } from './settings/appliers'
import { launchdWatchDirs } from './services/dir-watcher'
import { createShellRunner } from './services/shell-runner'
import { createElevationExecutor } from './services/elevation'
import { toServicesPayload } from './services/process-discovery'
import { detectInstallChannel } from './services/install-channel'
import { createCoreServices } from './core-services'
import { createAiStack } from './ai'
import type { ApplyCtx } from './settings/types'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null
let store: SettingsStore

// dev 自动化验证端口(如 CDP 交互测试);生产不生效
if (process.env['ELECTRON_RENDERER_URL'] && process.env['LAUNCHER_DEV_DEBUG_PORT']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['LAUNCHER_DEV_DEBUG_PORT'])
}

// dev E2E:隔离 userData(与正在运行的打包版互不争抢单实例锁/缓存);必须在取锁之前设置
// ⚠ 用 LAUNCHER_E2E_USER_DATA 同时隔离设置文件:此前它只隔离 userData,而设置文件仍写真实的
//   ~/.config/launcher/config.json —— 自动化验证会悄悄改掉用户的配置(本项目真发生过)。
//   `home` 由 NSHomeDirectory 决定,改 HOME 环境变量对它无效,故只能在这里显式改路径。
const e2eUserData = process.env['ELECTRON_RENDERER_URL'] ? process.env['LAUNCHER_E2E_USER_DATA'] : undefined
if (e2eUserData) {
  app.setPath('userData', e2eUserData)
}

// 单实例锁：重复启动时唤起既有窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.on('second-instance', () => showMainWindow())

function logoDir(): string {
  // dev：项目根 resources/；打包后：extraResources 释放到 Contents/Resources/logo
  const base = app.isPackaged
    ? join(process.resourcesPath, 'logo')
    : join(__dirname, '../../resources/logo')
  return base
}

// main → renderer 推送(applier 事件与 settings:changed 共用;renderer 侧经 preload 白名单订阅)
function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

// 主进程主题(应用内切换或系统外观变化)变化 → 窗口底色 + Dock 图标随明暗切换
// 窄路径:不重跑 registry(themeSource 重赋值虽幂等,避免潜在 'updated' 回环)
nativeTheme.on('updated', () => {
  applyDockIcon(logoDir)
  mainWindow?.setBackgroundColor(windowBgColor())
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 700,
    minHeight: 450,
    show: false,
    title: APP_NAME,
    // 接管标题栏:应用自绘 28px 色带(与侧边栏同色 --surface),交通灯驻留其上
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 6 },
    backgroundColor: windowBgColor(), // 依据生效主题(启动序里 themeSource 已先应用)
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      // 首帧前把初始设置带进 preload(免同步 IPC、无主题/语言闪烁)
      additionalArguments: [`--launcher-initial-settings=${JSON.stringify(store.get())}`]
    }
  })

  // menubarOnly:关窗 → 隐藏常驻菜单栏;false 时关窗即退出
  mainWindow.on('close', (e) => {
    if (store.get().menubarOnly) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  // window.open / target=_blank 一律走系统浏览器(http/https 白名单)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // dev 可见性：渲染层控制台错误转发到主进程输出，启动后自检 root 是否渲染
  const isDev = Boolean(process.env['ELECTRON_RENDERER_URL'])
  if (isDev) {
    mainWindow.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.log(`[renderer:${level}]`, message)
    })
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const result = (await mainWindow?.webContents.executeJavaScript(
            "JSON.stringify({url: location.href.slice(0,80), root: !!document.getElementById('root'), rootKids: document.getElementById('root')?.childElementCount ?? -1, bodyKids: document.body.childElementCount, shell: !!document.querySelector('.app-shell')})"
          )) as string
          console.log(`[dev-check] ${result}`)
        } catch (err) {
          console.log('[dev-check] failed:', err)
        }
      }, 1500)
    })
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * 唤起主窗口(Dock 图标点击 / 重复启动 / 托盘共用的入口)。
 * ⚠ menubarOnly(默认开)下关窗只是 hide —— 窗口对象仍在,`getAllWindows().length` 仍为 1,
 * 用「有没有窗口」判断会漏掉「窗口存在但被隐藏」这一态(Electron 脚手架的 activate 写法即如此,
 * 会让 Dock 点击静默无效)。这里只判窗口对象是否可用,已销毁才重建。
 */
function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore() // macOS 上 show() 不会取消最小化
    mainWindow.show()
    mainWindow.focus()
    return
  }
  if (app.isReady()) createWindow() // ready 前 store 尚未初始化,建窗会抛
}

app.whenReady().then(async () => {
  // 启动序:设置加载 → applier 注册表副作用(themeSource/Tray/Dock/登录项/目录监听) → 建窗 → IPC
  store = createSettingsStore(
    e2eUserData ? join(e2eUserData, 'config.json') : defaultConfigPath(app.getPath('home'))
  )
  const trayCtl = createTrayController({ logoDir, getWindow: () => mainWindow })
  const ctx: ApplyCtx = {
    logoDir,
    getWindow: () => mainWindow,
    tray: trayCtl,
    watchDirs: launchdWatchDirs(app.getPath('home')),
    broadcast
  }
  const registry = createApplierRegistry(ctx, { onDirsChanged: () => plists.invalidate() })

  // 执行层(阶段 2/3):ShellRunner(cmdTimeout 注入)/ 提权 / 定时任务服务
  const runner = createShellRunner({ getTimeoutMs: () => store.get().cmdTimeout })
  const elevate = createElevationExecutor()

  const xmlIndentOf = (): string => {
    const v = store.get().xmlIndent
    return v === 'tab' ? '\t' : ' '.repeat(Number(v))
  }

  // 核心服务栈(定时任务/Launch Agents/端口服务)——装配单一来源见 core-services.ts
  // (launcher-mcp 独立进程复用同一份,避免两处漂移)
  const { plists, agents, cron, discovery, termination, docker, launchctl, brew } = createCoreServices({
    runner,
    elevate,
    home: app.getPath('home'),
    getXmlIndent: xmlIndentOf,
    getCronRetainDays: () => store.get().cronLogRetainDays,
    onServicesChange: (r, polling) => broadcast(IPC_EVENTS.servicesUpdated, toServicesPayload(r, polling)),
    log: (m) => console.log(`[svc] ${m}`)
  })
  // plist 必须在 registry.apply 之前建好:fsevents applier 的 onDirsChanged 会失效其 scanAll 记忆
  registry.apply(store.get())
  // 设置变更(渲染层 patch / reset)→ 重新应用全部副作用
  store.onChange((s) => registry.apply(s))

  discovery.start() // 启动扫一次(侧边栏角标初值);页面激活后按 3s 轮询

  // 安装来源探测(brew/npm/manual):决定「检查更新」给哪条升级命令。
  // 约 0.2s(brew list --cask),放在建窗之前;失败/判不出都会回退 manual,不阻断启动
  const installChannel = await detectInstallChannel({ runner })

  // AI 助手(阶段 4):pi 引擎 + ToolRegistry + 内置会话;MCP HTTP 端点同批启动
  const ai = createAiStack({
    store,
    services: { plists, agents, cron, discovery, termination, docker, launchctl, brew },
    home: app.getPath('home'),
    userDataDir: app.getPath('userData'),
    emit: (ev) => broadcast(IPC_EVENTS.aiRunEvent, ev)
  })
  await ai.start()

  registerIpc({ store, tray: trayCtl, agents, cron, discovery, termination, docker, installChannel, ai })

  createWindow()

  // Dock 图标点击 / 重新打开应用 → 唤起(Dock 点击由 macOS 的 applicationShouldHandleReopen 触发,必发此事件)
  app.on('activate', () => showMainWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// menubarOnly 关窗只隐藏,退出须经 Tray 菜单 / Cmd+Q(默认 macOS 行为保留)
app.on('before-quit', () => {
  // 允许 quit 流程真正退出(绕过 close 的 hide 拦截)
  mainWindow?.removeAllListeners('close')
  mainWindow?.destroy()
})
