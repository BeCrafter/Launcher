// 图表的「配置」读写 —— 纯函数,不碰 mermaid 运行时。
//
// 设计约束:**配置必须写回标准 mermaid 源码**。
// 笔记是一篇能被 Obsidian / GitHub / 任何编辑器打开的文件,把方向、主题塞进
// frontmatter 或自定义围栏属性,就等于让这张图只在 Launcher 里能看。
// 所以:
//   · 方向 → 写进 `flowchart LR` / `stateDiagram-v2` 下一行的 `direction LR`;
//   · 主题 → 写进 mermaid 自己的 `%%{init: {"theme":"dark"}}%%` 指令;
//   · 「跟随应用」= **不写**主题指令,由渲染时喂 themeVariables 决定。
//
// init 指令的解析是**宽容**的:JSON.parse 失败就退化成对原文做定点字符串替换,
// 认不出的内容一个字节都不动(与 frontmatter 那套「外科式改写」同一套纪律)。

export type DiagramKind =
  | 'flowchart'
  | 'mindmap'
  | 'sequence'
  | 'class'
  | 'state'
  | 'er'
  | 'pie'
  | 'gantt'
  | 'other'

export type DiagramDirection = 'TB' | 'BT' | 'LR' | 'RL'

/** 'app' = 跟随应用主题(不写指令);其余是 mermaid 自带的主题名 */
export type DiagramTheme = 'app' | 'default' | 'neutral' | 'dark' | 'forest'

/** 各类型是否支持方向(以及方向写在哪) */
const DIRECTION_STYLE: Record<string, 'header' | 'line' | 'none'> = {
  flowchart: 'header',
  state: 'line',
  class: 'line',
  er: 'line',
  mindmap: 'none',
  sequence: 'none',
  pie: 'none',
  gantt: 'none',
  other: 'none'
}

export function supportsDirection(kind: DiagramKind): boolean {
  return DIRECTION_STYLE[kind] !== 'none'
}

/**
 * 头行:缩进 + `flowchart|graph` + 可选方向 + **其余原样**。
 * 末尾那个 `([\s\S]*)` 不能省:`flowchart LR; A-->B` 是合法的一行写法,
 * 只保留到方向为止会把后面的节点定义整段吃掉。
 */
const HEADER_RE = /^(\s*)(flowchart|graph)\b(?:[ \t]*([A-Za-z]{2}))?([\s\S]*)$/
/** 从一整行里取方向(用于读) */
const HEADER_DIR_RE = /^\s*(?:flowchart|graph)\b[ \t]*([A-Za-z]{2})?\b/
const KIND_RES: [DiagramKind, RegExp][] = [
  ['flowchart', /^(flowchart|graph)\b/],
  ['mindmap', /^mindmap\b/],
  ['sequence', /^sequenceDiagram\b/],
  ['class', /^classDiagram\b/],
  ['state', /^stateDiagram(-v2)?\b/],
  ['er', /^erDiagram\b/],
  ['pie', /^pie\b/],
  ['gantt', /^gantt\b/],
  // 其余 mermaid 类型:认得出来(不报错),但没有专门的配置项
  [
    'other',
    /^(journey|timeline|quadrantChart|gitGraph|xyChart|xychart-beta|block-beta|sankey-beta|packet-beta|architecture-beta|kanban|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|mindmap-beta)\b/
  ]
]

/** 跳过空行、注释(`%%`)与 init 指令,取第一行有内容的话 */
function firstMeaningfulLine(lines: string[]): string {
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') continue
    if (line.startsWith('%%')) continue
    return line
  }
  return ''
}

export function detectKind(src: string): DiagramKind {
  const head = firstMeaningfulLine(src.split('\n'))
  if (head === '') return 'other'
  for (const [kind, re] of KIND_RES) if (re.test(head)) return kind
  return 'other'
}

/** 读方向。flowchart 在头行上,state/class/er 在紧随其后的 `direction XX` 行上。 */
export function readDirection(src: string): DiagramDirection | null {
  const lines = src.split('\n')
  const kind = detectKind(src)
  const style = DIRECTION_STYLE[kind]
  if (style === 'header') {
    const head = firstMeaningfulLine(lines)
    const m = HEADER_DIR_RE.exec(head)
    const dir = m?.[1]?.toUpperCase()
    return dir === 'TB' || dir === 'TD' ? 'TB' : dir === 'BT' || dir === 'LR' || dir === 'RL' ? dir : null
  }
  if (style === 'line') {
    for (const raw of lines) {
      const m = /^\s*direction\s+(TB|TD|BT|LR|RL)\s*$/.exec(raw)
      if (m) {
        const d = m[1].toUpperCase()
        return d === 'TD' ? 'TB' : (d as DiagramDirection)
      }
    }
  }
  return null
}

/**
 * 写方向。**没找到可改的行就原样返回** —— 与其把 `direction LR` 插到用户
 * 某个奇怪的位置上,不如什么都不做(调用方会看到方向没变)。
 */
export function writeDirection(src: string, dir: DiagramDirection): string {
  const kind = detectKind(src)
  const style = DIRECTION_STYLE[kind]
  const lines = src.split('\n')

  if (style === 'header') {
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*(flowchart|graph)\b/.test(lines[i])) continue
      // 用函数式 replace 拼回:缩进与关键字原样保留,只换方向那一段,行尾内容一字不动
      lines[i] = lines[i].replace(HEADER_RE, (_all, indent: string, kw: string, _dir: string, rest: string) => {
        // 方向后面紧跟的东西如果是 `;` 或空白之外的内容,补一个空格再拼
        return `${indent}${kw} ${dir}${rest}`
      })
      return lines.join('\n')
    }
    return src
  }

  if (style === 'line') {
    const at = lines.findIndex((l) => /^\s*direction\s+(TB|TD|BT|LR|RL)\s*$/.test(l))
    if (at >= 0) {
      lines[at] = lines[at].replace(/direction\s+(TB|TD|BT|LR|RL)/, `direction ${dir}`)
      return lines.join('\n')
    }
    // 没有就插在头行之后
    const headAt = lines.findIndex((l) => l.trim() !== '' && !l.trim().startsWith('%%'))
    if (headAt < 0) return src
    lines.splice(headAt + 1, 0, `  direction ${dir}`)
    return lines.join('\n')
  }

  return src
}

// ── init 指令(主题) ──

interface InitDirective {
  /** 在原文里的下标区间,含 `%%{` 与 `}%%` */
  start: number
  end: number
  /** 内层 `{...}` 原文 */
  body: string
}

const INIT_RE = /%%\{\s*init\s*:\s*(\{[\s\S]*?\})\s*\}%%/
const THEME_RE = /(["']?)theme\1\s*:\s*(["'])([^"']*)\2/

function findInit(src: string): InitDirective | null {
  const m = INIT_RE.exec(src)
  if (!m) return null
  return { start: m.index, end: m.index + m[0].length, body: m[1] }
}

/** 读主题。没有指令、或指令里没写 theme → 'app'(跟随应用) */
export function readTheme(src: string): DiagramTheme {
  const init = findInit(src)
  if (init === null) return 'app'
  const m = THEME_RE.exec(init.body)
  const t = m?.[3]
  return t === 'default' || t === 'neutral' || t === 'dark' || t === 'forest' ? t : 'app'
}

/**
 * 写主题。'app' 会**移除** theme 键(其余键原样保留);键被移空则整条指令一并去掉。
 * 已有指令但内容不是合法 JSON 时,只对 `theme` 那一处做定点替换,别的一字不动。
 */
export function writeTheme(src: string, theme: DiagramTheme): string {
  const init = findInit(src)

  if (theme === 'app') {
    if (init === null) return src
    if (!THEME_RE.test(init.body)) return src
    // 去掉 `theme: "..."` 这一项,连同它带走的那一个逗号(前或后)
    const body = init.body
      .replace(/(["']?)theme\1\s*:\s*(["'])[^"']*\2\s*,/, '')
      .replace(/(["']?)theme\1\s*:\s*(["'])[^"']*\2/, '')
      .replace(/,\s*\}/, '}')
    if (body.replace(/[{}\s,]/g, '') === '') {
      // 只剩空壳了 → 整条指令删掉,连同它占的那一行
      const before = src.slice(0, init.start).replace(/[ \t]*$/, '')
      const after = src.slice(init.end).replace(/^[ \t]*\r?\n?/, '')
      return before + after
    }
    return src.slice(0, init.start) + `%%{init: ${body}}%%` + src.slice(init.end)
  }

  const value = `"${theme}"`
  if (init === null) {
    // 插在第一行有内容的话**之前** —— mermaid 要求 init 在任何图定义之前生效
    const lines = src.split('\n')
    const at = lines.findIndex((l) => l.trim() !== '' && !l.trim().startsWith('%%'))
    const idx = at < 0 ? lines.length : at
    lines.splice(idx, 0, `%%{init: {"theme": ${value}}}%%`)
    return lines.join('\n')
  }

  if (THEME_RE.test(init.body)) {
    const body = init.body.replace(THEME_RE, (_all, q1: string, q2: string) => `${q1}theme${q1}: ${q2}${theme}${q2}`)
    return src.slice(0, init.start) + `%%{init: ${body}}%%` + src.slice(init.end)
  }
  // 有指令但没 theme 键 → 在第一个 `{` 之后补一个
  const body = init.body.replace(/^\{/, `{"theme": ${value},`)
  return src.slice(0, init.start) + `%%{init: ${body}}%%` + src.slice(init.end)
}

// ── 模板与片段 ──

export interface DiagramTemplate {
  kind: DiagramKind
  /** 中文模板 */
  zh: string
  /** 英文模板 */
  en: string
}

export const DIAGRAM_KINDS: DiagramKind[] = ['flowchart', 'mindmap', 'sequence', 'class', 'state', 'er', 'pie', 'gantt']

export const TEMPLATES: DiagramTemplate[] = [
  {
    kind: 'flowchart',
    zh: 'flowchart LR\n  A[开始] --> B{判断}\n  B -->|是| C[处理]\n  B -->|否| D[结束]',
    en: 'flowchart LR\n  A[Start] --> B{Check}\n  B -->|yes| C[Handle]\n  B -->|no| D[Done]'
  },
  {
    kind: 'mindmap',
    zh: 'mindmap\n  root((中心主题))\n    分支一\n      叶子\n    分支二',
    en: 'mindmap\n  root((Topic))\n    Branch A\n      Leaf\n    Branch B'
  },
  {
    kind: 'sequence',
    zh: 'sequenceDiagram\n  participant C as 客户端\n  participant S as 服务端\n  C->>S: 请求\n  S-->>C: 响应',
    en: 'sequenceDiagram\n  participant C as Client\n  participant S as Server\n  C->>S: request\n  S-->>C: response'
  },
  {
    kind: 'class',
    zh: 'classDiagram\n  class 服务 {\n    +String 名称\n    +启动()\n  }\n  服务 <|-- 端口服务',
    en: 'classDiagram\n  class Service {\n    +String name\n    +start()\n  }\n  Service <|-- PortService'
  },
  {
    kind: 'state',
    zh: 'stateDiagram-v2\n  [*] --> 空闲\n  空闲 --> 运行: 启动\n  运行 --> 空闲: 停止\n  运行 --> [*]',
    en: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: start\n  Running --> Idle: stop\n  Running --> [*]'
  },
  {
    kind: 'er',
    zh: 'erDiagram\n  AGENT ||--o{ SERVICE : 管理\n  AGENT {\n    string label\n  }',
    en: 'erDiagram\n  AGENT ||--o{ SERVICE : manages\n  AGENT {\n    string label\n  }'
  },
  {
    kind: 'pie',
    zh: 'pie title 端口占用\n  "node" : 40\n  "redis" : 25\n  "其他" : 35',
    en: 'pie title Port usage\n  "node" : 40\n  "redis" : 25\n  "other" : 35'
  },
  {
    kind: 'gantt',
    zh: 'gantt\n  title 排期\n  dateFormat YYYY-MM-DD\n  section 阶段一\n  需求 :a1, 2026-01-01, 7d\n  开发 :a2, after a1, 14d',
    en: 'gantt\n  title Schedule\n  dateFormat YYYY-MM-DD\n  section Phase 1\n  Design :a1, 2026-01-01, 7d\n  Build :a2, after a1, 14d'
  }
]

export function templateFor(kind: DiagramKind, lang: string): string {
  const hit = TEMPLATES.find((t) => t.kind === kind)
  if (!hit) return ''
  return lang.startsWith('zh') ? hit.zh : hit.en
}

/** 空源码时的兜底类型(打开对话框、或源码被清空) */
export const FALLBACK_KIND: DiagramKind = 'flowchart'

/**
 * 从源码推断「新建时应预填什么」。已经写过图的笔记再插一张时,沿用上一次的类型与方向
 * —— 同一篇笔记里的图通常是一个风格。
 */
export function initialConfig(src: string): { kind: DiagramKind; direction: DiagramDirection; theme: DiagramTheme } {
  const kind = src.trim() === '' ? FALLBACK_KIND : detectKind(src)
  return {
    kind,
    direction: readDirection(src) ?? 'LR',
    theme: readTheme(src)
  }
}
