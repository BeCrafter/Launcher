import { describe, expect, it } from 'vitest'
import {
  canvasDisplayPath,
  canvasEmbedAllowed,
  canvasEmbedRef,
  canvasInternalData,
  canvasRefBadge,
  canvasRefFromLink,
  isCanvasPath,
  readCanvasInternal,
  retargetCanvasText,
  type CanvasEmbedRef
} from './canvas-ref'

const EXTERNAL = { source: '/tmp/说明.pdf', project: '', host: '这台电脑' }

function scene(elements: unknown[]): string {
  return JSON.stringify(
    {
      type: 'excalidraw',
      version: 2,
      source: 'https://excalidraw.com',
      elements,
      appState: {},
      files: {}
    },
    null,
    2
  )
}

function embed(id: string, link: string | null, customData?: unknown): Record<string, unknown> {
  return {
    type: 'embeddable',
    id,
    x: 0,
    y: 0,
    width: 360,
    height: 240,
    link,
    isDeleted: false,
    ...(customData === undefined ? {} : { customData })
  }
}

function launcher(kind: 'note' | 'file', value: string): Record<string, unknown> {
  return { launcher: kind === 'note' ? { kind, id: value } : { kind, path: value } }
}

describe('canvasRefFromLink', () => {
  it('旧协议里的中文逐段解码一次', () => {
    expect(canvasRefFromLink('note:%E8%B5%84%E6%96%99/%E6%88%91%E7%9A%84%20%E7%AC%94%E8%AE%B0')).toEqual({
      kind: 'note',
      id: '资料/我的 笔记'
    })
    expect(canvasRefFromLink('launcher-note://file/%E5%9B%BE/a%20b.png?v=7')).toEqual({
      kind: 'file',
      path: '图/a b.png'
    })
  })

  it('可读路径原样使用:中文和空格不转义,字面 %20 不被解码', () => {
    expect(canvasRefFromLink('资料/我的 笔记.md')).toEqual({ kind: 'note', id: '资料/我的 笔记' })
    expect(canvasRefFromLink('图 1.png')).toEqual({ kind: 'file', path: '图 1.png' })
    expect(canvasRefFromLink('附件/50%20off.png')).toEqual({ kind: 'file', path: '附件/50%20off.png' })
  })

  it('网页原样保留,绝对路径兜底成库外文件', () => {
    expect(canvasRefFromLink(' https://example.com/a b ')).toEqual({
      kind: 'web',
      url: 'https://example.com/a b'
    })
    const external = canvasRefFromLink('/tmp/说明.pdf')
    expect(external?.kind).toBe('external')
    expect(external !== null && external.kind === 'external' ? external.source : null).toBe(
      '/tmp/说明.pdf'
    )
  })

  it('空串、坏编码、危险协议和越界路径都不认', () => {
    expect(canvasRefFromLink(null)).toBeNull()
    expect(canvasRefFromLink('   ')).toBeNull()
    expect(canvasRefFromLink('note:%E0%A4%A')).toBeNull()
    expect(canvasRefFromLink('javascript:alert(1)')).toBeNull()
    expect(canvasRefFromLink('data:text/html,hi')).toBeNull()
    expect(canvasRefFromLink('file:///etc/passwd')).toBeNull()
    expect(canvasRefFromLink('../外面的文件.txt')).toBeNull()
    expect(canvasRefFromLink('https://')).toBeNull()
  })

  it('validateEmbeddable 用同一套判断:认不出就不给交互提示', () => {
    expect(canvasEmbedAllowed('资料/我的 笔记.md')).toBe(true)
    expect(canvasEmbedAllowed('/tmp/说明.pdf')).toBe(true)
    expect(canvasEmbedAllowed('https://example.com/a')).toBe(true)
    expect(canvasEmbedAllowed('note:%E6%97%A5%E5%B8%B8')).toBe(true)
    expect(canvasEmbedAllowed('javascript:alert(1)')).toBe(false)
    expect(canvasEmbedAllowed('')).toBe(false)
  })
})

describe('customData 优先', () => {
  it('库外记录盖过链接;内部引用盖过旧协议链接', () => {
    const external = canvasEmbedRef({ embed: EXTERNAL }, '说明.pdf')
    expect(external).toEqual({ kind: 'external', ...EXTERNAL })
    expect(canvasEmbedRef(launcher('note', '新的笔记'), 'note:%E6%97%A7')).toEqual({
      kind: 'note',
      id: '新的笔记'
    })
    expect(canvasEmbedRef(launcher('file', '图/a.png'), null)).toEqual({
      kind: 'file',
      path: '图/a.png'
    })
  })

  it('launcher 写得不对就退回解析链接', () => {
    expect(readCanvasInternal({ launcher: { kind: 'note', id: '../跑出去' } })).toBeNull()
    expect(canvasEmbedRef({ launcher: { kind: 'note', id: '' } }, '旧的.md')).toEqual({
      kind: 'note',
      id: '旧的'
    })
  })

  it('写 launcher 时保留其他自定义字段,并清掉 embed', () => {
    expect(canvasInternalData({ kind: 'note', id: 'a' }, { keep: 1, embed: EXTERNAL })).toEqual({
      keep: 1,
      launcher: { kind: 'note', id: 'a' }
    })
    expect(canvasInternalData({ kind: 'file', path: 'a.png' })).toEqual({
      launcher: { kind: 'file', path: 'a.png' }
    })
  })
})

describe('展示路径与角标', () => {
  const cases: Array<[CanvasEmbedRef, string | null, string]> = [
    [{ kind: 'note', id: '资料/记录' }, '资料/记录.md', 'note'],
    [{ kind: 'file', path: '附件/说明.pdf' }, '附件/说明.pdf', 'vault'],
    [{ kind: 'file', path: '画/子白板.excal' }, '画/子白板.excal', 'canvas'],
    [{ kind: 'external', ...EXTERNAL }, '/tmp/说明.pdf', 'external'],
    [{ kind: 'web', url: 'https://example.com' }, null, 'web']
  ]
  it.each(cases)('%j', (ref, path, badge) => {
    expect(canvasDisplayPath(ref)).toBe(path)
    expect(canvasRefBadge(ref)).toBe(badge)
  })

  it('白板的两种后缀、大小写都算白板;不是白板仍是库内', () => {
    expect(canvasRefBadge({ kind: 'file', path: '旧板.excalidraw' })).toBe('canvas')
    expect(canvasRefBadge({ kind: 'file', path: '大写.EXCALIDRAW' })).toBe('canvas')
    expect(canvasRefBadge({ kind: 'file', path: '画.excal.txt' })).toBe('vault')
    expect(canvasRefBadge({ kind: 'file', path: '没有后缀' })).toBe('vault')
    expect(isCanvasPath('a/b/板.excal')).toBe(true)
    expect(isCanvasPath('板.其他')).toBe(false)
  })

  it('库外优先源文件,没有源文件时用打包副本', () => {
    expect(
      canvasDisplayPath({ kind: 'external', source: '', project: '附件/说明.pdf', host: '' })
    ).toBe('附件/说明.pdf')
    expect(canvasDisplayPath({ kind: 'external', source: '', project: '', host: '' })).toBeNull()
  })
})

describe('retargetCanvasText', () => {
  it('笔记改名:link 和 launcher 一起换,其他元素与字段逐字保留', () => {
    const text = scene([
      { type: 'text', id: 't', text: '不动的字', originalText: '不动的字', isDeleted: false },
      embed('a', '旧笔记.md', launcher('note', '旧笔记')),
      embed('b', 'https://example.com/a', { keep: true }),
      embed('c', '旧笔记.md', launcher('note', '旧笔记'))
    ])
    const out = retargetCanvasText(text, [{ from: '旧笔记.md', to: '新笔记.md' }])
    expect(out.changed).toBe(true)
    const next = JSON.parse(out.text)
    expect(next.elements[0]).toEqual({
      type: 'text',
      id: 't',
      text: '不动的字',
      originalText: '不动的字',
      isDeleted: false
    })
    expect(next.elements[1].link).toBe('新笔记.md')
    expect(next.elements[1].customData).toEqual({ launcher: { kind: 'note', id: '新笔记' } })
    expect(next.elements[2].link).toBe('https://example.com/a')
    expect(next.elements[2].customData).toEqual({ keep: true })
    expect(next.elements[3].link).toBe('新笔记.md')
  })

  it('旧协议链接也能改写,并升成可读路径', () => {
    const text = scene([
      embed('a', 'note:%E6%97%A5%E5%B8%B8/%E8%AE%B0%E5%BD%95'),
      embed('b', 'launcher-note://file/%E5%9B%BE/a.png')
    ])
    const out = retargetCanvasText(text, [
      { from: '日常/记录.md', to: '工作/记录.md' },
      { from: '图/a.png', to: '图/b.png' }
    ])
    const next = JSON.parse(out.text)
    expect(next.elements[0].link).toBe('工作/记录.md')
    expect(next.elements[0].customData.launcher).toEqual({ kind: 'note', id: '工作/记录' })
    expect(next.elements[1].link).toBe('图/b.png')
    expect(next.elements[1].customData.launcher).toEqual({ kind: 'file', path: '图/b.png' })
  })

  it('目录改名按段边界匹配,不碰同名前缀的根层对象', () => {
    const text = scene([
      embed('a', '工作/笔记.md', launcher('note', '工作/笔记')),
      embed('b', '工作/图.png', launcher('file', '工作/图.png')),
      embed('c', '工作-2/别的.md', launcher('note', '工作-2/别的')),
      embed('d', '工作.md', launcher('note', '工作')),
      embed('e', '工作日记.md', launcher('note', '工作日记'))
    ])
    const out = retargetCanvasText(text, [{ from: '工作', to: '项目', prefix: true }])
    const next = JSON.parse(out.text)
    const links = next.elements.map((element: { link: string }) => element.link)
    expect(links).toEqual(['项目/笔记.md', '项目/图.png', '工作-2/别的.md', '工作.md', '工作日记.md'])
  })

  it('笔记与普通文件互相转换时角标种类跟着换', () => {
    const toFile = retargetCanvasText(
      scene([embed('a', '文档.md', launcher('note', '文档'))]),
      [{ from: '文档.md', to: '文档.txt' }]
    )
    expect(JSON.parse(toFile.text).elements[0].link).toBe('文档.txt')
    expect(JSON.parse(toFile.text).elements[0].customData.launcher).toEqual({
      kind: 'file',
      path: '文档.txt'
    })

    const toNote = retargetCanvasText(
      scene([embed('a', '旧.txt', launcher('file', '旧.txt'))]),
      [{ from: '旧.txt', to: '旧.md' }]
    )
    expect(JSON.parse(toNote.text).elements[0].link).toBe('旧.md')
    expect(JSON.parse(toNote.text).elements[0].customData.launcher).toEqual({
      kind: 'note',
      id: '旧'
    })
  })

  it('库外只改打包副本 project,源文件和网页不动', () => {
    const text = scene([
      embed('a', '/tmp/说明.pdf', { embed: { source: '/tmp/说明.pdf', project: '', host: 'h' } }),
      embed('b', '附件/说明.pdf', {
        embed: { source: '', project: '附件/说明.pdf', host: 'h' }
      }),
      embed('c', 'https://example.com/a')
    ])
    const out = retargetCanvasText(text, [{ from: '附件', to: '资料', prefix: true }])
    const next = JSON.parse(out.text)
    expect(next.elements[0].link).toBe('/tmp/说明.pdf')
    expect(next.elements[0].customData.embed.project).toBe('')
    expect(next.elements[1].link).toBe('资料/说明.pdf')
    expect(next.elements[1].customData.embed).toEqual({
      source: '',
      project: '资料/说明.pdf',
      host: 'h'
    })
    expect(next.elements[2].link).toBe('https://example.com/a')
  })

  it('没有命中时不改一个字节;坏 JSON 同样原样返回', () => {
    const text = scene([embed('a', '别的.md', launcher('note', '别的'))])
    expect(retargetCanvasText(text, [{ from: '旧.md', to: '新.md' }])).toEqual({
      text,
      changed: false
    })
    expect(retargetCanvasText('不是 json', [{ from: 'a', to: 'b' }])).toEqual({
      text: '不是 json',
      changed: false
    })
    expect(retargetCanvasText(text, [])).toEqual({ text, changed: false })
  })

  it('删掉的元素也一起改(撤销堆里可能还留着旧版本),第二次调用不再变化', () => {
    const trash = embed('a', '旧.md', launcher('note', '旧'))
    trash.isDeleted = true
    const out = retargetCanvasText(scene([trash]), [{ from: '旧.md', to: '新.md' }])
    expect(JSON.parse(out.text).elements[0].link).toBe('新.md')
    expect(retargetCanvasText(out.text, [{ from: '旧.md', to: '新.md' }])).toEqual({
      text: out.text,
      changed: false
    })
  })

  it('保留文件结尾的换行', () => {
    const out = retargetCanvasText(scene([embed('a', '旧.md')]) + '\n', [
      { from: '旧.md', to: '新.md' }
    ])
    expect(out.text.endsWith('\n')).toBe(true)
    expect(JSON.parse(out.text).elements[0].link).toBe('新.md')
  })
})
