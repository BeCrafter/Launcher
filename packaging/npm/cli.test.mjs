// CLI 冒烟测试：真的把 cli.mjs 跑起来，逐个子命令过一遍。
//
// 为什么需要它：lib.test.mjs 只覆盖纯函数，抓不到「入口里引用了不存在的函数」这类错误
// —— 那正是本项目真实踩过的（quitRunning 改名后漏改一处调用，纯函数测试全绿，
// 但 uninstall 直接抛 ReferenceError）。这里用 Node 的默认 unhandled-error 输出做断言。
//
// ⚠ 只测**离线安全**的路径：install 的真实下载由手工端到端验证，不放进单测。
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'

const exec = promisify(execFile)
const CLI = join(dirname(fileURLToPath(import.meta.url)), 'cli.mjs')
const EMPTY_DIR = mkdtempSync(join(tmpdir(), 'launcher-cli-smoke-'))
afterAll(() => rmSync(EMPTY_DIR, { recursive: true, force: true }))

/** 跑 CLI 并收拢结果；非零退出不抛，交给断言判断 */
async function cli(args) {
  try {
    const r = await exec(process.execPath, [CLI, ...args], { timeout: 20_000 })
    return { code: 0, out: r.stdout, err: r.stderr }
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : -1, out: e.stdout ?? '', err: e.stderr ?? '' }
  }
}

const CRASH = /is not defined|ReferenceError|TypeError|SyntaxError|Cannot find module/

describe('cli 冒烟', () => {
  it('--version 打印版本且退出 0', async () => {
    const r = await cli(['--version'])
    expect(r.code).toBe(0)
    expect(r.out.trim()).not.toBe('')
    expect(r.err).not.toMatch(CRASH)
  })

  it('--help / -h 打印用法且退出 0', async () => {
    for (const flag of ['--help', '-h']) {
      const r = await cli([flag])
      expect(r.code).toBe(0)
      expect(r.out).toMatch(/用法/)
      expect(r.err).not.toMatch(CRASH)
    }
  })

  it('uninstall 指向空目录：报「未发现」且退出 0（不误删别处）', async () => {
    const r = await cli(['uninstall', '--dir', EMPTY_DIR])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/未发现/)
    expect(r.err).not.toMatch(CRASH)
  })

  // 上一条会在 findInstalled 返回 null 后提前 return，走不到真正的删除分支。
  // 这条造一个假的 .app 让它走到底 —— 「改名漏改一处调用」那类 bug 就是这么漏掉的。
  it('uninstall 真的会走删除分支（空壳 .app 也要能清掉）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'launcher-cli-del-'))
    mkdirSync(join(dir, 'Launcher.app'), { recursive: true })
    try {
      const r = await cli(['uninstall', '--dir', dir])
      expect(r.code).toBe(0)
      expect(r.out).toMatch(/已卸载/)
      expect(r.err).not.toMatch(CRASH)
      expect(existsSync(join(dir, 'Launcher.app'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('status 对空壳 .app 不崩（Info.plist 缺失 → 版本未知）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'launcher-cli-st-'))
    mkdirSync(join(dir, 'Launcher.app'), { recursive: true })
    try {
      const r = await cli(['status', '--dir', dir])
      expect(r.code).toBe(0)
      expect(r.out).toMatch(/已安装\s+未知版本/)
      expect(r.err).not.toMatch(CRASH)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('status 离线也要正常收场（registry 取不到不是错误）', async () => {
    const r = await cli(['status', '--dir', EMPTY_DIR])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/本 CLI/)
    expect(r.err).not.toMatch(CRASH)
  })

  it('install 指向不可写目录：明确报错 + 退出 1（且不静默改道）', async () => {
    const r = await cli(['install', '--version', '0.1.0', '--dir', '/System/definitely-not-writable'])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/无法写入指定的安装目录/)
    expect(r.err).not.toMatch(CRASH)
  })

  it('参数错误退出 2，不是崩溃', async () => {
    for (const bad of [['bogus'], ['install', '--version'], ['install', '--dir'], ['install', '--nope']]) {
      const r = await cli(bad)
      expect(r.code, `${bad.join(' ')} 应退出 2`).toBe(2)
      expect(r.err).not.toMatch(CRASH)
    }
  })
})
