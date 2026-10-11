// 附件地址的两端:写出去的形式与读回来的形式。
//
// 事故背景:粘贴图片写的是 `![](assets/Pasted image 20261009150211.png)` ——
// 名字里有空格。这在 CommonMark 里是不合法的地址写法(GitHub 渲染不出来),
// 而我们自己的解析正则当时也不收空格,于是**一张图都显示不出来**。
// 现在的约定是:写出去时编码(`%20`),读回来时两种写法都收。

import { describe, expect, it } from 'vitest'
import { NOTES_ASSET_SCHEME } from '@shared/notes'
import { encodeNoteAssetPath, resolvePreviewSrc, resolveNoteAssetSrc } from './note-asset'

const ASSET = `${NOTES_ASSET_SCHEME}://asset/`

describe('encodeNoteAssetPath(写出去的形式)', () => {
  it('空格编码成 %20,路径分隔符保留', () => {
    expect(encodeNoteAssetPath('assets/Pasted image 20261009150211.png')).toBe(
      'assets/Pasted%20image%2020261009150211.png'
    )
  })

  it('中文文件名照样能编码', () => {
    expect(encodeNoteAssetPath('assets/截图 1.png')).toBe('assets/%E6%88%AA%E5%9B%BE%201.png')
  })

  it('没有特殊字符时原样不动', () => {
    expect(encodeNoteAssetPath('assets/a.png')).toBe('assets/a.png')
  })
})

describe('resolveNoteAssetSrc(读回来的形式)', () => {
  it('裸空格与 %20 都解析到同一个地址', () => {
    const raw = resolveNoteAssetSrc('assets/Pasted image.png')
    const encoded = resolveNoteAssetSrc('assets/Pasted%20image.png')
    expect(raw).toBe(`${ASSET}assets/Pasted%20image.png`)
    expect(encoded).toBe(raw)
  })

  it('**不会二次编码** —— 已经是 %20 的地址再编码一次就永远找不到文件', () => {
    expect(resolveNoteAssetSrc('assets/a%20b.png')).not.toContain('%2520')
    expect(resolveNoteAssetSrc('assets/a%20b.png')).toBe(`${ASSET}assets/a%20b.png`)
  })

  it('中文名编码成 UTF-8 百分号序列', () => {
    expect(resolveNoteAssetSrc('assets/截图.png')).toBe(`${ASSET}assets/%E6%88%AA%E5%9B%BE.png`)
  })

  it('非法百分号编码不会抛,按原样处理', () => {
    expect(() => resolveNoteAssetSrc('assets/100%.png')).not.toThrow()
    expect(resolveNoteAssetSrc('assets/100%.png')).toContain('assets/100%25.png')
  })

  it.each([
    ['https://tracker.example/x.png', 'http 图片不加载 —— 预览绝不发起网络请求'],
    ['http://x/y.png', 'http 同上'],
    ['data:image/png;base64,AAAA', 'data URI 不加载'],
    ['file:///etc/passwd', 'file 不加载'],
    ['/etc/passwd', '绝对路径不加载 —— 那是读到目录外的入口'],
    ['~/Pictures/x.png', '家目录写法不加载'],
    ['', '空地址']
  ])('%s → null(%s)', (src) => {
    expect(resolveNoteAssetSrc(src)).toBeNull()
  })

  it('./ 前缀会被规整掉(等价路径不该产生两个 URL)', () => {
    expect(resolveNoteAssetSrc('./assets/a.png')).toBe(`${ASSET}assets/a.png`)
    expect(resolveNoteAssetSrc('assets//a.png')).toBe(`${ASSET}assets/a.png`)
  })
})

describe('resolvePreviewSrc(预览里所有会联网的地址都走它:图片 / 媒体 / 网页嵌入)', () => {
  it('http(s) 原样放行 —— 远程图片与远程网页都靠这条', () => {
    expect(resolvePreviewSrc('https://example.com')).toBe('https://example.com')
    expect(resolvePreviewSrc('http://localhost:8080/report')).toBe('http://localhost:8080/report')
  })

  it('相对路径走笔记目录的自定义协议', () => {
    expect(resolvePreviewSrc('assets/report.html')).toBe(`${ASSET}assets/report.html`)
    expect(resolvePreviewSrc('assets/我的 报告.html')).toBe(`${ASSET}assets/%E6%88%91%E7%9A%84%20%E6%8A%A5%E5%91%8A.html`)
  })

  it('两端空白会被去掉', () => {
    expect(resolvePreviewSrc('  https://example.com  ')).toBe('https://example.com')
  })

  it.each([
    ['file:///etc/passwd', 'file: 能读整个磁盘 —— 绝不能放'],
    ['javascript:alert(1)', 'javascript: 是直接的 XSS'],
    ['data:text/html,<script>x</script>', 'data: 是另一条注入路径'],
    ['/etc/passwd', '绝对路径'],
    ['~/report.html', '家目录写法'],
    ['', '空地址']
  ])('%s → null(%s)', (src) => {
    expect(resolvePreviewSrc(src)).toBeNull()
  })
})

describe('resolvePreviewSrc:远程图片(用户明确要的能力)', () => {
  // 用户报的现象:粘一个 https 图片地址进编辑器,预览里什么都没有。
  // 原因不是解析失败,而是当时刻意不让预览联网 —— 现在放行了。
  const BILI = 'https://i1.hdslb.com/bfs/archive/fa568034fc011a06b597af79e2e50d7c88d91e98.jpg'

  it('https 图片地址原样返回,交给 <img src>', () => {
    expect(resolvePreviewSrc(BILI)).toBe(BILI)
  })

  it('本地相对路径仍然走自定义协议(两条路并存,不是二选一)', () => {
    expect(resolvePreviewSrc('assets/a.png')).toBe(`${ASSET}assets/a.png`)
  })

  it('两端空白会被去掉 —— 手粘的地址常带一个尾空格', () => {
    expect(resolvePreviewSrc(`  ${BILI}  `)).toBe(BILI)
  })

  it('放行 http(s) 不等于什么都放行:危险 scheme 一律拒绝', () => {
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,<script>x</script>', 'ftp://x/y.png']) {
      expect(resolvePreviewSrc(bad)).toBeNull()
    }
  })
})
