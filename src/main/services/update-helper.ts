// 升级助手:应用退出后才执行替换的独立 shell 脚本。
//
// 为什么必须独立进程:主进程一旦退出,它自己的 Node 事件循环也没了;而替换 .app 必须在
// 旧进程完全退出后进行(否则移动的是正在运行的可执行文件)。脚本以 detached 方式启动,
// 轮询旧 PID 消失后:
//   1. self —— 旧包移到备份 → 解压好的新包移到原路径 → 去隔离标记
//   2. brew —— 执行 `brew upgrade --cask`(Caskroom 记录由 brew 自己维护)
//   3. 新版本启动后写一个 ready 标记;助手等 30s,标记没出现就自动回滚并重新拉起旧版本
//
// 结果写 TSV 到 `<userData>/updates/result.tsv`,新版本(或回滚后的旧版本)启动时消费一次。
// 所有路径都经 shQuote 编码,脚本文件 0700 —— 脚本里不含任何未转义的用户数据。

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateArch, UpdateManifestFile } from './update-manifest'
import type { UpdateResultInfo } from '../../shared/ipc'
import { shQuote } from './elevation'

/** 助手等待新版本写 ready 标记的时长 */
export const READY_TIMEOUT_SEC = 30
/** 等待旧进程退出的时长(0.25s × 240 = 60s) */
const WAIT_TICKS = 240

export interface UpdatePaths {
  dir: string
  log: string
  result: string
  ready: string
  zip: (version: string, arch: UpdateArch) => string
  part: (version: string, arch: UpdateArch) => string
  stagingDir: (version: string) => string
  stagedApp: (version: string) => string
  backupApp: string
  helperScript: string
}

export function updatePaths(userDataDir: string): UpdatePaths {
  const dir = join(userDataDir, 'updates')
  return {
    dir,
    log: join(dir, 'update.log'),
    result: join(dir, 'result.tsv'),
    ready: join(dir, 'ready.marker'),
    zip: (version, arch) => join(dir, `Launcher-${version}-${arch}.zip`),
    part: (version, arch) => join(dir, `Launcher-${version}-${arch}.zip.part`),
    stagingDir: (version) => join(dir, `staging-${version}`),
    stagedApp: (version) => join(dir, `staging-${version}`, 'Launcher.app'),
    backupApp: join(dir, 'backup', 'Launcher.app'),
    helperScript: join(dir, 'apply-update.sh')
  }
}

/** 确保 updates 目录存在(日志、结果、ready 标记都写在这里) */
export function ensureUpdateDir(paths: UpdatePaths): void {
  mkdirSync(paths.dir, { recursive: true })
}

export interface HelperScriptOptions {
  mode: 'self' | 'brew'
  appPath: string
  pid: number
  fromVersion: string
  toVersion: string
  paths: UpdatePaths
  /** self:解压后的新 .app */
  stagedApp?: string | null
  /** self:旧包备份路径 */
  backupApp?: string | null
  /** brew:brew 可执行文件路径 */
  brewPath?: string | null
  /** brew:cask 全限定名 */
  caskRef?: string | null
}

/**
 * 生成助手脚本正文。**所有变量都走 shQuote**;脚本自身只使用常量命令名。
 * 导出成纯函数是为了单测能直接断言「路径被正确引用、回滚分支存在」。
 */
export function buildHelperScript(opts: HelperScriptOptions): string {
  const q = shQuote
  const mode = opts.mode
  const staged = opts.stagedApp ?? ''
  const backup = opts.backupApp ?? opts.paths.backupApp
  const brew = opts.brewPath ?? ''
  const cask = opts.caskRef ?? ''

  const selfBranch =
    mode === 'self'
      ? `
if [ -e "$APP" ]; then
  rm -rf "$BACKUP"
  mkdir -p "$(dirname "$BACKUP")"
  if ! mv "$APP" "$BACKUP" >> "$LOG" 2>&1; then
    log "无法移走旧版本(权限不足或应用仍在运行)"
    result failed "$FROM" "$TO" ""
    open "$APP" >> "$LOG" 2>&1 || true
    exit 1
  fi
fi
if ! mv "$STAGED" "$APP" >> "$LOG" 2>&1; then
  log "新版本写入失败,开始回滚"
  if [ -e "$BACKUP" ]; then
    # 新包可能只写了一半:$APP 若还在,mv 会把备份塞进它里面,必须先清掉
    rm -rf "$APP" >> "$LOG" 2>&1 || true
    mv "$BACKUP" "$APP" >> "$LOG" 2>&1 || true
  fi
  result failed "$FROM" "$TO" ""
  open "$APP" >> "$LOG" 2>&1 || true
  exit 1
fi
`
      : `
if ! "$BREW" upgrade --cask "$CASK" >> "$LOG" 2>&1; then
  log "brew upgrade 失败,重新打开现有版本"
  open "$APP" >> "$LOG" 2>&1 || true
  result failed "$FROM" "$TO" ""
  exit 1
fi
`

  const rollbackBranch =
    mode === 'self'
      ? `
if [ -e "$BACKUP" ]; then
  rm -rf "$APP.rollback-failed" >> "$LOG" 2>&1 || true
  mv "$APP" "$APP.rollback-failed" >> "$LOG" 2>&1 || rm -rf "$APP" >> "$LOG" 2>&1 || true
  if mv "$BACKUP" "$APP" >> "$LOG" 2>&1; then
    result rolled-back "$FROM" "$TO" ""
    log "已回滚到 $FROM"
    open "$APP" >> "$LOG" 2>&1 || true
  else
    log "回滚失败,原版本备份在 $BACKUP"
    result failed "$FROM" "$TO" "$BACKUP"
  fi
else
  log "找不到备份,无法回滚"
  result failed "$FROM" "$TO" ""
fi
`
      : `
log "Homebrew 升级后新版本未能启动;请运行 brew reinstall --cask $CASK 或从官网重装"
result failed "$FROM" "$TO" ""
`

  return `#!/bin/sh
# Launcher 升级助手 —— 由应用自动生成,勿手改(每次升级都会覆盖)
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH

MODE=${q(mode)}
APP=${q(opts.appPath)}
STAGED=${q(staged)}
BACKUP=${q(backup)}
BREW=${q(brew)}
CASK=${q(cask)}
PID=${q(String(opts.pid))}
FROM=${q(opts.fromVersion)}
TO=${q(opts.toVersion)}
LOG=${q(opts.paths.log)}
RESULT=${q(opts.paths.result)}
READY=${q(opts.paths.ready)}

log() { printf '%s %s\\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }
result() { printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$1" "$2" "$3" "$4" "$(date +%s)" > "$RESULT"; }

log "升级助手启动: $FROM -> $TO (mode=$MODE, pid=$PID)"

# 1. 等旧进程退出(最长 60s)
n=0
while kill -0 "$PID" 2>/dev/null; do
  n=$((n + 1))
  if [ "$n" -ge ${WAIT_TICKS} ]; then
    log "旧进程 60s 内没有退出,放弃升级"
    result failed "$FROM" "$TO" ""
    exit 1
  fi
  sleep 0.25
done

# 2. 清掉上一轮可能残留的 ready 标记,再执行替换
rm -f "$READY"
${selfBranch.trim()}
xattr -dr com.apple.quarantine "$APP" >> "$LOG" 2>&1 || true
chmod +x "$APP/Contents/Resources/launcher-mcp" >> "$LOG" 2>&1 || true

# 3. 先记录已替换,再拉起新版本
result installed "$FROM" "$TO" ""
open "$APP" >> "$LOG" 2>&1 || log "open 失败: $APP"
log "已替换并请求启动 $TO,等待 ready 标记(最长 ${READY_TIMEOUT_SEC}s)"

# 4. 看门狗:新版本没写 ready 标记 → 回滚
n=0
while [ "$n" -lt ${READY_TIMEOUT_SEC} ]; do
  if [ -s "$READY" ]; then
    log "新版本已启动"
    exit 0
  fi
  sleep 1
  n=$((n + 1))
done

log "新版本 ${READY_TIMEOUT_SEC}s 内未完成启动,开始回滚"
pkill -f "$APP/Contents/MacOS/Launcher" >> "$LOG" 2>&1 || true
sleep 1
${rollbackBranch.trim()}
`
}

export type HelperSpawnResult = { ok: true } | { ok: false; error: string }

/** 写入脚本并以 detached 方式启动;失败会把原因带回主进程(界面据此报错) */
export function spawnUpdateHelper(
  opts: HelperScriptOptions & { spawnImpl?: typeof spawn }
): HelperSpawnResult {
  const script = buildHelperScript(opts)
  try {
    ensureUpdateDir(opts.paths)
    writeFileSync(opts.paths.helperScript, script, { mode: 0o700 })
  } catch (err) {
    return { ok: false, error: `无法写入升级助手:${err instanceof Error ? err.message : String(err)}` }
  }

  const spawnImpl = opts.spawnImpl ?? spawn
  let child: ChildProcess
  try {
    child = spawnImpl('/bin/sh', [opts.paths.helperScript], {
      detached: true,
      stdio: 'ignore'
    })
  } catch (err) {
    return { ok: false, error: `无法启动升级助手:${err instanceof Error ? err.message : String(err)}` }
  }
  child.unref()
  return { ok: true }
}

/** 新版本启动时写 ready 标记(助手看到它就不再回滚) */
export function markAppReady(userDataDir: string, version: string): void {
  const paths = updatePaths(userDataDir)
  try {
    ensureUpdateDir(paths)
    writeFileSync(paths.ready, `${version}\n${process.pid}\n${Date.now()}\n`, 'utf8')
  } catch {
    /* 标记写不出来只会让助手误回滚;尽力而为,不阻断启动 */
  }
}

/** 解析结果文件(TSV:status from to backup at) */
export function parseUpdateResult(text: string): UpdateResultInfo | null {
  const line = String(text ?? '')
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean)
  if (!line) return null
  const [status, from, to, backup, at] = line.split('\t')
  if (status !== 'installed' && status !== 'rolled-back' && status !== 'failed') return null
  const ts = Number(at)
  return {
    status,
    from: from ?? '',
    to: to ?? '',
    backup: backup ? backup : null,
    at: Number.isFinite(ts) && ts > 0 ? ts * 1000 : null
  }
}

/** 读一次结果并删除文件(避免每次启动都重复提示) */
export function consumeUpdateResult(userDataDir: string): UpdateResultInfo | null {
  const paths = updatePaths(userDataDir)
  if (!existsSync(paths.result)) return null
  try {
    const parsed = parseUpdateResult(readFileSync(paths.result, 'utf8'))
    unlinkSync(paths.result)
    return parsed
  } catch {
    try {
      unlinkSync(paths.result)
    } catch {
      /* ignore */
    }
    return null
  }
}

/** 清理某版本的下载/解压残留(重试或取消时用) */
export function cleanupStaged(paths: UpdatePaths, version: string, arch: UpdateArch): void {
  for (const p of [paths.zip(version, arch), paths.part(version, arch)]) {
    try {
      if (existsSync(p)) unlinkSync(p)
    } catch {
      /* ignore */
    }
  }
}
