#!/usr/bin/env node
// 发版前预检 —— 本地与 CI 共用同一份实现。
//
//   node scripts/release-check.mjs                              # 自检 package.json 的版本
//   node scripts/release-check.mjs --tag v0.2.0                 # 额外:tag 与版本一致、且未被占用
//   node scripts/release-check.mjs --version 0.2.0-rc.1 --emit  # CI:校验并写出 IS_PRERELEASE
//
// 为什么要有它:打 tag 是"先推后验"—— CI 里的版本一致性校验发生在 tag 已经推上去之后,
// 一旦不一致只能删 tag 重打。这里把同样的判断提前到本地,推之前就能拦住。

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describePrereleaseEffects, validateVersion } from './release-version.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const hasFlag = (name) => process.argv.includes(name)

const problems = []
const warnings = []
const notes = []

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...opts }).trim()
}

// ── 1. 版本号格式与预发布词 ──
let version = argValue('--version')
if (version === undefined) {
  version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
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

// ── 3. 工作区状态(提醒,不阻断) ──
// CI 构建的是**tag 指向的那个 commit**,本地未提交的改动本身不影响产物;
// 这里提示是为了拦住「改了版本号却没提交就打算打 tag」。
try {
  const dirty = git(['status', '--porcelain'])
  if (dirty !== '') {
    warnings.push(
      `工作区有未提交改动(${dirty.split('\n').length} 项)—— 确认要发布的改动都已提交后再打 tag`
    )
  }
} catch {
  warnings.push('读不到 git 状态 —— 工作区是否干净未校验')
}

// ── 4. CI 模式:把预发布判定写进 $GITHUB_ENV 供后续步骤使用 ──
if (hasFlag('--emit')) {
  const target = process.env.GITHUB_ENV
  if (target) {
    appendFileSync(target, `IS_PRERELEASE=${verdict.ok && verdict.prerelease ? 'true' : 'false'}\n`)
  } else if (!verdict.ok) {
    // 未在 CI 中且版本非法时,由下面的 problems 走非零退出
  }
}

// ── 输出 ──
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
console.log(warnings.length || notes.length ? '\n  ✓ 预检通过' : '  ✓ 预检通过')
