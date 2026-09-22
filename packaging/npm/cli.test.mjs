// CLI 冒烟测试：真的把 cli.mjs 跑起来，逐个子命令过一遍。
//
// 为什么需要它：lib.test.mjs 只覆盖纯函数，抓不到「入口里引用了不存在的函数」这类错误
// —— 那正是本项目真实踩过的（quitRunning 改名后漏改一处调用，纯函数测试全绿，
// 但 uninstall 直接抛 ReferenceError）。这里用 Node 的默认 unhandled-error 输出做断言。
//
// ⚠ 只测**离线安全**的路径：install 的真实下载由手工端到端验证，不放进单测。
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
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
async function cli(args, env = {}) {
  try {
    const r = await exec(process.execPath, [CLI, ...args], { timeout: 20_000, env: { ...process.env, ...env } })
    return { code: 0, out: r.stdout, err: r.stderr }
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : -1, out: e.stdout ?? '', err: e.stderr ?? '' }
  }
}

/** 死地址：让「取不到 cdn 内容」走确定的失败分支，测试不依赖公网也不受沙箱影响 */
const DEAD = { LAUNCHER_R2_BASE: 'http://127.0.0.1:1/launcher' }

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
      const r = await cli(['status', '--dir', dir], DEAD)
      expect(r.code).toBe(0)
      expect(r.out).toMatch(/已安装\s+未知版本/)
      expect(r.err).not.toMatch(CRASH)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('status 离线也要正常收场（仓库与 npm 都取不到不是错误）', async () => {
    const r = await cli(['status', '--dir', EMPTY_DIR], DEAD)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/仓库最新\s+\(未取到/)
    // npm 这条打的是公网 registry，测试环境可能通（→ 尚未发布）也可能不通（→ 未取到），两者都算正常收场
    expect(r.out).toMatch(/npm 包\s+\((未取到|尚未发布)/)
    expect(r.err).not.toMatch(CRASH)
  })

  it('versions 取不到列表：报错退出 1，且指出用的哪个地址', async () => {
    const r = await cli(['versions'], DEAD)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/取不到版本列表/)
    expect(r.err).toMatch(/127\.0\.0\.1:1/)
    expect(r.err).not.toMatch(CRASH)
  })

  // 正向路径：给一个本地 cdn 夹具（versions.txt + latest 别名重定向），验证读清单与版本比对的接线
  it('versions / status 读到真实清单时给出正确结论', async () => {
    const server = createServer((req, res) => {
      const path = new URL(req.url, 'http://x').pathname
      // 注意别在这里设 Connection: close —— 302 上带它会让 Node 的 fetch 不跟随重定向
      if (path.endsWith('/versions.txt')) {
        res.writeHead(200, { 'content-type': 'text/plain' })
        return res.end('0.4.0-rc.1 pre\n0.3.0\n0.1.0\n')
      }
      if (path.includes('Launcher-latest-')) {
        res.writeHead(302, { location: path.replace('latest', '0.3.0') })
        return res.end()
      }
      if (path.includes('Launcher-')) {
        // 别名重定向后的产物对象（真实 cdn 上它是存在的）
        res.writeHead(200, { 'content-type': 'application/zip' })
        return res.end()
      }
      res.writeHead(404).end('nope')
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const env = { LAUNCHER_R2_BASE: `http://127.0.0.1:${server.address().port}/launcher` }

    const dir = mkdtempSync(join(tmpdir(), 'launcher-cli-manifest-'))
    mkdirSync(join(dir, 'Launcher.app', 'Contents'), { recursive: true })
    writeFileSync(
      join(dir, 'Launcher.app', 'Contents', 'Info.plist'),
      '<plist><dict><key>CFBundleShortVersionString</key><string>0.1.0</string></dict></plist>'
    )
    try {
      const v = await cli(['versions'], env)
      expect(v.code).toBe(0)
      // 默认只列稳定版；预发布只报个数
      expect(v.out).toMatch(/0\.3\.0\s+\[最新\]/)
      expect(v.out).not.toMatch(/0\.4\.0-rc\.1/)
      expect(v.out).toMatch(/另有 1 个预发布/)

      const vp = await cli(['versions', '--pre'], env)
      expect(vp.out).toMatch(/0\.4\.0-rc\.1\s+\[预发布\]/)

      const st = await cli(['status', '--dir', dir], env)
      expect(st.code).toBe(0)
      expect(st.out).toMatch(/仓库最新\s+0\.3\.0/)
      expect(st.out).toMatch(/有新版：0\.1\.0 → 0\.3\.0/)
      expect(st.out).toMatch(/--version 0\.3\.0/)
      expect(st.err).not.toMatch(CRASH)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      server.close()
    }
    // 本用例起本地 HTTP 夹具并**三次 spawn CLI 子进程**,默认 5s 在机器忙时会假失败(实测反复出现)。
    // 给一个与真实代价相称的上限:仍然能抓住真正的挂死,但不再被负载抖动影响。
  }, 20_000)

  it('versions --json 同样在取不到时退出 1（不能输出半截 json）', async () => {
    const r = await cli(['versions', '--json'], DEAD)
    expect(r.code).toBe(1)
    expect(r.out).not.toMatch(/^\[/)
  })

  it('install 指向不可写目录：明确报错 + 退出 1（且不静默改道）', async () => {
    const r = await cli(['install', '--version', '0.1.0', '--dir', '/System/definitely-not-writable'])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/无法写入指定的安装目录/)
    expect(r.err).not.toMatch(CRASH)
  })

  it('参数错误退出 2，不是崩溃', async () => {
    for (const bad of [
      ['bogus'],
      ['install', '--version'],
      ['install', '--dir'],
      ['install', '--nope'],
      // --pre / --json 只对 versions 有意义，用在别处要报错而不是静默忽略
      ['status', '--pre'],
      ['install', '--json']
    ]) {
      const r = await cli(bad)
      expect(r.code, `${bad.join(' ')} 应退出 2`).toBe(2)
      expect(r.err).not.toMatch(CRASH)
    }
  })
})
