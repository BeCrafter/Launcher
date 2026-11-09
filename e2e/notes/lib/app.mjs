// 启动 / 关闭用于 E2E 的 Electron 实例。
//
// 两条硬约束（都是以前踩过的坑,写在 src/main/index.ts 的注释里）:
//   1. **必须**用 `LAUNCHER_E2E_USER_DATA` 把 userData、设置文件、笔记目录一起隔离;
//      否则自动化会悄悄改掉用户真实的 ~/.config/launcher/config.json 与笔记。
//   2. 窗口被遮挡时 Chromium 会停掉 rAF,拖拽的贴边自动滚动就永远不触发。
//      所以固定带上三个 `--disable-*background*` 开关。
//
// 不走 electron-vite dev:dev 会占用用户的开发实例、还会受源码 watcher 影响。
// E2E 直接跑 `out/` 里的构建产物,cwd 是仓库根。

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CDP, sleep } from './cdp.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const ELECTRON_BINARY = 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'

/** 取一个空闲端口,避免和用户正在跑的调试实例撞车。 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(
    abs % 60
  )}`
}

/**
 * 写笔记文件。格式与 notes-service 落盘的一致:frontmatter + 空行 + 正文。
 * tags 省略;需要测标签时由用例自己通过界面添加。
 */
export function seedNotes(profileDir, notes) {
  const notesDir = join(profileDir, 'notes')
  mkdirSync(notesDir, { recursive: true })
  // 示例媒体:应用只在「笔记目录为空、需要写示例笔记」时才拷贝,而 E2E 目录不是空的。
  // 媒体用例（![[sample.png]]）需要它,由夹具自己保证。
  const assetsSrc = join(REPO_ROOT, 'resources/note-sample/assets')
  if (existsSync(assetsSrc)) {
    const assetsDst = join(notesDir, 'assets')
    mkdirSync(assetsDst, { recursive: true })
    for (const name of readdirSync(assetsSrc)) {
      const to = join(assetsDst, name)
      if (!existsSync(to)) cpSync(join(assetsSrc, name), to)
    }
  }
  const now = stamp()
  for (const note of notes) {
    const frontmatter = [`---`, `title: ${note.title}`, `created: ${now}`, `updated: ${now}`]
    if (note.tags !== undefined && note.tags.length > 0) {
      frontmatter.push(`tags: [${note.tags.join(', ')}]`)
    }
    frontmatter.push(`---`)
    const body = note.body.endsWith('\n') ? note.body : `${note.body}\n`
    writeFileSync(join(notesDir, note.file), `${frontmatter.join('\n')}\n${body}`)
  }
  return notesDir
}

/** 从笔记文件读回正文（去掉 frontmatter），用于验证自动保存。 */
export function readNoteBody(profileDir, file) {
  const path = join(profileDir, 'notes', file)
  if (!existsSync(path)) return null
  const raw = readFileSync(path, 'utf8')
  if (!raw.startsWith('---\n')) return raw
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return raw
  const after = raw.indexOf('\n', end + 4)
  return after < 0 ? '' : raw.slice(after + 1)
}

/**
 * 启动应用并返回可操作的句柄。
 * @param {{root: string, profileDir: string}} options
 */
export async function launchApp({ root, profileDir }) {
  const binary = join(root, ELECTRON_BINARY)
  if (!existsSync(binary)) throw new Error(`找不到 Electron:${binary}`)
  if (!existsSync(join(root, 'out/main/index.js'))) {
    throw new Error('out/ 不存在。先运行 `npm run build`（或 `npm run test:e2e:notes`）。')
  }
  mkdirSync(profileDir, { recursive: true })
  const port = await freePort()
  const logs = []
  const child = spawn(
    binary,
    [
      '.',
      `--remote-debugging-port=${port}`,
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows'
    ],
    {
      cwd: root,
      env: { ...process.env, LAUNCHER_E2E_USER_DATA: profileDir },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  const record = (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim() === '') continue
      // fswatch 的噪音会淹没真正有用的日志
      if (line.includes('change detected:')) continue
      logs.push(line)
      if (logs.length > 400) logs.shift()
    }
  }
  child.stdout.on('data', record)
  child.stderr.on('data', record)

  const page = await waitForPage(port, child, logs)
  const cdp = new CDP(page.webSocketDebuggerUrl)
  await cdp.open()

  return {
    cdp,
    port,
    profileDir,
    logs,
    get pid() {
      return child.pid
    },
    async stop() {
      cdp.close()
      await stopChild(child)
    }
  }
}

async function waitForPage(port, child, logs) {
  const deadline = Date.now() + 25_000
  let lastError = null
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Electron 提前退出（code=${child.exitCode}）\n${logs.slice(-30).join('\n')}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const pages = await response.json()
        const page = pages.find(
          (candidate) => candidate.type === 'page' && candidate.url.includes('out/renderer')
        )
        if (page !== undefined) return page
      }
    } catch (error) {
      lastError = error
    }
    await sleep(150)
  }
  const suffix = lastError === null ? '' : `（最后一次错误：${lastError.message}）`
  throw new Error(`等待页面超时${suffix}\n${logs.slice(-30).join('\n')}`)
}

async function stopChild(child) {
  if (child.exitCode !== null) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    sleep(4000).then(() => false)
  ])
  if (exited) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(2000)
  ])
}
