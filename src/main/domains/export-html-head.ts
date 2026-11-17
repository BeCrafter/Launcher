// 打印前给一份 HTML 补 charset 的小工具(纯函数,单测可直接跑)。

const TAG = '<meta charset="utf-8">'

/**
 * charset 永远补:临时文件是 UTF-8,没有 meta 的话 Chromium 可能按 latin-1 猜。
 */
export function injectExportHead(html: string): string {
  const head = /<head(?:\s[^>]*)?>/i.exec(html)
  if (head !== null) {
    const at = head.index + head[0].length
    return `${html.slice(0, at)}${TAG}${html.slice(at)}`
  }
  // 没有 head:插在 doctype 之后,避免 meta 出现在 doctype 前把文档推进怪异模式
  const doctype = /<!doctype[^>]*>/i.exec(html)
  if (doctype !== null) {
    const at = doctype.index + doctype[0].length
    return `${html.slice(0, at)}${TAG}${html.slice(at)}`
  }
  return `${TAG}${html}`
}
