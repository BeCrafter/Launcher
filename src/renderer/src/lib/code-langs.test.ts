// 围栏语言 → 解析器。
//
// 这里守的是「别名指对了地方」:`plist` 要落到 XML、`bash` 要落到 shell、
// `c++` 不能被截成 `c`。指错了不会报错,只会把整段配置染成另一个语言的配色。

import { describe, expect, it } from 'vitest'
import { languageFor, normalizeLang, parserFor } from './code-langs'

describe('normalizeLang', () => {
  it('取第一个词,后面的属性丢掉', () => {
    expect(normalizeLang('js title="示例"')).toBe('js')
    expect(normalizeLang('  Python  ')).toBe('python')
    expect(normalizeLang('json:{a:1}')).toBe('json')
  })

  it('大小写归一', () => {
    expect(normalizeLang('JavaScript')).toBe('javascript')
  })

  it('空信息串得到空串', () => {
    expect(normalizeLang('')).toBe('')
    expect(normalizeLang('   ')).toBe('')
  })
})

describe('parserFor', () => {
  it.each([
    ['js', true],
    ['javascript', true],
    ['ts', true],
    ['tsx', true],
    ['json', true],
    ['html', true],
    ['css', true],
    ['scss', true],
    ['xml', true],
    // 本项目的主战场:launchd 的 plist 就是 XML
    ['plist', true],
    ['markdown', true],
    ['md', true],
    ['sh', true],
    ['bash', true],
    ['zsh', true],
    ['shell', true],
    ['py', true],
    ['yaml', true],
    ['yml', true],
    ['toml', true],
    ['ini', true],
    ['conf', true],
    ['dockerfile', true],
    ['sql', true],
    ['go', true],
    ['rust', true],
    ['c', true],
    ['c++', true],
    ['objective-c', true],
    ['java', true],
    ['diff', true],
    ['nginx', true]
  ])('%s → 有解析器', (lang, ok) => {
    expect(parserFor(lang) !== null).toBe(ok)
  })

  it.each([['', false], ['mermaid', false], ['text', false], ['日志', false], ['nonsense', false]])(
    '%s → 没有解析器(渲染成纯文本,而不是猜一个近似的语法)',
    (lang, ok) => {
      expect(parserFor(lang) !== null).toBe(ok)
    }
  )

  it('c++ 与 c 是两个不同的语言(不能被截断成同一个)', () => {
    expect(parserFor('c++')).not.toBe(parserFor('c'))
  })

  it('别名与规范名指向同一个解析器', () => {
    expect(parserFor('plist')).toBe(parserFor('xml'))
    expect(parserFor('bash')).toBe(parserFor('shell'))
    expect(parserFor('yml')).toBe(parserFor('yaml'))
    expect(parserFor('ts')).toBe(parserFor('typescript'))
  })

  it('解析器能真的把一段代码解析成树,不抛异常', () => {
    for (const lang of ['js', 'json', 'xml', 'yaml', 'shell', 'python', 'sql', 'go', 'rust', 'ini']) {
      const p = parserFor(lang)!
      expect(() => p.parse('a = 1\nb: [x]\n<tag attr="1"/>\n')).not.toThrow()
    }
  })
})

describe('languageFor(编辑器要的是 Language,不是 Parser)', () => {
  it('返回的对象同时带着 name 与 parser —— markdown({ codeLanguages }) 要的就是它', () => {
    const lang = languageFor('js')
    expect(lang).not.toBeNull()
    expect(typeof lang!.name).toBe('string')
    expect(lang!.parser).toBe(parserFor('js'))
  })

  it('与 parserFor 的判定完全一致(同一个表,不会一个认一个不认)', () => {
    for (const name of ['js', 'plist', 'bash', 'c++', 'mermaid', 'nonsense', '']) {
      expect(languageFor(name) === null).toBe(parserFor(name) === null)
    }
  })

  it('别名照样落到同一个 Language 实例上', () => {
    expect(languageFor('plist')).toBe(languageFor('xml'))
    expect(languageFor('yml')).toBe(languageFor('yaml'))
  })
})
