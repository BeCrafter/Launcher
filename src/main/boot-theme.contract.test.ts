// 启动底色的「三处同源」。
//
// 同一个颜色在三个地方各自需要它,而它们的加载时机互不相同:
//   ① 主进程建窗的 BrowserWindow.backgroundColor(渲染层画出第一帧之前,屏幕上就是它);
//   ② renderer/index.html 里启动过渡页与 html 背景(纯 HTML/CSS,不经过打包,拿不到 TS 常量);
//   ③ 应用自身的 --bg(base.css)。
// 三处一旦漂移,启动期就会出现「白 → 深 → 浅」这类跳变 —— 2026-09-23 用户报告的首次启动白屏
// 正是这条链上的产物,故在这里钉死,而不是只靠注释。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BG_DARK, BG_LIGHT } from '../shared/constants'
import { BOOT_WATCHDOG_MS, SPLASH_GRACE_MS } from './services/boot-gate'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')
const HTML = read('src/renderer/index.html')
const BASE_CSS = read('src/renderer/src/styles/base.css')

describe('启动底色三处同源', () => {
  it('index.html 的 --boot-bg(浅/深)== shared/constants 的 BG_LIGHT/BG_DARK', () => {
    const found = [...HTML.matchAll(/--boot-bg:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase())
    expect(found).toHaveLength(2) // 第一个是 :root 的浅色默认值,第二个在 prefers-color-scheme:dark 里
    expect(found[0]).toBe(BG_LIGHT)
    expect(found[1]).toBe(BG_DARK)
  })

  it('深色值确实在 prefers-color-scheme:dark 块里(否则深浅两值就反了)', () => {
    const media = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\s*\}/.exec(HTML)?.[1] ?? ''
    expect(media).toContain(BG_DARK)
    expect(media).not.toContain(BG_LIGHT)
    const firstLight = HTML.indexOf(BG_LIGHT)
    const mediaStart = HTML.search(/@media\s*\(prefers-color-scheme:\s*dark\)/)
    expect(firstLight).toBeGreaterThan(-1)
    expect(firstLight).toBeLessThan(mediaStart) // 浅色是 :root 的默认值,必须排在媒体查询之前
  })

  it('base.css 的 --bg 深/浅两值与常量一致', () => {
    const rootBlock = /:root\s*\{([\s\S]*?)\}/.exec(BASE_CSS)?.[1] ?? ''
    const lightBlock = /body\.light-theme\s*\{([\s\S]*?)\}/.exec(BASE_CSS)?.[1] ?? ''
    expect(/--bg:\s*(#[0-9a-fA-F]{6})/.exec(rootBlock)?.[1].toLowerCase()).toBe(BG_DARK)
    expect(/--bg:\s*(#[0-9a-fA-F]{6})/.exec(lightBlock)?.[1].toLowerCase()).toBe(BG_LIGHT)
  })
})

describe('启动过渡页与启动期契约', () => {
  it('过渡页样式内联在 head,不依赖打包出来的 CSS(它要在 686KB 样式表到达之前就能上屏)', () => {
    const head = HTML.slice(0, HTML.indexOf('</head>'))
    expect(head).toContain('<style>')
    expect(head).toMatch(/--boot-bg:/)
    // html 上的背景是最后一道保险:任何一帧(含还没解析到 body 的空帧)都不是浏览器默认白
    expect(head).toMatch(/html\s*\{[^}]*background:\s*var\(--boot-bg\)/)
  })

  it('过渡页不再写死深色(浅色主题下会变成「白 → 黑 → 白」跳变)', () => {
    const splash = /<div id="boot-splash">([\s\S]*?)<\/div>\s*<div id="root">/.exec(HTML)?.[0] ?? ''
    expect(splash).not.toBe('')
    expect(splash).not.toContain('#0e0e17')
    expect(splash).toContain('boot-spinner')
  })

  it('启动上报脚本是 classic 内联脚本(不经过打包:module bundle 挂了它还得能跑)', () => {
    const scripts = [...HTML.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    // 上报脚本必须是**不带 src、也不是 module** 的内联 classic:module 会跟着 bundle 一起不执行
    const bootTag = scripts.find((m) => m[2].includes('notifyBootPainted'))
    expect(bootTag).toBeTruthy()
    expect(bootTag![1]).not.toContain('src=')
    expect(bootTag![1]).not.toContain('module')
    const boot = bootTag![2]
    expect(boot).toContain("'splash'")
    expect(boot).toContain("'app'")
    // 上报前必须等真实帧(rAF)——「产出了一帧」是门控显示窗口的唯一依据
    expect(boot).toContain('requestAnimationFrame')
    // 失败兜底:界面迟迟没起来 → 换成可点的重载提示
    expect(boot).toContain('boot-fail-btn')
    expect(boot).toMatch(/FAIL_AFTER_MS\s*=\s*(\d+)/)
  })

  it('渲染层的失败提示必须晚于主进程 watchdog(否则兜底会先于转圈提示出现)', () => {
    const failAfter = Number(/FAIL_AFTER_MS = (\d+)/.exec(HTML)?.[1] ?? '0')
    expect(failAfter).toBeGreaterThan(BOOT_WATCHDOG_MS)
    expect(SPLASH_GRACE_MS).toBeLessThan(BOOT_WATCHDOG_MS) // 宽限必须短于兜底,否则宽限没机会生效
  })

  it('过渡页由 React 首次 commit 摘除(而非模块求值期)', () => {
    const bootstrap = read('src/renderer/src/state/bootstrap.ts')
    expect(bootstrap).not.toContain("getElementById('boot-splash')")
    const splashModule = read('src/renderer/src/boot/splash.ts')
    expect(splashModule).toContain('useLayoutEffect')
    expect(splashModule).toContain("getElementById('boot-splash')")
  })
})
