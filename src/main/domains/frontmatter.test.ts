// frontmatter 的核心契约:**绝不丢失、绝不静默重写用户内容**。
//
// 这套测试守的不是「解析器算得对」,而是「写路径不产出它不该产出的行」——
// 未知键能存活是结构性的,不是靠解析器正确性推出来的。

import { describe, expect, it } from 'vitest'
import {
  assembleFile,
  bodyText,
  patchFrontmatter,
  readFrontmatter,
  renderFrontmatter,
  splitFrontmatter,
  type FrontmatterFields
} from './frontmatter'

/** 读 → 改 → 拼回整份文件 */
function apply(text: string, patch: Partial<FrontmatterFields>): string {
  const split = splitFrontmatter(text)
  const lines = split.present ? patchFrontmatter(split, patch) : renderFrontmatter(patch)
  return assembleFile({ bom: split.bom, eol: split.eol, frontmatterLines: lines, body: bodyText(split) })
}

/** 不改任何东西地拼回 —— 必须与原文逐字节相同 */
function roundTrip(text: string): string {
  const split = splitFrontmatter(text)
  return assembleFile({
    bom: split.bom,
    eol: split.eol,
    frontmatterLines: split.present ? split.lines : null,
    body: bodyText(split)
  })
}

function fields(text: string): FrontmatterFields {
  return readFrontmatter(splitFrontmatter(text)).fields
}

describe('splitFrontmatter', () => {
  it('没有围栏 → 整份当正文,不「收养」裸文件', () => {
    const split = splitFrontmatter('# 标题\n\n正文')
    expect(split.present).toBe(false)
    expect(split.unclosed).toBe(false)
    expect(split.lines).toEqual([])
    expect(bodyText(split)).toBe('# 标题\n\n正文')
  })

  it('首行不是 --- 就不算围栏(第 2 行的 --- 是分隔线)', () => {
    const split = splitFrontmatter('# 标题\n---\n正文')
    expect(split.present).toBe(false)
    expect(bodyText(split)).toBe('# 标题\n---\n正文')
  })

  it('围栏开了没闭合 → 整份当正文,并标记 unclosed(绝不补围栏)', () => {
    const text = '---\ntitle: x\n\n正文还在\n'
    const split = splitFrontmatter(text)
    expect(split.present).toBe(false)
    expect(split.unclosed).toBe(true)
    expect(bodyText(split)).toBe(text) // 一个字都没被吞进元数据
  })

  it('结束围栏也接受 YAML 的 ...', () => {
    const split = splitFrontmatter('---\ntitle: x\n...\n正文')
    expect(split.present).toBe(true)
    expect(split.lines).toEqual(['title: x'])
    expect(bodyText(split)).toBe('正文')
  })

  it('BOM 与 CRLF 都原样保留', () => {
    const text = '﻿---\r\ntitle: x\r\n---\r\nbody\r\n'
    const split = splitFrontmatter(text)
    expect(split.bom).toBe(true)
    expect(split.eol).toBe('\r\n')
    expect(roundTrip(text)).toBe(text)
  })

  it('纯 LF 文件逐字节往返', () => {
    const text = '---\ntitle: x\ntags:\n  - a\n---\n\nbody\n'
    expect(roundTrip(text)).toBe(text)
  })

  it('frontmatter 超上限 → opaque,不解析', () => {
    const big = `---\nnote: ${'x'.repeat(17 * 1024)}\n---\nbody`
    const split = splitFrontmatter(big)
    expect(split.opaque).toBe(true)
    expect(readFrontmatter(split).fields).toEqual({})
  })
})

describe('读:标量', () => {
  it('值里带冒号 —— 只按第一个冒号切分', () => {
    expect(fields('---\ntitle: "带:冒号的值"\n---\n').title).toBe('带:冒号的值')
    expect(fields('---\ntitle: 带:冒号的值\n---\n').title).toBe('带:冒号的值')
  })

  it('值里带井号 —— 不当注释剥掉', () => {
    expect(fields('---\ntitle: 带 # 井号的值\n---\n').title).toBe('带 # 井号的值')
  })

  it('单引号与双引号都认', () => {
    expect(fields("---\ntitle: '单引号'\n---\n").title).toBe('单引号')
    expect(fields('---\ntitle: "双引号"\n---\n').title).toBe('双引号')
  })

  it('created 是不透明字符串 —— 日期绝不能被转成 Date', () => {
    const f = fields('---\ncreated: 2026-10-09\n---\n')
    expect(f.created).toBe('2026-10-09')
    expect(typeof f.created).toBe('string')
  })

  it('pinned 认 true/yes/on,其余为 false', () => {
    expect(fields('---\npinned: true\n---\n').pinned).toBe(true)
    expect(fields('---\npinned: yes\n---\n').pinned).toBe(true)
    expect(fields('---\npinned: false\n---\n').pinned).toBe(false)
    expect(fields('---\nother: 1\n---\n').pinned).toBeUndefined()
  })

  it('块标量形态认不出 → 记入 issues,读作缺失', () => {
    const split = splitFrontmatter('---\ntitle: |\n  多行\n  文本\ntags:\n  - a\n---\n')
    const r = readFrontmatter(split)
    expect(r.fields.title).toBeUndefined()
    expect(r.fields.tags).toEqual(['a']) // 同一份文件里的其它键不受影响
    expect(r.issues).toContain('title')
  })

  it('锚点 / 别名 / 标签形态认不出 → issues', () => {
    expect(readFrontmatter(splitFrontmatter('---\ntitle: &a foo\n---\n')).issues).toContain('title')
    expect(readFrontmatter(splitFrontmatter('---\ntitle: *a\n---\n')).issues).toContain('title')
  })
})

describe('读:tags', () => {
  it('块序列形态', () => {
    expect(fields('---\ntags:\n  - redis\n  - 故障\n---\n').tags).toEqual(['redis', '故障'])
  })

  it('flow 形态也读得懂', () => {
    expect(fields('---\ntags: [redis, 故障]\n---\n').tags).toEqual(['redis', '故障'])
  })

  it('单标量按 YAML 语义当单元素序列', () => {
    expect(fields('---\ntags: redis\n---\n').tags).toEqual(['redis'])
  })

  it('去重 + 丢空值', () => {
    expect(fields('---\ntags:\n  - a\n  - a\n  - ""\n---\n').tags).toEqual(['a'])
  })
})

describe('读:refs', () => {
  const blockRefs = [
    '---',
    'refs:',
    '  - type: agent',
    '    key: user:com.foo',
    '    label: com.foo',
    '    detail: user · ~/Library/LaunchAgents',
    '---',
    ''
  ].join('\n')

  it('块序列形态解析出 type/key/label/detail', () => {
    expect(fields(blockRefs).refs).toEqual([
      {
        type: 'agent',
        key: 'user:com.foo',
        label: 'com.foo',
        detail: 'user · ~/Library/LaunchAgents'
      }
    ])
  })

  it('label 缺失时退化成 key(至少能显示点什么)', () => {
    const t = '---\nrefs:\n  - type: service\n    key: 8080:node\n---\n'
    expect(fields(t).refs).toEqual([{ type: 'service', key: '8080:node', label: '8080:node' }])
  })

  it('flow 形态 → refsUnparsed,不解析', () => {
    const r = readFrontmatter(splitFrontmatter('---\nrefs: [{type: agent, key: a}]\n---\n'))
    expect(r.refsUnparsed).toBe(true)
    expect(r.fields.refs).toBeUndefined()
  })

  it('未知 type 原样往返(为将来的类型留门)', () => {
    const t = '---\nrefs:\n  - type: future-thing\n    key: k\n    label: L\n---\n'
    expect(fields(t).refs?.[0].type).toBe('future-thing')
  })
})

describe('写:只动拥有的行', () => {
  it('未知顶层键在 patch 后逐字节存活且位置不变', () => {
    const text = [
      '---',
      'aliases:',
      '  - 别名',
      'title: 旧标题',
      'cssclasses: [wide]',
      'created: 2026-10-09',
      '---',
      'body'
    ].join('\n')

    const out = apply(text, { title: '新标题' })
    expect(out).toContain('aliases:\n  - 别名') // 整块原样
    expect(out).toContain('cssclasses: [wide]') // flow 形态也不动
    expect(out).toContain('title: 新标题')
    expect(out.indexOf('aliases:')).toBeLessThan(out.indexOf('title:')) // 位置不变
  })

  it('40 行 frontmatter 里 30 个未知键 —— 只有拥有的行变化', () => {
    const unknown = Array.from({ length: 30 }, (_, i) => `custom${i}: v${i}`)
    const text = ['---', 'title: 旧', ...unknown, 'created: 2026-10-09', '---', 'body'].join('\n')

    const before = text.split('\n')
    const after = apply(text, { title: '新' }).split('\n')

    const changed = before.filter((l, i) => l !== after[i])
    expect(changed).toEqual(['title: 旧']) // 恰好一行
  })

  it('未在 patch 里出现的拥有键原样保留', () => {
    const text = '---\ntitle: 标题\ncreated: 2026-10-09\ntags:\n  - a\n---\nbody'
    const out = apply(text, { updated: '2026-10-09T10:00:00+08:00' })
    expect(out).toContain('title: 标题')
    expect(out).toContain('created: 2026-10-09')
    expect(out).toContain('tags:\n  - a')
  })

  it('形态认不出的键写时跳过,绝不被覆盖', () => {
    const text = '---\ntitle: |\n  多行\n  文本\ntags:\n  - a\n---\nbody'
    const out = apply(text, { tags: ['a', 'b'] })
    expect(out).toContain('title: |\n  多行\n  文本') // 块标量原封不动
    expect(out).toContain('  - b')
  })

  it('refs 条目里的未知子键在改写后存活', () => {
    const text = [
      '---',
      'refs:',
      '  - type: agent',
      '    key: user:com.foo',
      '    label: 旧名',
      '    custom: keepme',
      '    detail: user',
      '---',
      'body'
    ].join('\n')

    const out = apply(text, {
      refs: [{ type: 'agent', key: 'user:com.foo', label: '新名', detail: 'user' }]
    })
    expect(out).toContain('label: 新名')
    expect(out).toContain('custom: keepme') // 未知子键原样
  })

  it('refs 里 detail 被移除时,那一行消失而其余保留', () => {
    const text = '---\nrefs:\n  - type: cron\n    key: abc\n    label: L\n    detail: 30 2 * * *\n---\n'
    const out = apply(text, { refs: [{ type: 'cron', key: 'abc', label: 'L' }] })
    expect(out).not.toContain('detail:')
    expect(out).toContain('label: L')
  })

  it('新增条目用规范缩进,插在既有条目之后', () => {
    const text = '---\nrefs:\n  - type: agent\n    key: k1\n    label: L1\n---\n'
    const out = apply(text, {
      refs: [
        { type: 'agent', key: 'k1', label: 'L1' },
        { type: 'service', key: '8080:node', label: 'node', detail: '127.0.0.1:8080' }
      ]
    })
    expect(out).toContain('  - type: service\n    key: 8080:node\n    label: node\n    detail: 127.0.0.1:8080')
  })

  it('文件里没有的键追加到末尾,顺序规范', () => {
    const out = apply('---\ntitle: t\n---\nbody', { pinned: true, tags: ['a'] })
    const lines = out.split('\n')
    // 规范顺序:title / created / updated / tags / pinned / refs
    expect(lines.indexOf('tags:')).toBeGreaterThan(lines.indexOf('title: t'))
    expect(lines.indexOf('pinned: true')).toBeGreaterThan(lines.indexOf('tags:'))
  })

  it('pinned 为 false 时删掉该行而不是写 false', () => {
    expect(apply('---\ntitle: t\npinned: true\n---\n', { pinned: false })).not.toContain('pinned')
  })

  it('tags 语义未变时原样透传 —— flow 形态不会被重排成块形态', () => {
    const text = '---\ntags: [b, a]\n---\nbody'
    expect(apply(text, { tags: ['b', 'a'] })).toBe(text)
  })
})

describe('写:值的引号策略', () => {
  it('歧义值加引号(否则会被别的 YAML 解析器读成布尔/数字/null)', () => {
    expect(apply('---\n---\n', { title: 'true' })).toContain('title: "true"')
    expect(apply('---\n---\n', { title: '2026' })).toContain('title: "2026"')
    expect(apply('---\n---\n', { title: 'null' })).toContain('title: "null"')
    expect(apply('---\n---\n', { title: '~' })).toContain('title: "~"')
  })

  it('以特殊字符开头 / 含 ": " 或 " #" 的值加引号', () => {
    expect(apply('---\n---\n', { title: '- 开头' })).toContain('title: "- 开头"')
    expect(apply('---\n---\n', { title: 'a: b' })).toContain('title: "a: b"')
    expect(apply('---\n---\n', { title: 'a #b' })).toContain('title: "a #b"')
  })

  it('普通值(含中文与冒号后无空格)不加引号', () => {
    expect(apply('---\n---\n', { title: '排查 redis 重启' })).toContain('title: 排查 redis 重启')
    expect(apply('---\n---\n', { title: 'a:b' })).toContain('title: a:b')
  })

  it('写出的值能被自己读回来(往返一致)', () => {
    for (const v of ['true', '2026', '- 开头', 'a: b', 'a #b', '排查 redis', '带"引号"', "带'单引号'"]) {
      const text = apply('---\n---\nbody', { title: v })
      expect(fields(text).title).toBe(v)
    }
  })
})

describe('写:幂等', () => {
  it('同值 patch 两次,第二次字节不变', () => {
    const text = '---\ntitle: t\ntags:\n  - a\nrefs:\n  - type: agent\n    key: k\n    label: L\n---\nbody'
    const patch = {
      title: 't',
      tags: ['a'],
      refs: [{ type: 'agent', key: 'k', label: 'L' }]
    }
    const once = apply(text, patch)
    expect(apply(once, patch)).toBe(once)
  })

  it('updated 是唯一每次都会变的行', () => {
    const text = '---\ntitle: t\ncreated: 2026-01-01\n---\nbody'
    const a = apply(text, { updated: '2026-10-09T10:00:00+08:00' })
    const b = apply(a, { updated: '2026-10-09T11:00:00+08:00' })
    const diff = a.split('\n').filter((l, i) => l !== b.split('\n')[i])
    expect(diff).toEqual(['updated: 2026-10-09T10:00:00+08:00'])
  })
})

describe('renderFrontmatter', () => {
  it('按规范顺序产出', () => {
    const lines = renderFrontmatter({
      title: '标题',
      created: '2026-10-09T10:00:00+08:00',
      updated: '2026-10-09T10:00:00+08:00',
      tags: ['a'],
      pinned: true,
      refs: [{ type: 'agent', key: 'k', label: 'L' }]
    })
    expect(lines[0]).toBe('title: 标题')
    expect(lines).toContain('pinned: true')
    expect(lines.join('\n')).toContain('refs:\n  - type: agent')
  })

  it('空字段不产出空行', () => {
    expect(renderFrontmatter({ title: 't', tags: [] })).toEqual(['title: t'])
  })

  it('产出的 frontmatter 能被自己读回来', () => {
    const lines = renderFrontmatter({ title: '标题', tags: ['a', 'b'], pinned: true })
    const text = assembleFile({ bom: false, eol: '\n', frontmatterLines: lines, body: '正文' })
    expect(fields(text)).toEqual({ title: '标题', tags: ['a', 'b'], pinned: true })
    expect(bodyText(splitFrontmatter(text))).toBe('正文')
  })
})

describe('assembleFile', () => {
  it('frontmatterLines 为 null → 裸正文', () => {
    expect(assembleFile({ bom: false, eol: '\n', frontmatterLines: null, body: '# hi\n' })).toBe('# hi\n')
  })

  it('空正文不会多出空行', () => {
    const text = assembleFile({ bom: false, eol: '\n', frontmatterLines: ['title: t'], body: '' })
    expect(text).toBe('---\ntitle: t\n---\n')
  })
})
