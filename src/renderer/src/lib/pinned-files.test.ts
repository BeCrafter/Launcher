import { describe, expect, it } from 'vitest'
import {
  MAX_PINNED_FILES,
  dropPinnedFolder,
  movePinnedFile,
  prunePinnedFiles,
  remapPinnedFile,
  remapPinnedFolder
} from './pinned-files'

describe('prunePinnedFiles', () => {
  it('只留下仍然存在的文件', () => {
    expect(
      prunePinnedFiles(['图.png', '走了.txt', '板.excal'], [{ path: '图.png' }, { path: '板.excal' }])
    ).toEqual(['图.png', '板.excal'])
  })

  it('去重并丢掉空路径', () => {
    expect(prunePinnedFiles(['a.txt', 'a.txt', '', 'b.txt'], [{ path: 'a.txt' }, { path: 'b.txt' }]))
      .toEqual(['a.txt', 'b.txt'])
  })

  it('截断到上限', () => {
    const pins = Array.from({ length: MAX_PINNED_FILES + 5 }, (_, i) => `f${i}.txt`)
    const files = pins.map((path) => ({ path }))
    expect(prunePinnedFiles(pins, files)).toHaveLength(MAX_PINNED_FILES)
  })
})

describe('remapPinnedFile', () => {
  it('只改精确命中的那一条', () => {
    expect(remapPinnedFile(['a/图.png', 'a/图-2.png'], 'a/图.png', 'b/图.png')).toEqual([
      'b/图.png',
      'a/图-2.png'
    ])
  })

  it('改名后去重', () => {
    expect(remapPinnedFile(['a.txt', 'b.txt'], 'a.txt', 'b.txt')).toEqual(['b.txt'])
  })
})

describe('remapPinnedFolder', () => {
  it('目录下所有文件跟前缀走,同名前缀的其他目录不误伤', () => {
    expect(
      remapPinnedFolder(['素材/图.png', '素材/深/表.csv', '素材2/图.png', '根.txt'], '素材', '资料')
    ).toEqual(['资料/图.png', '资料/深/表.csv', '素材2/图.png', '根.txt'])
  })

  it('根路径不做整体搬运', () => {
    expect(remapPinnedFolder(['a.txt'], '', 'x')).toEqual(['a.txt'])
  })
})

describe('dropPinnedFolder', () => {
  it('删掉目录下所有 pin,相似前缀的其他目录保留', () => {
    expect(dropPinnedFolder(['素材/图.png', '素材/深/表.csv', '素材2/图.png'], '素材')).toEqual([
      '素材2/图.png'
    ])
  })

  it('空目录路径不做任何删除', () => {
    expect(dropPinnedFolder(['a.txt'], '')).toEqual(['a.txt'])
  })
})

describe('movePinnedFile', () => {
  const pins = ['a.txt', 'b.txt', 'c.txt']

  it('往上挪', () => {
    expect(movePinnedFile(pins, 'c.txt', 0)).toEqual(['c.txt', 'a.txt', 'b.txt'])
  })

  it('往下挪', () => {
    expect(movePinnedFile(pins, 'a.txt', 2)).toEqual(['b.txt', 'a.txt', 'c.txt'])
  })

  it('挪到末尾', () => {
    expect(movePinnedFile(pins, 'a.txt', pins.length)).toEqual(['b.txt', 'c.txt', 'a.txt'])
  })

  it('回到原位时不改顺序', () => {
    expect(movePinnedFile(pins, 'b.txt', 1)).toEqual(pins)
    expect(movePinnedFile(pins, 'b.txt', 2)).toEqual(pins)
  })

  it('不在置顶列表里的路径原样返回', () => {
    expect(movePinnedFile(pins, 'zzz.txt', 0)).toEqual(pins)
  })

  it('下标越界时夹到首尾', () => {
    expect(movePinnedFile(pins, 'c.txt', -5)).toEqual(['c.txt', 'a.txt', 'b.txt'])
    expect(movePinnedFile(pins, 'a.txt', 99)).toEqual(['b.txt', 'c.txt', 'a.txt'])
  })

  it('源与目标之间有隐藏/失效路径时仍按原数组下标插', () => {
    // 渲染层只显示 a、c;把 c 拖到 a 前面,隐藏的 gone.txt 不能被挤乱。
    expect(movePinnedFile(['a.txt', 'gone.txt', 'c.txt'], 'c.txt', 0)).toEqual([
      'c.txt',
      'a.txt',
      'gone.txt'
    ])
  })
})
