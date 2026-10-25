// UTF-8 字节工具:shared 会同时被打进 main 与 renderer。
// renderer 没有 Node 的 Buffer(即使 sandbox:false 也不能假设 polyfill),
// 所以这里只用 Web 标准的 TextEncoder/TextDecoder。

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

/** 字符串的 UTF-8 字节数 */
export function utf8Bytes(s: string): number {
  return encoder.encode(s).length
}

/** 按 UTF-8 字节上限截断,且**不切断多字节字符**(截出半个汉字会变成 U+FFFD) */
export function cutUtf8(s: string, maxBytes: number): { text: string; cut: boolean } {
  if (maxBytes <= 0) return { text: '', cut: s.length > 0 }
  const bytes = encoder.encode(s)
  if (bytes.length <= maxBytes) return { text: s, cut: false }
  let end = maxBytes
  // UTF-8 续字节以 10xxxxxx 开头:退到字符起点,避免半个码点
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  return { text: decoder.decode(bytes.subarray(0, end)), cut: true }
}
