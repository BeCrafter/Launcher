#!/usr/bin/env node
// 生成单个版本的更新清单 `Launcher-<版本>.json`(应用内升级读它)。
//
//   node scripts/release-manifest.mjs --version 0.3.0 --dir dist
//   node scripts/release-manifest.mjs --version 0.3.0 --dir dist --out /tmp/Launcher-0.3.0.json
//
// 清单是**按版本不可变**的:一经上传就永远指向同一批 zip。最新版由 versions.txt 决定,
// 因此不存在可变的 latest.json(见 src/main/services/update-manifest.ts 的说明)。
//
// 发布顺序(CI 必须遵守):先传 zip → 再传清单 → 最后传 versions.txt。
// 应用只有在 versions.txt 里看到新版本后才会去取清单;顺序反了会出现「知道有新版但清单 404」。

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const ARCHES = ['arm64', 'x64']

/** 流式 sha256(产物 ~120MB,不整份读进内存) */
export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

/** 从 electron-builder.yml 读最低系统版本,避免清单与打包配置各写一份 */
export async function readMinimumSystemVersion(ymlPath = join(ROOT, 'electron-builder.yml')) {
  const text = await readFile(ymlPath, 'utf8')
  const m = /^\s*minimumSystemVersion:\s*["']?([^"'\s]+)["']?\s*$/m.exec(text)
  if (!m) throw new Error(`${ymlPath} 里没找到 minimumSystemVersion`)
  return m[1]
}

export function assertVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(version ?? ''))) {
    throw new Error(`版本号不合法:${JSON.stringify(version)}`)
  }
}

/**
 * 由 dist 里已有的 zip 生成清单对象。
 * 缺任一架构的 zip 直接抛错 —— 只发一半的清单会让另一半用户升级失败。
 */
export async function buildManifest({ version, dir, minSystemVersion }) {
  assertVersion(version)
  if (!minSystemVersion) throw new Error('缺少 minSystemVersion')

  const files = {}
  for (const arch of ARCHES) {
    const name = `Launcher-${version}-${arch}.zip`
    const path = join(dir, name)
    let st
    try {
      st = await stat(path)
    } catch {
      throw new Error(`缺少产物 ${path}`)
    }
    if (!st.isFile() || st.size <= 0) throw new Error(`产物不是有效文件:${path}`)
    files[arch] = { path: name, sha256: await sha256File(path), size: st.size }
  }

  return { version, minSystemVersion, files }
}

// ── CLI ──
async function main() {
  const argv = process.argv.slice(2)
  const value = (name, fallback) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : fallback
  }
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log('用法:node scripts/release-manifest.mjs --version <x.y.z> [--dir dist] [--out <file>]')
    return
  }
  const version = value('--version')
  if (!version) throw new Error('缺少 --version')
  const dir = value('--dir', join(ROOT, 'dist'))
  const out = value('--out', join(dir, `Launcher-${version}.json`))
  const minSystemVersion = await readMinimumSystemVersion()
  const manifest = await buildManifest({ version, dir, minSystemVersion })
  await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`✓ ${out}`)
  for (const arch of ARCHES) {
    const f = manifest.files[arch]
    console.log(`  ${arch}: ${f.path}  ${f.size} bytes  sha256=${f.sha256}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n  ✗ ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}
