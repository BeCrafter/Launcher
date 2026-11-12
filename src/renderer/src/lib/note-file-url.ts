// 笔记目录文件的只读协议 URL:`launcher-note://file/<rel>`。
//
// 路径必须逐段编码(空格、中文、`#`、`?` 都是合法文件名),只在段与段之间保留 `/`。
// 查询串只做缓存版本(HTML 预览在保存后重载),不参与路径解析 —— 两侧都靠这一点防穿越。

const PREFIX = 'launcher-note://file/'
const EXTERNAL_PREFIX = 'launcher-note://external/?p='

/** 白板外部文件的只读协议 URL。路径放在查询串里,不进 pathname。 */
export function noteExternalUrl(abs: string, version?: number | string): string {
  const query = version === undefined ? '' : `&v=${encodeURIComponent(String(version))}`
  return `${EXTERNAL_PREFIX}${encodeURIComponent(abs)}${query}`
}

export function noteFileUrl(rel: string, version?: number | string): string {
  const path = rel
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  const query = version === undefined ? '' : `?v=${encodeURIComponent(String(version))}`
  return `${PREFIX}${path}${query}`
}

/** 从协议 URL 取回相对路径(测试与「当前预览的是哪个文件」判断用) */
export function noteFileRelFromUrl(url: string): string | null {
  if (!url.startsWith(PREFIX)) return null
  const rest = url.slice(PREFIX.length)
  const path = rest.split(/[?#]/, 1)[0] ?? ''
  try {
    return path
      .split('/')
      .map((seg) => decodeURIComponent(seg))
      .join('/')
  } catch {
    return null
  }
}
