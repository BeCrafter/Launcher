#!/usr/bin/env node
// 应用编译脚本：electron-vite 构建 → electron-builder 打包（arm64/x64/universal）→ 端到端架构验证
// 用法：
//   node scripts/build-app.mjs                    # 本机架构（native）+ 验证
//   node scripts/build-app.mjs --arch arm64       # 指定架构
//   node scripts/build-app.mjs --arch x64         # x64（arm 机器上经 Rosetta 运行验证）
//   node scripts/build-app.mjs --arch universal   # 双架构通用包（lipo 双段验证）
//   node scripts/build-app.mjs --arch all         # arm64 + x64 依次构建并分别验证
//   node scripts/build-app.mjs --no-run           # 跳过运行验证（仅静态架构检查）
//   node scripts/build-app.mjs --release          # 出 dmg + zip 发布产物（不传 --dir；产物名见 electron-builder.yml）
import { execFileSync, spawn } from 'node:child_process'
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// ── 架构名映射：electron-builder 参数名（arm64/x64/universal）vs lipo/ps 输出名（arm64/x86_64）──
const LIPO_ARCH = { arm64: ['arm64'], x64: ['x86_64'], universal: ['arm64', 'x86_64'] }
const HOST_LIPO = process.arch === 'arm64' ? 'arm64' : 'x86_64'
const productName = 'Launcher'

// ── 参数 ──
const argv = process.argv.slice(2)
const archIdx = argv.indexOf('--arch')
const archArg =
  (archIdx >= 0 && argv[archIdx + 1]) ||
  (argv.find((a) => a.startsWith('--arch=')) ?? '').split('=')[1] ||
  'native'
const skipRun = argv.includes('--no-run')
const release = argv.includes('--release')
const ARCH_TARGETS = {
  native: [process.arch === 'arm64' ? 'arm64' : 'x64'],
  arm64: ['arm64'],
  x64: ['x64'],
  universal: ['universal'],
  all: ['arm64', 'x64']
}
const targets = ARCH_TARGETS[archArg]
if (!targets) {
  console.error(`未知 --arch：${archArg}（可用 native|arm64|x64|universal|all）`)
  process.exit(1)
}

// ── electron 下载镜像兜底：env > .npmrc > npmmirror ──
const npmrc = join(ROOT, '.npmrc')
if (existsSync(npmrc)) {
  const m = readFileSync(npmrc, 'utf8').match(/electron_mirror\s*=\s*(\S+)/)
  if (m) process.env.ELECTRON_MIRROR ||= m[1]
}
process.env.ELECTRON_MIRROR ||= 'https://npmmirror.com/mirrors/electron/'
process.env.NPM_CONFIG_ELECTRON_MIRROR ||= process.env.ELECTRON_MIRROR

const sh = (cmd, args, opts = {}) => {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  return execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts })
}

// ── 0. 前置：打包图标（v2 星际火箭为项目唯一图标，浅色版作静态应用图标，
//        现场用 iconutil 生成标准 icns，不信任磁盘 icns 文件状态，杜绝陈旧/损坏 icns 进入打包）──
function pickLogo() {
  // 打包静态应用图标：紫调插画款固定用浅色版（icon-light.png，Finder/Dock 默认外观）
  const pngPath = join(ROOT, 'resources/logo/rocketOrbit2/icon-light.png')
  if (!existsSync(pngPath)) {
    throw new Error(`未找到图标资源：${pngPath}（先跑 npm run icon:theme）`)
  }
  return { variant: 'rocketOrbit2', pngPath }
}

const ICONSET_REPS = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]
function buildIcns(pngPath, outPath) {
  const iconset = join(tmpdir(), `launcher-build-icon.iconset`) // iconutil 要求目录以 .iconset 结尾
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset, { recursive: true })
  for (const [name, size] of ICONSET_REPS) {
    execFileSync('sips', ['-z', String(size), String(size), pngPath, '--out', join(iconset, name)], {
      stdio: 'pipe'
    })
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', outPath], { stdio: 'pipe' })
  rmSync(iconset, { recursive: true, force: true })
}

// bundle 内 icns 完整性：iconutil 能解出 ≥8 个尺寸表示才视为有效
function assertBundleIcon(appPath) {
  const icns = join(appPath, 'Contents/Resources/icon.icns')
  const tmp = join(tmpdir(), 'launcher-chk-icon.iconset')
  rmSync(tmp, { recursive: true, force: true })
  try {
    execFileSync('iconutil', ['-c', 'iconset', icns, '-o', tmp], { stdio: 'pipe' })
    const n = readdirSync(tmp).filter((f) => f.endsWith('.png')).length
    rmSync(tmp, { recursive: true, force: true })
    return n >= 8
  } catch {
    rmSync(tmp, { recursive: true, force: true })
    return false
  }
}

// ── 字体瘦身：Chromium 自 2015 起支持 woff2，@font-face 的 src 列表里排在 woff2 之后的
//    woff/ttf 兜底项永远不会被加载，但 Vite 会照抄 fontsource / FontAwesome 的 src 列表把
//    文件一并产出（实测 13MB）。此处按构建产物 CSS 的实际引用逐条判定后删除。
//    保守策略：首项不是 woff2 的规则整条跳过（宁可少删，不误删）──
function pruneLegacyFonts() {
  const assetsDir = join(ROOT, 'out/renderer/assets')
  if (!existsSync(assetsDir)) throw new Error(`未找到构建产物目录：${assetsDir}`)
  const cssFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.css'))
  if (cssFiles.length === 0) throw new Error(`${assetsDir} 下无 CSS 产物，构建是否成功？`)

  const legacy = new Set()
  for (const cssName of cssFiles) {
    const css = readFileSync(join(assetsDir, cssName), 'utf8')
    // 注：@font-face 在产物里既有 `@font-face{` 也有 `@font-face {`（带空格），且 src 里
    // 内联的 data URI 自带分号（data:font/woff2;base64,…）——故允许空白，且按块内切片而非按 ; 截断
    for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
      const at = block.indexOf('src:')
      if (at < 0) continue
      const urls = [...block.slice(at + 4).matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map((m) => m[2])
      // 首项须是 woff2（外链文件或内联 data URI）；否则说明结构有变、可能真需要兜底格式 → 整条跳过
      const first = urls[0]
      if (!first || !(first.endsWith('.woff2') || first.startsWith('data:font/woff2'))) continue
      for (const u of urls.slice(1)) {
        if (!u.startsWith('data:')) legacy.add(u) // data URI 兜底已内联进 CSS（实测仅 42KB），不处理
      }
    }
  }

  let count = 0
  let bytes = 0
  for (const rel of legacy) {
    const abs = resolve(assetsDir, rel)
    // url 可能指向 assets 之外（如 ../webfonts/x）——不越界处理，避免误删源码目录
    if (!abs.startsWith(assetsDir + sep) || !existsSync(abs)) continue
    bytes += statSync(abs).size
    rmSync(abs)
    count++
  }
  console.log(
    `  字体瘦身：删除 ${count} 个 legacy 字体（woff2 之后的兜底格式），释放 ${(bytes / 1048576).toFixed(1)}MB`
  )
  return { count, bytes }
}

// app.asar 内不应出现 node_modules：renderer 依赖由 Vite 打进 out/renderer，
// main/preload 只 import electron + node 内建。若此处 FAIL，多半是有人把构建期依赖
// 误加回了 package.json 的 dependencies —— electron-builder 会无条件收进 asar（实测 +181MB）。
// asar 布局：offset 0/4/8 为 pickle 头(uint32LE)，JSON 索引自 offset 16 起、长度取 offset 8。
function assertNoNodeModules(appPath) {
  const asarPath = join(appPath, 'Contents/Resources/app.asar')
  if (!existsSync(asarPath)) return { ok: false, reason: 'app.asar 不存在' }
  const sizeMB = statSync(asarPath).size / 1048576
  let header
  try {
    const fd = openSync(asarPath, 'r')
    try {
      const lenBuf = Buffer.alloc(4)
      readSync(fd, lenBuf, 0, 4, 8)
      const headerLen = lenBuf.readUInt32LE(0)
      header = Buffer.alloc(headerLen)
      const read = readSync(fd, header, 0, headerLen, 16)
      header = header.subarray(0, read).toString('utf8')
    } finally {
      closeSync(fd)
    }
  } catch (err) {
    return { ok: false, reason: `asar 头解析失败：${err.message}`, sizeMB }
  }
  const hit = header.includes('"node_modules"')
  return { ok: !hit, reason: hit ? 'asar 内含 node_modules' : '', sizeMB }
}

// ── 验证：Mach-O 架构 + 实际运行架构 ──
function lipoArchs(bin) {
  try {
    return execFileSync('lipo', ['-archs', bin], { encoding: 'utf8', cwd: ROOT }).trim()
  } catch {
    return ''
  }
}
function assertStaticArch(appPath, expected) {
  const exe = join(appPath, 'Contents/MacOS', productName)
  const framework = join(
    appPath,
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework'
  )
  const exeArchs = lipoArchs(exe)
  const fwArchs = lipoArchs(framework)
  const ok = expected.every((a) => exeArchs.includes(a)) && expected.every((a) => fwArchs.includes(a))
  console.log(
    `  静态架构：主 bin [${exeArchs}] Framework [${fwArchs}] 期望 [${expected.join(',')}] → ${ok ? 'PASS' : 'FAIL'}`
  )
  return ok
}
function assertRuntimeArch(appPath, expected) {
  const exe = join(appPath, 'Contents/MacOS', productName)
  let proc
  try {
    proc = spawn(exe, [], { stdio: 'ignore' })
  } catch (err) {
    return Promise.resolve({ ok: false, note: `spawn 失败（${err.code ?? err.message}）` })
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok, detail) => {
      if (settled) return
      settled = true
      try {
        process.kill(proc.pid, 'SIGTERM')
        setTimeout(() => {
          try {
            process.kill(proc.pid, 'SIGKILL')
          } catch {}
        }, 1500)
      } catch {}
      console.log(`  运行架构：${detail} → ${ok ? 'PASS' : 'FAIL'}`)
      resolve({ ok, note: detail })
    }
    const timer = setTimeout(() => finish(false, '启动超时（12s 未见进程）'), 12000)
    const start = Date.now()
    const poll = setInterval(() => {
      if (proc.exitCode !== null) {
        clearInterval(poll)
        clearTimeout(timer)
        finish(false, `进程退出 code=${proc.exitCode}`)
        return
      }
      if (Date.now() - start < 2000) return
      try {
        // macOS ps 无 arch 关键字：读进程 comm 路径，用 lipo 判定其实际架构
        const comm = execFileSync('ps', ['-o', 'comm=', '-p', String(proc.pid)], {
          encoding: 'utf8'
        }).trim()
        if (comm) {
          const archs = lipoArchs(comm)
          if (archs) {
            clearInterval(poll)
            clearTimeout(timer)
            finish(expected.includes(archs), `进程二进制 ${archs}（${comm.split('/').slice(-2).join('/')}）`)
          }
        }
      } catch {}
    }, 500)
    proc.on('error', (err) => {
      clearInterval(poll)
      clearTimeout(timer)
      finish(false, `进程错误（${err.code ?? err.message}）`)
    })
  })
}

// ── 主流程 ──
main()

async function main() {
  const { variant, pngPath } = pickLogo()
  mkdirSync(join(ROOT, 'build'), { recursive: true })
  buildIcns(pngPath, join(ROOT, 'build/icon.icns'))
  console.log(`[0] 图标：${variant}（${basename(pngPath)} → iconutil 现场生成 build/icon.icns）`)

  console.log('[1] electron-vite build')
  sh('npx', ['electron-vite', 'build'])

  console.log('[2] 构建产物瘦身')
  pruneLegacyFonts()

  let allPass = true
  for (const arch of targets) {
    console.log(`\n══════ arch=${arch} ══════`)
    const ebArgs = ['electron-builder', '--mac', `--${arch}`]
    // 默认 --dir 只出解包目录（快、供验证）；--release 时放开为 electron-builder.yml 的 dmg+zip
    if (!release) ebArgs.push('--dir')
    // ⚠ 必须显式 --publish never：HEAD 上有 git tag 时 electron-builder 会「隐式发布」到
    //   GitHub Releases（v26 的默认行为，v27 起改为必须显式指定），而 CI 里没有 GH_TOKEN，
    //   于是打包成功却以「GitHub Personal Access Token is not set」退出 1 —— 2026-09-22
    //   在 dev 流水线上踩到，正式流水线（release.yml 也是打 tag 触发）同一个雷。
    //   GitHub Release 由 workflow 的 softprops/action-gh-release 负责，R2 是单独的
    //   aws s3 cp 步骤，这里再发布一次只会重复、且必然失败。
    ebArgs.push('--publish', 'never')
    sh('npx', ebArgs)
    const appPath = join(
      ROOT,
      'dist',
      arch === 'arm64' ? 'mac-arm64' : arch === 'x64' ? 'mac' : 'mac-universal',
      `${productName}.app`
    )
    if (!existsSync(appPath)) {
      console.error(`  ✗ 产物缺失：${appPath}`)
      allPass = false
      continue
    }
    const expected = LIPO_ARCH[arch]
    const staticOk = assertStaticArch(appPath, expected)
    // 打包资源完整性：v2 图标集必须随 extraResources 进入 bundle（Tray/Dock 依赖）
    const resBase = join(appPath, 'Contents/Resources/logo')
    const resourcesOk =
      existsSync(join(resBase, 'icon.png')) &&
      existsSync(join(resBase, 'iconTemplate.png')) &&
      existsSync(join(resBase, 'icon-dark.png')) &&
      existsSync(join(resBase, 'icon-light.png'))
    console.log(
      `  打包资源：Contents/Resources/logo/（icon + tray template + theme icons）→ ${resourcesOk ? 'PASS' : 'FAIL'}`
    )
    // bundle 图标完整性：iconutil 解出 ≥8 尺寸表示（手写/损坏 icns 只有 3 个）
    const iconOk = assertBundleIcon(appPath)
    console.log(`  bundle 图标：Contents/Resources/icon.icns 完整尺寸表示 → ${iconOk ? 'PASS' : 'FAIL'}`)
    // asar 体积与内容：node_modules 一旦回潮，asar 会从 ~15MB 涨到 ~200MB
    const asar = assertNoNodeModules(appPath)
    console.log(
      `  asar 内容：${asar.sizeMB?.toFixed(1)}MB，不含 node_modules → ${asar.ok ? 'PASS' : `FAIL（${asar.reason}）`}`
    )
    let runOk = true
    let runNote = ''
    if (!skipRun) {
      const r = await assertRuntimeArch(appPath, arch === 'universal' ? [HOST_LIPO] : expected)
      if (r.ok) {
        runOk = true
      } else if (staticOk && !expected.includes(HOST_LIPO)) {
        // 主机架构不支持运行该产物（如 Intel 机上的 arm64 包）：静态 PASS 即通过，运行验证记为 SKIP
        runOk = true
        runNote = `${r.note}；主机 ${HOST_LIPO} 无法原生运行 ${arch} 产物，运行验证 SKIP（以静态验证为准）`
      } else {
        runOk = false
        runNote = r.note
      }
    } else {
      console.log('  运行验证：--no-run 跳过')
    }
    if (runNote) console.log(`  注：${runNote}`)
    const allOk = staticOk && resourcesOk && iconOk && asar.ok && runOk
    console.log(`\n  arch=${arch} 结论：${allOk ? '✅ PASS' : '❌ FAIL'}`)
    if (!allOk) allPass = false
  }
  console.log(`\n${allPass ? '✅ 全部架构构建与验证通过' : '❌ 存在失败项'}（产物目录 dist/）`)
  process.exit(allPass ? 0 : 1)
}
