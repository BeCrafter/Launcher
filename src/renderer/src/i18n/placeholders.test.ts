// i18n 契约:占位符。
//
// 事故:`notes.clash.message` 里写了**两个** `{NAME}`,而调用方是
// `t('notes.clash.message').replace('{NAME}', x)` —— `.replace` 只替换第一个,
// 于是界面上真的显示出字面的 `{NAME}`。类型检查和单测都拦不住这种「文案与替换次数不匹配」。
//
// 规则:一条文案里同一个占位符**只能出现一次**。需要两处不同内容就用两个名字。

import { describe, expect, it } from 'vitest'
import { enUS } from './dict.en-US'
import { zhCN } from './dict.zh-CN'

const PLACEHOLDER = /\{(\w+)\}/g

function duplicatedPlaceholders(text: string): string[] {
  const seen = new Map<string, number>()
  for (const m of text.matchAll(PLACEHOLDER)) {
    const k = m[1]
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)
}

describe('i18n 占位符契约', () => {
  it.each([
    ['zh-CN', zhCN],
    ['en-US', enUS]
  ])('%s:没有重复的占位符(重复时 .replace 只换第一个)', (_lang, dict) => {
    const bad = Object.entries(dict as Record<string, string>)
      .map(([key, value]) => ({ key, dup: duplicatedPlaceholders(value) }))
      .filter((x) => x.dup.length > 0)
    expect(
      bad.map((x) => `${x.key}: ${x.dup.join(',')}`),
      '同一条文案里同一占位符出现多次,调用方只会替换第一个'
    ).toEqual([])
  })

  it('占位符两侧没有多余空白(`{ NAME }` 不会被任何 replace 命中)', () => {
    const bad: string[] = []
    for (const [lang, dict] of [
      ['zh-CN', zhCN],
      ['en-US', enUS]
    ] as const) {
      for (const [key, value] of Object.entries(dict as Record<string, string>)) {
        if (/\{\s+\w+\s+\}/.test(value)) bad.push(`${lang}/${key}`)
      }
    }
    expect(bad).toEqual([])
  })
})
