import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, nativeTheme } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { APP_NAME } from '../shared/constants'

export const LOGO_VARIANTS = ['rocketOrbit', 'rocketOrbit2'] as const
export type LogoVariant = (typeof LOGO_VARIANTS)[number]

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let activeVariant: LogoVariant = 'rocketOrbit2'

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

// ── 设置持久化（userData/settings.json，阶段 5 并入正式 settings 模块）──
function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function loadSettings(): { logoVariant?: string } {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf8'))
  } catch {
    return {}
  }
}

function saveSettings(patch: Record<string, unknown>): void {
  const current = loadSettings()
  writeFileSync(settingsFile(), JSON.stringify({ ...current, ...patch }, null, 2))
}

function logoDir(v: LogoVariant): string {
  // dev：项目根 resources/；打包后：extraResources 释放到 Contents/Resources/logo
  const base = app.isPackaged
    ? join(process.resourcesPath, 'logo')
    : join(__dirname, '../../resources/logo')
  return join(base, v)
}

// ── Tray（图标 = 当前 variant 的模板图，系统自动适配明暗菜单栏）──
function createTray(): void {
  const iconPath = join(logoDir(activeVariant), 'iconTemplate.png')
  const icon = nativeImage.createFromPath(iconPath)
  icon.setTemplateImage(true)
  console.log(`[tray] path=${iconPath} empty=${icon.isEmpty()} size=${JSON.stringify(icon.getSize())}`)
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

// ── Logo 应用：Tray 重建 + Dock 图标 ──
// Dock 深浅主题：macOS 无原生自动切换，监听 nativeTheme（含「自动」跟随系统外观）
// 按 shouldUseDarkColors 在 icon-dark/light.png 间轮换；变体无双图时回退 icon.png。
function applyDockIcon(v: LogoVariant): void {
  if (process.platform !== 'darwin') return
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  const themed = join(logoDir(v), `icon-${theme}.png`)
  const iconPath = existsSync(themed) ? themed : join(logoDir(v), 'icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  if (!icon.isEmpty()) {
    app.dock?.setIcon(icon)
    console.log(`[dock] icon set (${v}, ${theme}${themed === iconPath ? '' : ', fallback'})`)
  }
}

function applyLogo(v: LogoVariant): void {
  activeVariant = v
  tray?.destroy()
  tray = null
  createTray()
  applyDockIcon(v)
}

nativeTheme.on('updated', () => applyDockIcon(activeVariant))

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 700,
    minHeight: 450,
    show: false,
    title: APP_NAME,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false
    }
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
            "document.getElementById('root')?.childElementCount ?? -1"
          )) as number
          console.log(`[dev-check] root children: ${result}`)
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

// ── IPC：Logo 变体（dev 期预览切换，阶段 5 并入设置页）──
ipcMain.handle('logo:list', () => [...LOGO_VARIANTS])
ipcMain.handle('logo:get', () => activeVariant)
ipcMain.handle('logo:set', (_e, v: string) => {
  if (!LOGO_VARIANTS.includes(v as LogoVariant)) throw new Error(`unknown logo variant: ${v}`)
  saveSettings({ logoVariant: v })
  applyLogo(v as LogoVariant)
  return v
})

ipcMain.handle('ping', () => 'pong')

app.whenReady().then(() => {
  const saved = loadSettings().logoVariant
  if (saved && LOGO_VARIANTS.includes(saved as LogoVariant)) {
    activeVariant = saved as LogoVariant
  }
  createWindow()
  applyLogo(activeVariant)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
