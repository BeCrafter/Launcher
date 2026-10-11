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

/** 仓库地址（设置页「关于」与侧边栏链接用） */
export const GITHUB_REPO_URL = 'https://github.com/BeCrafter/Launcher'

/**
 * 设置与笔记的根目录（相对 `$HOME`）：`config.json` 与 `notes/` 都在它下面。
 *
 * 为什么抽到 shared：主进程用 `node:path` 拼（settings/store.ts），shared 侧不能用 `node:*`
 * （shared 同时被 renderer 打包，见 cron-log.ts 的同类约束），只能模板串拼。
 * 两处各写一遍迟早漂移 —— 而「笔记目录跟设置文件不在同一层」是个很难排查的怪现象。
 */
export const LAUNCHER_CONFIG_DIR_SUFFIX = '.config/launcher'
