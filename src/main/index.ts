import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { APP_NAME } from '../shared/constants'
import { IPC, IPC_EVENTS, type BootPaintPhase } from '../shared/ipc'
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
import { createBootGate, type BootGate } from './services/boot-gate'
import { createCoreServices } from './core-services'
import { createAiStack } from './ai'
import type { ApplyCtx } from './settings/types'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null
let store: SettingsStore
/** 窗口显示门控(每个窗口一份;见 services/boot-gate.ts 的说明) */
let bootGate: BootGate | null = null

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

/** 真正把窗口露出来(唯一实现;门控与常规唤起都走它) */
function revealMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore() // macOS 上 show() 不会取消最小化
  mainWindow.show()
  mainWindow.focus()
}

/**
 * 启动进度上报(renderer → main):'splash' 过渡页已上屏 / 'app' 应用已 commit。
 * 注册一次即可 —— 门控是模块级变量,按 sender 认窗口,避免重复注册累积监听器。
 */
ipcMain.on(IPC.appBootPainted, (e, phase: BootPaintPhase) => {
  if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) return
  if (phase === 'splash') bootGate?.splashPainted()
  else if (phase === 'app') bootGate?.appPainted()
})

/** 加载失败时的兜底页:同样是主题化底色 —— 绝不让「失败」变成一块白 */
function bootErrorPage(reason: string): string {
  const bg = windowBgColor()
  const fg = nativeTheme.shouldUseDarkColors ? '#8e8ea8' : '#6d7489'
  const safe = reason.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;')).slice(0, 200)
  const html =
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Launcher</title>` +
    `<style>html,body{margin:0;height:100%;background:${bg};color:${fg};font-family:system-ui,sans-serif}` +
    `body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:0 24px}` +
    `</style></head><body><div style="font-size:13px;font-weight:600">Launcher 启动失败</div>` +
    `<div style="font-size:12px">界面资源没能加载完成：${safe}</div></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
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
    // 显式写出:窗口在隐藏期间仍要产出帧,否则「渲染层真的画出来了」这件事无从观测,
    // 整个显示门控就只能退回到计时器(见 services/boot-gate.ts)
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      // 首帧前把初始设置带进 preload(免同步 IPC、无主题/语言闪烁)
      additionalArguments: [`--launcher-initial-settings=${JSON.stringify(store.get())}`]
    }
  })
  console.log(`[boot] window created`)

  // 显示门控:窗口何时可以露出来,由渲染层的真实进度决定(rAF → 过渡页已上屏;应用 commit → 直接显示)
  bootGate = createBootGate({
    reveal: (reason) => {
      console.log(`[boot] reveal reason=${reason}`)
      revealMainWindow()
    },
    log: (m) => console.log(`[boot] ${m}`)
  })
  // 双 rAF = 至少有一帧已提交给合成器 —— 这是「马上 show 出去的那一帧里有东西」的唯一证明
  mainWindow.webContents.once('dom-ready', () => {
    void mainWindow?.webContents
      .executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
      .then(() => bootGate?.splashPainted())
      .catch(() => {
        /* 渲染层异常:交给 watchdog 兜底显示 */
      })
  })
  // 加载失败:换成主题化的错误页再显示(绝不让「失败」变成一块白)
  mainWindow.webContents.on('did-fail-load', (_e, _code, desc, _url, isMainFrame) => {
    if (!isMainFrame) return
    void mainWindow?.loadURL(bootErrorPage(desc)).then(() => bootGate?.fail())
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

  // 只作诊断:显示时机由 bootGate 决定(ready-to-show 可能在「文档里什么都没有」时也触发,
  // 它是否等于「首帧已绘制」在 Electron 里无法从代码侧证实 —— 而 2026-09-23 的白屏正说明不能赌它)
  mainWindow.on('ready-to-show', () => {
    console.log('[boot] ready-to-show')
  })

  mainWindow.on('closed', () => {
    bootGate?.dispose()
    bootGate = null
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
 *
 * ⚠ 启动还没就绪时**不能**直接 show:那会在渲染层什么都没画的时候露出窗口底色(浅色主题下
 * 就是白屏 —— 首次安装后用户在「半天没反应」的几秒里再点一次图标正是这条路径)。
 * 未就绪则交给门控挂起,等渲染层信号或 watchdog。
 */
function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (bootGate && !bootGate.isRevealed()) {
      bootGate.requestReveal()
      return
    }
    revealMainWindow()
    return
  }
  if (app.isReady()) createWindow() // ready 前 store 尚未初始化,建窗会抛
}

app.whenReady().then(async () => {
  // 启动序:设置加载 → applier 注册表副作用(themeSource/Tray/Dock/登录项/目录监听) → 建窗 → IPC
  store = createSettingsStore(
    e2eUserData ? join(e2eUserData, 'config.json') : defaultConfigPath(app.getPath('home'))
  )
  const trayCtl = createTrayController({ logoDir, getWindow: () => mainWindow, revealWindow: showMainWindow })
  const ctx: ApplyCtx = {
    logoDir,
    getWindow: () => mainWindow,
    revealWindow: showMainWindow,
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
  // ⚠ 只**发起**不 await —— `brew list --cask` 冷启动可达数秒,挡在建窗之前等于让用户干等
  // 一个连窗口都没有的启动;消费者(app:info / app:checkUpdates)各自 await 这个 promise。
  const installChannel = detectInstallChannel({ runner })

  // AI 助手(阶段 4):pi 引擎 + ToolRegistry + 内置会话;MCP HTTP 端点同批启动
  const ai = createAiStack({
    store,
    services: { plists, agents, cron, discovery, termination, docker, launchctl, brew },
    home: app.getPath('home'),
    userDataDir: app.getPath('userData'),
    emit: (ev) => broadcast(IPC_EVENTS.aiRunEvent, ev)
  })

  // ⚠ 顺序有两处硬约束,别顺手调换:
  //   · registry.apply()(themeSource / Tray / Dock / 登录项 / fs.watch)必须在建窗**之前** ——
  //     否则窗口底色会跟随系统外观而不是应用主题;
  //   · registerIpc() 也必须在建窗**之前** —— 渲染层启动瞬间就会调 settings:get / agents:list。
  registerIpc({
    store,
    tray: trayCtl,
    agents,
    cron,
    discovery,
    termination,
    docker,
    getInstallChannel: () => installChannel,
    ai
  })

  createWindow()

  // MCP 端点起服放在建窗之后:它只影响 MCP 客户端,不该拖慢首屏;
  // 顺带修掉「抛错 → whenReady 回调 unhandled rejection → 整个启动序中断」的隐患
  void ai.start().catch((err) => console.error('[mcp] 启动失败', err))

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
