// 笔记契约:类型、上限、目录解析 —— main 与 renderer 共用。
//
// 注意:不得引入 node:* 依赖(shared 同时被 renderer 打包,同 cron-log.ts 的约束),
// 路径一律模板串拼 —— 本项目 macOS 专用,`/` 是唯一分隔符。

import { LAUNCHER_CONFIG_DIR_SUFFIX } from './constants'

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

export interface NotesListPayload {
  notes: NoteMeta[]
  /**
   * 所有目录的 id(相对路径)。
   * 必须单独给:**空目录**在 notes 里没有任何痕迹,不给的话用户刚建的空目录会立刻消失。
   */
  folders: string[]
  /** 生效目录(设置里为空时是默认路径) */
  dir: string
  /** 因上限未列出的篇数 */
  truncated: number
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

/** 拼接父子路径(父为空则就是子) */
export function joinNoteId(parent: string, child: string): string {
  return parent === '' ? child : `${parent}/${child}`
}
