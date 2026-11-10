// 行内扫描的公共底座:wikilink 扫描前先「屏蔽掉不该被当成语法的区间」。
//
// 规则只有一份:代码里的 `[[...]]`、URL 与链接地址里的方括号都不是 wikilink。
// 各处各写一套,漂移的表现是「预览认、编辑器不认」这种最难查的错位。

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
 */
export function maskInlineLiterals(line: string): string {
  const ranges: Array<[number, number]> = codeRanges(line)

  // 反斜杠转义:下一个字符是字面量
  for (const m of line.matchAll(/\\[\s\S]/g)) {
    if (m.index !== undefined) ranges.push([m.index, m.index + m[0].length])
  }

  // URL / www / 自动链接:整段屏蔽
  for (const m of line.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi)) {
    if (m.index !== undefined) ranges.push([m.index, m.index + m[0].length])
  }

  // Markdown 链接/图片的地址部分(`](...)`),链接文字仍参与扫描
  for (const m of line.matchAll(/\]\([^)\n]*\)/g)) {
    if (m.index !== undefined) ranges.push([m.index, m.index + m[0].length])
  }

  return applyMask(line, ranges)
}
