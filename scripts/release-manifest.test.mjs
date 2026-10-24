import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertVersion,
  buildManifest,
  readMinimumSystemVersion,
  sha256File
} from './release-manifest.mjs'

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function distWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-manifest-'))
  dirs.push(dir)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return dir
}

describe('release-manifest', () => {
  it('两个架构都生成 path / sha256 / size', async () => {
    const dir = distWith({
      'Launcher-0.3.0-arm64.zip': 'arm64-bytes',
      'Launcher-0.3.0-x64.zip': 'x64-bytes!'
    })
    const m = await buildManifest({ version: '0.3.0', dir, minSystemVersion: '12.0' })
    expect(m.version).toBe('0.3.0')
    expect(m.minSystemVersion).toBe('12.0')
    expect(m.files.arm64).toEqual({
      path: 'Launcher-0.3.0-arm64.zip',
      sha256: createHash('sha256').update('arm64-bytes').digest('hex'),
      size: Buffer.byteLength('arm64-bytes')
    })
    expect(m.files.x64.path).toBe('Launcher-0.3.0-x64.zip')
  })

  it('缺任一架构 → 抛错(不能发半份清单)', async () => {
    const dir = distWith({ 'Launcher-0.3.0-arm64.zip': 'a' })
    await expect(buildManifest({ version: '0.3.0', dir, minSystemVersion: '12.0' })).rejects.toThrow(
      /缺少产物/
    )
  })

  it('版本号非法 → 抛错', () => {
    expect(() => assertVersion('v0.3.0')).toThrow()
    expect(() => assertVersion('0.3')).toThrow()
    expect(() => assertVersion('0.4.0-rc.1')).not.toThrow()
  })

  it('sha256File 与 createHash 一致', async () => {
    const dir = distWith({ 'x.zip': 'hello' })
    expect(await sha256File(join(dir, 'x.zip'))).toBe(
      createHash('sha256').update('hello').digest('hex')
    )
  })

  it('最低系统版本从 electron-builder.yml 读(与打包配置同源)', async () => {
    expect(await readMinimumSystemVersion()).toBe('12.0')
  })
})
