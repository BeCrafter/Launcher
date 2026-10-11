// 图表配置的读写。
//
// 这一组测试守的是同一件事:**配置必须写回标准 mermaid 源码**。
// 写坏了不会有报错,只会让那张图在 Obsidian / GitHub 里打不开 —— 所以每一条
// 都顺手断言「改完之后其余字节原样」。

import { describe, expect, it } from 'vitest'
import {
  detectKind,
  initialConfig,
  readDirection,
  readTheme,
  supportsDirection,
  templateFor,
  writeDirection,
  writeTheme
} from './diagram'

describe('detectKind', () => {
  it.each([
    ['flowchart LR\n  A --> B', 'flowchart'],
    ['graph TD\n  A --> B', 'flowchart'],
    ['mindmap\n  root((x))', 'mindmap'],
    ['sequenceDiagram\n  A->>B: hi', 'sequence'],
    ['classDiagram\n  A <|-- B', 'class'],
    ['stateDiagram-v2\n  [*] --> A', 'state'],
    ['erDiagram\n  A ||--o{ B : x', 'er'],
    ['pie title x\n  "a" : 1', 'pie'],
    ['gantt\n  title x', 'gantt'],
    ['journey\n  title x', 'other']
  ])('%s → %s', (src, kind) => {
    expect(detectKind(src)).toBe(kind)
  })

  it('跳过 init 指令与注释,看第一行有内容的话', () => {
    expect(detectKind('%%{init: {"theme":"dark"}}%%\n%% 这是注释\nflowchart LR')).toBe('flowchart')
  })

  it('空源码不算任何一种', () => {
    expect(detectKind('')).toBe('other')
    expect(detectKind('   \n\n')).toBe('other')
  })
})

describe('方向', () => {
  it('flowchart 的方向在头行上', () => {
    expect(readDirection('flowchart LR\n  A-->B')).toBe('LR')
    expect(readDirection('graph TD')).toBe('TB') // TD 与 TB 是同一个方向
    expect(readDirection('flowchart\n  A-->B')).toBeNull()
  })

  it('state / class / er 的方向在头行下面那一行', () => {
    expect(readDirection('stateDiagram-v2\n  direction LR\n  [*] --> A')).toBe('LR')
    expect(readDirection('classDiagram\n  direction RL')).toBe('RL')
  })

  it('不支持方向的类型读出来是 null', () => {
    expect(readDirection('mindmap\n  root((x))')).toBeNull()
    expect(supportsDirection('mindmap')).toBe(false)
    expect(supportsDirection('flowchart')).toBe(true)
  })

  it('写方向只动方向那一段', () => {
    expect(writeDirection('flowchart LR\n  A --> B', 'TB')).toBe('flowchart TB\n  A --> B')
    expect(writeDirection('graph TD\n  A --> B', 'RL')).toBe('graph RL\n  A --> B')
  })

  it('头行后面还挂着内容时,内容一字不丢', () => {
    // `flowchart LR; A-->B` 是合法的一行写法。此前只保留到方向为止,把节点定义整段吃掉了。
    expect(writeDirection('flowchart LR; A-->B', 'TB')).toBe('flowchart TB; A-->B')
  })

  it('本来没写方向就补上', () => {
    expect(writeDirection('flowchart\n  A --> B', 'LR')).toBe('flowchart LR\n  A --> B')
  })

  it('state 图没有 direction 行就插一行,已有就替换', () => {
    expect(writeDirection('stateDiagram-v2\n  [*] --> A', 'LR')).toBe('stateDiagram-v2\n  direction LR\n  [*] --> A')
    expect(writeDirection('stateDiagram-v2\n  direction TB\n  [*] --> A', 'RL')).toBe(
      'stateDiagram-v2\n  direction RL\n  [*] --> A'
    )
  })

  it('不支持方向的类型原样返回(而不是硬塞一行)', () => {
    const src = 'mindmap\n  root((x))'
    expect(writeDirection(src, 'LR')).toBe(src)
  })

  it('往返:写完再读回来是同一个值', () => {
    for (const d of ['TB', 'BT', 'LR', 'RL'] as const) {
      expect(readDirection(writeDirection('flowchart LR\n  A-->B', d))).toBe(d)
    }
  })
})

describe('主题', () => {
  it('没有 init 指令 = 跟随应用', () => {
    expect(readTheme('flowchart LR')).toBe('app')
  })

  it('认得 mermaid 自带的四个主题', () => {
    expect(readTheme('%%{init: {"theme":"dark"}}%%\nflowchart LR')).toBe('dark')
    expect(readTheme("%%{init: {'theme':'forest'}}%%\nflowchart LR")).toBe('forest')
    expect(readTheme('%%{init: {"theme": "neutral"}}%%\nflowchart LR')).toBe('neutral')
  })

  it('认不出的主题名按「跟随应用」处理(不报错、也不乱改)', () => {
    expect(readTheme('%%{init: {"theme":"solarized"}}%%\nflowchart LR')).toBe('app')
  })

  it('写主题:没有指令就插在最前面(mermaid 要求 init 在图定义之前)', () => {
    expect(writeTheme('flowchart LR\n  A-->B', 'dark')).toBe('%%{init: {"theme": "dark"}}%%\nflowchart LR\n  A-->B')
  })

  it('写主题:已有指令就只换 theme 的值', () => {
    expect(writeTheme('%%{init: {"theme":"dark"}}%%\nflowchart LR', 'forest')).toBe(
      '%%{init: {"theme": "forest"}}%%\nflowchart LR'
    )
  })

  it('写主题:指令里还有别的配置时,别的配置一字不动', () => {
    const src = '%%{init: {"flowchart":{"curve":"basis"},"theme":"dark"}}%%\nflowchart LR'
    const out = writeTheme(src, 'neutral')
    expect(out).toContain('"flowchart":{"curve":"basis"}')
    expect(readTheme(out)).toBe('neutral')
  })

  it('写主题:指令里本来没有 theme 键,就补一个', () => {
    const out = writeTheme('%%{init: {"flowchart":{"curve":"basis"}}}%%\nflowchart LR', 'dark')
    expect(out).toContain('"flowchart":{"curve":"basis"}')
    expect(readTheme(out)).toBe('dark')
  })

  it('「跟随应用」= 把 theme 键摘掉', () => {
    const out = writeTheme('%%{init: {"theme":"dark"}}%%\nflowchart LR', 'app')
    expect(out).toBe('flowchart LR')
  })

  it('「跟随应用」:摘掉 theme 之后指令里还有别的配置,就留着', () => {
    const out = writeTheme('%%{init: {"theme":"dark","flowchart":{"curve":"basis"}}}%%\nflowchart LR', 'app')
    expect(out).toContain('"flowchart":{"curve":"basis"}}')
    expect(out).not.toContain('theme')
    expect(readTheme(out)).toBe('app')
  })

  it('往返:写完再读回来是同一个值', () => {
    for (const th of ['app', 'default', 'neutral', 'dark', 'forest'] as const) {
      expect(readTheme(writeTheme('flowchart LR', th))).toBe(th)
    }
  })

  it('幂等:同一个主题写两次,结果完全相同', () => {
    const once = writeTheme('flowchart LR\n  A-->B', 'dark')
    expect(writeTheme(once, 'dark')).toBe(once)
    const back = writeTheme(once, 'app')
    expect(writeTheme(back, 'app')).toBe(back)
  })
})

describe('模板与初始状态', () => {
  it('每个类型都有中英两份模板,且模板能认出自己的类型', () => {
    for (const kind of ['flowchart', 'mindmap', 'sequence', 'class', 'state', 'er', 'pie', 'gantt'] as const) {
      expect(detectKind(templateFor(kind, 'zh-CN'))).toBe(kind)
      expect(detectKind(templateFor(kind, 'en-US'))).toBe(kind)
      expect(templateFor(kind, 'zh-CN')).not.toBe(templateFor(kind, 'en-US'))
    }
  })

  it('initialConfig:空源码给流程图 + 从左到右', () => {
    expect(initialConfig('')).toEqual({ kind: 'flowchart', direction: 'LR', theme: 'app' })
  })

  it('initialConfig:已有源码时沿用它的类型 / 方向 / 主题', () => {
    expect(initialConfig('%%{init: {"theme":"forest"}}%%\nmindmap\n  root((x))')).toEqual({
      kind: 'mindmap',
      direction: 'LR', // mindmap 没有方向,给个默认值(UI 上不会显示方向按钮)
      theme: 'forest'
    })
  })
})
