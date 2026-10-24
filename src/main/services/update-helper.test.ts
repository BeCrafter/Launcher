import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildHelperScript,
  consumeUpdateResult,
  markAppReady,
  parseUpdateResult,
  spawnUpdateHelper,
  updatePaths
} from './update-helper'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'launcher-helper-'))
  dirs.push(d)
  return d
}

const baseOpts = (userData: string) => {
  const paths = updatePaths(userData)
  return {
    mode: 'self' as const,
    appPath: '/Applications/My App/Launcher.app',
    pid: 1234,
    fromVersion: '0.2.2',
    toVersion: '0.3.0',
    paths,
    stagedApp: join(paths.dir, 'staging-0.3.0', 'Launcher.app'),
    backupApp: paths.backupApp
  }
}

describe('buildHelperScript', () => {
  it('路径经单引号编码(空格 / 单引号都不会逃逸)', () => {
    const userData = tmp()
    const opts = baseOpts(userData)
    opts.appPath = "/Applications/Bob's Apps/Launcher.app"
    const script = buildHelperScript(opts)

    // 带单引号的路径必须被编码成 '\'' 形式,不能直接拼进脚本
    expect(script).toContain(`APP='/Applications/Bob'\\''s Apps/Launcher.app'`)
    expect(script).toContain(`PID='1234'`)
    expect(script).toContain(`MODE='self'`)
  })

  it('self 模式包含备份 / 替换 / 回滚 / 结果落盘', () => {
    const script = buildHelperScript(baseOpts(tmp()))
    expect(script).toContain('mv "$APP" "$BACKUP"')
    expect(script).toContain('mv "$STAGED" "$APP"')
    expect(script).toContain('result installed "$FROM" "$TO" ""')
    expect(script).toContain('result rolled-back "$FROM" "$TO" ""')
    expect(script).toContain('result failed "$FROM" "$TO" ""')
    expect(script).toContain('ready.marker')
    // 等旧进程退出,不能一上来就替换正在运行的可执行文件
    expect(script).toContain('kill -0 "$PID"')
  })

  it('brew 模式执行 brew upgrade --cask,不自行搬包', () => {
    const userData = tmp()
    const paths = updatePaths(userData)
    const script = buildHelperScript({
      mode: 'brew',
      appPath: '/Applications/Launcher.app',
      pid: 9,
      fromVersion: '0.2.2',
      toVersion: '0.3.0',
      paths,
      brewPath: '/opt/homebrew/bin/brew',
      caskRef: 'becrafter/brew/launcher'
    })
    expect(script).toContain('"$BREW" upgrade --cask "$CASK"')
    expect(script).toContain(`BREW='/opt/homebrew/bin/brew'`)
    expect(script).not.toContain('mv "$STAGED" "$APP"')
  })

  it('两种模式的脚本都能通过 sh -n 语法检查', () => {
    for (const mode of ['self', 'brew'] as const) {
      const userData = tmp()
      const paths = updatePaths(userData)
      const script = buildHelperScript({
        ...baseOpts(userData),
        mode,
        brewPath: mode === 'brew' ? '/opt/homebrew/bin/brew' : null,
        caskRef: mode === 'brew' ? 'becrafter/brew/launcher' : null
      })
      const file = join(userData, `check-${mode}.sh`)
      writeFileSync(file, script)
      expect(() => execFileSync('/bin/sh', ['-n', file])).not.toThrow()
    }
  })
})

describe('parseUpdateResult', () => {
  it('解析 installed / rolled-back / failed', () => {
    expect(parseUpdateResult('installed\t0.2.2\t0.3.0\t\t1700000000\n')).toEqual({
      status: 'installed',
      from: '0.2.2',
      to: '0.3.0',
      backup: null,
      at: 1700000000 * 1000
    })
    expect(parseUpdateResult('rolled-back\t0.2.2\t0.3.0\t')).toMatchObject({
      status: 'rolled-back',
      backup: null,
      at: null
    })
    expect(parseUpdateResult('failed\t0.2.2\t0.3.0\t/tmp/backup\t1700000001')).toMatchObject({
      status: 'failed',
      backup: '/tmp/backup'
    })
  })

  it('空 / 未知状态 → null', () => {
    expect(parseUpdateResult('')).toBeNull()
    expect(parseUpdateResult('weird\t1\t2\t\t3')).toBeNull()
  })
})

describe('ready 标记与结果消费', () => {
  it('新版本启动写标记;结果只消费一次', () => {
    const userData = tmp()
    const paths = updatePaths(userData)
    markAppReady(userData, '0.3.0')
    expect(existsSync(paths.ready)).toBe(true)
    expect(readFileSync(paths.ready, 'utf8')).toContain('0.3.0')

    // 助手写结果 → 第一次消费读到并删除
    spawnUpdateHelper({
      ...baseOpts(userData),
      spawnImpl: (() => ({ unref: () => undefined })) as never
    })
    writeFileSync(paths.result, 'installed\t0.2.2\t0.3.0\t\t1700000000\n')
    expect(consumeUpdateResult(userData)).toMatchObject({ status: 'installed', to: '0.3.0' })
    expect(consumeUpdateResult(userData)).toBeNull()
  })
})

describe('spawnUpdateHelper', () => {
  it('写入 0700 脚本并以 detached 方式交给 /bin/sh', () => {
    const userData = tmp()
    const calls: { file: string; args: string[]; opts: Record<string, unknown> }[] = []
    const fakeSpawn = ((file: string, args: string[], opts: Record<string, unknown>) => {
      calls.push({ file, args, opts })
      return { unref: () => undefined }
    }) as never

    const r = spawnUpdateHelper({ ...baseOpts(userData), spawnImpl: fakeSpawn })
    expect(r.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].file).toBe('/bin/sh')
    expect(calls[0].args).toEqual([updatePaths(userData).helperScript])
    expect(calls[0].opts).toMatchObject({ detached: true, stdio: 'ignore' })
    expect(existsSync(updatePaths(userData).helperScript)).toBe(true)
  })

  it('写脚本失败 → 带回错误,不抛', () => {
    const r = spawnUpdateHelper({
      ...baseOpts('/dev/null/not-a-dir'),
      spawnImpl: (() => ({ unref: () => undefined })) as never
    })
    expect(r.ok).toBe(false)
  })
})
