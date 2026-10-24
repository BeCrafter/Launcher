#!/usr/bin/env node
// 发版前检查 —— 本地与 CI 共用同一份实现。
//
//   npm run release:check                    # 完整预检:当前工作区(含未提交改动)
//   npm run release:check -- --head          # 完整预检:仅 HEAD(忽略本地改动)
//   npm run release:check -- --quick         # 只做版本/tag/工作区检查(秒级)
//   npm run release:check -- --tag v0.2.0    # 完整预检,并额外校验 tag 一致性与占用
//   node scripts/release-check.mjs --version 0.2.0-rc.1 --emit   # CI:只校验版本并写出 IS_PRERELEASE
//
// 为什么默认是完整预检:本地 node_modules 是「养」出来的,会掩盖只在干净安装才出现的问题。
// 2026-10-21 的 v0.2.2 就是典型:npm ci 不装 Electron 二进制(44 起没有 postinstall),
// 而本地早就装好了,测试全绿;CI 上测试 import electron 时触发懒下载,GitHub 502,
// 整个测试文件在 import 阶段失败。完整预检默认导出**当前工作区**(含未提交改动、忽略
// .gitignore 的文件),从零 npm ci 后跑 typecheck / test / 发布构建 —— 依赖是干净的,
// 源码是你现在改的这份,不用先提交就能验证。想验「提交后到底会发什么」时加 --head。
//
// CI 用 --emit 调用时只做轻校验:CI 紧接着自己会跑 typecheck / test / build,
// 没必要在版本检查里再装一遍依赖。

import { execFileSync, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describePrereleaseEffects, validateVersion } from './release-version.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const hasFlag = (name) => argv.includes(name)
const argValue = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

function fail(message) {
  console.error(`\n  ✗ ${message}\n`)
  process.exit(1)
}

function usage() {
  console.log(
    [
      '',
      '  用法:npm run release:check [-- 选项]',
      '',
      '  选项:',
      '    --head        只检查已提交的 HEAD,忽略工作区改动(默认包含未提交改动)',
      '    --quick       只做版本/tag/工作区检查,跳过干净安装与构建',
      '    --version <v> 校验指定版本号(只做轻校验)',
      '    --tag <tag>   额外校验 tag 与版本一致、且未被占用',
      '    --keep-temp   保留完整预检的临时目录(默认成功后删除、失败时保留)',
      '    --emit        CI 用:把 IS_PRERELEASE 写进 $GITHUB_ENV',
      '    -h, --help    显示本帮助',
      ''
    ].join('\n')
  )
}

const VALUED = new Set(['--version', '--tag'])
const FLAGS = new Set(['--emit', '--head', '--quick', '--keep-temp', '--help', '-h'])
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (FLAGS.has(arg)) continue
  if (VALUED.has(arg)) {
    if (argv[i + 1] === undefined) fail(`${arg} 缺少参数`)
    i++
    continue
  }
  fail(`未知选项 ${arg}（--help 看用法）`)
}
if (hasFlag('--help') || hasFlag('-h')) {
  usage()
  process.exit(0)
}

const ciMode = hasFlag('--emit')
const headOnly = hasFlag('--head')
const keepTemp = hasFlag('--keep-temp')
// 指定 --version 时只校验这个号,不跑构建(构建读的是 package.json,和这个参数无关)
const quick = hasFlag('--quick') || ciMode || argValue('--version') !== undefined

const problems = []
const warnings = []
const notes = []

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...opts }).trim()
}

// ── 1. 版本号格式与预发布词 ──
let version = argValue('--version')
if (version === undefined) {
  // --head 校验的是「提交后会发什么」,版本号也要取 HEAD 里的,不能读本地改过的 package.json
  const pkg = headOnly
    ? JSON.parse(git(['show', 'HEAD:package.json']))
    : JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  version = pkg.version
}
const verdict = validateVersion(version)
if (!verdict.ok) {
  problems.push(verdict.reason)
}
notes.push(`版本号:${version}${verdict.ok ? '' : '  ← 非法'}`)
if (verdict.ok) notes.push(...describePrereleaseEffects(verdict.prerelease))

// ── 2. tag 校验(可选) ──
const tag = argValue('--tag')
if (tag !== undefined) {
  if (tag !== `v${version}`) {
    problems.push(`tag ${tag} 与版本 ${version} 不一致(应为 v${version})`)
  }
  try {
    git(['rev-parse', '-q', '--verify', `refs/tags/${tag}`])
    problems.push(`本地已存在 tag ${tag} —— 请先删除或改用新版本号`)
  } catch {
    // 不存在 = 期望情况
  }
  try {
    const remote = git(['ls-remote', '--tags', 'origin', tag])
    if (remote !== '') problems.push(`远端已存在 tag ${tag} —— 推送会覆盖/失败,请改用新版本号`)
  } catch {
    warnings.push('读不到远端 tag 列表(离线?)—— 远端占用情况未校验')
  }
}

// ── 3. 工作区状态 ──
// 完整预检会把未提交改动一起导出,所以脏工作区不再阻断;轻校验仍然提醒 ——
// CI 构建的是 tag 指向的 commit,没提交的改动不会跟着发出去。
let dirtyCount = 0
try {
  const dirty = git(['status', '--porcelain'])
  if (dirty !== '') {
    dirtyCount = dirty.split('\n').length
    if (quick) {
      warnings.push(
        headOnly
          ? `工作区有未提交改动(${dirtyCount} 项)—— 本次按 HEAD 检查,这些改动不会纳入`
          : `工作区有未提交改动(${dirtyCount} 项)—— 确认要发布的改动都已提交后再打 tag`
      )
    } else {
      notes.push(
        headOnly
          ? `工作区有未提交改动(${dirtyCount} 项)—— 本次按 HEAD 检查,这些改动不会纳入`
          : `工作区有未提交改动(${dirtyCount} 项)—— 完整预检会一并纳入`
      )
    }
  }
} catch {
  warnings.push('读不到 git 状态 —— 工作区是否干净未校验')
}

// ── 4. CI 模式:把预发布判定写进 $GITHUB_ENV 供后续步骤使用 ──
if (ciMode) {
  const target = process.env.GITHUB_ENV
  if (target) {
    appendFileSync(target, `IS_PRERELEASE=${verdict.ok && verdict.prerelease ? 'true' : 'false'}\n`)
  }
}

// ── 输出:先报轻校验结果,有问题立刻停,别白跑一次干净安装 ──
const indent = (s) => `  ${s}`
if (notes.length) console.log(notes.map(indent).join('\n'))
if (warnings.length) {
  console.log()
  for (const w of warnings) console.log(`  ⚠ ${w}`)
}
if (problems.length) {
  console.log()
  for (const p of problems) console.log(`  ✗ ${p}`)
  process.exit(1)
}
if (quick) {
  console.log('\n  ✓ 预检通过\n')
  process.exit(0)
}

// ── 完整预检:在 HEAD 的干净副本里重跑流水线的确定性步骤 ──
let tmp = null
let finished = false

function cleanup() {
  if (tmp === null) return
  if (keepTemp || !finished) {
    console.log(`\n  临时目录保留在:${tmp}`)
    console.log('  排查完可以手动删除\n')
    return
  }
  rmSync(tmp, { recursive: true, force: true })
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    cleanup()
    process.exit(130)
  })
}

function run(cmd, args, opts = {}) {
  console.log(`  $ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, CI: '1', ...opts.env },
    stdio: 'inherit'
  })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 退出码 ${r.status}`)
}

const timings = []
function stage(name, fn) {
  console.log(`\n▸ ${name}`)
  const started = Date.now()
  fn()
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  timings.push([name, seconds])
  console.log(`  ✓ ${name}（${seconds}s）`)
}

function preflight() {
  const head = git(['rev-parse', '--short', 'HEAD'])
  tmp = mkdtempSync(join(tmpdir(), 'launcher-preflight-'))
  const src = join(tmp, 'src')
  mkdirSync(src)

  console.log(`\n  基线 commit ${head}`)
  console.log(
    headOnly
      ? '  检查范围   仅 HEAD（本地未提交改动不纳入）'
      : `  检查范围   当前工作区${dirtyCount > 0 ? `（含 ${dirtyCount} 项未提交改动）` : '（与 HEAD 一致）'}`
  )
  console.log(`  干净副本   ${src}`)

  if (headOnly) {
    stage('导出 HEAD 到干净副本', () => {
      const tar = join(tmp, 'head.tar')
      run('git', ['archive', '--format=tar', '-o', tar, 'HEAD'])
      run('tar', ['-xf', tar, '-C', src])
      rmSync(tar)
    })
  } else {
    stage('导出工作区到干净副本', () => {
      // 用 git ls-files 列出「提交时会包含的文件」:已跟踪 + 未跟踪但未被 .gitignore 忽略。
      // 不直接 tar 整个目录,避免把 node_modules / out / dist 和本地私密文件带进来。
      const listed = execFileSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
      )
      const files = listed.split('\0').filter(Boolean).filter((rel) => {
        try {
          lstatSync(join(ROOT, rel))
          return true
        } catch {
          return false // 已删除但仍在 index 里的文件
        }
      })
      if (files.length === 0) throw new Error('工作区没有可导出的文件')

      const tar = join(tmp, 'worktree.tar')
      console.log('  $ git ls-files --cached --others --exclude-standard | tar -cf …')
      const r = spawnSync('tar', ['-cf', tar, '--null', '-T', '-', '-C', ROOT], {
        input: files.join('\0') + '\0',
        stdio: ['pipe', 'inherit', 'inherit']
      })
      if (r.error) throw r.error
      if (r.status !== 0) throw new Error(`tar 退出码 ${r.status}`)
      run('tar', ['-xf', tar, '-C', src])
      rmSync(tar)
    })
  }

  stage('干净安装依赖（npm ci）', () => {
    run('npm', ['ci'], { cwd: src })
  })

  // Electron 44 起没有 postinstall,二进制是 import 时懒下载的。干净安装后 path.txt 不应存在;
  // 测试跑完却出现,说明有测试绕过了 vitest 的 electron 桩、真的触发了下载。
  const electronMarker = join(src, 'node_modules/electron/path.txt')
  const hadElectron = existsSync(electronMarker)

  stage('类型检查', () => {
    run('npm', ['run', 'typecheck'], { cwd: src })
  })

  stage('单元测试', () => {
    run('npm', ['test'], { cwd: src })
  })

  if (!hadElectron && existsSync(electronMarker)) {
    throw new Error(
      '测试触发了 Electron 二进制下载 —— 有测试绕过了 vitest 的 electron 桩,请改用 vi.mock'
    )
  }

  stage('构建发布产物（arm64 + x64）', () => {
    run('node', ['scripts/build-app.mjs', '--arch', 'all', '--release', '--no-run'], {
      cwd: src,
      // 与 CI 对齐:runner 上没有签名身份,本地也不要因为自动发现证书而引入差异
      env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
    })
  })

  stage('校验产物文件齐全', () => {
    const builtVersion = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')).version
    const missing = []
    for (const arch of ['arm64', 'x64']) {
      for (const ext of ['zip', 'dmg']) {
        const file = join(src, 'dist', `Launcher-${builtVersion}-${arch}.${ext}`)
        if (!existsSync(file)) missing.push(file)
      }
    }
    if (missing.length > 0) throw new Error(`产物缺失:\n    ${missing.join('\n    ')}`)
  })

  // 应用内升级读的是 Launcher-<版本>.json;这里提前跑一遍 CI 用的同一份生成器,
  // 把「清单字段写错 / 少一个架构 / sha256 对不上」挡在发版之前。
  stage('生成并校验更新清单', () => {
    const builtVersion = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')).version
    run('node', ['scripts/release-manifest.mjs', '--version', builtVersion, '--dir', 'dist'], { cwd: src })

    const manifestPath = join(src, 'dist', `Launcher-${builtVersion}.json`)
    if (!existsSync(manifestPath)) throw new Error(`清单未生成:${manifestPath}`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.version !== builtVersion) {
      throw new Error(`清单版本 ${manifest.version} 与 package.json ${builtVersion} 不一致`)
    }
    if (typeof manifest.minSystemVersion !== 'string' || manifest.minSystemVersion === '') {
      throw new Error('清单缺少 minSystemVersion')
    }
    for (const arch of ['arm64', 'x64']) {
      const f = manifest.files?.[arch]
      if (!f || f.path !== `Launcher-${builtVersion}-${arch}.zip`) {
        throw new Error(`清单缺少 ${arch} 产物或文件名不符`)
      }
      const zip = join(src, 'dist', f.path)
      const size = lstatSync(zip).size
      if (f.size !== size) throw new Error(`${arch} 清单 size ${f.size} 与实际 ${size} 不一致`)
      const sha = execFileSync('/usr/bin/shasum', ['-a', '256', zip], { encoding: 'utf8' })
        .trim()
        .split(/\s+/)[0]
      if (f.sha256 !== sha) throw new Error(`${arch} 清单 sha256 与实际不一致`)
    }
  })
}

try {
  preflight()
  finished = true
} catch (err) {
  console.error(`\n  ✗ 预检失败:${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
} finally {
  cleanup()
}

if (process.exitCode) {
  console.log('  预检未通过,先修复再发版。\n')
  process.exit(process.exitCode)
}

console.log('\n──────── 预检结果 ────────')
for (const [name, seconds] of timings) console.log(`  ✓ ${name}  ${seconds}s`)
console.log('\n  ✓ 全部通过 —— 可以发版\n')
