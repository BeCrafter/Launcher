// cdn 根地址的三处一致性。
//
// 应用（main 的 update-check）与两条 CLI（packaging/npm/lib.mjs、scripts/install.sh）各写一份
// cdn 根地址 —— 它们必须指向同一个地方，否则出现「通道装得到新版、应用却说没有」的分叉。
// 此前只有注释在管这件事，改一处漏另外两处不会有人发现，故在此钉死。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CDN_BASE, versionsUrl } from './update-check'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

describe('cdn 根地址三处一致', () => {
  it('应用 = npm CLI = install.sh', () => {
    const cli = /DEFAULT_R2_BASE = '([^']+)'/.exec(read('packaging/npm/cli.mjs'))?.[1]
    const sh = /LAUNCHER_R2_BASE:-([^}"]+)/.exec(read('scripts/install.sh'))?.[1]
    expect(cli).toBeTruthy()
    expect(sh).toBeTruthy()
    expect(CDN_BASE).toBe(cli)
    expect(CDN_BASE).toBe(sh)
    expect(CDN_BASE).toMatch(/^https:\/\//)
  })

  it('清单地址 = cdn 根 + versions.txt（与 CLI 侧的 VERSIONS_PATH 同名文件）', () => {
    expect(read('packaging/npm/lib.mjs')).toContain("VERSIONS_PATH = '/versions.txt'")
    expect(versionsUrl({})).toBe(`${CDN_BASE}/versions.txt`)
    // R2_PREFIX 与 workflow 里的一致（产物与清单都挂在它下面）
    const prefix = CDN_BASE.split('/').pop()
    expect(read('.github/workflows/release.yml')).toMatch(new RegExp(`R2_PREFIX: ${prefix}(\\s|$)`))
  })

  it('LAUNCHER_R2_BASE 覆盖三处同名同义（镜像 / 本地端到端验证都靠它）', () => {
    expect(versionsUrl({ LAUNCHER_R2_BASE: 'http://127.0.0.1:9/x/' })).toBe('http://127.0.0.1:9/x/versions.txt')
    expect(read('packaging/npm/lib.mjs')).toContain('VERSIONS_PATH')
    expect(read('scripts/install.sh')).toContain('LAUNCHER_R2_BASE')
  })

  it('发版流水线先传「按版本的更新清单」,再传 versions.txt', () => {
    const wf = read('.github/workflows/release.yml')
    // 清单由 dist 里的实际产物生成(与发布构建同源),不在 YAML 里另写拼装逻辑
    expect(wf).toContain('node scripts/release-manifest.mjs')
    expect(wf).toContain('dist/Launcher-${VERSION}.json')
    const manifestUpload = wf.indexOf('aws s3 cp "dist/Launcher-${VERSION}.json"')
    const versionsUpload = wf.indexOf('aws s3 cp versions.txt')
    expect(manifestUpload).toBeGreaterThan(-1)
    expect(versionsUpload).toBeGreaterThan(-1)
    // 反了的话,发版刚结束的窗口里应用会「知道有新版但清单 404」
    expect(manifestUpload).toBeLessThan(versionsUpload)
  })
})
