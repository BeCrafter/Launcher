// 启动过渡页的摘除时机(全应用唯一写者)
//
// 为什么不在模块求值期删:过渡页原来是在 `bootstrap()` 的第一行被 `remove()` 的,而
// `bootstrap()` 由 App 模块顶层同步调用 —— `<script type="module">` 的执行可能早于浏览器首帧
// (打包产物里 686KB 的 render-blocking CSS 又把「可以首绘」与「脚本可以执行」卡在同一时刻),
// 于是过渡页在**还没被画出来**时就被删掉,首帧落到「#root 为空、只剩 body 背景」的状态;
// 浅色主题下 body 背景是近白 `#f6f7fb` —— 这就是 2026-09-23 报告的「首次启动白屏」。
//
// 改成 `useLayoutEffect`:它在 DOM 变更之后、该次 commit 绘制**之前**运行,所以摘除与应用 DOM
// 落在同一帧,渲染管线不可能产出一帧「过渡页已删、应用未画」。热启动时应用先画好、过渡页
// 一帧都不会被看到;冷启动时过渡页一直挂到应用就绪。
//
// ⚠ 必须在每个渲染分支上调用(外壳 / preload 缺失 / 引导失败),否则那条分支会永远停在过渡页上。

import { useLayoutEffect } from 'react'

/** 摘除启动过渡页(幂等:不存在或已被摘除时什么都不做) */
export function removeBootSplash(): void {
  document.getElementById('boot-splash')?.remove()
}

/** 在首次 commit 时摘除启动过渡页(与应用 DOM 同帧) */
export function useBootSplash(): void {
  useLayoutEffect(() => {
    removeBootSplash()
  }, [])
}
