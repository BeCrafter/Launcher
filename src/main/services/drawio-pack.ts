// draw.io 离线资源包:按需下载官方 draw.war、校验、只取 webapp/ 静态资源并原子落盘。
//
// 资源包不随安装包分发:首次从在线切离线时下载到 userData/drawio/v<版本>/。
// 这里不执行包里的任何东西,只把它当静态文件交给 launcher-drawio:// 协议。
// 安全线:
//   ① 只认固定版本 + GitHub release 给的 sha256(手动导入例外,记录实际哈希);
//   ② 只解 webapp/ 下的静态资源,跳过 WEB-INF/META-INF/JSP/class;
//   ③ 拒绝绝对路径与 ..,单文件/总量都有上限;
//   ④ 先解到临时目录,完整成功后才原子改名成正式版本目录 —— 失败/取消不会留下半个包。

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat, writeFile, type FileHandle } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import JSZip from 'jszip'
import {
  DRAWIO_PACK_BYTES,
  DRAWIO_PACK_DIR,
  DRAWIO_PACK_SHA256,
  DRAWIO_PACK_VERSION,
  drawioPackSources,
  type DrawioProgress,
  type DrawioStatus
} from '../../shared/drawio'

/** 单个资源文件上限(js/app.min.js 约 11MB;64MB 留足余量) */
const SINGLE_FILE_MAX = 64 * 1024 * 1024
/** 解压总量上限(drawio webapp 解压后约 100MB) */
const TOTAL_MAX = 512 * 1024 * 1024
/** 进度推送节流,避免 64KB 一块刷爆 IPC */
const PROGRESS_INTERVAL_MS = 120
/** 单个下载源等首字节的上限:连不上的镜像别把整次下载卡死 */
const FIRST_BYTE_TIMEOUT_MS = 12_000
/** 传输中两次收到数据的最长间隔:卡住的源及时换掉 */
const STALL_TIMEOUT_MS = 20_000

/** Electron net.fetch 与 Node fetch 的交集:只用 URL 字符串 + init 两个参数 */
export type DrawioFetch = (url: string, init?: RequestInit) => Promise<Response>

export interface DrawioPackDeps {
  /** 生产传 app.getPath('userData') */
  userDataDir: string
  /** E2E:没有真实资源包,由协议层提供 stub 页面 */
  stub?: boolean
  /** 生产传 Electron net.fetch(走系统代理);单测注入假实现 */
  fetchImpl?: DrawioFetch
  /** 单测替换下载源与期望摘要;生产一律用共享常量 */
  packUrls?: string[]
  expectedSha256?: string
  expectedBytes?: number
  log?: (message: string) => void
}

export interface DrawioDownloadOutcome {
  ok: boolean
  status: DrawioStatus
  message?: string
}

export interface DrawioPack {
  status: () => Promise<DrawioStatus>
  download: (onProgress?: (progress: DrawioProgress) => void) => Promise<DrawioStatus>
  cancel: () => void
  importWar: (warPath: string) => Promise<DrawioStatus>
  /** 版本目录:承载 launcher-drawio://app/v<版本>/ 的根 */
  versionDir: () => string
}

interface ReadyMarker {
  version: string
  sha256: string
  bytes: number
  source: 'download' | 'manual'
  installedAt: number
}

export function drawioRootDir(userDataDir: string): string {
  return join(userDataDir, 'drawio')
}

export function drawioVersionDir(userDataDir: string): string {
  return join(drawioRootDir(userDataDir), DRAWIO_PACK_DIR)
}

export function createDrawioPack(deps: DrawioPackDeps): DrawioPack {
  const root = drawioRootDir(deps.userDataDir)
  const versionDir = drawioVersionDir(deps.userDataDir)
  const markerPath = join(versionDir, '.ready.json')
  const log = deps.log ?? (() => {})
  const packUrls = deps.packUrls ?? drawioPackSources()
  const expectedSha256 = deps.expectedSha256 ?? DRAWIO_PACK_SHA256
  const expectedBytes = deps.expectedBytes ?? DRAWIO_PACK_BYTES
  let activeAbort: AbortController | null = null
  let downloading = false

  async function readMarker(): Promise<ReadyMarker | null> {
    try {
      const raw = await readFile(markerPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<ReadyMarker>
      if (parsed.version !== DRAWIO_PACK_VERSION) return null
      return parsed as ReadyMarker
    } catch {
      return null
    }
  }

  async function status(): Promise<DrawioStatus> {
    if (deps.stub === true) {
      return { installed: true, version: DRAWIO_PACK_VERSION, stub: true, downloading }
    }
    const marker = await readMarker()
    const installed =
      marker !== null && existsSync(join(versionDir, 'index.html'))
    return { installed, version: DRAWIO_PACK_VERSION, stub: false, downloading }
  }

  async function download(onProgress?: (progress: DrawioProgress) => void): Promise<DrawioStatus> {
    if (downloading) return status()
    const current = await status()
    if (current.installed) return current
    const fetchImpl = deps.fetchImpl
    if (fetchImpl === undefined) throw new Error('下载组件未初始化')

    downloading = true
    const abort = new AbortController()
    activeAbort = abort
    let tempDir: string | null = null
    let tempFile: string | null = null
    try {
      await mkdir(root, { recursive: true })
      let lastError: unknown = null
      let verified: { file: string; digest: string; bytes: number; sourceUrl: string } | null = null
      for (const [index, url] of packUrls.entries()) {
        if (abort.signal.aborted) throw abortError()
        if (index > 0) log(`换下载源:${url}`)
        const file = join(root, `.draw.war-${process.pid}-${Date.now()}-${index}`)
        tempFile = file
        try {
          const result = await fetchInto(url, file, {
            abort,
            expectedBytes,
            expectedSha256,
            onProgress
          })
          verified = { file, ...result, sourceUrl: url }
          tempFile = null // 由 verified 接管
          break
        } catch (err) {
          if (abort.signal.aborted) throw abortError()
          lastError = err
          log(`下载源失败(${url}):${err instanceof Error ? err.message : String(err)}`)
          await rm(file, { force: true }).catch(() => {})
          tempFile = null
        }
      }
      if (verified === null) {
        throw lastError instanceof Error ? lastError : new Error('下载失败:所有下载源都不可用')
      }
      log(`离线组件下载完成(来源:${verified.sourceUrl})`)
      onProgress?.({ phase: 'verify', received: verified.bytes, total: verified.bytes })
      await extractInto(verified.file, {
        onTempDir: (dir) => {
          tempDir = dir
        },
        marker: {
          version: DRAWIO_PACK_VERSION,
          sha256: verified.digest,
          bytes: verified.bytes,
          source: 'download',
          installedAt: Date.now()
        },
        onProgress,
        log
      })
      await rm(verified.file, { force: true })
      return await status()
    } catch (err) {
      if (tempDir !== null) await rm(tempDir, { recursive: true, force: true }).catch(() => {})
      if (tempFile !== null) await rm(tempFile, { force: true }).catch(() => {})
      throw err
    } finally {
      activeAbort = null
      downloading = false
      if (abort.signal.aborted) {
        // 调用方按取消处理,不再弹错误
        log('离线组件下载已取消')
      }
    }
  }

  function cancel(): void {
    activeAbort?.abort()
  }

  /**
   * 从单个下载源拉整个包到 path。
   * 镜像只负责传字节,**校验统一在这里做**:sha256 不符就把这个源判失败,交给调用方换下一个。
   * 首字节超时 / 传输停滞也只中止这一个源,不影响用户取消(用户取消走外层 abort)。
   */
  async function fetchInto(
    url: string,
    path: string,
    input: {
      abort: AbortController
      expectedBytes: number
      expectedSha256: string
      onProgress?: (progress: DrawioProgress) => void
    }
  ): Promise<{ digest: string; bytes: number }> {
    const fetchImpl = deps.fetchImpl
    if (fetchImpl === undefined) throw new Error('下载组件未初始化')
    const attempt = new AbortController()
    const onOuterAbort = (): void => attempt.abort()
    input.abort.signal.addEventListener('abort', onOuterAbort, { once: true })
    let timer: NodeJS.Timeout | null = null
    const arm = (ms: number): void => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => attempt.abort(), ms)
    }
    let fh: FileHandle | null = null
    try {
      arm(FIRST_BYTE_TIMEOUT_MS)
      const response = await fetchImpl(url, { signal: attempt.signal, redirect: 'follow' })
      if (!response.ok) throw new Error(`下载失败:HTTP ${response.status}`)
      if (response.body === null) throw new Error('下载失败:响应没有正文')
      const total = Number(response.headers.get('content-length') ?? 0) || input.expectedBytes
      const hash = createHash('sha256')
      let received = 0
      let lastReport = 0
      fh = await open(path, 'w')
      const reader = response.body.getReader()
      arm(STALL_TIMEOUT_MS)
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value === undefined) continue
        arm(STALL_TIMEOUT_MS)
        hash.update(value)
        await fh.write(value)
        received += value.byteLength
        const now = Date.now()
        if (input.onProgress !== undefined && now - lastReport >= PROGRESS_INTERVAL_MS) {
          lastReport = now
          input.onProgress({ phase: 'download', received, total })
        }
      }
      await fh.close()
      fh = null
      if (input.abort.signal.aborted) throw abortError()
      const digest = hash.digest('hex')
      if (digest !== input.expectedSha256) {
        throw new Error(`资源包校验失败(sha256 ${digest.slice(0, 12)}…)`)
      }
      return { digest, bytes: received }
    } catch (err) {
      if (input.abort.signal.aborted) throw abortError()
      // attempt 自己超时(不是用户取消):换个源继续,别把「慢」报成「下载失败」
      if (attempt.signal.aborted) throw new Error('下载超时')
      throw err
    } finally {
      if (timer !== null) clearTimeout(timer)
      input.abort.signal.removeEventListener('abort', onOuterAbort)
      if (fh !== null) await fh.close().catch(() => {})
    }
  }

  async function importWar(warPath: string): Promise<DrawioStatus> {
    if (downloading) throw new Error('正在下载离线组件,请稍后再导入')
    downloading = true
    let tempDir: string | null = null
    try {
      const info = await stat(warPath)
      if (!info.isFile()) throw new Error('不是 .war 文件')
      const bytes = await readFile(warPath)
      const digest = createHash('sha256').update(bytes).digest('hex')
      await extractInto(warPath, {
        bytes,
        onTempDir: (dir) => {
          tempDir = dir
        },
        marker: {
          version: DRAWIO_PACK_VERSION,
          sha256: digest,
          bytes: bytes.byteLength,
          source: 'manual',
          installedAt: Date.now()
        },
        log
      })
      return await status()
    } catch (err) {
      if (tempDir !== null) await rm(tempDir, { recursive: true, force: true }).catch(() => {})
      throw err
    } finally {
      downloading = false
    }
  }

  /**
   * 解到临时目录,写 marker,再原子改名成正式版本目录。
   * 旧目录只在完整解压成功后才删,所以中途失败不会损坏已装好的包。
   */
  async function extractInto(
    warPath: string,
    input: {
      bytes?: Buffer
      marker: ReadyMarker
      onTempDir: (dir: string) => void
      onProgress?: (progress: DrawioProgress) => void
      log: (message: string) => void
    }
  ): Promise<void> {
    const bytes = input.bytes ?? (await readFile(warPath))
    const temp = join(root, `.tmp-${process.pid}-${Date.now()}`)
    input.onTempDir(temp)
    await mkdir(temp, { recursive: true })
    const zip = await JSZip.loadAsync(bytes)
    // 两种包布局都要认:
    //   · 源码树打出来的 war:静态资源在 src/main/webapp/ 下(wars 里带 webapp/ 前缀)
    //   · GitHub release 的 draw.war:webapp 的内容**直接在压缩包根**
    //     (index.html / js/ / styles/ 与 WEB-INF/ 同级)
    const hasWebappPrefix = Object.keys(zip.files).some((name) =>
      name.replace(/\\/g, '/').startsWith('webapp/')
    )
    const prefix = hasWebappPrefix ? 'webapp/' : ''
    let total = 0
    let count = 0
    let hasIndex = false
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue
      const norm = name.replace(/\\/g, '/')
      if (prefix !== '' && !norm.startsWith(prefix)) continue
      const rel = norm.slice(prefix.length)
      if (rel === '') continue
      const segments = rel.split('/')
      if (segments.some((s) => s === '' || s === '.' || s === '..' || s.includes('\0'))) continue
      // 服务端代码/配置不进资源目录
      if (segments.some((s) => s === 'WEB-INF' || s === 'META-INF')) continue
      if (/\.(?:jsp|jspx|java|class|war)$/i.test(rel)) continue
      const data = await entry.async('uint8array')
      if (data.byteLength > SINGLE_FILE_MAX) {
        throw new Error(`资源包里的文件过大:${rel}`)
      }
      total += data.byteLength
      if (total > TOTAL_MAX) throw new Error('资源包解压后超过大小上限')
      const target = join(temp, ...segments)
      // join 后再确认一次仍在临时目录内(防编码/分隔符把路径带出去)
      if (!target.startsWith(temp + sep)) continue
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, data)
      count += 1
      if (rel === 'index.html') hasIndex = true
    }
    if (count === 0 || !hasIndex) throw new Error('资源包里没有 draw.io 的 index.html')
    await writeFile(join(temp, '.ready.json'), JSON.stringify(input.marker, null, 2), 'utf8')
    // 许可证/公告如果 WAR 根目录有,一起留在资源目录旁边
    for (const lic of ['LICENSE', 'NOTICE']) {
      const file = zip.file(lic)
      if (file !== null) await writeFile(join(temp, lic), await file.async('uint8array'))
    }
    input.onProgress?.({ phase: 'extract', received: total, total })
    await rm(versionDir, { recursive: true, force: true })
    await rename(temp, versionDir)
    input.log(`离线组件已安装到 ${versionDir}(${count} 个文件)`)
  }

  return { status, download, cancel, importWar, versionDir: () => versionDir }
}

function abortError(): Error {
  const err = new Error('已取消')
  err.name = 'AbortError'
  return err
}
