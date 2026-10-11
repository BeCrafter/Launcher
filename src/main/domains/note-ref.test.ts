import { describe, expect, it } from 'vitest'
import { normalizeRefs, normalizeTags, sameRef } from './note-ref'
import { MAX_REFS, MAX_TAGS, TAG_MAX, REF_KEY_MAX, REF_LABEL_MAX } from '../../shared/notes'

describe('normalizeRefs', () => {
  it('保留合法条目', () => {
    expect(normalizeRefs([{ type: 'agent', key: 'user:foo', label: 'foo' }])).toEqual([
      { type: 'agent', key: 'user:foo', label: 'foo' }
    ])
  })

  it('label 缺失时退化成 key', () => {
    expect(normalizeRefs([{ type: 'cron', key: 'abc123' }])).toEqual([
      { type: 'cron', key: 'abc123', label: 'abc123' }
    ])
  })

  it('type 或 key 为空 → 丢弃(手改坏一行不该让整篇读不出来)', () => {
    expect(normalizeRefs([{ type: '', key: 'k' }, { type: 'agent', key: '' }, { key: 'k' }])).toEqual([])
  })

  it('非对象项丢弃', () => {
    expect(normalizeRefs(['agent', 42, null, [], undefined])).toEqual([])
  })

  it('非数组 → 空', () => {
    expect(normalizeRefs(undefined)).toEqual([])
    expect(normalizeRefs('x')).toEqual([])
    expect(normalizeRefs({})).toEqual([])
  })

  it('按 (type, key) 去重 —— 重复添加不在文件里堆两行', () => {
    const out = normalizeRefs([
      { type: 'agent', key: 'k', label: 'A' },
      { type: 'agent', key: 'k', label: 'B' },
      { type: 'cron', key: 'k', label: 'C' }
    ])
    expect(out).toHaveLength(2)
    expect(out[0].label).toBe('A') // 先到先得
  })

  it('trim 并截断超长字段', () => {
    const out = normalizeRefs([{ type: ' agent ', key: `  ${'k'.repeat(300)}  `, label: 'l'.repeat(300) }])
    expect(out[0].type).toBe('agent')
    expect(out[0].key).toHaveLength(REF_KEY_MAX)
    expect(out[0].label).toHaveLength(REF_LABEL_MAX)
  })

  it('detail 为空串时不留空字段', () => {
    expect(normalizeRefs([{ type: 'agent', key: 'k', label: 'L', detail: '   ' }])[0]).toEqual({
      type: 'agent',
      key: 'k',
      label: 'L'
    })
  })

  it('条数上限', () => {
    const many = Array.from({ length: MAX_REFS + 10 }, (_, i) => ({ type: 'agent', key: `k${i}`, label: 'L' }))
    expect(normalizeRefs(many)).toHaveLength(MAX_REFS)
  })

  it('未知 type 原样保留(为将来的类型留门)', () => {
    expect(normalizeRefs([{ type: 'future', key: 'k', label: 'L' }])[0].type).toBe('future')
  })
})

describe('sameRef', () => {
  it('同类型同键视为同一目标', () => {
    expect(sameRef({ type: 'agent', key: 'k', label: 'A' }, { type: 'agent', key: 'k', label: 'B' })).toBe(true)
    expect(sameRef({ type: 'agent', key: 'k', label: 'L' }, { type: 'cron', key: 'k', label: 'L' })).toBe(false)
    expect(sameRef({ type: 'agent', key: 'a', label: 'L' }, { type: 'agent', key: 'b', label: 'L' })).toBe(false)
  })
})

describe('normalizeTags', () => {
  it('trim + 去重 + 丢空值', () => {
    expect(normalizeTags([' a ', 'a', '', '  ', 'b'], MAX_TAGS, TAG_MAX)).toEqual(['a', 'b'])
  })

  it('非数组 / 非字符串项', () => {
    expect(normalizeTags(undefined, MAX_TAGS, TAG_MAX)).toEqual([])
    expect(normalizeTags([1, null, {}, 'ok'], MAX_TAGS, TAG_MAX)).toEqual(['ok'])
  })

  it('单项截断 + 条数上限', () => {
    expect(normalizeTags(['x'.repeat(200)], MAX_TAGS, TAG_MAX)[0]).toHaveLength(TAG_MAX)
    const many = Array.from({ length: MAX_TAGS + 5 }, (_, i) => `t${i}`)
    expect(normalizeTags(many, MAX_TAGS, TAG_MAX)).toHaveLength(MAX_TAGS)
  })
})
