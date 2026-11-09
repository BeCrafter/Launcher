#!/usr/bin/env node
// 笔记编辑器端到端用例运行器。
//
//   node e2e/notes/run.mjs                 # 跑全部
//   node e2e/notes/run.mjs --list          # 只列出用例
//   node e2e/notes/run.mjs --filter drag   # 按 id / 标题 / 标签过滤
//   node e2e/notes/run.mjs --keep          # 保留临时 profile 方便排查
//
// 前置:先 `npm run build`（`npm run test:e2e:notes` 会自动跑构建）。
// 为什么不开 electron-vite dev:见 lib/app.mjs 顶部注释。

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApp, seedNotes } from './lib/app.mjs'
import { NoteE2EContext } from './lib/ctx.mjs'
import { CaseFailure } from './lib/assert.mjs'
import { CASES, AREA_TITLES } from './manifest.mjs'
import { LINK_NOTE, MAIN_NOTE, BASIC } from './lib/fixtures.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const tmpDir = join(here, '.tmp')

function parseArgs(argv) {
  const options = { list: false, keep: false, filter: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--list') options.list = true
    else if (arg === '--keep') options.keep = true
    else if (arg === '--filter') options.filter = argv[++index] ?? ''
    else if (arg.startsWith('--filter=')) options.filter = arg.slice('--filter='.length)
    else {
      console.error(`未知参数:${arg}`)
      process.exit(2)
    }
  }
  return options
}

function checkCases() {
  const seen = new Set()
  for (const testCase of CASES) {
    if (typeof testCase.id !== 'string' || testCase.id === '') throw new Error('用例缺少 id')
    if (seen.has(testCase.id)) throw new Error(`重复的用例 id:${testCase.id}`)
    seen.add(testCase.id)
    if (typeof testCase.run !== 'function') throw new Error(`用例 ${testCase.id} 缺少 run`)
  }
}

function selectedCases(filter) {
  if (filter === null || filter === '') return CASES
  const needles = filter
    .toLowerCase()
    .split(',')
    .map((needle) => needle.trim())
    .filter((needle) => needle !== '')
  return CASES.filter((testCase) => {
    const haystack = `${testCase.id} ${testCase.area} ${testCase.title} ${(testCase.tags ?? []).join(' ')}`.toLowerCase()
    return needles.some((needle) => haystack.includes(needle))
  })
}

function printList(cases) {
  const groups = new Map()
  for (const testCase of cases) {
    if (!groups.has(testCase.area)) groups.set(testCase.area, [])
    groups.get(testCase.area).push(testCase)
  }
  console.log(`共 ${cases.length} 条端到端用例\n`)
  for (const [area, items] of groups) {
    console.log(`## ${area} · ${AREA_TITLES[area] ?? ''}（${items.length}）`)
    for (const item of items) {
      console.log(`  - ${item.id} — ${item.title}`)
    }
    console.log('')
  }
}

function timestamp() {
  const date = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function indent(text, spaces) {
  const pad = ' '.repeat(spaces)
  return String(text)
    .split('\n')
    .map((line) => pad + line)
    .join('\n')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  checkCases()
  const cases = selectedCases(options.filter)
  if (cases.length === 0) {
    console.error(`没有匹配的用例:${options.filter}`)
    process.exit(2)
  }
  if (options.list) {
    printList(cases)
    return
  }

  if (!existsSync(join(root, 'out/main/index.js'))) {
    console.error('缺少 out/ 构建产物。先运行 `npm run build`,或直接 `npm run test:e2e:notes`。')
    process.exit(2)
  }

  const runDir = join(tmpDir, `run-${timestamp()}`)
  const profileDir = join(runDir, 'profile')
  const failuresDir = join(runDir, 'failures')
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(failuresDir, { recursive: true })
  seedNotes(profileDir, [MAIN_NOTE, LINK_NOTE])

  console.log(`启动隔离实例…（profile: ${profileDir}）`)
  const app = await launchApp({ root, profileDir })
  const ctx = new NoteE2EContext({
    cdp: app.cdp,
    profileDir,
    noteFile: MAIN_NOTE.file,
    noteTitle: MAIN_NOTE.title,
    logs: app.logs
  })

  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    await app.stop()
  }
  const onInterrupt = async () => {
    console.log('\n收到中断,关闭实例…')
    await stop()
    process.exit(130)
  }
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onInterrupt)

  const results = []
  try {
    await ctx.boot()
    console.log(`开始执行 ${cases.length} 条用例\n`)
    for (const testCase of cases) {
      const started = Date.now()
      const label = `${testCase.id} — ${testCase.title}`
      process.stdout.write(`  ${label} … `)
      try {
        await ctx.reset(testCase.fixture ?? BASIC)
        await testCase.run(ctx)
        const duration = Date.now() - started
        results.push({ id: testCase.id, area: testCase.area, title: testCase.title, ok: true, duration })
        console.log(`PASS (${duration}ms)`)
      } catch (error) {
        const duration = Date.now() - started
        const message = error instanceof CaseFailure ? error.message : (error?.stack ?? String(error))
        results.push({
          id: testCase.id,
          area: testCase.area,
          title: testCase.title,
          ok: false,
          duration,
          error: message
        })
        console.log(`FAIL (${duration}ms)`)
        console.log(indent(message, 6))
        const shot = join(failuresDir, `${testCase.id.replace(/[^a-z0-9-]+/gi, '_')}.png`)
        try {
          await app.cdp.screenshot(shot)
          console.log(`      截图:${shot}`)
        } catch {
          // 页面已经崩了就没法截图
        }
      }
    }
  } finally {
    await stop()
  }

  const failed = results.filter((result) => !result.ok)
  const passed = results.length - failed.length
  console.log(`\n结果:${passed} 通过 / ${failed.length} 失败 / ${results.length} 总计`)
  if (failed.length > 0) {
    console.log('\n失败用例:')
    for (const result of failed) console.log(`  - ${result.id}: ${result.title}`)
    console.log(`\n应用日志（最后 20 行）:\n${app.logs.slice(-20).join('\n')}`)
  }

  const report = { startedAt: new Date().toISOString(), results }
  const reportPath = join(runDir, 'report.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  cpSync(reportPath, join(tmpDir, 'last-report.json'))

  const keepScene = options.keep || failed.length > 0
  if (keepScene) {
    console.log(`\n现场保留:${runDir}`)
  } else {
    rmSync(runDir, { recursive: true, force: true })
    console.log(`\n报告:${join(tmpDir, 'last-report.json')}`)
  }

  if (failed.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('\n运行器异常:')
  console.error(error?.stack ?? String(error))
  process.exitCode = 1
})
