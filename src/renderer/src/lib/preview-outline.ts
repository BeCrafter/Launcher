// 预览大纲的数据层(纯函数,不碰 DOM)。
//
// 为什么从源文建目录、而不是直接扫渲染后的 `.md-h`:
//   · 代码围栏里的 `# xxx` 不能算标题(块模型已经处理);
//   · 引用里的标题渲染器会画出来,但它没有「节」的语义(块模型里属于引用正文),
//     放进目录会出现点了跳不过去、折了折不全的条目;
//   · `<details>` 里默认收起的标题也不该出现在目录里。
// 只收录「块的父级全是标题」的 heading,恰好就是预览里作为 `.md-h` 平铺的那些。

import { parseMarkdownBlocks, type MarkdownBlock } from './markdown-blocks'
import { parseHeadingLine, slugifyHeading } from './markdown'

export interface PreviewHeading {
  /** 折叠键:`slug#序号`。改标题文字会换键(那一节折叠状态重置),改别处不会 */
  key: string
  level: number
  title: string
  /** 源文行号(0 起)。跳转/查找 DOM 一律按它,不用可能重复的 id */
  line: number
  /** 子树结束行(不含):空行已裁掉,等于 `line + 1` 时没有可折叠内容 */
  endLine: number
  parentKey: string | null
  childKeys: string[]
  /** 树深度,根为 0 */
  depth: number
  /** 这一节有没有正文/子标题可以藏起来 */
  foldable: boolean
}

export interface PreviewOutline {
  headings: PreviewHeading[]
  minLevel: number
}

export interface HeadingPosition {
  key: string
  /** 相对滚动内容顶部的偏移(px) */
  top: number
}

/** `## 乙 ##` + 行内标记 → 纯文本标题。 */
export function plainHeadingTitle(raw: string): string {
  const source = raw.trim()
  const text = source
    .replace(/[ \t]+#+[ \t]*$/, '')
    // 图片 / wikilink:有别名用别名,没有就用目标
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/<[^>]*>/g, '')
    .trim()
  if (text !== '') return text
  // 全是标记(例如标题就是 `**`)时退回原文,至少能在目录里看见点东西
  return source
}

function ancestorChainIsHeadings(block: MarkdownBlock, byId: ReadonlyMap<number, MarkdownBlock>): boolean {
  const seen = new Set<number>([block.id])
  let parentId = block.parentId
  while (parentId !== null) {
    if (seen.has(parentId)) return false
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (parent === undefined) return false
    if (parent.kind !== 'heading') return false
    parentId = parent.parentId
  }
  return true
}

/**
 * 从正文构建预览目录。
 *
 * 标题行必须是渲染器认可的形状(`parseHeadingLine`),块的祖先链必须全是标题 ——
 * 后者排除 `<details>` / 表格单元格 / 对齐块里那些没有「节」语义的标题。
 */
export function buildPreviewOutline(source: string): PreviewOutline {
  const lines = source.split('\n')
  const blocks = parseMarkdownBlocks(source)
  const byId = new Map(blocks.map((block) => [block.id, block]))

  const raw = blocks
    .filter((block) => block.kind === 'heading')
    .filter((block) => ancestorChainIsHeadings(block, byId))
    .sort((a, b) => a.from - b.from)
    .map((block) => {
      const parsed = parseHeadingLine(lines[block.from] ?? '')
      if (parsed === null) return null
      return {
        level: parsed.level,
        text: plainHeadingTitle(parsed.title),
        line: block.from,
        endLine: block.contentTo
      }
    })
    .filter((item): item is { level: number; text: string; line: number; endLine: number } => item !== null)

  const occurrence = new Map<string, number>()
  const headings: PreviewHeading[] = []
  const stack: PreviewHeading[] = []
  let minLevel = Number.POSITIVE_INFINITY

  for (const item of raw) {
    const slugified = slugifyHeading(item.text)
    const slug = slugified === '' ? 'section' : slugified
    const nth = occurrence.get(slug) ?? 0
    occurrence.set(slug, nth + 1)
    const key = nth === 0 ? slug : `${slug}#${nth + 1}`

    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) stack.pop()
    const parent = stack[stack.length - 1] ?? null
    const heading: PreviewHeading = {
      key,
      level: item.level,
      title: item.text,
      line: item.line,
      endLine: item.endLine,
      parentKey: parent?.key ?? null,
      childKeys: [],
      depth: parent === null ? 0 : parent.depth + 1,
      foldable: item.endLine > item.line + 1
    }
    if (parent !== null) parent.childKeys.push(key)
    headings.push(heading)
    stack.push(heading)
    minLevel = Math.min(minLevel, item.level)
  }

  return { headings, minLevel: Number.isFinite(minLevel) ? minLevel : 1 }
}

/**
 * 当前可见的标题键。折叠的标题**自己**仍然可见(否则没法从目录里再展开),
 * 它的后代全部隐藏;嵌套折叠同样成立。
 */
export function visibleHeadingKeys(
  headings: readonly PreviewHeading[],
  folded: ReadonlySet<string>
): Set<string> {
  // 父先于子出现:父被折叠(或本身被祖先藏掉)时,子也藏;折叠的父自己仍然可见。
  const visible = new Set<string>()
  const hidden = new Set<string>()
  for (const heading of headings) {
    if (heading.parentKey !== null && hidden.has(heading.parentKey)) {
      hidden.add(heading.key)
      continue
    }
    visible.add(heading.key)
    if (folded.has(heading.key)) hidden.add(heading.key)
  }
  return visible
}

/**
 * 当前标题:顶边越过「内容区顶部 + offset」的最后一个。
 * `positions` 按文档顺序;不可见项(`display:none` / 已摘下)不传进来即可。
 */
export function pickActiveHeadingKey(
  positions: readonly HeadingPosition[],
  scrollTop: number,
  offset = 28
): string | null {
  if (positions.length === 0) return null
  const threshold = scrollTop + offset
  let hit: HeadingPosition | null = null
  for (const position of positions) {
    if (!Number.isFinite(position.top)) continue
    if (position.top <= threshold) hit = position
    else break
  }
  return hit?.key ?? positions[0].key
}

/** 点目录时滚不到想要的位置,把当前项钉在这次落点上。 */
export interface OutlinePin {
  key: string
  scrollTop: number
}

/**
 * 点击落点还没被用户滚走时,当前节用被点的那一项;
 * 否则跟滚动侦察。差 1px 以内算同一个落点(亚像素舍入)。
 */
export function pinnedActiveKey(
  spyKey: string | null,
  pin: OutlinePin | null,
  scrollTop: number
): string | null {
  if (pin !== null && Math.abs(scrollTop - pin.scrollTop) <= 1) return pin.key
  return spyKey
}

/** 贴边热区,和刻度条渐隐遮罩同宽(notes.css 里的 22px)。 */
export const OUTLINE_EDGE = 22

/**
 * 贴边滚动速度(像素/秒)。
 * 会话锚点是每秒 7 格、格距 16px,观感大约 112px/s。刻度条直接滚像素,取同一个速度。
 */
export const OUTLINE_EDGE_SPEED = 112

export interface OutlineEdgeStep {
  scrollTop: number
  /** 没有可滚余量时为 0 */
  maxScroll: number
  /** 相对刻度条顶部 */
  pointerY: number
  /** 刻度条可见高度 */
  height: number
  edge: number
  /** 秒 */
  dt: number
  /** 像素/秒 */
  speed: number
}

function clampScroll(value: number, max: number): number {
  return Math.min(max, Math.max(0, value))
}

/**
 * 指针停在刻度条上缘或下缘时,滚动槽下一步的 scrollTop。
 * 装得下、指针在中间、或时间步不是正数,都不动。到头夹住。
 * 按时间走,不按帧:调用方传入经过的秒数。
 */
export function stepOutlineEdgeScroll(step: OutlineEdgeStep): number {
  const max = Math.max(0, step.maxScroll)
  const current = clampScroll(step.scrollTop, max)
  if (max === 0 || step.dt <= 0 || step.speed <= 0 || step.height <= 0) return current
  const dir = step.pointerY < step.edge ? -1 : step.pointerY > step.height - step.edge ? 1 : 0
  if (dir === 0) return current
  return clampScroll(current + dir * step.speed * step.dt, max)
}

/**
 * 滚动槽上下是否还有被裁掉的刻度。
 * 差 1px 以内算到头,免得亚像素舍入让「上面还有」在顶上还亮着。
 * 装得下(maxScroll <= 0)时两边都没有。
 */
export function outlineEdgeEnds(
  scrollTop: number,
  maxScroll: number
): { above: boolean; below: boolean } {
  const max = Math.max(0, maxScroll)
  if (max === 0) return { above: false, below: false }
  return { above: scrollTop > 1, below: max - scrollTop > 1 }
}

export interface OutlineTickScroll {
  scrollTop: number
  maxScroll: number
  /** 刻度顶边在滚动内容里的位置 */
  tickTop: number
  tickHeight: number
  viewHeight: number
  /** 上下要让开的渐隐宽度 */
  padding: number
}

/**
 * 高亮对准某一根刻度时,刻度槽应该停在哪。
 * 已经在渐隐以内就不动栏,只让高亮自己滑。
 * 快踩进渐隐才把刻度放到窗口中央,再夹进可滚范围。
 * 居中算出来越过顶或底时,这一头自然整段可见。
 * 不要提前为了露尾把高亮从中央拖走。
 */
export function outlineTickScrollTarget(input: OutlineTickScroll): number {
  const max = Math.max(0, input.maxScroll)
  const current = clampScroll(input.scrollTop, max)
  const pad = Math.max(0, input.padding)
  const view = input.viewHeight
  if (view <= 0 || !Number.isFinite(input.tickTop)) return current
  const top = input.tickTop
  const height = Math.max(0, input.tickHeight)
  const bottom = top + height
  if (pad * 2 < view && top >= current + pad && bottom <= current + view - pad) return current
  return clampScroll(top + height / 2 - view / 2, max)
}

/** 高亮滑动的时长。刻度槽的跟随用同一段,两边一起走完。 */
export const OUTLINE_FOLLOW_MS = 180

/** cubic-bezier(0.2, 0.8, 0.2, 1)。控制点和拇指的 CSS 过渡一致。 */
function outlineFollowEase(amount: number): number {
  if (amount <= 0) return 0
  if (amount >= 1) return 1
  const at = (t: number, p1: number, p2: number): number => {
    const u = 1 - t
    return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t
  }
  const slope = (t: number, p1: number, p2: number): number => {
    const u = 1 - t
    return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2)
  }
  let t = amount
  for (let i = 0; i < 8; i += 1) {
    const dx = slope(t, 0.2, 0.2)
    if (Math.abs(dx) < 1e-6) break
    t -= (at(t, 0.2, 0.2) - amount) / dx
    if (t < 0) t = 0
    else if (t > 1) t = 1
  }
  return at(t, 0.8, 1)
}

/**
 * 从 `from` 朝 `to` 走一步。按经过的毫秒取缓动,不越过目标;
 * 剩不到半像素、时间到了、或本来就只差半像素,直接落在目标上。
 */
export function stepOutlineFollow(
  from: number,
  to: number,
  elapsedMs: number,
  durationMs = OUTLINE_FOLLOW_MS
): number {
  if (!Number.isFinite(to)) return from
  if (!Number.isFinite(from)) return to
  if (Math.abs(to - from) <= 0.5) return to
  if (durationMs <= 0 || elapsedMs >= durationMs) return to
  if (elapsedMs <= 0) return from
  const next = from + (to - from) * outlineFollowEase(elapsedMs / durationMs)
  if ((to - from) * (to - next) < 0) return to
  if (Math.abs(to - next) <= 0.5) return to
  return next
}
