// 预览折叠的 DOM 层。
//
// 渲染器输出的是**扁平**的块序列(标题与正文是兄弟节点),所以「折叠一节」就是
// 从标题往后把兄弟节点藏起来,直到下一个 level ≤ 当前 level 的标题。
// 不包 <section>、不拆 React 节点:共享渲染器(markdown.tsx)一个字都不用改。
//
// 隐藏区间每次都清掉重放:父节折起来时子节自己的折叠状态不会丢,
// 展开父节后仍然只露出子节该露的部分。按钮能复用就复用,避免连点时重建。

import type { PreviewHeading } from './preview-outline'

export interface PreviewFoldLabels {
  fold: string
  unfold: string
}

export const FOLD_BUTTON_CLASS = 'md-h-fold-btn'
export const FOLD_HIDDEN_CLASS = 'md-fold-hidden'
const FOLDED_BY_ATTR = 'data-md-folded-by'

/** `.notes-preview-body` 的直接标题子元素(文档顺序)。 */
export function directHeadingElements(body: HTMLElement): HTMLElement[] {
  return [...body.children].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('md-h')
  )
}

function levelOf(el: HTMLElement): number {
  const value = Number(el.getAttribute('aria-level'))
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** 按源行找标题。只找直接子元素 —— 引用/表格里的标题不算「节」。 */
export function findDirectHeading(body: HTMLElement, line: number): HTMLElement | null {
  return directHeadingElements(body).find((el) => el.dataset.line === String(line)) ?? null
}

/** 标题到下一个同级/更高级标题之间的兄弟节点。 */
function foldRangeOf(headingEl: HTMLElement, level: number): HTMLElement[] {
  const out: HTMLElement[] = []
  let node = headingEl.nextElementSibling
  while (node !== null) {
    if (node instanceof HTMLElement && node.classList.contains('md-h')) {
      const nextLevel = levelOf(node)
      if (nextLevel > 0 && nextLevel <= level) break
    }
    if (node instanceof HTMLElement) out.push(node)
    node = node.nextElementSibling
  }
  return out
}

function clearHidden(body: HTMLElement): void {
  for (const node of body.querySelectorAll<HTMLElement>(`.${FOLD_HIDDEN_CLASS}`)) {
    node.classList.remove(FOLD_HIDDEN_CLASS)
    node.removeAttribute(FOLDED_BY_ATTR)
  }
}

/** 能折与只显示层级标是两种按钮,对不上就得换一枚。 */
function sameKind(button: HTMLButtonElement, foldable: boolean): boolean {
  return button.classList.contains('md-h-level-only') === !foldable
}

/** 就地更新。元素不换,:hover 还在,连点时箭头不会闪回成 H。 */
function updateButton(
  button: HTMLButtonElement,
  heading: PreviewHeading,
  folded: boolean,
  labels: PreviewFoldLabels
): void {
  const num = button.querySelector('.md-h-num')
  if (num !== null) num.textContent = String(heading.level)
  if (!heading.foldable) return
  button.dataset.foldKey = heading.key
  button.setAttribute('aria-expanded', String(!folded))
  const label = folded ? labels.unfold : labels.fold
  button.setAttribute('aria-label', label)
  button.title = label
}

function makeButton(
  heading: PreviewHeading,
  folded: boolean,
  labels: PreviewFoldLabels,
  onToggle: (key: string) => void
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = FOLD_BUTTON_CLASS
  // 键盘用户走右侧目录卡片;标题旁这排按钮不进 Tab 序列。
  button.tabIndex = -1
  // 平时显示 Hn,悬停(或本节已折叠)才换成箭头。层级已在标题的 aria-level 上。
  // H 与数字分开:H 做成细高斜体,数字贴在它的右下角。整段文字仍是 Hn。
  const level = document.createElement('span')
  level.className = 'md-h-level'
  level.setAttribute('aria-hidden', 'true')
  const mark = document.createElement('span')
  mark.className = 'md-h-mark'
  mark.textContent = 'H'
  const num = document.createElement('span')
  num.className = 'md-h-num'
  num.textContent = String(heading.level)
  level.append(mark, num)
  button.appendChild(level)
  // 没有正文可折的标题只留层级标,悬停也不变箭头,也不响应点击。
  if (!heading.foldable) {
    button.classList.add('md-h-level-only')
    button.setAttribute('aria-hidden', 'true')
    return button
  }
  button.dataset.foldKey = heading.key
  button.setAttribute('aria-expanded', String(!folded))
  const label = folded ? labels.unfold : labels.fold
  button.setAttribute('aria-label', label)
  button.title = label
  const icon = document.createElement('i')
  icon.className = 'fa-solid fa-chevron-right'
  icon.setAttribute('aria-hidden', 'true')
  button.appendChild(icon)
  // 读按钮上当前的键,不读创建时那个。正文被整段替换后按钮会复用,
  // 闭包里的旧键就对不上新标题,点了什么都不变。
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const key = button.dataset.foldKey
    if (key !== undefined && key !== '') onToggle(key)
  })
  return button
}

/**
 * 把折叠状态重放到预览正文上:
 *   1. 清掉上一轮的隐藏类;
 *   2. 每个标题一枚层级标。已经有、且种类没变的按钮就地更新,
 *      不拆掉重建 —— 否则连点时新按钮没有 :hover,H 会闪回来;
 *   3. 按文档顺序重放所有折叠区间。
 *
 * 调用方放在 `useLayoutEffect` 里,React 提交后、绘制前完成,不会闪。
 */
export function applyPreviewFoldDom(
  body: HTMLElement,
  headings: readonly PreviewHeading[],
  folded: ReadonlySet<string>,
  labels: PreviewFoldLabels,
  onToggle: (key: string) => void
): void {
  clearHidden(body)
  const elements = directHeadingElements(body)
  const byLine = new Map(elements.map((el) => [el.dataset.line ?? '', el]))
  const kept = new Set<Element>()

  for (const heading of headings) {
    const el = byLine.get(String(heading.line))
    if (el === undefined) continue
    const isFolded = folded.has(heading.key)
    el.dataset.foldKey = heading.key
    el.dataset.folded = isFolded ? 'true' : 'false'
    const current = el.querySelector(':scope > .md-h-fold-btn')
    if (current instanceof HTMLButtonElement && sameKind(current, heading.foldable)) {
      updateButton(current, heading, isFolded, labels)
      kept.add(current)
    } else {
      current?.remove()
      const created = makeButton(heading, isFolded, labels, onToggle)
      el.appendChild(created)
      kept.add(created)
    }
  }

  for (const button of body.querySelectorAll(`.${FOLD_BUTTON_CLASS}`)) {
    if (!kept.has(button)) button.remove()
  }

  for (const heading of headings) {
    if (!folded.has(heading.key)) continue
    const el = byLine.get(String(heading.line))
    if (el === undefined) continue
    for (const node of foldRangeOf(el, heading.level)) {
      node.classList.add(FOLD_HIDDEN_CLASS)
      node.setAttribute(FOLDED_BY_ATTR, heading.key)
    }
  }
}
