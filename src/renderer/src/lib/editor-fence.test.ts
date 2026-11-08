import { describe, expect, it } from 'vitest'
import { planFencePair, planFenceUpgrade } from './editor-fence'
import { parseMarkdownBlocks } from './markdown-blocks'

describe('planFencePair:行首第三个反引号', () => {
  it('顶层空行 → 成对围栏,光标停在开头围栏之后', () => {
    expect(planFencePair('``', 2, null)).toEqual({ insert: '```\n```', caret: 3 })
  })

  it('保留 1–3 个前导空格', () => {
    expect(planFencePair('  ``', 4, null)).toEqual({ insert: '  ```\n  ```', caret: 5 })
    expect(planFencePair('   ``', 5, null)).toEqual({ insert: '   ```\n   ```', caret: 6 })
  })

  it('引用前缀原样带到两行围栏', () => {
    expect(planFencePair('> ``', 4, null)).toEqual({ insert: '> ```\n> ```', caret: 5 })
    expect(planFencePair('> > ``', 6, null)).toEqual({ insert: '> > ```\n> > ```', caret: 7 })
  })

  it('上一行是正文时补空行', () => {
    expect(planFencePair('``', 2, '正文')).toEqual({ insert: '\n```\n```', caret: 4 })
    expect(planFencePair('  ``', 4, '正文')).toEqual({ insert: '\n  ```\n  ```', caret: 6 })
  })

  it('上一行已经是空行 → 不重复补', () => {
    expect(planFencePair('``', 2, '')).toEqual({ insert: '```\n```', caret: 3 })
    expect(planFencePair('``', 2, '   ')).toEqual({ insert: '```\n```', caret: 3 })
  })

  it('引用跟着非引用正文时也要空行(否则会被上一段吞掉)', () => {
    expect(planFencePair('> ``', 4, '正文')).toEqual({ insert: '\n> ```\n> ```', caret: 6 })
  })

  it('同一层引用里连着写 → 不补空行(会把引用拆成两块)', () => {
    expect(planFencePair('> ``', 4, '> 引用')).toEqual({ insert: '> ```\n> ```', caret: 5 })
  })

  it('4 空格 / Tab / 列表标记 / 正文开头都不触发', () => {
    expect(planFencePair('    ``', 6, null)).toBeNull()
    expect(planFencePair('\t``', 3, null)).toBeNull()
    expect(planFencePair('- ``', 4, null)).toBeNull()
    expect(planFencePair('[x](y) ``', 9, null)).toBeNull()
  })

  it('光标后面还有内容 → 不触发', () => {
    expect(planFencePair('``x', 2, null)).toBeNull()
  })

  it('还没输到两个反引号 → 不触发', () => {
    expect(planFencePair('``', 1, null)).toBeNull()
  })

  it('行尾多余空白会被一起替换掉', () => {
    expect(planFencePair('  ``  ', 4, null)).toEqual({ insert: '  ```\n  ```', caret: 5 })
  })
})

describe('planFenceUpgrade:行内容起点', () => {
  it('顶层行首:围栏各占一行', () => {
    expect(
      planFenceUpgrade({
        openLine: '`abc`',
        openCol: 0,
        closeLine: '`abc`',
        closeCol: 4,
        prevLineText: null
      })
    ).toEqual({
      openFrom: 0,
      openTo: 1,
      openInsert: '```\n',
      closeInsert: '\n```',
      caret: 3
    })
  })

  it('引用行首:两行围栏都带 `> `', () => {
    expect(
      planFenceUpgrade({
        openLine: '> `abc`',
        openCol: 2,
        closeLine: '> `abc`',
        closeCol: 6,
        prevLineText: null
      })
    ).toEqual({
      openFrom: 0,
      openTo: 3,
      openInsert: '> ```\n> ',
      closeInsert: '\n> ```',
      caret: 5
    })
  })

  it('2 空格缩进:围栏与内容共用缩进', () => {
    expect(
      planFenceUpgrade({
        openLine: '  `abc`',
        openCol: 2,
        closeLine: '  `abc`',
        closeCol: 6,
        prevLineText: null
      })
    ).toEqual({
      openFrom: 0,
      openTo: 3,
      openInsert: '  ```\n  ',
      closeInsert: '\n  ```',
      caret: 5
    })
  })

  it('闭合反引号后面还有文字 → 另起一行', () => {
    expect(
      planFenceUpgrade({
        openLine: '`abc` def',
        openCol: 0,
        closeLine: '`abc` def',
        closeCol: 4,
        prevLineText: null
      })
    ).toEqual({
      openFrom: 0,
      openTo: 1,
      openInsert: '```\n',
      closeInsert: '\n```\n',
      caret: 3
    })
  })

  it('顶层行首需要空行时,`\\n` 落在行首', () => {
    expect(
      planFenceUpgrade({
        openLine: '`abc`',
        openCol: 0,
        closeLine: '`abc`',
        closeCol: 4,
        prevLineText: '正文'
      })
    ).toEqual({
      openFrom: 0,
      openTo: 1,
      openInsert: '\n```\n',
      closeInsert: '\n```',
      caret: 4
    })
  })

  it('引用行首:同层引用不补空行,非引用正文后补', () => {
    const base = { openLine: '> `abc`', openCol: 2, closeLine: '> `abc`', closeCol: 6 }
    expect(planFenceUpgrade({ ...base, prevLineText: '> 引用' })?.openInsert).toBe('> ```\n> ')
    expect(planFenceUpgrade({ ...base, prevLineText: '正文' })?.openInsert).toBe('\n> ```\n> ')
  })

  it('多行选区:结束围栏用闭合行自己的前缀', () => {
    expect(
      planFenceUpgrade({
        openLine: '  `abc`',
        openCol: 2,
        closeLine: '> `def`',
        closeCol: 6,
        prevLineText: null
      })
    ).toMatchObject({ openInsert: '  ```\n  ', closeInsert: '\n> ```', caret: 5 })
  })

  it('开头 / 闭合位置不是反引号 → null(防止 pending 过期后误改)', () => {
    expect(
      planFenceUpgrade({
        openLine: 'xabc`',
        openCol: 1,
        closeLine: 'xabc`',
        closeCol: 5,
        prevLineText: null
      })
    ).toBeNull()
    expect(
      planFenceUpgrade({
        openLine: '`abcx',
        openCol: 0,
        closeLine: '`abcx',
        closeCol: 4,
        prevLineText: null
      })
    ).toBeNull()
  })

  it('第二个反引号之后(首尾各 2 个)也能升级,替换掉整段标记', () => {
    expect(
      planFenceUpgrade({
        openLine: '``abc``',
        openCol: 0,
        closeLine: '``abc``',
        closeCol: 5,
        prevLineText: null,
        ticks: 2
      })
    ).toEqual({ openFrom: 0, openTo: 2, openInsert: '```\n', closeInsert: '\n```', caret: 3 })
  })

  it('引用 + 2 个反引号:前缀保留到两行围栏', () => {
    expect(
      planFenceUpgrade({
        openLine: '> ``abc``',
        openCol: 2,
        closeLine: '> ``abc``',
        closeCol: 7,
        prevLineText: null,
        ticks: 2
      })
    ).toEqual({ openFrom: 0, openTo: 4, openInsert: '> ```\n> ', closeInsert: '\n> ```', caret: 5 })
  })

  it('反引号个数与 ticks 对不上 → null', () => {
    expect(
      planFenceUpgrade({
        openLine: '`abc`',
        openCol: 0,
        closeLine: '`abc`',
        closeCol: 4,
        prevLineText: null,
        ticks: 2
      })
    ).toBeNull()
  })
})

describe('planFenceUpgrade:行中选区', () => {
  it('前面有正文:先空行,再围栏', () => {
    expect(
      planFenceUpgrade({
        openLine: 'x `abc` y',
        openCol: 2,
        closeLine: 'x `abc` y',
        closeCol: 6,
        prevLineText: null
      })
    ).toEqual({
      openFrom: 2,
      openTo: 3,
      openInsert: '\n\n```\n',
      closeInsert: '\n```\n',
      caret: 7
    })
  })

  it('行尾闭合:不再多留一行', () => {
    expect(
      planFenceUpgrade({
        openLine: 'x `abc`',
        openCol: 2,
        closeLine: 'x `abc`',
        closeCol: 6,
        prevLineText: null
      })
    ).toMatchObject({ openInsert: '\n\n```\n', closeInsert: '\n```', caret: 7 })
  })

  it('行中 + 2 个反引号:替换掉整段标记,围栏仍各占一行', () => {
    expect(
      planFenceUpgrade({
        openLine: 'x ``abc`` y',
        openCol: 2,
        closeLine: 'x ``abc`` y',
        closeCol: 7,
        prevLineText: null,
        ticks: 2
      })
    ).toEqual({
      openFrom: 2,
      openTo: 4,
      openInsert: '\n\n```\n',
      closeInsert: '\n```\n',
      caret: 7
    })
  })

  it('4 空格前缀按行中处理(那是缩进代码块)', () => {
    expect(
      planFenceUpgrade({
        openLine: '    `abc`',
        openCol: 4,
        closeLine: '    `abc`',
        closeCol: 8,
        prevLineText: '正文'
      })
    ).toMatchObject({ openFrom: 4, openTo: 5, openInsert: '\n```\n', closeInsert: '\n```', caret: 8 })
  })

  it('选区前只有空白(超过 3 空格)时不再补空行', () => {
    expect(
      planFenceUpgrade({
        openLine: '     `abc`',
        openCol: 5,
        closeLine: '     `abc`',
        closeCol: 9,
        prevLineText: '正文'
      })
    ).toMatchObject({ openInsert: '\n```\n', closeInsert: '\n```', caret: 9 })
  })
})

describe('块模型:生成的围栏必须自成一块', () => {
  it('段落后面没有空行的围栏会被吞掉(这是要避免的)', () => {
    expect(parseMarkdownBlocks('para\n```\n```').map((b) => b.kind)).toEqual(['paragraph'])
  })

  it('成对围栏的补空行规则让块模型认出 fence', () => {
    const pair = planFencePair('``', 2, 'para')!
    expect(parseMarkdownBlocks(`para\n${pair.insert}`).map((b) => b.kind)).toEqual([
      'paragraph',
      'fence'
    ])
  })

  it('引用里的成对围栏不会把引用拆开', () => {
    const pair = planFencePair('> ``', 4, '> 引用')!
    expect(parseMarkdownBlocks(`> 引用\n${pair.insert}`).map((b) => b.kind)).toEqual(['quote'])
  })

  it('行中选区升级后是独立 fence,前后正文仍是段落', () => {
    const plan = planFenceUpgrade({
      openLine: 'x `abc` y',
      openCol: 2,
      closeLine: 'x `abc` y',
      closeCol: 6,
      prevLineText: null
    })!
    const src = `x ${plan.openInsert}abc${plan.closeInsert} y`
    expect(parseMarkdownBlocks(src).map((b) => b.kind)).toEqual(['paragraph', 'fence', 'paragraph'])
  })

  it('引用里整行选区升级后仍是一个 quote 块', () => {
    const plan = planFenceUpgrade({
      openLine: '> `abc`',
      openCol: 2,
      closeLine: '> `abc`',
      closeCol: 6,
      prevLineText: null
    })!
    const src = plan.openInsert + 'abc' + plan.closeInsert
    expect(parseMarkdownBlocks(src).map((b) => b.kind)).toEqual(['quote'])
  })
})
