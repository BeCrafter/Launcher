// Vite 的 `?raw` 导入:把文件内容作为字符串**在构建期内联**。
//
// renderer 侧这条声明来自 `vite/client`(见 renderer/src/env.d.ts),
// 但 main 的 tsconfig 里没有它 —— 而示例笔记正文就是用 `?raw` 从
// resources/note-sample/*.md 读进来的(见 domains/note-sample.ts)。
// 这里只补最小的一条,不把 vite 的整套全局声明引进主进程。
declare module '*?raw' {
  const content: string
  export default content
}
