// 行内扫描的公共底座:行内标签与 wikilink 都要先「屏蔽掉不该被当成语法的区间」。
//
// 两条规则必须只有一份:
//   · 行内代码 / 转义 / URL / 链接地址里的 `#` 不是标签;
//   · 代码里的 `[[...]]` 也不是 wikilink。
// 两边各写一套,漂移的表现是「预览认、索引不认」这种最难查的错位。

/** 把区间替换成等长空格 —— 位置偏移保持不变,调用方仍能拿原串切片 */
function applyMask(line: string, ranges: Array<[number, number]>): string {
  if (ranges.length === 0) return line
  ranges.sort((a, b) => a[0] - b[0])
  let out = ''
  let last = 0
  for (const [from, to] of ranges) {
    if (to <= last) continue
    const start = Math.max(from, last)
    out += line.slice(last, start)
    out += ' '.repeat(to - start)
    last = to
  }
  return out + line.slice(last)
}

/** 行内代码 span:同长度的反引号串成对才算(未闭合的反引号是字面量) */
function codeRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let i = 0
  while (i < line.length) {
    if (line[i] !== '`') {
      i++
      continue
    }
    let openLen = 1
    while (line[i + openLen] === '`') openLen++
    let j = i + openLen
    let close = -1
    while (j < line.length) {
      if (line[j] !== '`') {
        j++
        continue
      }
      let run = 1
      while (line[j + run] === '`') run++
      if (run === openLen) {
        close = j
        break
      }
      j += run
    }
    if (close < 0) {
      i += openLen
      continue
    }
    ranges.push([i, close + openLen])
    i = close + openLen
  }
  return ranges
}

/**
 * 把行内不该参与语法识别的区间替换成等长空格。
 *
 * `maskWikilinks` 默认开启 —— 标签扫描要忽略 `[[笔记#标题]]` 里的 `#`;
 * wikilink 自己的扫描必须传 `false`,否则会把自己屏蔽掉。
 */
export function maskInlineLiterals(line: string, opts: { maskWikilinks?: boolean } = {}): string {
  const ranges: Array<[number, number]> = codeRanges(line)

  // 反斜杠转义:下一个字符是字面量
  for (const m of line.matchAll(/\\[\s\S]/g)) {
    if (m.index !== undefined) ranges.push([m.index, m.index + m[0].length])
  }

  // URL / www / 自动链接:整段屏蔽,URL 里的 #fragment 不是标签
  for (const m of line.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi)) {
    if (m.index !== undefined) ranges.push([m.index, m.index + m[0].length])
  }

  // Markdown 链接/图片的地址部分(`](...)`),链接文字仍参与扫描
  for (const m of line.matchAll(/\]\([^)\n]*\)/g)) {
    if (m.index !== undefined) ranges.push([m.index, m.index + m[0].length])
  }

  if (opts.maskWikilinks !== false) {
    for (const m of line.matchAll(/!?\[\[[^\[\]\n]*\]\]/g)) {
      if (m.index !== undefined) ranges.push([m.index, m.index + m[0].length])
    }
  }

  return applyMask(line, ranges)
}

const OPEN_FENCE_RE = /^[ \t]*(?:>[ \t]?)*[ \t]*(`{3,}|~{3,})(.*)$/
const CLOSE_FENCE_RE = /^[ \t]*(?:>[ \t]?)*[ \t]*(`{3,}|~{3,})[ \t]*$/

/**
 * 逐行判断是否落在围栏代码块正文里(围栏行本身不算)。
 *
 * 支持引用/提示块里的围栏(`> ```` `);未闭合的围栏一直吃到结尾 ——
 * 与渲染器的宽容口径一致。
 */
export function fenceMask(lines: string[]): boolean[] {
  const inside = new Array<boolean>(lines.length).fill(false)
  let fence: { ch: string; len: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (fence !== null) {
      const close = CLOSE_FENCE_RE.exec(line)
      if (close !== null && close[1]![0] === fence.ch && close[1]!.length >= fence.len) {
        fence = null
        continue
      }
      inside[i] = true
      continue
    }
    const open = OPEN_FENCE_RE.exec(line)
    if (open !== null) fence = { ch: open[1]![0]!, len: open[1]!.length }
  }
  return inside
}
