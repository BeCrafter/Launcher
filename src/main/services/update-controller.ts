// 应用内更新的状态机(main 持有,渲染层只是视图)。
//
// 阶段: idle → checking → available → downloading → verifying → ready → applying → restarting
// 旁路: upToDate / error。下载在检查命中后自动开始(用户点一次「检查升级」即可),
// ready 之后由界面倒计时自动重启,也可以手动点「重启并升级」。
//
// 为什么状态放在 main:离开设置页、窗口隐藏、渲染层重载都不该丢失进度;而且下载和替换
// 本来就不属于某个 React 组件的生命周期。渲染层通过 appUpdateChanged 事件拿到快照。
//
// 两条升级引擎(见 update-mode.ts):
//   · self —— 直接下载 zip(live 进度 + sha256),ditto 解压校验后交给助手脚本替换
//   · brew —— 准备阶段走 `brew update/fetch`,替换阶段走 `brew upgrade --cask`
//
// 没有 Apple 证书,所以这里**不做** codesign/spctl 门槛(它们必然失败);真实性靠 HTTPS +
// 清单 sha256,结构校验见 update-target.ts。

import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, promises as fsp, rmSync } from 'node:fs'
import type {
  InstallChannel,
  UpdateErrorCode,
  UpdatePhase,
  UpdateProgress,
  UpdateResultInfo,
  UpdateState
} from '../../shared/ipc'
import { UPGRADE_COMMAND } from '../../shared/ipc'
import { CASK_REF, prepareBrewUpdate } from './brew-update'
import {
  cleanupStaged,
  consumeUpdateResult,
  ensureUpdateDir,
  markAppReady,
  spawnUpdateHelper,
  updatePaths,
  type HelperScriptOptions
} from './update-helper'
import { artifactUrl, fetchUpdateManifest, type UpdateArch, type UpdateManifest } from './update-manifest'
import { resolveUpdateMode, type ResolvedUpdateMode } from './update-mode'
import type { ShellRunner } from './shell-runner'
import { checkForUpdate, compareVersions } from './update-check'
import { canReplaceBundle, validateAppBundle } from './update-target'

export interface UpdateControllerDeps {
  currentVersion: () => string
  /** process.getSystemVersion()(如 14.6.1),用于校验 LSMinimumSystemVersion */
  hostVersion: string
  arch: UpdateArch
  /** 当前运行的 .app;dev 下 null */
  bundlePath: string | null
  userDataDir: string
  runner: ShellRunner
  getChannel: () => Promise<InstallChannel>
  fetchImpl?: typeof fetch
  env?: NodeJS.ProcessEnv
  broadcast: (state: UpdateState) => void
  log?: (msg: string) => void
  quit: () => void
  /** 测试注入:替换真实的 detached 助手启动 */
  spawnHelper?: (opts: HelperScriptOptions) => { ok: true } | { ok: false; error: string }
  now?: () => number
  /** 测试注入:覆盖 versions.txt 地址 */
  versionsUrlOverride?: string
  /** 下载看门狗(长时间零字节时中止);默认 10 分钟 */
  stallTimeoutMs?: number
}

export interface UpdateController {
  getState(): UpdateState
  check(): Promise<UpdateState>
  download(): Promise<UpdateState>
  apply(): Promise<UpdateState>
  cancel(): Promise<UpdateState>
  consumeResult(): UpdateResultInfo | null
  logPath(): string | null
  /** 应用启动时调用:写 ready 标记,让升级助手知道新版本真的起来了 */
  onBoot(): void
  dispose(): void
}

const DOWNLOAD_STALL_MS = 10 * 60_000
const PROGRESS_EMIT_MS = 150

export function createUpdateController(deps: UpdateControllerDeps): UpdateController {
  const paths = updatePaths(deps.userDataDir)
  const log = deps.log ?? ((m: string): void => console.log(`[update] ${m}`))
  const now = deps.now ?? ((): number => Date.now())
  const env = deps.env ?? process.env
  const fetchImpl = deps.fetchImpl ?? fetch

  let phase: UpdatePhase = 'idle'
  let channel: InstallChannel = 'manual'
  let targetVersion: string | null = null
  let mode: UpdateState['mode'] = 'none'
  let progress: UpdateProgress | null = null
  let message: string | null = null
  let error: UpdateState['error'] = null
  let checkedAt: number | null = null
  let downloadSize: number | null = null
  let manifest: UpdateManifest | null = null
  let resolved: ResolvedUpdateMode | null = null

  let abort: AbortController | null = null
  /** 正在读响应体时,取消/超时要能打断 read(AbortSignal 在 net.fetch 上未必立刻生效) */
  let cancelRead: (() => void) | null = null
  let cancelRequested = false
  let quitTimer: NodeJS.Timeout | null = null

  const snapshot = (): UpdateState => ({
    phase,
    currentVersion: deps.currentVersion(),
    targetVersion,
    channel,
    mode,
    progress: progress ? { ...progress } : null,
    message,
    error: error ? { ...error } : null,
    fallbackCommand: UPGRADE_COMMAND[channel],
    checkedAt,
    downloadSize,
    canCheck: phase === 'idle' || phase === 'upToDate' || phase === 'available' || phase === 'error',
    canCancel: phase === 'downloading' || phase === 'verifying' || phase === 'ready',
    canApply: phase === 'ready'
  })

  const emit = (): void => {
    try {
      deps.broadcast(snapshot())
    } catch (err) {
      log(`广播状态失败:${String(err)}`)
    }
  }

  /** 追加一行升级日志(界面可「查看日志」);失败不影响主流程 */
  const logLine = (line: string): void => {
    const text = `${new Date().toISOString()} ${line}\n`
    log(line)
    try {
      ensureUpdateDir(paths)
      // 同步写:失败时紧接着要读 logFile() 并把路径交给界面,异步写会和这个判断赛跑
      appendFileSync(paths.log, text, 'utf8')
    } catch {
      /* ignore */
    }
  }

  const logFile = (): string | null => (existsSync(paths.log) ? paths.log : null)

  const fail = (code: UpdateErrorCode, reason: string): UpdateState => {
    phase = 'error'
    progress = null
    // 先落日志再取路径:首次失败时日志文件由这一行创建,顺序反了会拿到 null
    logLine(`失败(${code}):${reason}`)
    error = { code, message: reason, logPath: logFile() }
    emit()
    return snapshot()
  }

  const setProgress = (received: number, total: number | null): void => {
    const percent = total && total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null
    progress = { received, total, percent }
  }

  // ── 检查 ──
  async function check(): Promise<UpdateState> {
    // ready 也返回:此时已有下好的新版本,重新检查会把 targetVersion/manifest 清空,
    // 白白丢掉已完成的下载。要重查请先 cancel 回到 available。
    if (
      phase === 'checking' ||
      phase === 'downloading' ||
      phase === 'verifying' ||
      phase === 'ready' ||
      phase === 'applying' ||
      phase === 'restarting'
    ) {
      return snapshot()
    }

    phase = 'checking'
    error = null
    progress = null
    message = '正在检查新版本…'
    targetVersion = null
    downloadSize = null
    manifest = null
    resolved = null
    checkedAt = null
    emit()

    try {
      const detected = await deps.getChannel()
      channel = detected
      const r = await checkForUpdate(deps.currentVersion(), {
        channel: detected,
        fetchImpl,
        url: deps.versionsUrlOverride
      })

      if (r.status === 'error') {
        return fail('network', r.errorMessage ?? '检查更新失败')
      }
      checkedAt = now()

      if (r.status === 'noRelease') {
        phase = 'upToDate'
        message = '尚未发布任何版本'
        emit()
        return snapshot()
      }
      if (r.status === 'upToDate') {
        phase = 'upToDate'
        targetVersion = r.latest?.stable ?? r.latest?.version ?? null
        message = null
        emit()
        return snapshot()
      }

      // 只对**稳定版**做应用内升级:预发布不会出现在 Homebrew cask 里,
      // 也不该在用户没明确选择时被自动装进来。
      const target = r.latest?.stable
      if (!target) {
        phase = 'upToDate'
        message = '最新版本是预发布,未自动升级'
        emit()
        return snapshot()
      }

      targetVersion = target
      message = '正在确认升级方式…'
      emit()

      resolved = await resolveUpdateMode({
        channel: detected,
        bundlePath: deps.bundlePath,
        runner: deps.runner
      })
      mode = resolved.mode

      phase = 'available'
      message =
        mode === 'none'
          ? (resolved.reason ?? '当前安装位置不支持应用内升级')
          : `发现新版本 ${target}`
      error =
        mode === 'none'
          ? { code: 'unsupported', message: resolved.reason ?? '当前安装位置不支持应用内升级', logPath: logFile() }
          : null
      emit()

      if (mode !== 'none') {
        // 不 await:下载可能持续数分钟,IPC 调用应立即返回,进度走事件
        void download()
      }
      return snapshot()
    } catch (err) {
      return fail('unknown', err instanceof Error ? err.message : String(err))
    }
  }

  // ── 下载 ──
  async function download(): Promise<UpdateState> {
    if (!targetVersion || mode === 'none') return snapshot()
    if (phase !== 'available' && !(phase === 'error' && targetVersion !== null)) return snapshot()
    try {
      return mode === 'brew' ? await downloadBrew(targetVersion) : await downloadSelf(targetVersion)
    } catch (err) {
      return fail('unknown', err instanceof Error ? err.message : String(err))
    }
  }

  async function downloadSelf(target: string): Promise<UpdateState> {
    phase = 'downloading'
    error = null
    progress = { received: 0, total: null, percent: null }
    message = '正在获取版本清单…'
    emit()

    const m = await fetchUpdateManifest(target, {
      fetchImpl,
      env,
      timeoutMs: 20_000
    })
    // 取清单期间还没有 abort controller,取消在这里补一次,否则会「取消完又开始下载」
    if (cancelRequested) {
      cancelRequested = false
      phase = 'available'
      progress = null
      message = '已取消本次升级'
      logLine('已取消')
      emit()
      return snapshot()
    }
    if (!m.ok) return fail('manifest', m.error)
    manifest = m.manifest
    if (manifest.minSystemVersion && compareVersions(manifest.minSystemVersion, deps.hostVersion) > 0) {
      return fail('unsupported', `该版本要求 macOS ${manifest.minSystemVersion}+`)
    }

    const file = manifest.files[deps.arch]
    downloadSize = file.size
    const url = artifactUrl(file.path, env)
    const part = paths.part(target, deps.arch)
    const zip = paths.zip(target, deps.arch)
    try {
      ensureUpdateDir(paths)
      await fsp.rm(part, { force: true })
    } catch (err) {
      return fail(
        'permission',
        `无法写入更新目录:${err instanceof Error ? err.message : String(err)}`
      )
    }

    const controller = new AbortController()
    abort = controller
    cancelRequested = false
    const stall = setTimeout(() => {
      controller.abort()
      cancelRead?.()
    }, deps.stallTimeoutMs ?? DOWNLOAD_STALL_MS)
    let received = 0
    let lastEmit = 0
    const hash = createHash('sha256')

    message = `正在下载 ${file.path}…`
    setProgress(0, file.size)
    emit()

    let handle: Awaited<ReturnType<typeof fsp.open>> | null = null
    try {
      const res = await fetchImpl(url, { signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (!res.body) throw new Error('响应没有内容')

      const headerLen = Number(res.headers.get('content-length'))
      const total = Number.isFinite(headerLen) && headerLen > 0 ? headerLen : file.size
      handle = await fsp.open(part, 'w')

      // 用 reader 而不是 async iteration:Electron net.fetch 返回的 body 不保证实现
      // Symbol.asyncIterator,但 getReader() 是 Web Streams 标准接口。
      const reader = res.body.getReader()
      cancelRead = () => {
        void reader.cancel().catch(() => undefined)
      }
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (cancelRequested) throw new Error('下载已取消')
          if (done) break
          if (!value) continue
          const buf = Buffer.from(value)
          hash.update(buf)
          received += buf.length
          // FileHandle.write 可能短写;循环到整块落盘,否则文件尾会缺字节
          let off = 0
          while (off < buf.length) {
            const { bytesWritten } = await handle.write(buf, off, buf.length - off)
            if (bytesWritten <= 0) throw new Error('写入安装包失败')
            off += bytesWritten
          }
          setProgress(received, total)
          const t = now()
          if (t - lastEmit >= PROGRESS_EMIT_MS || received >= total) {
            lastEmit = t
            emit()
          }
        }
      } finally {
        cancelRead = null
      }
      await handle.sync()
      await handle.close()
      handle = null
    } catch (err) {
      if (handle) {
        await handle.close().catch(() => undefined)
      }
      cancelRead = null
      clearTimeout(stall)
      abort = null
      if (cancelRequested) {
        await fsp.rm(part, { force: true }).catch(() => undefined)
        cancelRequested = false
        phase = 'available'
        progress = null
        message = '已取消下载'
        logLine('下载已取消')
        emit()
        return snapshot()
      }
      const reason = controller.signal.aborted
        ? '下载超时(长时间没有数据)'
        : err instanceof Error
          ? err.message
          : String(err)
      return fail('download', reason)
    } finally {
      clearTimeout(stall)
      cancelRead = null
    }
    abort = null

    /** 下载/校验途中取消:清掉半成品,回到 available(ditto 不可中断,只能在步骤间观察) */
    const takeCancelled = async (): Promise<UpdateState | null> => {
      if (!cancelRequested) return null
      cancelRequested = false
      await fsp.rm(part, { force: true }).catch(() => undefined)
      await fsp.rm(zip, { force: true }).catch(() => undefined)
      cleanupStagedDir(target)
      phase = 'available'
      progress = null
      message = '已取消本次升级'
      logLine('已取消')
      emit()
      return snapshot()
    }
    {
      const c = await takeCancelled()
      if (c) return c
    }

    // ── 校验 ──
    phase = 'verifying'
    progress = { received, total: received, percent: 100 }
    message = '正在校验安装包…'
    emit()
    {
      // 下载收尾时点「取消」的话,在进入解压(不可中断)之前先处理掉
      const c = await takeCancelled()
      if (c) return c
    }

    const digest = hash.digest('hex')
    if (received !== file.size) {
      await fsp.rm(part, { force: true }).catch(() => undefined)
      return fail('verify', `安装包大小不符(收到 ${received} 字节,清单 ${file.size})`)
    }
    if (digest !== file.sha256) {
      await fsp.rm(part, { force: true }).catch(() => undefined)
      return fail('verify', '安装包 sha256 校验失败')
    }
    try {
      await fsp.rename(part, zip)
    } catch (err) {
      return fail('verify', `保存安装包失败:${err instanceof Error ? err.message : String(err)}`)
    }

    message = '正在解压…'
    emit()
    cleanupStagedDir(target)
    try {
      await fsp.mkdir(paths.stagingDir(target), { recursive: true })
    } catch (err) {
      return fail('verify', `无法创建解压目录:${err instanceof Error ? err.message : String(err)}`)
    }

    const ditto = await deps.runner.run('/usr/bin/ditto', ['-x', '-k', zip, paths.stagingDir(target)], {
      timeoutMs: 5 * 60_000
    })
    if (ditto.code !== 0 || ditto.error) {
      return fail('verify', `解压失败:${ditto.stderr.trim() || ditto.error || `退出码 ${ditto.code}`}`)
    }
    {
      const c = await takeCancelled()
      if (c) return c
    }

    const validated = await validateAppBundle(paths.stagedApp(target), {
      runner: deps.runner,
      expectedVersion: target,
      arch: deps.arch,
      hostVersion: deps.hostVersion
    })
    if (!validated.ok) {
      const code: UpdateErrorCode = validated.error.includes('macOS') ? 'unsupported' : 'verify'
      return fail(code, validated.error)
    }
    {
      const c = await takeCancelled()
      if (c) return c
    }

    phase = 'ready'
    progress = { received, total: received, percent: 100 }
    message = `新版本 ${target} 已准备就绪`
    logLine(`已准备就绪:${target}`)
    emit()
    return snapshot()
  }

  function cleanupStagedDir(target: string): void {
    try {
      rmSync(paths.stagingDir(target), { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }

  async function downloadBrew(target: string): Promise<UpdateState> {
    phase = 'downloading'
    cancelRequested = false
    error = null
    progress = null
    message = '正在准备 Homebrew 升级…'
    emit()

    const brewPath = resolved?.brewPath
    if (!brewPath) return fail('unsupported', '找不到 Homebrew')

    const r = await prepareBrewUpdate({
      brewPath,
      targetVersion: target,
      runner: deps.runner,
      onMessage: (m) => {
        message = m
        emit()
      }
    })
    // brew 的步骤不可中断,只能等当前命令结束后再响应取消
    if (cancelRequested) {
      cancelRequested = false
      phase = 'available'
      progress = null
      message = '已取消本次升级'
      logLine('已取消')
      emit()
      return snapshot()
    }
    if (!r.ok) {
      // tap 还没跟上(发版刚结束的几分钟):退回原地替换,不让用户卡在这里
      if (deps.bundlePath && canReplaceBundle(deps.bundlePath)) {
        logLine(`Homebrew 准备失败,改用应用内替换:${r.error}`)
        mode = 'self'
        return downloadSelf(target)
      }
      return fail('download', r.error)
    }

    phase = 'ready'
    message = `新版本 ${target} 已准备就绪(Homebrew)`
    logLine(`Homebrew 已准备就绪:${target}`)
    emit()
    return snapshot()
  }

  // ── 应用(退出并替换) ──
  async function apply(): Promise<UpdateState> {
    // 助手没启动起来时保留 ready 所需的文件,允许直接重试,不必再下载一遍
    const retryApply = phase === 'error' && error?.code === 'apply'
    if ((phase !== 'ready' && !retryApply) || !targetVersion || !deps.bundlePath) return snapshot()
    const target = targetVersion
    const appPath = deps.bundlePath
    const useBrew = mode === 'brew'

    if (!useBrew && !existsSync(paths.stagedApp(target))) {
      return fail('verify', '解压后的新版本已不存在,请重新检查更新')
    }

    phase = 'applying'
    error = null
    progress = null
    message = useBrew ? '正在退出并通过 Homebrew 升级…' : '正在退出并安装新版本…'
    emit()

    const opts: HelperScriptOptions = {
      mode: useBrew ? 'brew' : 'self',
      appPath,
      pid: process.pid,
      fromVersion: deps.currentVersion(),
      toVersion: target,
      paths,
      stagedApp: useBrew ? null : paths.stagedApp(target),
      backupApp: paths.backupApp,
      brewPath: resolved?.brewPath ?? null,
      caskRef: CASK_REF
    }

    const spawn = deps.spawnHelper ?? spawnUpdateHelper
    const spawned = spawn(opts)
    if (!spawned.ok) return fail('apply', spawned.error)

    phase = 'restarting'
    message = '应用即将退出,升级完成后会自动重新打开'
    logLine(`开始替换:${appPath} (${useBrew ? 'brew' : 'self'})`)
    emit()

    // 留一点时间把 restarting 状态推给渲染层,再退出
    quitTimer = setTimeout(() => deps.quit(), 600)
    quitTimer.unref?.()
    return snapshot()
  }

  // ── 取消 ──
  async function cancel(): Promise<UpdateState> {
    if (phase === 'downloading' || phase === 'verifying') {
      cancelRequested = true
      if (phase === 'downloading' && !abort) {
        // brew update/fetch 与清单请求都没有可用的 abort;先把「正在取消」告诉界面
        message = mode === 'brew' ? '正在取消(等待 Homebrew 当前步骤结束)…' : '正在取消…'
        emit()
      }
      abort?.abort()
      cancelRead?.()
      return snapshot()
    }
    if (phase === 'ready') {
      if (targetVersion) {
        cleanupStaged(paths, targetVersion, deps.arch)
        cleanupStagedDir(targetVersion)
      }
      manifest = null
      progress = null
      downloadSize = null
      phase = 'available'
      message = '已取消本次升级'
      emit()
    }
    return snapshot()
  }

  return {
    getState: snapshot,
    check,
    download,
    apply,
    cancel,
    consumeResult: () => consumeUpdateResult(deps.userDataDir),
    logPath: logFile,
    onBoot: () => markAppReady(deps.userDataDir, deps.currentVersion()),
    dispose: () => {
      cancelRequested = true
      abort?.abort()
      cancelRead?.()
      if (quitTimer) {
        clearTimeout(quitTimer)
        quitTimer = null
      }
    }
  }
}
