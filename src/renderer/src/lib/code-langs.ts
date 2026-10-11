// 围栏代码块的语言表:```lang → 一个 CodeMirror `Language`(需要时再取它的 `.parser`)。
//
// 两类来源,统一成 `Language`:
//   · Lezer 语法(`@codemirror/lang-*`)—— 精确、增量,但覆盖的语言有限;
//   · `@codemirror/legacy-modes` 的 StreamLanguage —— 老的 CodeMirror 5 模式,
//     覆盖面极广,代价是逐行状态机、精度差一档。
// 存 `Language` 而不是 `Parser` 是因为编辑器要的正是它:
// `markdown({ codeLanguages })` 收 Language,于是**围栏里的代码在编辑器里也会高亮** ——
// 与预览是同一套 token 配色。预览侧只要 `.parser`,由 parserFor 现取。
//
// **没有匹配的语言一律返回 null,渲染成纯文本** —— 猜一个近似的语法去高亮
// 比不高亮更糟(一整段日志被染成字符串色)。

import type { Parser } from '@lezer/common'
import type { StreamParser } from '@codemirror/streamparser'
import { StreamLanguage, type Language } from '@codemirror/language'
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from '@codemirror/lang-javascript'
import { jsonLanguage } from '@codemirror/lang-json'
import { htmlLanguage } from '@codemirror/lang-html'
import { cssLanguage } from '@codemirror/lang-css'
import { xmlLanguage } from '@codemirror/lang-xml'
import { markdownLanguage } from '@codemirror/lang-markdown'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { python } from '@codemirror/legacy-modes/mode/python'
import { standardSQL } from '@codemirror/legacy-modes/mode/sql'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { go } from '@codemirror/legacy-modes/mode/go'
import { rust } from '@codemirror/legacy-modes/mode/rust'
import { c, cpp, java, kotlin, scala, csharp, dart, objectiveC } from '@codemirror/legacy-modes/mode/clike'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { diff } from '@codemirror/legacy-modes/mode/diff'
import { nginx } from '@codemirror/legacy-modes/mode/nginx'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { perl } from '@codemirror/legacy-modes/mode/perl'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { cmake } from '@codemirror/legacy-modes/mode/cmake'
import { http } from '@codemirror/legacy-modes/mode/http'
import { sass } from '@codemirror/legacy-modes/mode/sass'
import { haskell } from '@codemirror/legacy-modes/mode/haskell'
import { julia } from '@codemirror/legacy-modes/mode/julia'
import { r } from '@codemirror/legacy-modes/mode/r'
import { pascal } from '@codemirror/legacy-modes/mode/pascal'
import { groovy } from '@codemirror/legacy-modes/mode/groovy'
import { clojure } from '@codemirror/legacy-modes/mode/clojure'
import { scheme } from '@codemirror/legacy-modes/mode/scheme'
import { erlang } from '@codemirror/legacy-modes/mode/erlang'
import { elm } from '@codemirror/legacy-modes/mode/elm'
import { tcl } from '@codemirror/legacy-modes/mode/tcl'
import { verilog } from '@codemirror/legacy-modes/mode/verilog'
import { vhdl } from '@codemirror/legacy-modes/mode/vhdl'
import { gas } from '@codemirror/legacy-modes/mode/gas'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf'

/**
 * legacy-modes 的模式类型来自 `@codemirror/streamparser`(纯类型包),
 * 而 `StreamLanguage` 来自 `@codemirror/language` —— 两份声明结构完全一样,
 * 只因为 `StringStream` 有个 private 字段而互不兼容。这里的 cast 就是这个已知的
 * 类型重复问题,不是我们在放宽什么:运行时是同一个实现。
 */
type CMStreamParser = Parameters<typeof StreamLanguage.define>[0]

const stream = (mode: StreamParser<unknown>): Language =>
  StreamLanguage.define(mode as unknown as CMStreamParser)

/** 每个语言一行的别名表。键一律小写 —— 查表前会先规范化。 */
const LANGS: Record<string, Language> = {
  // ── Lezer 语法(精确)──
  javascript: javascriptLanguage,
  jsx: jsxLanguage,
  typescript: typescriptLanguage,
  tsx: tsxLanguage,
  json: jsonLanguage,
  html: htmlLanguage,
  css: cssLanguage,
  xml: xmlLanguage,
  markdown: markdownLanguage,

  // ── StreamLanguage(覆盖面)──
  shell: stream(shell),
  properties: stream(properties),
  python: stream(python),
  sql: stream(standardSQL),
  yaml: stream(yaml),
  toml: stream(toml),
  go: stream(go),
  rust: stream(rust),
  c: stream(c),
  cpp: stream(cpp),
  java: stream(java),
  kotlin: stream(kotlin),
  scala: stream(scala),
  csharp: stream(csharp),
  dart: stream(dart),
  objectivec: stream(objectiveC),
  dockerfile: stream(dockerFile),
  diff: stream(diff),
  nginx: stream(nginx),
  powershell: stream(powerShell),
  ruby: stream(ruby),
  lua: stream(lua),
  perl: stream(perl),
  swift: stream(swift),
  cmake: stream(cmake),
  http: stream(http),
  sass: stream(sass),
  haskell: stream(haskell),
  julia: stream(julia),
  r: stream(r),
  pascal: stream(pascal),
  groovy: stream(groovy),
  clojure: stream(clojure),
  scheme: stream(scheme),
  erlang: stream(erlang),
  elm: stream(elm),
  tcl: stream(tcl),
  verilog: stream(verilog),
  vhdl: stream(vhdl),
  gas: stream(gas),
  latex: stream(stex),
  protobuf: stream(protobuf)
}

/** 常见别名 → 上面的规范名。写在这里而不是散在 LANGS 里,是为了让「有哪些语言」一眼可数。 */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  jsonc: 'json',
  htm: 'html',
  xhtml: 'html',
  vue: 'html',
  svelte: 'html',
  // plist 就是 XML —— 本项目的主战场之一,单独给个别名
  plist: 'xml',
  svg: 'xml',
  rss: 'xml',
  atom: 'xml',
  md: 'markdown',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  console: 'shell',
  terminal: 'shell',
  'shell-session': 'shell',
  ini: 'properties',
  conf: 'properties',
  config: 'properties',
  cfg: 'properties',
  env: 'properties',
  dotenv: 'properties',
  editorconfig: 'properties',
  gitconfig: 'properties',
  yml: 'yaml',
  // SCSS 是 CSS 的超集,legacy 的 sass 模式只认缩进语法,套在 SCSS 上会错得离谱
  scss: 'css',
  py: 'python',
  python3: 'python',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
  sqlite: 'sql',
  golang: 'go',
  rs: 'rust',
  'c++': 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  h: 'c',
  kt: 'kotlin',
  kts: 'kotlin',
  cs: 'csharp',
  'c#': 'csharp',
  objc: 'objectivec',
  'objective-c': 'objectivec',
  docker: 'dockerfile',
  patch: 'diff',
  ps1: 'powershell',
  pwsh: 'powershell',
  rb: 'ruby',
  jl: 'julia',
  hs: 'haskell',
  tex: 'latex',
  asm: 'gas',
  'assembly': 'gas',
  proto: 'protobuf'
}

/** 规范化围栏信息串(```js title="x" → js);取不到就返回空串 */
export function normalizeLang(info: string): string {
  const first = info.trim().split(/[\s:{,]/)[0] ?? ''
  return first.toLowerCase()
}

/**
 * 语言 → Language 对象;不认识返回 null。
 * 编辑器把它交给 `markdown({ codeLanguages })`,围栏里的代码因此也会高亮。
 * `mermaid` 等「不是代码」的围栏由调用方先拦掉,不会走到这里。
 */
export function languageFor(lang: string): Language | null {
  const name = normalizeLang(lang)
  if (name === '') return null
  return LANGS[name] ?? LANGS[ALIASES[name] ?? ''] ?? null
}

/** 语言 → Parser;不认识返回 null。预览侧自渲染只要 parser */
export function parserFor(lang: string): Parser | null {
  return languageFor(lang)?.parser ?? null
}
