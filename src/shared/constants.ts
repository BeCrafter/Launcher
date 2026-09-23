export const APP_NAME = 'Launcher'
export const APP_VERSION = '0.1.0'

/**
 * 应用底色(浅/深两值),必须与 `src/renderer/src/styles/base.css` 的 `--bg` 一致。
 *
 * 为什么单独导出:同一个颜色在**三处**各自需要它,而它们的加载时机互不相同 ——
 *   ① 主进程建窗的 `BrowserWindow.backgroundColor`(渲染层画出第一帧之前露在屏幕上的就是它);
 *   ② `src/renderer/index.html` 里启动过渡页与 `html` 背景(纯 HTML/CSS,不经过打包,拿不到 TS 常量);
 *   ③ 应用自身的 `--bg`。
 * 三处一旦不一致,启动期就会出现「白 → 深 → 浅」这类跳变(2026-09-23 用户报告的首次启动白屏)。
 * ①②③ 的同源关系由 `src/main/boot-theme.contract.test.ts` 锁住。
 */
export const BG_DARK = '#0e0e17'
export const BG_LIGHT = '#f6f7fb'
