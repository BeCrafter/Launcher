import { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { APP_NAME } from '../shared/constants'
import { createSettingsStore, defaultConfigPath, type SettingsStore } from './settings/store'
import { applyDockIcon, applySettings } from './settings/apply'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let store: SettingsStore

// dev 自动化验证端口(如 CDP 交互测试);生产不生效
if (process.env['ELECTRON_RENDERER_URL'] && process.env['LAUNCHER_DEV_DEBUG_PORT']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['LAUNCHER_DEV_DEBUG_PORT'])
}

// 单实例锁：重复启动时唤起既有窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
})

function logoDir(): string {
  // dev：项目根 resources/；打包后：extraResources 释放到 Contents/Resources/logo
  const base = app.isPackaged
    ? join(process.resourcesPath, 'logo')
    : join(__dirname, '../../resources/logo')
  return base
}

// ── Tray（图标 = v2 星际火箭模板图，系统自动适配明暗菜单栏）──
function createTray(): void {
  if (tray) return
  const icon = nativeImage.createFromPath(join(logoDir(), 'iconTemplate.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip(APP_NAME)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: `显示 ${APP_NAME}`,
        click: () => {
          mainWindow?.show()
          mainWindow?.focus()
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
    }
  })
}

function destroyTray(): void {
  tray?.destroy()
  tray = null
}

// 主进程主题(含系统外观变化)变化 → Dock 图标随明暗切换
nativeTheme.on('updated', () => {
  applyDockIcon({ logoDir, createTray, destroyTray })
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 700,
    minHeight: 450,
    show: false,
    title: APP_NAME,
    backgroundColor: '#0e0e17', // 深色主题下避免白闪
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

app.whenReady().then(() => {
  // 启动序:设置加载 → 副作用(themeSource/Tray/Dock/登录项) → 建窗 → IPC
  store = createSettingsStore(defaultConfigPath(app.getPath('home')))
  const refs = { logoDir, createTray, destroyTray }
  applySettings(store.get(), refs)
  registerIpc(store)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
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
