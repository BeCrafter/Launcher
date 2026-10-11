import { describe, expect, it } from 'vitest'
import { slugifyNoteTitle, titleFromBody, uniqueNoteId } from './note-id'
import { NOTE_SLUG_MAX } from '../../shared/notes'

describe('slugifyNoteTitle', () => {
  it('**文件名就是标题**:空白原样保留,不转成连字符', () => {
    expect(slugifyNoteTitle('排查 redis 反复重启')).toBe('排查 redis 反复重启')
    expect(slugifyNoteTitle('test 2')).toBe('test 2')
  })

  it('保留 CJK', () => {
    expect(slugifyNoteTitle('为什么 nginx 起不来')).toBe('为什么 nginx 起不来')
  })

  it('路径非法字符换成连字符', () => {
    expect(slugifyNoteTitle('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
    expect(slugifyNoteTitle('带\u0000控制字符')).toBe('带-控制字符')
  })

  it('内部空白原样,替换符不重复', () => {
    expect(slugifyNoteTitle('a   b')).toBe('a   b')
    expect(slugifyNoteTitle('a//b')).toBe('a-b') // 连续替换符收成一个
  })

  it('前导点被剥掉(否则是隐藏文件,也会和 .trash 撞)', () => {
    expect(slugifyNoteTitle('.hidden')).toBe('hidden')
    expect(slugifyNoteTitle('...x')).toBe('x')
  })

  it('全非法字符时回退到 note,而不是产出空文件名', () => {
    expect(slugifyNoteTitle('///')).toBe('note')
    expect(slugifyNoteTitle('   ')).toBe('note')
    expect(slugifyNoteTitle('')).toBe('note')
  })

  it('按码点截断,不会把 emoji 的代理对切成孤立代理', () => {
    const title = '🎉'.repeat(200)
    const out = slugifyNoteTitle(title)
    expect(Array.from(out)).toHaveLength(NOTE_SLUG_MAX)
    // 孤立代理会在这里现形(合法字符串的代理对总是成对出现)
    expect(out).toBe(Array.from(out).join(''))
    expect(/[\uD800-\uDBFF]$/.test(out)).toBe(false)
  })

  it('长标题截断到上限', () => {
    expect(Array.from(slugifyNoteTitle('x'.repeat(500)))).toHaveLength(NOTE_SLUG_MAX)
  })

  it('截断后不留下尾部连字符', () => {
    const out = slugifyNoteTitle(`${'a'.repeat(NOTE_SLUG_MAX - 1)} b`)
    expect(out.endsWith('-')).toBe(false)
  })
})


describe('uniqueNoteId', () => {
  it('不冲突时用本体', () => {
    expect(uniqueNoteId('note', new Set(), 0)).toBe('note')
  })

  it('冲突时依次加序号', () => {
    expect(uniqueNoteId('note', new Set(['note']), 0)).toBe('note-2')
    expect(uniqueNoteId('note', new Set(['note', 'note-2']), 0)).toBe('note-3')
  })

  it('序号用尽后走时间戳兜底', () => {
    const taken = new Set(['note', ...Array.from({ length: 98 }, (_, i) => `note-${i + 2}`)])
    expect(uniqueNoteId('note', taken, 1_700_000_000_000)).toBe(`note-${(1_700_000_000_000).toString(36)}`)
  })

  it('时间戳也撞上时继续自增,不会返回已占用的 id', () => {
    const stamp = (1_700_000_000_000).toString(36)
    const taken = new Set(['note', ...Array.from({ length: 98 }, (_, i) => `note-${i + 2}`), `note-${stamp}`])
    const out = uniqueNoteId('note', taken, 1_700_000_000_000)
    expect(out).toBe(`note-${stamp}-1`)
    expect(taken.has(out)).toBe(false)
  })
})

describe('titleFromBody', () => {
  it('取正文首个 # 标题', () => {
    expect(titleFromBody('## 二级不算\n# 真标题\n', '兜底')).toBe('真标题')
    expect(titleFromBody('# 标题\n正文', '兜底')).toBe('标题')
  })

  it('跳过围栏代码块里的 # 注释', () => {
    expect(titleFromBody('```sh\n# 这是注释\n```\n# 真标题\n', '兜底')).toBe('真标题')
    expect(titleFromBody('~~~\n# 注释\n~~~\n', '兜底')).toBe('兜底')
  })

  it('没有标题时回退', () => {
    expect(titleFromBody('正文\n\n更多正文', '文件名')).toBe('文件名')
    expect(titleFromBody('', '文件名')).toBe('文件名')
  })

  it('# 后必须有内容才算标题', () => {
    expect(titleFromBody('#\n# \n', '兜底')).toBe('兜底')
  })
})
