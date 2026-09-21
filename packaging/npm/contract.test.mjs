// 安装契约的跨文件一致性。
//
// 三条通道的安装逻辑分处三个文件（bash / Node / CI），无法共用代码 —— 只能靠这组测试钉住
// 最容易漂移的几个常量。任何一侧单独改动都会在这里失败，而不是等到用户装出问题。
// 契约原文见 docs/design/distribution.md「安装契约」小节。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseArgs, zipUrl } from './lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const INSTALL_SH = read('scripts/install.sh')
const LIB = read('packaging/npm/lib.mjs')
const CLI = read('packaging/npm/cli.mjs')
const WORKFLOW = read('.github/workflows/release.yml')

const r2FromSh = () => /LAUNCHER_R2_BASE:-([^}"]+)/.exec(INSTALL_SH)?.[1]
const r2FromCli = () => /DEFAULT_R2_BASE = '([^']+)'/.exec(CLI)?.[1]

describe('安装契约三方一致', () => {
  it('R2 默认地址：install.sh 与 npm CLI 相同', () => {
    // 两个都断言非空，否则「双方都提取失败」会让 toBe(undefined) 假通过
    expect(r2FromSh()).toBeTruthy()
    expect(r2FromCli()).toBeTruthy()
    expect(r2FromCli()).toBe(r2FromSh())
    expect(r2FromCli()).toMatch(/^https:\/\//)
  })

  it('R2 路径前缀与 workflow 的 R2_PREFIX 相同', () => {
    const prefix = r2FromCli().split('/').pop()
    expect(WORKFLOW).toMatch(new RegExp(`R2_PREFIX: ${prefix}(\\s|$)`))
  })

  it('产物命名：bash 模板 与 zipUrl() 输出同形', () => {
    expect(INSTALL_SH).toContain('Launcher-${VERSION#v}-${ARCH}.zip')
    expect(INSTALL_SH).toContain('Launcher-latest-${ARCH}.zip')
    // 同一条规则在 Node 侧的实际输出
    expect(zipUrl('https://x/y', '0.1.0', 'arm64')).toBe('https://x/y/Launcher-0.1.0-arm64.zip')
    expect(zipUrl('https://x/y', 'v0.1.0', 'arm64')).toBe('https://x/y/Launcher-0.1.0-arm64.zip')
    expect(zipUrl('https://x/y', null, 'arm64')).toBe('https://x/y/Launcher-latest-arm64.zip')
  })

  it('解压一律 ditto（unzip 丢符号链接与扩展属性，会破坏 .app 签名）', () => {
    expect(INSTALL_SH).toMatch(/ditto -x -k/)
    expect(CLI).toMatch(/'\/usr\/bin\/ditto', \['-x', '-k'/)
  })

  it('装完都要清隔离标记', () => {
    expect(INSTALL_SH).toMatch(/xattr -dr com\.apple\.quarantine/)
    expect(CLI).toMatch(/'\/usr\/bin\/xattr', \['-dr', 'com\.apple\.quarantine'/)
  })

  it('安装目录回落顺序一致：/Applications → ~/Applications', () => {
    expect(INSTALL_SH).toMatch(/LAUNCHER_INSTALL_DIR:-\/Applications/)
    expect(INSTALL_SH).toMatch(/\$HOME\/Applications/)
    expect(CLI).toMatch(/DEFAULT_INSTALL_DIR = '\/Applications'/)
    expect(CLI).toMatch(/join\(homedir\(\), 'Applications'\)/)
  })

  it('架构判据同源：两侧都走 uname -m（不用 process.arch）', () => {
    expect(INSTALL_SH).toMatch(/uname -m/)
    expect(CLI).toMatch(/'\/usr\/bin\/uname', \['-m'\]/)
    // 兜底可以用 process.arch，但必须排在 uname 之后
    expect(CLI.indexOf('archOfUname(uname.stdout)')).toBeLessThan(CLI.indexOf('archOf(process.arch)'))
  })
})

// 「有哪些版本可装」是三通道共用的发现机制：清单是 cdn 上的静态文件 versions.txt，
// CI 发版时维护（见 release.yml 的「生成版本清单」步骤）。
// 两侧各写一份实现（bash / Node），文件路径与解析口径必须一致。
describe('版本发现两通道一致', () => {
  it('清单与产物同源：都落在 R2 根下的 versions.txt', () => {
    // Node 侧：常量 + 拼装函数（cli.mjs 只用 cdn 根调用，文件名由 lib 拼）
    expect(LIB).toContain("VERSIONS_PATH = '/versions.txt'")
    expect(LIB).toMatch(/const url = `\$\{String\(base\).*\}\$\{VERSIONS_PATH\}`/)
    expect(CLI).toMatch(/fetchReleases\(r2BaseUrl\(\)\)/)
    expect(CLI).not.toMatch(/`\$\{r2BaseUrl\(\)\}\/versions/) // 不许另拼一份地址
    // bash 侧：同一个根 + 同一个文件名
    expect(INSTALL_SH).toMatch(/\$R2_BASE\/versions\.txt/)
    // 不能再依赖公网 api（内网镜像只需镜像这个根目录）
    expect(INSTALL_SH).not.toMatch(/api\.github\.com/)
    expect(CLI).not.toMatch(/api\.github\.com/)
    expect(LIB).not.toMatch(/RELEASES_API_URL/)
  })

  it('清单由 CI 生成并上传（否则两条通道永远读到 404）', () => {
    expect(WORKFLOW).toMatch(/versions\.txt/)
    expect(WORKFLOW).toMatch(/R2_PREFIX\}\/versions\.txt/)
    expect(WORKFLOW).toMatch(/生成版本清单/)
  })

  it('latest 指针问法相同：都 HEAD 别名并看重定向后的最终 URL', () => {
    // install.sh 用 curl 的 url_effective；cli.mjs 走 lib.mjs 里的 HEAD + res.url
    expect(INSTALL_SH).toMatch(/url_effective/)
    expect(LIB).toMatch(/res\.url/)
    expect(LIB).toMatch(/versionFromDownloadUrl/)
  })

  it('status 问的 latest 就是 install 会装的那个对象（同一个 zipUrl 拼接）', () => {
    // 拼法必须复用 zipUrl，不能另写一份字符串拼接（否则改名时又漏一处）
    expect(CLI).toMatch(/fetchLatestVersion\(zipUrl\(r2BaseUrl\(\), null, arch\)\)/)
  })

  it('两侧都有 versions / --list 入口（用户不必为「有哪些版本」去翻网页）', () => {
    expect(INSTALL_SH).toMatch(/--list/)
    expect(INSTALL_SH).toMatch(/installed_version/)
    expect(parseArgs(['versions']).cmd).toBe('versions')
    expect(parseArgs(['versions', '--pre'])).toMatchObject({ pre: true })
  })
})
