// 查找匹配的**高亮装饰**。
//
// 与 editor-marks.ts 同一条约束:只用 `Decoration.mark`,**绝不用 `Decoration.line`**
// —— 行装饰会改行高,破坏「源码模式每一行严格等高」的定义性约束。
//
// 匹配由 lib/note-find.ts 算好,这里只负责把区间铺成底色。用 StateField 而不是
// ViewPlugin,是因为「设置高亮」是面板主动派发的 effect,不是随文档/视口变化的派生值。

import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { FindMatch } from './note-find'

export interface FindHighlights {
  matches: readonly FindMatch[]
  /** 活动匹配下标;`-1` 表示没有活动项。 */
  active: number
}

/** 面板每次重算匹配 / 上下导航 / 正文变化后派发。 */
export const setFindHighlights = StateEffect.define<FindHighlights>()

function build(matches: readonly FindMatch[], active: number): DecorationSet {
  if (matches.length === 0) return Decoration.none
  const ranges = matches.map((match, index) =>
    Decoration.mark({
      class: index === active ? 'cm-find-match cm-find-match-active' : 'cm-find-match'
    }).range(match.from, match.to)
  )
  // 匹配天然升序且互不重叠(正则 exec 的语义),这里仍按 sort=true 兜底。
  return Decoration.set(ranges, true)
}

const findHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(setFindHighlights)) {
        next = build(effect.value.matches, effect.value.active)
      }
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field)
})

export const findHighlights = [findHighlightField]
