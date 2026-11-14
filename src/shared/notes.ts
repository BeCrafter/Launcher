// 笔记契约:类型、上限、目录解析 —— main 与 renderer 共用。
//
// 注意:不得引入 node:* 依赖(shared 同时被 renderer 打包,同 cron-log.ts 的约束),
// 路径一律模板串拼 —— 本项目 macOS 专用,`/` 是唯一分隔符。

import { LAUNCHER_CONFIG_DIR_SUFFIX } from './constants'

/**
 * 同步的默认排除。gitignore 风格,预填在设置里。
 * 用户清空后就是明确要全部同步,normalize 不会把空串填回这一段。
 */
export const DEFAULT_SYNC_IGNORE = ['.*', '*.tmp', '*.md.tmp'].join('\n')

/** 排除规则文本上限。设置文件是明文,不设界时损坏文件能把它撑大 */
export const SYNC_IGNORE_MAX = 8 * 1024

/** WebDAV / S3 单文件上限。再大的跳过并记进结果,不按格式另设 */
export const SYNC_HTTP_MAX_BYTES = 128 * 1024 * 1024

// ── 上限 ──
/** 单篇笔记正文上限:超过则读/写都拒绝(README 的「笔记」不该是数据仓库) */
export const MAX_NOTE_BYTES = 1024 * 1024
/** frontmatter 区上限:超过即 opaque,不解析也不改写(原样保留) */
export const MAX_FRONTMATTER_BYTES = 16 * 1024
export const MAX_TITLE = 200
export const MAX_TAGS = 32
export const TAG_MAX = 48
export const MAX_REFS = 64
export const REF_TYPE_MAX = 32
export const REF_KEY_MAX = 200
export const REF_LABEL_MAX = 200
export const REF_DETAIL_MAX = 200
/** 列表上限:超出的按 mtime 倒序截断,payload 里报 truncated(不静默丢) */
export const MAX_NOTES = 2000
/** 文件行列表上限(与笔记同一套「不静默丢」原则) */
export const MAX_FILES = 2000
/** 一次拖入的顶层项上限,防误拖整个磁盘 */
export const MAX_IMPORT_ROOTS = 200
/** 导入时最多复制的文件 / 目录数,超出的跳过并计数 */
export const MAX_IMPORT_FILES = MAX_FILES
export const MAX_IMPORT_DIRS = 1000
/** 给 AI 的正文上限:超出截断并显式说明 */
export const MAX_BODY_FOR_AI = 64 * 1024
/**
 * 给 AI 的**单张图片**上限(比 MAX_ASSET_BYTES 严得多)。
 * 图片要 base64 进请求体,16 MiB 的图转完是 21 MiB —— 那不是「看一眼截图」的用法。
 */
export const MAX_ASSET_FOR_AI = 4 * 1024 * 1024
/**
 * 引用**选中片段**时的片段上限。片段是渲染层给的(用户选中的文字),
 * 跨 IPC 进来必须收敛 —— 落进会话文件的每一字节,之后每一轮都会重发。
 */
export const MAX_NOTE_QUOTE_BYTES = 16 * 1024
/**
 * 单条消息里所有引用笔记正文的**注入总量**上限。
 * 单篇 64 KiB × 10 篇 = 640 KiB 是会把上下文撑爆的,超出的按引用顺序不注入并写明。
 */
export const MAX_NOTE_MENTION_BYTES = 128 * 1024
/** 笔记 id(= 相对笔记目录的路径,去扩展名)长度上限 */
export const NOTE_ID_MAX = 400
/** 单段(文件名或目录名)长度上限 */
export const NOTE_SEGMENT_MAX = 120
/** 目录嵌套上限:防病态深目录把扫描/渲染拖垮 */
export const MAX_FOLDER_DEPTH = 8
/** 标题 → 文件名片段的长度上限 */
export const NOTE_SLUG_MAX = 80
/** 单张图片/附件上限 */
export const MAX_ASSET_BYTES = 16 * 1024 * 1024
/** 列表行里的摘录长度 */
export const EXCERPT_MAX = 160

/** 附件子目录(在**根层**排除,不参与笔记扫描;嵌套的同名目录是普通目录) */
export const NOTES_ASSETS_DIR = 'assets'
/** 无 shell 时删除的落点(点开头 → 扫描器跳过,Obsidian 也忽略) */
export const NOTES_TRASH_DIR = '.trash'
/** 预览加载本地图片的自定义协议 */
export const NOTES_ASSET_SCHEME = 'launcher-note'

/**
 * 允许在预览里加载的图片扩展名。
 *
 * **刻意不含 svg**:SVG 能内嵌 <script>,作为文档直接打开时是 XSS 向量。
 * 作为 <img> 加载虽不执行脚本,但只要用户把 launcher-note:// 地址粘进地址栏就绕过了这层保护。
 */
export const NOTE_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'] as const

export function isNoteImageExt(ext: string): boolean {
  return (NOTE_IMAGE_EXTS as readonly string[]).includes(ext.toLowerCase())
}

/**
 * 附件按扩展名分成几类。**这张表是唯一的事实来源** ——
 * 协议处理器拿它决定「放不放行、怎么发、发什么 Content-Type」,
 * 渲染层(markdown.tsx)拿它决定「用哪个元素显示」。
 * 两边各写一份必然漂移,而漂移的表现是「预览里一个打不开的黑框」。
 */
export type NoteAssetKind = 'image' | 'video' | 'audio' | 'pdf' | 'page'

const ASSET_KINDS: Record<string, NoteAssetKind> = {
  // 图片
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  // 视频
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  m4v: 'video',
  ogv: 'video',
  // 音频
  mp3: 'audio',
  m4a: 'audio',
  wav: 'audio',
  ogg: 'audio',
  oga: 'audio',
  flac: 'audio',
  aac: 'audio',
  // 文档
  pdf: 'pdf',
  // 本地网页(iframe 嵌入用)
  html: 'page',
  htm: 'page'
}

/** 扩展名(不带点) → 附件类型;不认识返回 null */
export function noteAssetKind(ext: string): NoteAssetKind | null {
  return ASSET_KINDS[ext.toLowerCase()] ?? null
}

/** 从一段地址里取扩展名并判类型(忽略 ?query 与 #hash) */
export function noteAssetKindOfUrl(url: string): NoteAssetKind | null {
  const clean = url.split(/[?#]/)[0]
  const dot = clean.lastIndexOf('.')
  if (dot < 0) return null
  return noteAssetKind(clean.slice(dot + 1))
}

/**
 * 扩展名(不带点) → Content-Type。
 *
 * 和 ASSET_KINDS 一样**只有这一份**:协议处理器拿它回响应头,
 * AI 的读图工具拿它填图片块的 mimeType。两边各写一份,漂移的表现是
 * 「模型收到一个它不认识的图片类型」或者「浏览器把图当二进制下载」。
 */
const ASSET_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8'
}

export function noteAssetMime(ext: string): string {
  return ASSET_MIME[ext.toLowerCase()] ?? 'application/octet-stream'
}

// ── 关联 ──

/** 关联对象的类型(与三个模块对应);开放联合:未知 type 原样保留、降级为中性 chip */
export type NoteRefType = 'agent' | 'cron' | 'service'

/**
 * 一条关联。
 *
 * `key` 是**持久身份键**(见各域的身份规则),`label`/`detail` 是**链接时的展示名快照** ——
 * 有快照才能离线渲染、才能在对象已不存在时仍然说清「这里原本指向谁」。
 * `detail` 同时是 cron 的重解析依据:它的 id 是内容哈希,用户改了命令就失配,
 * 靠 detail 里的 `expr · cmd` 才能把关联找回来。
 */
export interface NoteRef {
  type: NoteRefType | (string & {})
  key: string
  label: string
  detail?: string
}

// ── 领域模型 ──

/** 列表项:不含正文(正文只在 read 时取,列表不该拖着全部内容) */
export interface NoteMeta {
  /** = 文件名去扩展名;不往 frontmatter 里塞 id 字段 */
  id: string
  title: string
  created: string
  updated: string
  tags: string[]
  pinned: boolean
  refs: NoteRef[]
  excerpt: string
  mtimeMs: number
  size: number
  /** frontmatter 里认得但形态无法解析的键(原样保留,写时跳过) */
  frontmatterIssues: string[]
  /** refs 段不是本应用认识的形态 → 只读、不显示 chips */
  refsUnparsed: boolean
  /** frontmatter 过大 → 未解析 */
  opaque: boolean
  /**
   * 超过 MAX_NOTE_BYTES → 不在应用内打开(读了也写不回去,只会把 IPC 撑爆)。
   * 列表里照常出现并明说原因,而不是让它悄悄消失。
   */
  tooLarge?: boolean
}

export interface Note extends NoteMeta {
  body: string
  /** sha1(整份文件文本):写操作的 CAS 依据 */
  revision: string
}

/** 目录里的非 Markdown 文件:只带列表需要的元信息,不含内容 */
export interface NoteFileMeta {
  /** 相对笔记目录的路径,含文件名与扩展名,如 `素材/截图.png` */
  path: string
  /** 文件名(含扩展名) */
  name: string
  /** 小写扩展名(不含点);无扩展名 = '' */
  ext: string
  size: number
  mtimeMs: number
}

// ── 非 Markdown 文件:类型、上限与读写契约 ──

/**
 * 文件行的类型。**这张表是唯一来源**:
 * 左栏图标、打开方式、viewer registry、协议 MIME/CSP 都从它派生。
 */
export type NoteFileKind =
  | 'text'
  | 'code'
  | 'markdown'
  | 'csv'
  | 'html'
  | 'image'
  | 'psd'
  | 'tiff'
  | 'heic'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'archive'
  | 'archive-unsupported'
  | 'model'
  | 'legacy-office'
  | 'canvas'
  | 'unsupported'

/**
 * 可编辑文本的大小上限。
 *
 * 不是产品限制,是内存安全线:CodeMirror 的文档是 JS UTF-16 字符串 + piece tree,
 * IPC 还会再复制一份。64 MiB 已经能覆盖正常代码/日志;再大就只读或交给默认应用,
 * 而不是把整个应用拖死。媒体/PDF 不走整读,靠 Range 不受这条限制。
 */
export const MAX_TEXT_FILE_BYTES = 64 * 1024 * 1024
/** 单个二进制文件(Office/压缩包/PSD/TIFF/HEIC/3D)整读硬上限 */
export const MAX_FILE_BYTES_READ = 128 * 1024 * 1024

/** 各类查看器的建议上限(Sail 同量级;渲染层先按 stat 拦,主进程再有硬上限) */
export const OFFICE_MAX_BYTES = 40 * 1024 * 1024
export const IMAGE_MAX_BYTES = 80 * 1024 * 1024
export const IMAGE_MAX_PIXELS = 80_000_000
export const MODEL_MAX_BYTES = 120 * 1024 * 1024
export const ARCHIVE_MAX_BYTES = 128 * 1024 * 1024
export const ARCHIVE_UNPACKED_MAX = 256 * 1024 * 1024
export const ARCHIVE_ENTRY_MAX = 128 * 1024 * 1024
export const ARCHIVE_ENTRIES_MAX = 2000
export const ARCHIVE_DEPTH_MAX = 3
/** 压缩包内 HTML 内联资源的总预算 */
export const ARCHIVE_INLINE_RESOURCE_MAX = 32 * 1024 * 1024
export const ARCHIVE_HTML_MAX = 16 * 1024 * 1024

export const CSV_PREVIEW_ROWS = 5000
export const CSV_PREVIEW_COLS = 200
export const CSV_PREVIEW_BYTES = 8 * 1024 * 1024

/** 文件协议 host:`launcher-note://file/<rel>` */
export const NOTES_FILE_HOST = 'file'
/**
 * 白板外部文件的只读协议 host:`launcher-note://external/?p=<绝对路径>`。
 * 路径放在查询串里,不放进 pathname,避免 `/` 被协议当成目录。
 */
export const NOTES_EXTERNAL_HOST = 'external'

const EXT_KIND: Record<string, NoteFileKind> = {
  // 代码
  js: 'code',
  mjs: 'code',
  cjs: 'code',
  ts: 'code',
  tsx: 'code',
  jsx: 'code',
  json: 'code',
  jsonc: 'code',
  json5: 'code',
  jsonl: 'code',
  vue: 'code',
  svelte: 'code',
  astro: 'code',
  go: 'code',
  py: 'code',
  rb: 'code',
  rs: 'code',
  java: 'code',
  kt: 'code',
  kts: 'code',
  swift: 'code',
  php: 'code',
  c: 'code',
  h: 'code',
  cc: 'code',
  cpp: 'code',
  cxx: 'code',
  hpp: 'code',
  cs: 'code',
  sh: 'code',
  bash: 'code',
  zsh: 'code',
  fish: 'code',
  css: 'code',
  scss: 'code',
  sass: 'code',
  less: 'code',
  sql: 'code',
  lua: 'code',
  r: 'code',
  pl: 'code',
  scala: 'code',
  proto: 'code',
  graphql: 'code',
  gql: 'code',
  nix: 'code',
  tf: 'code',
  hcl: 'code',
  yml: 'code',
  yaml: 'code',
  toml: 'code',
  ini: 'code',
  xml: 'code',
  xsd: 'code',
  xsl: 'code',
  plist: 'code',
  diff: 'code',
  patch: 'code',
  dockerfile: 'code',
  makefile: 'code',
  cmake: 'code',
  gradle: 'code',
  // 纯文本
  txt: 'text',
  log: 'text',
  conf: 'text',
  config: 'text',
  env: 'text',
  properties: 'text',
  lock: 'text',
  mod: 'text',
  sum: 'text',
  mk: 'text',
  gitignore: 'text',
  gitattributes: 'text',
  editorconfig: 'text',
  npmrc: 'text',
  yarnrc: 'text',
  dockerignore: 'text',
  // 结构化文本
  csv: 'csv',
  tsv: 'csv',
  tab: 'csv',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  // 图片
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  apng: 'image',
  bmp: 'image',
  ico: 'image',
  svg: 'image',
  // 媒体
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  m4v: 'video',
  ogv: 'video',
  mkv: 'video',
  avi: 'video',
  mp3: 'audio',
  m4a: 'audio',
  wav: 'audio',
  ogg: 'audio',
  oga: 'audio',
  flac: 'audio',
  aac: 'audio',
  opus: 'audio',
  pdf: 'pdf',
  // Office OpenXML
  docx: 'docx',
  docm: 'docx',
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  pptx: 'pptx',
  pptm: 'pptx',
  // 旧版 Office(只给占位)
  doc: 'legacy-office',
  xls: 'legacy-office',
  ppt: 'legacy-office',
  // 压缩包
  zip: 'archive',
  tar: 'archive',
  tgz: 'archive',
  gz: 'archive',
  gzip: 'archive',
  rar: 'archive-unsupported',
  '7z': 'archive-unsupported',
  zst: 'archive-unsupported',
  bz2: 'archive-unsupported',
  xz: 'archive-unsupported',
  // 3D
  glb: 'model',
  gltf: 'model',
  obj: 'model',
  stl: 'model',
  // 需要解码的图片
  psd: 'psd',
  psb: 'psd',
  tif: 'tiff',
  tiff: 'tiff',
  heic: 'heic',
  heif: 'heic',
  // 白板是 Excalidraw 场景的文本文件,但不用 CodeMirror 打开(见 isNoteFileEditable)。
  // 库内新建用短后缀 .excal。导出仍是 Excalidraw 自己的 .excalidraw,
  // 已经在库里的 .excalidraw 也按白板打开。
  excal: 'canvas',
  excalidraw: 'canvas'
}

/** 无扩展名但显然是代码/配置的文件名(小写) */
const CODE_BASENAMES = new Set([
  'makefile',
  'dockerfile',
  'gemfile',
  'rakefile',
  'vagrantfile',
  'brewfile',
  'procfile'
])

/** 无扩展名但显然是纯文本的文件名(小写) */
const TEXT_BASENAMES = new Set([
  'license',
  'licence',
  'readme',
  'changelog',
  'authors',
  'notice'
])

/** 扩展名(不带点) → 文件类型;未知扩展名返回 unsupported */
export function noteFileKind(ext: string, name?: string): NoteFileKind {
  const e = ext.toLowerCase()
  if (e !== '') return EXT_KIND[e] ?? 'unsupported'
  const base = (name ?? '').toLowerCase()
  if (CODE_BASENAMES.has(base)) return 'code'
  return TEXT_BASENAMES.has(base) ? 'text' : 'unsupported'
}

/** 可以用 CodeMirror 编辑的类型 */
export function isNoteFileEditable(kind: NoteFileKind): boolean {
  return (
    kind === 'text' ||
    kind === 'code' ||
    kind === 'markdown' ||
    kind === 'csv' ||
    kind === 'html'
  )
}

/**
 * 文件协议/下载用的 Content-Type。只按扩展名判断,**不嗅探内容** ——
 * 嗅探会让一个改名成 .png 的恶意文件决定响应头,而扩展名是确定的。
 */
const FILE_MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  excal: 'application/vnd.excalidraw+json',
  excalidraw: 'application/vnd.excalidraw+json',
  jsonc: 'application/json; charset=utf-8',
  jsonl: 'application/x-ndjson; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  xsd: 'application/xml; charset=utf-8',
  xsl: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  yml: 'text/yaml; charset=utf-8',
  yaml: 'text/yaml; charset=utf-8',
  toml: 'text/plain; charset=utf-8',
  ini: 'text/plain; charset=utf-8',
  sh: 'text/x-shellscript; charset=utf-8',
  py: 'text/x-python; charset=utf-8',
  go: 'text/x-go; charset=utf-8',
  rs: 'text/x-rust; charset=utf-8',
  sql: 'text/x-sql; charset=utf-8',
  wasm: 'application/wasm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  apng: 'image/apng',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  opus: 'audio/opus',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  zip: 'application/zip',
  tar: 'application/x-tar',
  tgz: 'application/gzip',
  gz: 'application/gzip',
  gltf: 'model/gltf+json',
  glb: 'model/gltf-binary',
  stl: 'model/stl',
  obj: 'text/plain; charset=utf-8',
  psd: 'image/vnd.adobe.photoshop',
  psb: 'image/vnd.adobe.photoshop',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif'
}

export function noteFileMime(ext: string): string {
  return FILE_MIME[ext.toLowerCase()] ?? 'application/octet-stream'
}

/** 文件元信息 + 类型(不走内容读取) */
export interface NoteFileStat extends NoteFileMeta {
  kind: NoteFileKind
  mime: string
  editable: boolean
  tooLarge: boolean
}

export type NoteFileTextEncoding = 'utf8' | 'utf8-bom' | 'utf16le' | 'utf16be'

export interface NoteFileBaseDoc {
  /** 相对笔记目录的路径 */
  path: string
  name: string
  ext: string
  kind: NoteFileKind
  /** 协议/下载用的 Content-Type(按扩展名) */
  mime: string
  size: number
  mtimeMs: number
  editable: boolean
  tooLarge: boolean
}

export interface NoteFileTextDoc extends NoteFileBaseDoc {
  editable: true
  /** sha1(磁盘原始字节) */
  revision: string
  encoding: NoteFileTextEncoding
  /** 保存时按原样还原 */
  eol: '\n' | '\r\n'
  /** 运行时以 LF 归一 */
  text: string
}

export type NoteFileBinaryReason = 'binary' | 'unsupported-encoding' | 'too-large' | 'unsupported'

export interface NoteFileBinaryDoc extends NoteFileBaseDoc {
  editable: false
  revision: null
  reason: NoteFileBinaryReason
}

export type NoteFileDoc = NoteFileTextDoc | NoteFileBinaryDoc

export type NoteFileReadOutcome =
  | { ok: true; doc: NoteFileDoc }
  | { ok: false; kind: 'invalid' | 'not-found' | 'io'; message: string }

export interface NoteFileSaveInput {
  path: string
  /** LF 归一后的正文 */
  text: string
  expectedRevision: string
  /** 「保留我的版本」:以磁盘最新版本为基准强制覆盖 */
  force?: boolean
}

export type NoteFileSaveOutcome =
  | { ok: true; doc: NoteFileTextDoc }
  | {
      ok: false
      kind: 'conflict'
      /** 只回元信息,不回整份旧正文(可能是几十 MB) */
      latest: { revision: string; size: number; mtimeMs: number }
    }
  | {
      ok: false
      kind: 'invalid' | 'not-found' | 'io' | 'too-large' | 'not-text'
      message: string
    }

export type NoteFileBytesOutcome =
  | { ok: true; data: Uint8Array; size: number; mtimeMs: number }
  | {
      ok: false
      kind: 'invalid' | 'not-found' | 'io' | 'too-large'
      message: string
      size?: number
    }

/** 在指定目录新建一个空文件(非 .md;Markdown 笔记走 notes.create) */
export interface NoteFileCreateInput {
  /** 父目录 id(相对路径);空串 = 根层 */
  parent: string
  /** 单段文件名,含扩展名,如 `app.js` */
  name: string
}

export type NoteFileCreateOutcome =
  | { ok: true; file: NoteFileStat }
  | { ok: false; kind: 'invalid' | 'exists' | 'io'; message: string }

/**
 * 重命名文件:传入的是新的单段文件名,含扩展名。
 * 改成 `.md`(大小写不论)会写成 `.md`,目录扫描把它收成笔记。`.markdown` 仍是普通文件。
 */
export interface NoteFileRenameInput {
  /** 旧相对路径 */
  path: string
  /** 新的单段文件名,含扩展名,如 `app.js` */
  name: string
}

export type NoteFileRenameOutcome =
  | { ok: true; file: NoteFileStat }
  | { ok: false; kind: 'invalid' | 'not-found' | 'exists' | 'io'; message: string }

export interface NotesListPayload {
  notes: NoteMeta[]
  /**
   * 所有目录的 id(相对路径)。
   * 必须单独给:**空目录**在 notes 里没有任何痕迹,不给的话用户刚建的空目录会立刻消失。
   */
  folders: string[]
  /** 目录里的非 Markdown 文件(根层 assets/ 除外) */
  files: NoteFileMeta[]
  /** 生效目录(设置里为空时是默认路径) */
  dir: string
  /** 因上限未列出的篇数 */
  truncated: number
  /** 因上限未列出的文件数 */
  truncatedFiles: number
  /** 扫描失败原因 —— 「扫描挂了」与「真的没有笔记」不能长得一样 */
  error: string | null
}

export interface NotesChangedPayload {
  ids: string[]
}

export interface NoteCreateInput {
  title?: string
  body?: string
  tags?: string[]
  refs?: NoteRef[]
  /** 父目录 id(相对路径);空串 = 根层 */
  parent?: string
  /** 显式指定 id(测试/导入用);省略则由标题生成 */
  id?: string
}

/** 可单独改写的元数据(不动正文) */
export interface NoteMetaPatch {
  title?: string
  tags?: string[]
  pinned?: boolean
  refs?: NoteRef[]
}

export interface NoteSaveInput {
  id: string
  body: string
  /** 缺失一律拒绝(同 agent-service 的写路径约定) */
  expectedRevision: string
  meta?: NoteMetaPatch
  /** 仅用于「保留我的版本」覆盖冲突:写前会立刻重读,把窗口压到最小 */
  force?: boolean
  /**
   * 是否把 `updated` 推到当前时间(默认 true)。
   * 置顶这类纯元数据动作传 false:否则「取消置顶」会让那篇突然跳到「最近更新」最前。
   */
  touchUpdated?: boolean
}

export interface NoteRenameInput {
  id: string
  title: string
  expectedRevision: string
  /**
   * 撞名时的处置。默认**不**自动加序号,而是回 name-taken 让调用方去问用户 ——
   * 改名是用户的显式动作,输入 `note` 却得到 `note-2` 太意外。
   * 用户确认「保留两者」后,调用方带这个标记重试一次。
   */
  onConflict?: 'auto-rename'
}

export interface NoteRemoveInput {
  id: string
  expectedRevision: string
}

export interface NoteSaveAssetInput {
  fileName: string
  data: ArrayBuffer
}

/** 把 OS 文件/文件夹原样复制进笔记目录 */
export interface NoteImportInput {
  /** 目标目录 id;空串 = 根层 */
  target: string
  /** 源绝对路径(来自 preload 的 webUtils.getPathForFile) */
  paths: string[]
}

/** 白板外部文件在这台电脑上还在不在。不读内容。 */
export interface NoteExternalProbeInput {
  /** 录入时的绝对路径 */
  source: string
  /** 不再用来判断。留着,避免改调用形状。 */
  host: string
}

export interface NoteExternalProbeResult {
  /** 固定为 true。读原文件还是副本只看 present。 */
  sameHost: boolean
  /** 这个绝对路径是不是本机上可预览的普通文件 */
  present: boolean
  /** 固定为空串。不再当作电脑标识。 */
  host: string
}

export type NoteImportResult =
  | {
      ok: true
      target: string
      /** 实际复制出的文件 / 目录数(顶层被拖入的目录算一个) */
      files: number
      folders: number
      /** 隐藏项、符号链接、超深/超量、非法名等 */
      skipped: number
    }
  | { ok: false; message: string }

export type NoteFileOutcome = { ok: true } | { ok: false; message: string }

export interface NoteSaveAssetResult {
  /** 相对笔记目录的路径,如 `assets/Pasted image 20261009150211.png` */
  relPath: string
}

export type NoteSaveFailureKind =
  | 'conflict'
  /** 目标名已被占用(改名撞名)。用户可改用 suggested 再试一次 */
  | 'name-taken'
  | 'invalid'
  | 'too-large'
  | 'io'
  | 'not-found'

export type NoteSaveOutcome =
  | { ok: true; note: Note }
  /** 删除成功没有可回写的文档;调用方必须刷新列表并关掉编辑区,而不是解引用空 note */
  | { ok: true; removed: true }
  | { ok: false; kind: 'conflict'; latest: Note }
  | { ok: false; kind: Exclude<NoteSaveFailureKind, 'conflict'>; message: string; suggested?: string }

// ── 目录 ──

/**
 * 生效的笔记目录。**纯函数**(不碰 fs、不用 node:path):设置页要显示它、主进程要建它,
 * 两处必须算出同一个值。
 *
 * `e2eUserData` 存在时**强制**覆盖 —— 否则每次自动化验证都往用户真实笔记目录里写,
 * 正是 main/index.ts 里 LAUNCHER_E2E_USER_DATA 那段注释警告过的那类事故。
 */
export function resolveNotesDir(o: {
  notesDir: string
  home: string
  e2eUserData?: string
}): string {
  if (o.e2eUserData) return `${o.e2eUserData}/notes`
  const raw = o.notesDir.trim()
  if (raw !== '') return raw.startsWith('~/') ? `${o.home}/${raw.slice(2)}` : raw
  return `${o.home}/${LAUNCHER_CONFIG_DIR_SUFFIX}/notes`
}

/** 附件目录(绝对路径) */
export function notesAssetsDir(dir: string): string {
  return `${dir}/${NOTES_ASSETS_DIR}`
}

/**
 * 单段(文件名 / 目录名)是否安全。
 * 点开头一律拒绝:那既是隐藏文件,也是我们自己的 `.trash/` 落点。
 */
export function isSafeNoteSegment(seg: string): boolean {
  if (seg === '' || seg === '.' || seg === '..') return false
  if (seg.length > NOTE_SEGMENT_MAX) return false
  if (seg.startsWith('.')) return false
  return !/[/\\\u0000]/.test(seg)
}

/**
 * id 是**相对笔记目录的路径**(不含 `.md`),支持 `工作/nginx 排障` 这样的目录笔记。
 * 每一段都要安全,且深度有上限 —— 这是「读到目录外」的第一道闸(第二道在附件协议里)。
 */
export function isSafeNoteId(id: string): boolean {
  if (id === '' || id.length > NOTE_ID_MAX) return false
  const segs = id.split('/')
  if (segs.length > MAX_FOLDER_DEPTH + 1) return false
  return segs.every(isSafeNoteSegment)
}

/** `a/b/c` → `a/b`;根层返回空串 */
export function parentOf(id: string): string {
  const at = id.lastIndexOf('/')
  return at < 0 ? '' : id.slice(0, at)
}

/** `a/b/c` → `c` */
export function baseNameOf(id: string): string {
  const at = id.lastIndexOf('/')
  return at < 0 ? id : id.slice(at + 1)
}

/**
 * 文件名 → 主名 + 扩展名(不含点)。`a.tar.gz` → `{ base:'a.tar', ext:'gz' }`。
 * 无扩展名或点开头(`.env`)时 ext 为空,base 原样返回。
 * 新建与改名输入框共用这一份拆分:挂上时只选中主名,提交时按最后一段决定是笔记还是文件。
 */
export function splitFileExt(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return { base: name, ext: '' }
  return { base: name.slice(0, dot), ext: name.slice(dot + 1) }
}

/** 拼接父子路径(父为空则就是子) */
export function joinNoteId(parent: string, child: string): string {
  return parent === '' ? child : `${parent}/${child}`
}
