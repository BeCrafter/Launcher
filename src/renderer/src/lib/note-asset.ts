// 笔记正文里的地址 → 预览可加载的 URL。
//
// 两个入口,规则不同,别混用:
//   · `resolveNoteAssetSrc` —— **只认笔记目录内的相对路径**,拼成自定义协议地址。
//     本地附件(图片/视频/音频/PDF/本地网页)走它,真正的穿越防护在协议处理器里。
//   · `resolvePreviewSrc` —— 在它之上**额外放行 http(s)**。预览里所有会联网的地址
//     (远程图片、远程网页嵌入)都走它,见 docs/help.md 里写明的取舍。
//     其余 scheme(file: / data: / javascript:)两者都拒绝。

import { NOTES_ASSET_SCHEME } from '@shared/notes'

/** 本地附件:相对路径 → 自定义协议地址;不是本地相对路径的一律 null */
export function resolveNoteAssetSrc(src: string): string | null {
  if (src === '') return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return null
  if (src.startsWith('/') || src.startsWith('~')) return null
  const encoded = src
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.')
    .map((seg) => {
      /*
       * 引用里可能**已经是** `%20` —— 粘图时我们写的就是编码过的形式(CommonMark 要求
       * 地址里的空格写成 `%20`,不然 GitHub 那边渲染不出来)。
       * 直接 encodeURIComponent 会把 `%` 二次转义成 `%25`,文件就永远找不到了。
       * 所以先解回原样再统一编码;解不开(非法编码)就按原样处理。
       */
      let plain = seg
      try {
        plain = decodeURIComponent(seg)
      } catch {
        /* 非法百分号编码:原样 */
      }
      return encodeURIComponent(plain)
    })
    .join('/')
  return `${NOTES_ASSET_SCHEME}://asset/${encoded}`
}

/**
 * 插入引用时用的形式:把地址里的空格等字符编码掉。
 *
 * 为什么不直接写空格:Markdown 的链接地址在 CommonMark 里不允许裸空格,
 * Obsidian 认、GitHub 不认。编码一次两边都能开 —— 而解析侧(上面的函数与
 * markdown.tsx 的正则)两种写法都收,所以用户手写的旧引用也不会坏。
 */
export function encodeNoteAssetPath(relPath: string): string {
  return relPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

/**
 * 预览里**所有**要联网的地址都走这一个入口:图片/媒体的 `![](...)`、网页嵌入的
 * ```` ```embed ````。
 *
 * 规则:**本地相对路径 + http(s)**,其余一律拒绝。
 *   · http(s) —— 用户明确点头放行的两条路(远程图片直接显示、远程网页嵌入)。
 *     代价是打开笔记会向对方发请求(IP、时间、你在看哪篇),带跟踪像素的地址因此生效。
 *     这是取舍,不是疏漏;图片渲染出来时带 `referrerPolicy="no-referrer"`,
 *     至少不把「你从哪篇笔记点过来的」一起送出去。
 *   · `file:` 能读整个磁盘、`data:` / `javascript:` 是注入路径 —— 都拒绝。
 *
 * 之所以图片和嵌入共用一个函数:两者的放行规则**就是同一条**。
 * 各留一份必然漂移,而漂移的表现是「这里能开、那里打不开」这种说不清的现象。
 */
export function resolvePreviewSrc(url: string): string | null {
  const u = url.trim()
  if (u === '') return null
  if (/^https?:\/\//i.test(u)) return u
  return resolveNoteAssetSrc(u)
}
