#!/usr/bin/env node
// 发布版本 —— 本地唯一的发版入口：算号 → 预检 → (提交 package.json) → 打 tag → 推送 → 交给 CI。
//
//   npm run release:patch     0.1.0 → 0.1.1   正式版：release.yml 走 R2 + Homebrew cask + npm
//   npm run release:minor     0.1.0 → 0.2.0
//   npm run release:major     0.1.0 → 1.0.0
//   npm run release:dev       0.1.0 → 0.1.0-dev.1  测试版：dev-release.yml 只发 GitHub Release
//   npm run release:dev -- --base 0.2.0            指定 dev 基线（默认取最新正式版 tag）
//
// 正式版与测试版的差别不只是号：
//   · 正式版会**提交** package.json 的版本号（release.yml 断言 tag 与它一致），随后进三条分发通道
//   · 测试版**不提交**（版本号由 dev-release.yml 在 CI 里临时写进 package.json），只发 pre-release
//   为什么 dev 不能进分发通道，见 release-version.mjs 与 docs/design/distribution.md「预发布版本」。
//
// 选项：
//   --base <X.Y.Z>   dev 专用：指定基线
//   --tag <tag>      dev 专用：直接采用该 tag 的版本号（dev-release.yml 的 tag 触发路径用）
//   --print          只把算出的版本号打到 stdout 就退出（CI 用，不做检查、不改动任何东西）
//   --dry-run        只展示将要做什么，不提交/不打 tag/不推送
//   --no-verify      跳过 typecheck + test
//   --no-push        提交并打 tag，但不推送
//   -y, --yes        跳过确认

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import {
  BUMP_KINDS,
  bumpStable,
  isDevVersion,
  resolveDevVersion
} from './release-version.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = join(ROOT, 'package.json')
const REMOTE = 'origin'

// ── 小工具 ──
function git(args, { capture = true } = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit'
  })
}

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`)
  process.exit(1)
}

function step(msg) {
  console.log(`\n▸ ${msg}`)
}

function spawn(cmd, args) {
  console.log(`  $ ${cmd} ${args.join(' ')}`)
  const r = execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' })
  return r
}

function usage() {
  console.log(
    [
      '',
      '  用法：npm run release:<类型> [-- 选项]',
      '',
      `  类型：${[...BUMP_KINDS, 'dev'].join(' / ')}`,
      '    major   1.2.3 → 2.0.0     正式版',
      '    minor   1.2.3 → 1.3.0     正式版',
      '    patch   1.2.3 → 1.2.4     正式版',
      '    dev     0.1.0 → 0.1.0-dev.1  测试版（只发 GitHub Release）',
      '',
      '  选项：--base <X.Y.Z> | --tag <tag> | --print | --dry-run',
      '        --no-verify | --no-push | -y/--yes',
      ''
    ].join('\n')
  )
}

function parseArgs(argv) {
  const flags = new Set()
  const values = new Map()
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-y') flags.add('yes')
    else if (a === '-h') flags.add('help')
    else if (a.startsWith('--')) {
      const name = a.slice(2)
      if (['yes', 'help', 'print', 'dry-run', 'no-verify', 'no-push'].includes(name)) flags.add(name)
      else if (['base', 'tag'].includes(name)) values.set(name, argv[++i] ?? '')
      else fail(`未知选项 ${a}（--help 看用法）`)
    } else positional.push(a)
  }
  return { flags, values, positional }
}

const readPkg = () => JSON.parse(readFileSync(PKG, 'utf8'))

// 只替换 version 字段，避免整体 re-serialize 把 package.json 的格式搅乱
function writePkgVersion(version) {
  const src = readFileSync(PKG, 'utf8')
  const out = src.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`)
  if (out === src) fail('package.json 里没找到 version 字段')
  writeFileSync(PKG, out)
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(question)).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } catch (err) {
    // Ctrl+D / EOF 时 readline 会以 AbortError 拒绝 question 的 promise ——
    // 当作「取消」处理，别把栈打给用户看
    if (err instanceof Error && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) return false
    throw err
  } finally {
    rl.close()
  }
}

// ── 主流程 ──
const opts = parseArgs(process.argv.slice(2))
if (opts.flags.has('help')) {
  usage()
  process.exit(0)
}

const kind = opts.positional[0]
if (!kind) {
  usage()
  process.exit(1)
}
const targets = [...BUMP_KINDS, 'dev']
if (!targets.includes(kind)) fail(`未知的发布类型 ${kind}（可用：${targets.join(' / ')}）`)
if (opts.positional.length > 1) fail(`只认一个类型参数，多了：${opts.positional.slice(1).join(' ')}`)

const allTags = () =>
  git(['tag', '-l'])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

const pkgVersion = readPkg().version

// ── 算号（纯函数在 release-version.mjs，与 dev-release.yml 共用同一份实现）──
let version
let bumpsPkg
if (kind === 'dev') {
  if (opts.values.has('tag')) {
    version = String(opts.values.get('tag')).trim().replace(/^v/, '')
    if (!isDevVersion(version)) {
      fail(`--tag 须形如 vX.Y.Z-dev.N，收到 ${JSON.stringify(opts.values.get('tag'))}`)
    }
  } else {
    const r = resolveDevVersion({ tags: allTags(), base: opts.values.get('base'), fallback: pkgVersion })
    if (!r.ok) fail(r.reason)
    version = r.version
  }
  bumpsPkg = false
} else {
  const r = bumpStable(pkgVersion, kind)
  if (!r.ok) fail(r.reason)
  version = r.version
  bumpsPkg = true
}

// CI 只借这里的算法（dev-release.yml 的 dispatch 路径），到此为止
if (opts.flags.has('print')) {
  process.stdout.write(`${version}\n`)
  process.exit(0)
}

const tag = `v${version}`
const isDev = kind === 'dev'
const dryRun = opts.flags.has('dry-run')
const noPush = opts.flags.has('no-push')
const verify = !opts.flags.has('no-verify')

// ── 预检 ──
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()
if (branch === 'HEAD') fail('当前处于 detached HEAD，先切回 dev 分支')

const dirty = git(['status', '--porcelain']).trim()
if (dirty) {
  fail(
    `工作区有未提交改动（${dirty.split('\n').length} 项）——tag 会打在当前 commit 上，` +
      `产物里不会有你正在改的东西。先提交或 stash 再发版`
  )
}

if (git(['tag', '-l', tag]).trim() !== '') fail(`本地已存在 tag ${tag}，换一个版本号`)

try {
  const remote = git(['ls-remote', '--tags', REMOTE, tag]).trim()
  if (remote !== '') fail(`远端已存在 tag ${tag} —— 换一个版本号，或先删掉旧 tag`)
} catch {
  console.log(`  ⚠ 读不到远端 tag 列表（离线？）—— ${tag} 是否被占用未校验`)
}

const slug = (() => {
  try {
    const url = git(['remote', 'get-url', REMOTE]).trim()
    const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url)
    return m ? m[1] : null
  } catch {
    return null
  }
})()

// ── 展示将要做什么 ──
console.log('')
console.log(`  分支       ${branch}`)
console.log(`  当前版本   ${pkgVersion}（package.json）`)
console.log(`  目标版本   ${version}   ${isDev ? '（测试版）' : '（正式版）'}`)
console.log(`  标签       ${tag}`)
console.log('')
console.log('  将要执行：')
if (verify) console.log('    1. npm run typecheck && npm test')
if (bumpsPkg) console.log(`    ${verify ? 2 : 1}. 把 ${version} 写进 package.json 并提交`)
if (!noPush) {
  console.log(`    - git push ${REMOTE} ${branch}`)
  console.log(`    - git push ${REMOTE} ${tag}`)
}
console.log('')
if (isDev) {
  console.log('  触发 Dev Release：构建 arm64 + x64 → 发 GitHub Release（pre-release）')
  console.log('  不会触碰：Cloudflare R2 / Homebrew cask / npm')
} else {
  console.log('  触发 Release：构建 → 传 R2 → 更新 Homebrew cask → 发 npm → 发 GitHub Release')
}
console.log('')

if (dryRun) {
  console.log('  --dry-run：到此为止，什么都没改。\n')
  process.exit(0)
}

if (!opts.flags.has('yes')) {
  if (!process.stdin.isTTY) fail('非交互终端下必须显式加 --yes（避免 CI 里误发版）')
  if (!(await confirm(`  确认发布 ${tag}？(y/N) `))) {
    console.log('\n  已取消，什么都没改。\n')
    process.exit(1)
  }
}

// ── 执行 ──
if (verify) {
  step('类型检查与测试')
  spawn('npm', ['run', 'typecheck'])
  spawn('npm', ['test'])
}

if (bumpsPkg) {
  step(`写入版本号并提交`)
  writePkgVersion(version)
  git(['add', 'package.json'], { capture: false })
  // 只 add package.json：仓库里可能有并行会话的半成品，绝不能 -A 一把梭
  git(['commit', '-m', `chore(release): ${tag}`], { capture: false })
}

step(`打 tag ${tag}`)
git(['tag', '-a', tag, '-m', tag])

if (noPush) {
  console.log(`\n  --no-push：tag 已就位，自行推送：`)
  console.log(`    git push ${REMOTE} ${branch} && git push ${REMOTE} ${tag}\n`)
  process.exit(0)
}

step('推送')
git(['push', REMOTE, branch], { capture: false })
git(['push', REMOTE, `refs/tags/${tag}`], { capture: false })

const wf = isDev ? 'dev-release.yml' : 'release.yml'
console.log(`\n  ✓ ${tag} 已推送，CI 已接手`)
if (slug) console.log(`    https://github.com/${slug}/actions/workflows/${wf}`)
console.log('')
