// 编辑区 ↔ 预览区的滚动同步(纯函数)。
//
// 为什么不是「按比例」:两边的总高度几乎从不相等 —— 编辑器里 `## 标题` 是 4 个字符,
// 预览里是一个 22px 的块;编辑器里一张图是一行 `![](assets/x.png)`,预览里是 400px。
// 按比例同步的结果是「越往下越偏」,而且每敲一个字比例都在变,滚动条会自己漂。
//
// 所以按**源行锚点**同步:预览的每个块级元素都带 `data-line`(它在源文里的起始行),
// 两个锚点之间线性插值。编辑器滚到第 N 行 → 预览滚到第 N 行那一块所在的位置,
// 反过来也一样。两边看到的内容因此始终对得上。

export interface LineAnchor {
  /** 源文里的行号(0 起) */
  line: number
  /** 该块相对滚动容器内容顶部的偏移(px) */
  top: number
}

/** 在锚点序列里找最后一个 `key <= v` 的下标;都比 v 大时返回 -1 */
function lastAtOrBefore(anchors: LineAnchor[], key: 'line' | 'top', v: number): number {
  let lo = 0
  let hi = anchors.length - 1
  let hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (anchors[mid][key] <= v) {
      hit = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return hit
}

/**
 * 两个锚点之间按比例插值。
 *
 * 落在**最后一个锚点之后**时沿用最后一段的斜率外推:不外推的话,编辑区滚到底部时
 * 预览会卡在最后一个锚点上不动 —— 而两者的滚动余量几乎从不相等,看起来就是「不同步了」。
 * 外推出来的值可能超出可滚范围,由调用方按容器尺寸夹紧(那是调用方才知道的事)。
 */
function lerp(anchors: LineAnchor[], at: number, t: number): number {
  const a = anchors[at]
  const b = anchors[at + 1]
  if (b === undefined) {
    const prev = anchors[at - 1]
    if (prev === undefined) return a.top
    const span = a.line - prev.line
    if (span <= 0) return a.top
    return a.top + ((a.top - prev.top) * (t - a.line)) / span
  }
  const span = b.line - a.line
  if (span <= 0) return a.top
  return a.top + ((b.top - a.top) * (t - a.line)) / span
}

/**
 * 编辑器顶部在第 `line` 行 → 预览该滚到多少像素。
 *
 * 第一块之前(标题上方)返回 0;超出行数上限时由调用方按 `scrollHeight - clientHeight` 夹紧,
 * 这里不做夹紧是因为「该滚到哪」与「能滚到哪」是两件事 —— 后者取决于容器尺寸,
 * 交给调用方才是对的。
 */
export function previewScrollFor(anchors: LineAnchor[], line: number): number {
  if (anchors.length === 0) return 0
  const at = lastAtOrBefore(anchors, 'line', line)
  // 目标在第一块之前 → 顶部
  if (at < 0) return 0
  return lerp(anchors, at, line)
}

/**
 * 预览滚到第 `top` 像素 → 编辑器顶部应该在第几行(可能是小数,调用方自己取整或插值)。
 *
 * 反过来不做夹紧:行号本来就有 [0, 总行数) 这个天然边界,调用方拿到的值不会越界。
 */
export function editorLineFor(anchors: LineAnchor[], top: number): number {
  if (anchors.length === 0) return 0
  const at = lastAtOrBefore(anchors, 'top', top)
  if (at < 0) return anchors[0].line
  const a = anchors[at]
  const b = anchors[at + 1]
  if (b === undefined) {
    // 同 previewScrollFor:末尾按最后一段的斜率外推,否则编辑区跟不上预览的最后一段
    const prev = anchors[at - 1]
    if (prev === undefined) return a.line
    const span = a.top - prev.top
    if (span <= 0) return a.line
    return a.line + ((a.line - prev.line) * (top - a.top)) / span
  }
  const span = b.top - a.top
  if (span <= 0) return a.line
  return a.line + ((b.line - a.line) * (top - a.top)) / span
}

/** 从 DOM 里读出锚点。容器是滚动容器本身(offsetTop 的参照系) */
export function collectAnchors(container: HTMLElement): LineAnchor[] {
  const out: LineAnchor[] = []
  const base = container.getBoundingClientRect().top - container.scrollTop
  for (const el of container.querySelectorAll<HTMLElement>('[data-line]')) {
    const raw = el.dataset.line
    if (raw === undefined) continue
    const line = Number.parseInt(raw, 10)
    if (!Number.isFinite(line)) continue
    out.push({ line, top: el.getBoundingClientRect().top - base })
  }
  // 文档顺序即行号顺序,但列表项可能让同一行出现两次(li 与它所在的 ul),
  // 这里按行号排序并去重,二分查找才有意义
  out.sort((a, b) => a.line - b.line)
  return out.filter((a, i) => i === 0 || a.line !== out[i - 1].line)
}
