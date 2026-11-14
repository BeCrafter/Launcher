// 笔记服务:扫描 / 索引 / CAS 写 / 原子替换 / 目录监听 / 全文检索 / 附件落盘。
//
// 装配点只有 core-services.ts 一处,应用与独立的 launcher-mcp 进程共用同一份实现 ——
// 差别只在注入项:独立进程不传 onExternalChange(无 Electron、无 watcher),传不传 trash 决定
// 删除走系统废纸篓还是 <dir>/.trash/。两进程同持一个目录是安全的:都走 tmp+rename 原子写,
// 写前都重读,并发只会得到 conflict 而不是静默丢更新。

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent,
  type Stats
} from 'node:fs'
import { extname, join } from 'node:path'
import { resolveAssetRel } from '../domains/note-asset'
import { resolveExternalPath } from './notes-protocol'
import {
  EXCERPT_MAX,
  MAX_ASSET_BYTES,
  MAX_ASSET_FOR_AI,
  MAX_BODY_FOR_AI,
  MAX_FILES,
  MAX_FOLDER_DEPTH,
  MAX_NOTE_BYTES,
  MAX_TEXT_FILE_BYTES,
  MAX_FILE_BYTES_READ,
  MAX_NOTES,
  MAX_TITLE,
  NOTES_ASSETS_DIR,
  NOTES_TRASH_DIR,
  isNoteImageExt,
  isNoteFileEditable,
  baseNameOf,
  isSafeNoteId,
  isSafeNoteSegment,
  joinNoteId,
  noteAssetMime,
  noteFileKind,
  noteFileMime,
  notesAssetsDir,
  parentOf,
  splitFileExt,
  type Note,
  type NoteCreateInput,
  type NoteFileBinaryDoc,
  type NoteFileBytesOutcome,
  type NoteFileCreateInput,
  type NoteFileCreateOutcome,
  type NoteFileMeta,
  type NoteFileOutcome,
  type NoteFileReadOutcome,
  type NoteFileRenameInput,
  type NoteFileRenameOutcome,
  type NoteFileSaveInput,
  type NoteFileSaveOutcome,
  type NoteFileStat,
  type NoteFileTextDoc,
  type NoteExternalProbeInput,
  type NoteExternalProbeResult,
  type NoteImportInput,
  type NoteImportResult,
  type NoteMeta,
  type NoteRemoveInput,
  type NoteRenameInput,
  type NoteSaveAssetResult,
  type NoteSaveInput,
  type NoteSaveOutcome,
  type NotesListPayload
} from '../../shared/notes'
import { decodeTextBytes, encodeTextBytes, normalizeEol } from '../../shared/text-file'
import { resolveContainedFile } from '../domains/note-file'
import { importPathsIntoNotes, resolveNoteFile as resolveFileInNotes } from './note-import'
import {
  assembleFile,
  bodyText,
  patchFrontmatter,
  readFrontmatter,
  renderFrontmatter,
  splitFrontmatter,
  type FrontmatterFields,
  type FrontmatterSplit
} from '../domains/frontmatter'
import { slugifyFolderName, slugifyNoteTitle, titleFromBody, uniqueNoteId } from '../domains/note-id'
import { compactStamp, localIso } from '../domains/note-time'
import { createDebouncedDirWatcher, type DebouncedDirWatcher } from './dir-watcher'

export interface NotesService {
  dir(): string
  list(): Promise<NotesListPayload>
  read(id: string): Promise<Note | null>
  create(input: NoteCreateInput): Promise<Note>
  /**
   * 首次运行与「界面语言变了」两件事共用这一个入口:
   *   · 目录**完全为空** → 写入当前语言的示例,返回 `created`;
   *   · 已有一篇正文**逐字等于**另一种语言的示例(= 用户一个字没改过)→ 换成当前语言,
   *     连文件名一起换,返回 `switched`;
   *   · 其余一律不碰,返回 `none`。
   *
   * 为什么规则是「目录为空」而不是「装过一个标记」:前者不需要记住任何状态,
   * 而且用户删掉示例之后目录就不空了,不会隔一阵又冒出来。
   * 目录读不了(比如权限问题)时**不动手** —— 扫描失败与「真的没有笔记」必须区别对待,
   * 否则会在一个自己都没看懂情况的目录里动手。
   *
   * 「逐字相等才换」是这条规则的关键:用户只要动过一个字,我们就当它是他的笔记,
   * 永远不再碰 —— 换个界面语言不该把他的笔记换掉。
   */
  ensureSample(
    input: NoteCreateInput & {
      /**
       * 另一种语言的版本,用来认出「那篇是我们的示例且没被改过」。
       * `tags` 也参与比对:用户点 × 删过一条标签,那篇就已经是他的了。
       */
      other?: { title: string; body: string; tags?: string[] }
      /** 只在**首次创建**前调一次:把示例用到的媒体文件播种进 assets/ */
      onSeed?: () => void
    }
  ): Promise<'created' | 'switched' | 'none'>
  save(input: NoteSaveInput): Promise<NoteSaveOutcome>
  rename(input: NoteRenameInput): Promise<NoteSaveOutcome>
  remove(input: NoteRemoveInput): Promise<NoteSaveOutcome>
  search(query: string, limit?: number): Promise<NoteMeta[]>
  saveAsset(input: { fileName: string; data: ArrayBuffer }): Promise<NoteSaveAssetResult>
  /** 新建目录;返回目录的 id(相对路径) */
  createFolder(input: { parent: string; name: string }): Promise<{ id: string }>
  /** 删除目录(连同其中的笔记)到废纸篓 */
  removeFolder(input: { id: string }): Promise<NoteSaveOutcome>
  /** 目录改名(整体搬迁,目录内的笔记 id 前缀随之变化) */
  renameFolder(input: { id: string; name: string }): Promise<{ id: string }>
  /**
   * 移动到另一个目录。parent 为空串 = 根层。
   * kind 由调用方指明,服务端用 stat 核对:目录必须是目录,笔记必须是 `${id}.md`,文件必须是该路径上的普通文件。
   * 不符就失败,不按「路径在不在」猜种类 —— 无扩展名文件 `readme` 和笔记 `readme` 会撞车。
   * 目标已有同名项时**不覆盖**,自动加序号;文件撞名保留扩展名(`pic.png` → `pic-2.png`)。
   * 文件移动成功时带上新的 `file`,渲染层不自己拼元信息。
   */
  move(input: { id: string; parent: string; kind: 'note' | 'folder' | 'file' }): Promise<
    | {
        ok: true
        id: string
        renamed?: { from: string; to: string }
        file?: NoteFileStat
      }
    | { ok: false; message: string }
  >
  /** 把 OS 文件/文件夹原样复制进目标目录(批量导入) */
  importPaths(input: NoteImportInput): Promise<NoteImportResult>
  /** 白板外部文件在这台电脑上还在不在。不读内容,不跟随符号链接。 */
  probeExternal(input: NoteExternalProbeInput): NoteExternalProbeResult
  /** 文件相对路径 → 绝对路径;越界 / 根层 assets / 非普通文件返回 null */
  resolveNoteFile(rel: string): string | null
  /** 文件元信息与类型(不读内容);不存在/越界 → null */
  statFile(rel: string): NoteFileStat | null
  /**
   * 读文件用于查看/编辑。
   * 可编辑类型按 BOM 探测解码;二进制 / 未知编码 / 超限回 binary 占位而不是报错。
   */
  readFile(rel: string): Promise<NoteFileReadOutcome>
  /**
   * 读原始字节(Office / 压缩包 / PSD / 3D 查看器用)。
   * `maxBytes` 只用于提前拦截,实际不会超过 MAX_FILE_BYTES_READ。
   */
  readFileBytes(rel: string, maxBytes?: number): Promise<NoteFileBytesOutcome>
  /** 按原编码 / BOM / EOL 写回;带 sha1(原始字节) CAS,冲突不覆盖 */
  saveFile(input: NoteFileSaveInput): Promise<NoteFileSaveOutcome>
  /** 在指定目录新建空文件(非 .md;Markdown 笔记走 create) */
  createFile(input: NoteFileCreateInput): Promise<NoteFileCreateOutcome>
  /** 重命名文件:传入的是完整新文件名(含扩展名);改成 .md 会被拒绝 */
  renameFile(input: NoteFileRenameInput): Promise<NoteFileRenameOutcome>
  /** 删除文件(应用内走系统废纸篓) */
  removeFile(rel: string): Promise<NoteFileOutcome>
  /** 正文(供 AI 工具用;超长已截断并给出说明) */
  readBodyForAi(id: string): Promise<{ note: Note; body: string; truncated: boolean } | null>
  /**
   * 读一张本地附件给 AI(按需读图;模型自己决定要不要看)。
   *
   * 走与预览协议**同一套**三道闸(resolveAssetRel),且**只放行图片** ——
   * 视频/音频/PDF/网页对模型没有可读内容,读出来只是白白撑爆请求体。
   * 失败**带原因**回:模型要靠它换一条路(比如改用 read_note 看文字描述)。
   */
  readAssetForAi(rel: string): NoteAssetRead
  /** 仅应用内:目录监听。独立进程不调用 */
  start(): void
  stop(): void
  /** 目录有变动(含应用自己的保存)。同步用来去抖,不依赖扫描出的 id */
  onDirChange(cb: () => void): () => void
}

export type NoteAssetFailReason = 'invalid' | 'not-image' | 'too-large' | 'io'

export type NoteAssetRead =
  | { ok: true; data: string; mimeType: string; bytes: number; path: string }
  /** invalid = 不在 assets/ 下 / 扩展名不在白名单 / 路径穿越;not-image = 是附件但不是图片 */
  | { ok: false; reason: NoteAssetFailReason; size?: number }

/**
 * 正文里的路径有两种写法:应用自己写附件时编码成 `%20`,手写/外部工具留下的常是原样的空格。
 * 两种都试一遍 —— 只认一种的表现是「那张图模型永远看不到」。
 */
function assetCandidates(rel: string): string[] {
  const out = [rel]
  if (rel.includes('%')) {
    try {
      const decoded = decodeURIComponent(rel)
      if (decoded !== rel) out.push(decoded)
    } catch {
      /* 非法百分号编码:只按原样试 */
    }
  }
  return out
}

export function createNotesService(opts: {
  getDir(): string
  /** 外部改动(不传 = 独立进程,不启监听也不上报) */
  onExternalChange?(ids: string[]): void
  /** 删除落点;不传则移到 <dir>/.trash/ */
  trash?(path: string): Promise<void>
  log?(msg: string): void
  now?(): number
}): NotesService {
  const log = opts.log ?? ((): void => {})
  const now = opts.now ?? ((): number => Date.now())

  /** 目录变动的旁路。同步用它去抖,不走「外部改动」那条(那条会漏掉应用自己的保存) */
  const dirListeners = new Set<() => void>()

  /** 索引:元数据 + 用于判「要不要重读」的 (mtimeMs, size) + 已算出的 revision */
  interface Entry {
    meta: NoteMeta
    body: string
    revision: string
    mtimeMs: number
    size: number
  }
  const index = new Map<string, Entry>()
  /** 我们已知的磁盘版本:自己的每次读/写都更新它,于是自己的写不会误报为外部改动 */
  const lastKnownRevision = new Map<string, string>()
  /** 上一次扫描看到的目录集合(排序后);用来发现目录的新增与删除 */
  let lastFolders: string[] = []
  /** 上一次扫描看到的文件签名(path:mtime:size);文件行没有正文可比对,靠它发现变化 */
  let lastFilesSig = ''

  let watcher: DebouncedDirWatcher | null = null

  const sha1 = (text: string): string => createHash('sha1').update(text, 'utf8').digest('hex')
  const sha1Bytes = (bytes: Uint8Array): string => createHash('sha1').update(bytes).digest('hex')

  /** 文件行元信息 → stat 结果(不读内容,只看扩展名分类) */
  function fileStatOf(rel: string, st: { size: number; mtimeMs: number }): NoteFileStat {
    const name = baseNameOf(rel)
    const dot = name.lastIndexOf('.')
    const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
    const kind = noteFileKind(ext, name)
    const editable = isNoteFileEditable(kind)
    // 文本(含未知扩展名的「先按文本试读」)按 64 MiB,二进制按整读硬上限
    const textLike = editable || kind === 'unsupported' || kind === 'canvas'
    const tooLarge = st.size > (textLike ? MAX_TEXT_FILE_BYTES : MAX_FILE_BYTES_READ)
    return { path: rel, name, ext, kind, size: st.size, mtimeMs: st.mtimeMs, editable, tooLarge, mime: noteFileMime(ext) }
  }

  function binaryDoc(stat: NoteFileStat, reason: NoteFileBinaryDoc['reason']): NoteFileBinaryDoc {
    return { ...stat, editable: false, revision: null, reason }
  }

  function textDoc(
    stat: NoteFileStat,
    input: {
      kind?: NoteFileStat['kind']
      revision: string
      encoding: NoteFileTextDoc['encoding']
      eol: NoteFileTextDoc['eol']
      text: string
    }
  ): NoteFileTextDoc {
    return {
      ...stat,
      kind: input.kind ?? stat.kind,
      editable: true,
      tooLarge: false,
      revision: input.revision,
      encoding: input.encoding,
      eol: input.eol,
      text: input.text
    }
  }

  function fileOf(dir: string, id: string): string {
    return join(dir, `${id}.md`)
  }

  /** 某些文件系统上 birthtimeMs 为 0 → 回退 mtime,总比 1970 强 */
  function birthOf(st: Stats, mtimeMs: number): number {
    return st.birthtimeMs > 0 ? st.birthtimeMs : mtimeMs
  }

  /**
   * 递归收集目录下的笔记 id(相对路径,去 `.md`)。
   * 根层的 `assets/` 是附件目录,不参与扫描;嵌套的同名目录是普通目录。
   * 逐目录降级:读不动就跳过它,不影响其余目录(同 dir-watcher 的纪律)。
   */
  function collectTree(root: string): {
    ids: string[]
    folders: string[]
    files: string[]
    extraFiles: number
  } {
    const ids: string[] = []
    const folders: string[] = []
    const files: string[] = []
    let extraFiles = 0
    const walk = (rel: string, depth: number): void => {
      if (depth > MAX_FOLDER_DEPTH) return
      const abs = rel === '' ? root : join(root, rel)
      let entries: Dirent[]
      try {
        entries = readdirSync(abs, { withFileTypes: true })
      } catch (err) {
        log(`读取目录失败,跳过 ${rel || '.'}: ${String(err)}`)
        return
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue
        if (rel === '' && e.name === NOTES_ASSETS_DIR) continue
        const child = joinNoteId(rel, e.name)
        if (e.isDirectory()) {
          if (!isSafeNoteId(child)) {
            log(`skip 非法目录名: ${child}`)
            continue
          }
          folders.push(child)
          walk(child, depth + 1)
          continue
        }
        if (!e.isFile()) continue
        if (e.name.endsWith('.md')) {
          const id = child.slice(0, -3)
          if (!isSafeNoteId(id)) {
            log(`skip 非法文件名: ${child}`)
            continue
          }
          ids.push(id)
          continue
        }
        // 非 Markdown 文件进「文件行」。名字不安全的没法从列表打开/删除,不列出来
        if (!isSafeNoteId(child)) {
          log(`skip 非法文件名: ${child}`)
          continue
        }
        if (files.length < MAX_FILES) files.push(child)
        else extraFiles++
      }
    }
    walk('', 0)
    return { ids, folders, files, extraFiles }
  }

  /** 只要 id 的地方(create/rename 的查重)用它 */
  function collectIds(root: string): string[] {
    return collectTree(root).ids
  }

  /**
   * 索引里以 oldId 为前缀的条目整体换前缀。
   * 不换的话下一次 scan 会把它当成「旧的全删了 + 新的全加了」,白读一遍全部文件。
   */
  function reprefixIndex(oldId: string, newId: string): void {
    for (const key of [...index.keys()]) {
      if (key !== oldId && !key.startsWith(`${oldId}/`)) continue
      const entry = index.get(key)!
      const moved = `${newId}${key.slice(oldId.length)}`
      index.delete(key)
      lastKnownRevision.delete(key)
      index.set(moved, { ...entry, meta: { ...entry.meta, id: moved } })
    }
  }

  /** 目标路径是否已被占用(目录或同名 .md 都算) */
  function pathTaken(dir: string, id: string): boolean {
    return existsSync(join(dir, id)) || existsSync(join(dir, `${id}.md`))
  }

  /** 标题是否是「早期版本的路径兜底」残留(含 `/` 且尾段就是本文件名) */
  function isStalePathTitle(title: string | undefined, id: string): boolean {
    if (title === undefined || !title.includes('/')) return false
    return title.slice(title.lastIndexOf('/') + 1) === baseNameOf(id)
  }

  function excerptOf(body: string): string {
    let inFence = false
    for (const raw of body.split('\n')) {
      const line = raw.trim()
      if (/^(?:```|~~~)/.test(line)) {
        inFence = !inFence
        continue
      }
      if (inFence || line === '' || line.startsWith('#')) continue
      if (line.startsWith('![')) continue // 图片行当摘录没有意义
      const stripped = line.replace(/^(?:>\s*)*(?:[-*+]\s+|\d+[.)]\s+)?/, '')
      return stripped.slice(0, EXCERPT_MAX)
    }
    return ''
  }

  interface Parsed {
    meta: NoteMeta
    body: string
    revision: string
    split: FrontmatterSplit
    birthMs: number
    mtimeMs: number
    size: number
  }

  function parse(id: string, text: string, mtimeMs: number, size: number, birthMs: number): Parsed {
    const split = splitFrontmatter(text)
    const { fields, issues, refsUnparsed } = readFrontmatter(split)
    const body = bodyText(split)
    return {
      split,
      body,
      revision: sha1(text),
      birthMs,
      mtimeMs,
      size,
      meta: {
        id,
        // 回退用的是**文件名那一段**,不是完整 id —— id 现在是相对路径(`随手记/note`),
        // 拿它当标题会让列表里出现「目录名/文件名」。目录已经由树表达了,这里只该有名字。
        //
        // 另外修一处历史遗留:早期版本用完整 id 兜底,而那个值会被编辑区当成标题**写回文件**
        // (于是文件里真的存着 `title: 随手记/note`)。
        //
        // 判定不能只比「等于当前 id」:目录改名会把文件搬到新路径,而 frontmatter 里的旧路径
        // 标题不会跟着变(`随手记/note` 搬进 `随手记/sss/` 之后仍然写着旧路径)。
        // 所以规则是:标题**含 `/` 且末尾那一段等于本文件名** → 认定它是路径残留,当作没有标题。
        // 用户手写的标题极少带 `/`;真带了且尾段恰好同名,顶多退回文件名,不会丢东西。
        title: isStalePathTitle(fields.title, id)
          ? titleFromBody(body, baseNameOf(id))
          : (fields.title ?? titleFromBody(body, baseNameOf(id))),
        created: fields.created ?? localIso(birthMs),
        updated: fields.updated ?? localIso(mtimeMs),
        tags: fields.tags ?? [],
        pinned: fields.pinned ?? false,
        refs: fields.refs ?? [],
        excerpt: excerptOf(body),
        mtimeMs,
        size,
        frontmatterIssues: issues,
        refsUnparsed,
        opaque: split.opaque,
        ...(size > MAX_NOTE_BYTES ? { tooLarge: true } : {})
      }
    }
  }

  function toNote(p: Parsed): Note {
    return { ...p.meta, body: p.body, revision: p.revision }
  }

  /**
   * 扫一遍目录。**每次都 stat**:正确性不依赖 fs.watch,watcher 只是延迟优化。
   * (mtimeMs, size) 未变的文件不重读重解析 —— 笔记目录可能有几千篇。
   */
  function scan(): {
    payload: NotesListPayload
    changed: string[]
    foldersChanged: boolean
    filesChanged: boolean
  } {
    const dir = opts.getDir()
    const changed: string[] = []
    // 进循环前先记下「上一次长什么样」—— 新增/删除的文件与目录也要能被发现,
    // 否则往笔记目录里丢一个 .md(或外部建一个目录)在界面上永远不出现:
    // 只比对「同一篇的内容变没变」是发现不了它们的。
    const prevIds = new Set(index.keys())
    const prevFolders = lastFolders
    try {
      mkdirSync(dir, { recursive: true })
    } catch (err) {
      return {
        payload: {
          notes: [],
          folders: [],
          files: [],
          dir,
          truncated: 0,
          truncatedFiles: 0,
          error: `无法创建笔记目录:${String(err)}`
        },
        changed,
        foldersChanged: false,
        filesChanged: false
      }
    }

    let ids: string[]
    let folders: string[]
    let filePaths: string[]
    let extraFiles = 0
    try {
      const tree = collectTree(dir)
      ids = tree.ids
      folders = tree.folders
      filePaths = tree.files
      extraFiles = tree.extraFiles
    } catch (err) {
      return {
        payload: {
          notes: [],
          folders: [],
          files: [],
          dir,
          truncated: 0,
          truncatedFiles: 0,
          error: `无法读取笔记目录:${String(err)}`
        },
        changed,
        foldersChanged: false,
        filesChanged: false
      }
    }

    const seen = new Set<string>()
    for (const id of ids) {
      const file = join(dir, `${id}.md`)
      let st: Stats
      try {
        st = statSync(file)
      } catch (err) {
        log(`stat 失败,跳过 ${id}: ${String(err)}`)
        continue
      }
      seen.add(id)

      const cached = index.get(id)
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        if (lastKnownRevision.get(id) !== cached.revision) {
          changed.push(id)
          lastKnownRevision.set(id, cached.revision)
        }
        continue
      }

      let text: string
      try {
        text = readFileSync(file, 'utf8')
      } catch (err) {
        log(`读取失败,跳过 ${id}: ${String(err)}`)
        seen.delete(id)
        continue
      }
      const parsed = parse(id, text, st.mtimeMs, st.size, birthOf(st, st.mtimeMs))
      index.set(id, {
        meta: parsed.meta,
        body: parsed.body,
        revision: parsed.revision,
        mtimeMs: st.mtimeMs,
        size: st.size
      })
      const prev = lastKnownRevision.get(id)
      if (prev !== undefined && prev !== parsed.revision) changed.push(id)
      lastKnownRevision.set(id, parsed.revision)
    }

    // 新增的笔记(上一次扫描里没有)
    for (const id of seen) if (!prevIds.has(id)) changed.push(id)

    // 文件消失 → 索引与已知版本一并清掉,并**上报**(否则界面上会一直挂着一篇已删除的笔记)
    for (const id of [...index.keys()]) {
      if (!seen.has(id)) {
        index.delete(id)
        lastKnownRevision.delete(id)
        changed.push(id)
      }
    }

    // 目录集合变化(新建/删除目录,含**空目录** —— 它没有任何笔记可作痕迹)
    const folderSet = [...folders].sort()
    const foldersChanged =
      folderSet.length !== prevFolders.length || folderSet.some((f, i) => f !== prevFolders[i])
    lastFolders = folderSet

    // 文件行:只 stat,不读内容。mtime/size 组成签名,watcher 靠它发现外部改动
    const files: NoteFileMeta[] = []
    for (const rel of filePaths) {
      let st: Stats
      try {
        st = statSync(join(dir, rel))
      } catch (err) {
        log(`stat 失败,跳过文件 ${rel}: ${String(err)}`)
        continue
      }
      if (!st.isFile()) continue
      const name = baseNameOf(rel)
      const dot = name.lastIndexOf('.')
      files.push({
        path: rel,
        name,
        ext: dot < 0 ? '' : name.slice(dot + 1).toLowerCase(),
        size: st.size,
        mtimeMs: st.mtimeMs
      })
    }
    files.sort((a, b) => a.path.localeCompare(b.path))
    const filesSig = files.map((f) => `${f.path}:${f.mtimeMs}:${f.size}`).join('\n')
    const filesChanged = filesSig !== lastFilesSig
    lastFilesSig = filesSig

    const all = [...index.values()].map((e) => e.meta)
    all.sort((a, b) => b.mtimeMs - a.mtimeMs)
    const notes = all.slice(0, MAX_NOTES)
    return {
      payload: {
        notes,
        folders,
        files,
        dir,
        truncated: all.length - notes.length,
        truncatedFiles: extraFiles,
        error: null
      },
      changed,
      foldersChanged,
      filesChanged
    }
  }

  /** 从磁盘现状解析一份(冲突分支要回给用户「磁盘上现在长这样」,字段必须是真的) */
  function parsedFromDisk(id: string, file: string, text: string): Parsed {
    const st = statSync(file)
    return parse(id, text, st.mtimeMs, st.size, birthOf(st, st.mtimeMs))
  }

  /** 绕缓存重读:写路径必须先拿到磁盘**此刻**的内容(同 plist-service 的 readFresh 纪律) */
  function readFresh(id: string): Parsed | null {
    if (!isSafeNoteId(id)) return null
    const file = fileOf(opts.getDir(), id)
    if (!existsSync(file)) return null
    let st: Stats
    try {
      st = statSync(file)
    } catch {
      return null
    }
    const text = readFileSync(file, 'utf8')
    const parsed = parse(id, text, st.mtimeMs, st.size, birthOf(st, st.mtimeMs))
    index.set(id, {
      meta: parsed.meta,
      body: parsed.body,
      revision: parsed.revision,
      mtimeMs: st.mtimeMs,
      size: st.size
    })
    lastKnownRevision.set(id, parsed.revision)
    return parsed
  }

  /** 附件命名冲突时加序号 */
  function assetName(assets: string, base: string, ext: string): string {
    let name = `${base}.${ext}`
    for (let n = 2; existsSync(join(assets, name)); n++) name = `${base}-${n}.${ext}`
    return name
  }

  return {
    dir: () => opts.getDir(),

    async list() {
      return scan().payload
    },

    async read(id) {
      const parsed = readFresh(id)
      if (!parsed || parsed.size > MAX_NOTE_BYTES) return null
      return toNote(parsed)
    },

    async ensureSample(input) {
      const p = scan().payload
      // 扫描失败时不动手:那说明目录本身有问题,不是「空」
      if (p.error !== null) return 'none'

      if (p.notes.length === 0 && p.folders.length === 0 && p.files.length === 0) {
        try {
          // 目录是空的,assets/ 里也不会有同名文件 —— 这是「不覆盖用户文件」的天然保证
          input.onSeed?.()
          await this.create({ title: input.title, body: input.body, tags: input.tags })
          return 'created'
        } catch (err) {
          opts.log?.(`示例笔记写入失败:${String(err)}`)
          return 'none'
        }
      }

      // 目录不空:只有「那篇就是我们生成的另一种语言版本、且一个字没改过」才换
      const other = input.other
      if (other === undefined || other.title === input.title) return 'none'
      const hit = p.notes.find((n) => n.title === other.title)
      if (hit === undefined) return 'none'
      const full = await this.read(hit.id)
      // 逐字比对(只忽略行尾空白):用户动过一个字就当它是他的笔记,永远不再碰。
      // 标签也一起比 —— 正文没动、但标签被增删过,同样算「他已经动过手」。
      if (full === null || full.body.trimEnd() !== other.body.trimEnd()) return 'none'
      const otherTags = other.tags
      if (
        otherTags !== undefined &&
        (full.tags.length !== otherTags.length || full.tags.some((tag, i) => tag !== otherTags[i]))
      ) {
        return 'none'
      }
      try {
        await this.remove({ id: full.id, expectedRevision: full.revision })
        await this.create({ title: input.title, body: input.body, tags: input.tags })
        return 'switched'
      } catch (err) {
        opts.log?.(`示例笔记换语言失败:${String(err)}`)
        return 'none'
      }
    },

    async create(input) {
      const dir = opts.getDir()
      mkdirSync(dir, { recursive: true })
      const parent = input.parent !== undefined && input.parent !== '' ? input.parent : ''
      if (parent !== '' && !isSafeNoteId(parent)) {
        throw new Error(`非法目录 id:${parent}`)
      }
      const taken = new Set(collectIds(dir))

      const title = (input.title ?? '').trim().slice(0, MAX_TITLE)
      const explicit = input.id !== undefined && isSafeNoteId(input.id) ? input.id : null
      const id = uniqueNoteId(
        explicit ?? joinNoteId(parent, slugifyNoteTitle(title || 'note')),
        taken,
        now()
      )
      const ts = localIso(now())
      if (parent !== '') mkdirSync(join(dir, parent), { recursive: true })

      const fields: FrontmatterFields = { created: ts, updated: ts }
      if (title !== '') fields.title = title
      if (input.tags !== undefined && input.tags.length > 0) fields.tags = input.tags
      if (input.refs !== undefined && input.refs.length > 0) fields.refs = input.refs

      const body = input.body ?? ''
      const text = assembleFile({
        bom: false,
        eol: '\n',
        frontmatterLines: renderFrontmatter(fields),
        body
      })
      const file = fileOf(dir, id)
      // wx:并发创建时后到者失败,而不是把先到者的内容覆盖掉
      writeFileSync(file, text, { encoding: 'utf8', flag: 'wx' })

      const parsed = readFresh(id)!
      log(`created ${id}.md`)
      return toNote(parsed)
    },

    async save(input) {
      const { id } = input
      if (!isSafeNoteId(id)) return { ok: false, kind: 'invalid', message: `非法笔记 id:${id}` }
      if (typeof input.expectedRevision !== 'string' || input.expectedRevision === '') {
        // 同 agent-service:写路径必须带 revision,缺省一律拒绝
        return { ok: false, kind: 'invalid', message: '缺少 expectedRevision,拒绝写入' }
      }

      const file = fileOf(opts.getDir(), id)
      if (!existsSync(file)) return { ok: false, kind: 'not-found', message: `找不到 ${id}.md` }

      const text = readFileSync(file, 'utf8')
      const revision = sha1(text)
      if (input.force !== true && input.expectedRevision !== revision) {
        return { ok: false, kind: 'conflict', latest: toNote(parsedFromDisk(id, file, text)) }
      }
      if (Buffer.byteLength(input.body, 'utf8') > MAX_NOTE_BYTES) {
        return { ok: false, kind: 'too-large', message: '正文超过 1 MiB 上限,未写入' }
      }

      const st = statSync(file)
      const split = splitFrontmatter(text)
      const { fields } = readFrontmatter(split)
      const meta = input.meta ?? {}
      const hasMeta = Object.keys(meta).length > 0
      const ts = localIso(now())
      // 置顶/取消置顶这类动作只改元数据,不该动 updated ——
      // 否则取消置顶时那篇会突然跳到「最近更新」的最前面,像是刚编辑过
      const touchUpdated = input.touchUpdated !== false

      let frontmatterLines: string[] | null
      if (split.unclosed) {
        // 围栏没闭合:整份都是正文。只改正文是安全的,改元数据会把块插进正文中间 → 拒绝
        if (hasMeta) {
          return { ok: false, kind: 'invalid', message: 'frontmatter 围栏未闭合,无法改写元数据' }
        }
        frontmatterLines = null
      } else if (!split.present) {
        // D1:不「收养」裸 .md —— 只改正文时不给它凭空长出 frontmatter
        frontmatterLines = hasMeta
          ? renderFrontmatter({
              ...meta,
              created: localIso(birthOf(st, st.mtimeMs)),
              ...(touchUpdated ? { updated: ts } : {})
            })
          : null
      } else {
        const patch: Partial<FrontmatterFields> = { ...meta }
        if (touchUpdated) patch.updated = ts
        if (fields.created === undefined) patch.created = localIso(birthOf(st, st.mtimeMs))
        frontmatterLines = patchFrontmatter(split, patch)
      }

      const out = assembleFile({ bom: split.bom, eol: split.eol, frontmatterLines, body: input.body })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, out, 'utf8')
      renameSync(tmp, file) // 同盘原子替换,避免半写文件

      const parsed = readFresh(id)!
      return { ok: true, note: toNote(parsed) }
    },

    async rename(input) {
      const { id, title } = input
      if (!isSafeNoteId(id)) return { ok: false, kind: 'invalid', message: `非法笔记 id:${id}` }
      const clean = title.trim().slice(0, MAX_TITLE)
      if (clean === '') return { ok: false, kind: 'invalid', message: '标题不能为空' }

      const dir = opts.getDir()
      const file = fileOf(dir, id)
      if (!existsSync(file)) return { ok: false, kind: 'not-found', message: `找不到 ${id}.md` }

      const text = readFileSync(file, 'utf8')
      const st = statSync(file)
      if (input.expectedRevision !== sha1(text)) {
        return { ok: false, kind: 'conflict', latest: toNote(parsedFromDisk(id, file, text)) }
      }

      // 重命名只换文件名那一段,**留在原目录里**(目录属于用户的组织方式,不该被改名动作带走)
      const nextId = joinNoteId(parentOf(id), slugifyNoteTitle(clean))

      // 先把最终 id 定下来(可能因撞名而加序号),**再**决定写什么标题 ——
      // 顺序反了就会写出「标题 note、文件 note-2」这种脱钩状态,
      // 下次标题失焦时 syncFileName 会把文件改回 note,再次撞名,陷入连锁重命名。
      let finalId = nextId
      if (nextId !== id) {
        const taken = new Set(collectIds(dir))
        taken.delete(id)
        const candidate = uniqueNoteId(nextId, taken, now())
        // 撞名:默认**不**擅自加序号,而是把决定权交回给用户(渲染层会弹一次询问)
        if (candidate !== nextId && input.onConflict !== 'auto-rename') {
          return {
            ok: false,
            kind: 'name-taken',
            message: `「${baseNameOf(nextId)}」已存在`,
            suggested: baseNameOf(candidate)
          }
        }
        finalId = candidate
      }
      const bumped = finalId !== nextId // 撞名了,文件名带了序号
      const titleToWrite = bumped ? baseNameOf(finalId) : clean

      const split = splitFrontmatter(text)
      const { fields } = readFrontmatter(split)
      const patch: Partial<FrontmatterFields> = { title: titleToWrite, updated: localIso(now()) }
      if (split.present && fields.created === undefined) patch.created = localIso(birthOf(st, st.mtimeMs))
      const out = assembleFile({
        bom: split.bom,
        eol: split.eol,
        frontmatterLines: patchFrontmatter(split, patch),
        body: bodyText(split)
      })

      if (nextId === id) {
        const tmp = `${file}.tmp`
        writeFileSync(tmp, out, 'utf8')
        renameSync(tmp, file)
      } else {
        const nextFile = fileOf(dir, finalId)
        // 先写新文件再删旧的:写失败时旧文件完好,不会两边都没有
        writeFileSync(nextFile, out, { encoding: 'utf8', flag: 'wx' })
        rmSync(file)
        index.delete(id)
        lastKnownRevision.delete(id)
        const parsed = readFresh(finalId)!
        log(`renamed ${id}.md → ${finalId}.md${bumped ? '(撞名,已加序号)' : ''}`)
        return { ok: true, note: toNote(parsed) }
      }

      const parsed = readFresh(id)!
      return { ok: true, note: toNote(parsed) }
    },

    async createFolder(input) {
      const dir = opts.getDir()
      const parent = input.parent !== '' && isSafeNoteId(input.parent) ? input.parent : ''
      const name = slugifyFolderName(input.name)
      if (!isSafeNoteId(name)) throw new Error(`非法目录名:${input.name}`)
      mkdirSync(join(dir, parent), { recursive: true })
      // 同名目录已存在就复用,不报错(用户连点两次「新建文件夹」不该看到红字)
      let id = joinNoteId(parent, name)
      for (let n = 2; existsSync(join(dir, id)); n++) id = joinNoteId(parent, `${name}-${n}`)
      mkdirSync(join(dir, id))
      log(`created folder ${id}/`)
      return { id }
    },

    async removeFolder(input) {
      const { id } = input
      if (!isSafeNoteId(id)) return { ok: false, kind: 'invalid', message: `非法目录 id:${id}` }
      const abs = join(opts.getDir(), id)
      if (!existsSync(abs)) return { ok: false, kind: 'not-found', message: `找不到目录 ${id}` }

      if (opts.trash) {
        await opts.trash(abs)
      } else {
        const trashDir = join(opts.getDir(), NOTES_TRASH_DIR)
        mkdirSync(trashDir, { recursive: true })
        renameSync(abs, join(trashDir, `${compactStamp(now())}-${id.replace(/\//g, '_')}`))
      }
      // 索引里所有以该目录为前缀的条目都要清掉
      for (const key of [...index.keys()]) {
        if (key === id || key.startsWith(`${id}/`)) {
          index.delete(key)
          lastKnownRevision.delete(key)
        }
      }
      log(`removed folder ${id}/`)
      return { ok: true, removed: true }
    },

    async renameFolder(input) {
      const dir = opts.getDir()
      const { id } = input
      if (!isSafeNoteId(id)) throw new Error(`非法目录 id:${id}`)
      const name = slugifyFolderName(input.name)
      if (!isSafeNoteId(name)) throw new Error(`非法目录名:${input.name}`)
      const abs = join(dir, id)
      if (!existsSync(abs)) throw new Error(`找不到目录 ${id}`)

      const parent = parentOf(id)
      let next = joinNoteId(parent, name)
      // ⚠ 同名判定必须在冲突循环**之前**:目标路径就是自己时,`existsSync` 必然为真,
      // 先跑循环会把「点重命名但没改名字」变成「追加 -2」。这条曾经真的发生。
      if (next === id) return { id }
      for (let n = 2; existsSync(join(dir, next)); n++) next = joinNoteId(parent, `${name}-${n}`)
      renameSync(abs, join(dir, next))

      reprefixIndex(id, next)
      log(`renamed folder ${id}/ → ${next}/`)
      return { id: next }
    },

    async move(input) {
      const dir = opts.getDir()
      const { id } = input
      const kind = input.kind
      if (kind !== 'note' && kind !== 'folder' && kind !== 'file') {
        return { ok: false, message: `非法种类:${String(kind)}` }
      }
      if (!isSafeNoteId(id)) return { ok: false, message: `非法 id:${id}` }
      const rawParent = input.parent.trim()
      if (rawParent !== '' && !isSafeNoteId(rawParent)) {
        return { ok: false, message: `非法目标目录:${rawParent}` }
      }
      const parent = rawParent

      // ⚠ 存在性与种类核对必须排在「原地不动」之前:否则对不存在的 id 调 move(id, 根层)
      // 会因为 parentOf(id) === '' 命中那条捷径,报成功却什么也没做。
      // 种类用 stat 核对,不看「路径在不在」。文件 `pic.png` 的路径存在,不能被当成目录搬走;
      // 无扩展名文件 `readme` 也不能把旁边的笔记 `readme.md` 搬走。
      const src = join(dir, kind === 'note' ? `${id}.md` : id)
      let st: Stats
      try {
        st = statSync(src)
      } catch {
        return { ok: false, message: `找不到 ${id}` }
      }
      if (kind === 'folder') {
        if (!st.isDirectory()) return { ok: false, message: `不是目录:${id}` }
      } else if (!st.isFile()) {
        return { ok: false, message: `不是文件:${id}` }
      }

      // 拖到原地:直接当成功,免得平白多一次文件操作
      if (parent === parentOf(id)) {
        return kind === 'file' ? { ok: true, id, file: fileStatOf(id, st) } : { ok: true, id }
      }
      // 目录不能移进它自己或它的子孙里 —— 那会把整棵子树从磁盘上摘掉
      if (kind === 'folder' && (parent === id || parent.startsWith(`${id}/`))) {
        return { ok: false, message: '不能把目录移动到它自己里面' }
      }

      const base = baseNameOf(id)
      // 文件撞名要留住扩展名:pic.png → pic-2.png,而不是 pic.png-2
      const { base: stem, ext } = kind === 'file' ? splitFileExt(base) : { base, ext: '' }
      const nameAt = (n: number): string => {
        const numbered = n === 1 ? stem : `${stem}-${n}`
        return ext === '' ? numbered : `${numbered}.${ext}`
      }
      let n = 1
      let next = joinNoteId(parent, nameAt(n))
      const taken = (rel: string): boolean =>
        kind === 'file' ? existsSync(join(dir, rel)) : pathTaken(dir, rel)
      for (; n < 100 && taken(next); n++) next = joinNoteId(parent, nameAt(n))
      if (taken(next)) return { ok: false, message: `目标目录里同名项太多:${base}` }
      const renamed = next !== joinNoteId(parent, base)

      mkdirSync(join(dir, parent), { recursive: true })
      const dest = join(dir, kind === 'note' ? `${next}.md` : next)
      try {
        renameSync(src, dest)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        // 跨卷 rename 会 EXDEV。源和目标都在笔记目录里,正常不会发生;
        // 发生了就失败,不做拷贝兜底 —— 拷一半比直接失败更糟。
        if (code === 'EXDEV') return { ok: false, message: '不能跨卷移动,请把笔记目录放在同一块盘上' }
        return { ok: false, message: `移动失败:${String(err)}` }
      }
      if (kind !== 'file') reprefixIndex(id, next)

      // ⚠ 因撞名而改名时,必须把 frontmatter 的 title 一起改掉。
      // 不改的话 title 与文件名就不一致了 —— 而渲染层在标题失焦时会调用 syncFileName,
      // 它发现两者不一致就会把文件改回原标题,于是再次撞名、再加序号,陷入连锁重命名。
      if (renamed && kind === 'note') {
        const file = dest
        const text = readFileSync(file, 'utf8')
        const split = splitFrontmatter(text)
        const { fields } = readFrontmatter(split)
        if (split.present && fields.title !== undefined) {
          const out = assembleFile({
            bom: split.bom,
            eol: split.eol,
            frontmatterLines: patchFrontmatter(split, { title: baseNameOf(next) }),
            body: bodyText(split)
          })
          const tmp = `${file}.tmp`
          writeFileSync(tmp, out, 'utf8')
          renameSync(tmp, file)
        }
      }

      log(`moved ${kind} ${id} → ${next}${renamed ? '(撞名,已加序号)' : ''}`)
      const renamedField = renamed ? { renamed: { from: base, to: baseNameOf(next) } } : {}
      if (kind !== 'file') return { ok: true, id: next, ...renamedField }
      try {
        return { ok: true, id: next, ...renamedField, file: fileStatOf(next, statSync(dest)) }
      } catch (err) {
        return { ok: false, message: `读取文件信息失败:${String(err)}` }
      }
    },

    async importPaths(input) {
      return importPathsIntoNotes({
        dir: opts.getDir(),
        target: String(input?.target ?? ''),
        paths: Array.isArray(input?.paths) ? input.paths.map(String) : [],
        log
      })
    },

    probeExternal(input) {
      const source = String(input?.source ?? '')
      // 不比电脑标识。路径还在、并且是可预览的普通文件,就算在。
      if (source === '') return { sameHost: true, present: false, host: '' }
      const abs = resolveExternalPath(
        `launcher-note://external/?p=${encodeURIComponent(source)}`
      )
      return { sameHost: true, present: abs !== null, host: '' }
    },

    resolveNoteFile(rel) {
      return resolveFileInNotes(opts.getDir(), String(rel ?? ''))
    },

    statFile(rel) {
      const relS = String(rel ?? '')
      const abs = resolveContainedFile(opts.getDir(), relS)
      if (abs === null) return null
      try {
        const st = statSync(abs)
        if (!st.isFile()) return null
        return fileStatOf(relS, st)
      } catch {
        return null
      }
    },

    async createFile(input) {
      const parentRaw = String(input?.parent ?? '')
      const parent = parentRaw === '' ? '' : isSafeNoteId(parentRaw) ? parentRaw : null
      if (parent === null) {
        return { ok: false, kind: 'invalid', message: `非法目录 id:${parentRaw}` }
      }
      const name = String(input?.name ?? '').trim()
      // 只接受单段文件名:isSafeNoteSegment 已挡 / \ . .. 与超长
      if (!isSafeNoteSegment(name)) {
        return { ok: false, kind: 'invalid', message: `文件名不合法:${name}` }
      }
      const dot = name.lastIndexOf('.')
      // 没有扩展名 / 以 . 开头(如 .env)都不在这里建:前者更像笔记,后者是隐藏文件
      if (dot <= 0 || dot === name.length - 1) {
        return { ok: false, kind: 'invalid', message: '文件名需要包含扩展名,如 app.js' }
      }
      const ext = name.slice(dot + 1).toLowerCase()
      if (ext === 'md' || ext === 'markdown') {
        return { ok: false, kind: 'invalid', message: 'Markdown 笔记请使用「新建笔记」' }
      }
      // 根层 assets/ 是附件保留目录,那里面的文件不会出现在目录里
      if (parent === NOTES_ASSETS_DIR || parent.startsWith(`${NOTES_ASSETS_DIR}/`)) {
        return { ok: false, kind: 'invalid', message: 'assets 目录只用于存放附件' }
      }
      const rel = joinNoteId(parent, name)
      if (!isSafeNoteId(rel)) {
        return { ok: false, kind: 'invalid', message: `路径不合法:${rel}` }
      }
      const dir = opts.getDir()
      try {
        mkdirSync(join(dir, parent), { recursive: true })
        // wx:同名文件已存在时报错,绝不覆盖用户内容
        writeFileSync(join(dir, rel), '', { encoding: 'utf8', flag: 'wx' })
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EEXIST') return { ok: false, kind: 'exists', message: '同名文件已存在' }
        return { ok: false, kind: 'io', message: `创建失败:${String(err)}` }
      }
      log(`created file ${rel}`)
      return { ok: true, file: fileStatOf(rel, statSync(join(dir, rel))) }
    },

    async renameFile(input) {
      const oldRel = String(input?.path ?? '')
      const dir = opts.getDir()
      const absOld = resolveContainedFile(dir, oldRel)
      if (absOld === null) {
        return { ok: false, kind: 'not-found', message: '文件不存在或不在笔记目录内' }
      }

      // 调用方给的是完整新文件名。不再把旧扩展名拼回去,否则界面上改了后缀也落不了盘。
      const name = String(input?.name ?? '').trim()
      if (!isSafeNoteSegment(name)) {
        return { ok: false, kind: 'invalid', message: `文件名不合法:${name}` }
      }
      // .md 会被目录扫描收成笔记,打开中的文件视图跟不上。`.markdown` 不会,仍当普通文件。
      if (splitFileExt(name).ext.toLowerCase() === 'md') {
        return { ok: false, kind: 'invalid', message: 'Markdown 笔记请使用「新建笔记」' }
      }
      const newRel = joinNoteId(parentOf(oldRel), name)
      if (!isSafeNoteId(newRel)) {
        return { ok: false, kind: 'invalid', message: `路径不合法:${newRel}` }
      }
      if (newRel === oldRel) {
        try {
          return { ok: true, file: fileStatOf(oldRel, statSync(absOld)) }
        } catch (err) {
          return { ok: false, kind: 'io', message: `读取文件信息失败:${String(err)}` }
        }
      }

      const absNew = join(dir, newRel)
      if (existsSync(absNew)) {
        // 大小写不敏感卷上,仅改大小写时目标「已存在」—— 那是同一个 inode,允许改名
        try {
          const a = statSync(absOld)
          const b = statSync(absNew)
          if (a.dev !== b.dev || a.ino !== b.ino) {
            return { ok: false, kind: 'exists', message: '同名文件已存在' }
          }
        } catch {
          return { ok: false, kind: 'exists', message: '同名文件已存在' }
        }
      }
      try {
        renameSync(absOld, absNew)
      } catch (err) {
        return { ok: false, kind: 'io', message: `重命名失败:${String(err)}` }
      }
      log(`renamed file ${oldRel} -> ${newRel}`)
      try {
        return { ok: true, file: fileStatOf(newRel, statSync(absNew)) }
      } catch (err) {
        return { ok: false, kind: 'io', message: `读取文件信息失败:${String(err)}` }
      }
    },

    async readFile(rel) {
      const relS = String(rel ?? '')
      const abs = resolveContainedFile(opts.getDir(), relS)
      if (abs === null) {
        return { ok: false, kind: 'not-found', message: '文件不存在或不在笔记目录内' }
      }
      let st: Stats
      let bytes: Buffer
      try {
        st = statSync(abs)
        if (!st.isFile()) {
          return { ok: false, kind: 'not-found', message: '文件不存在或不是普通文件' }
        }
        const stat = fileStatOf(relS, st)
        // 已知的二进制类型不读正文:调用方应走 readFileBytes / 预览协议。
        // canvas 是 Excalidraw 场景的文本文件,只是不用 CodeMirror 打开,所以跟 unsupported 一样读进来。
        if (!stat.editable && stat.kind !== 'unsupported' && stat.kind !== 'canvas') {
          return { ok: true, doc: binaryDoc(stat, 'unsupported') }
        }
        if (st.size > MAX_TEXT_FILE_BYTES) {
          return { ok: true, doc: binaryDoc(stat, 'too-large') }
        }
        bytes = readFileSync(abs)
        const decoded = decodeTextBytes(bytes)
        if (!decoded.ok) return { ok: true, doc: binaryDoc(stat, decoded.reason) }
        return {
          ok: true,
          doc: textDoc(stat, {
            // 未知扩展名读成功 → 它就是可编辑纯文本
            kind: stat.kind === 'unsupported' ? 'text' : stat.kind,
            revision: sha1Bytes(bytes),
            encoding: decoded.decoded.encoding,
            eol: decoded.decoded.eol,
            text: decoded.decoded.text
          })
        }
      } catch (err) {
        return { ok: false, kind: 'io', message: `读取失败:${String(err)}` }
      }
    },

    async readFileBytes(rel, maxBytes) {
      const relS = String(rel ?? '')
      const abs = resolveContainedFile(opts.getDir(), relS)
      if (abs === null) {
        return { ok: false, kind: 'not-found', message: '文件不存在或不在笔记目录内' }
      }
      const cap = Math.min(
        Math.max(1, typeof maxBytes === 'number' && Number.isFinite(maxBytes) ? maxBytes : MAX_FILE_BYTES_READ),
        MAX_FILE_BYTES_READ
      )
      try {
        const st = statSync(abs)
        if (!st.isFile()) {
          return { ok: false, kind: 'not-found', message: '文件不存在或不是普通文件' }
        }
        if (st.size > cap) {
          return {
            ok: false,
            kind: 'too-large',
            message: `文件超过 ${Math.round(cap / 1024 / 1024)} MiB 上限`,
            size: st.size
          }
        }
        const buf = readFileSync(abs)
        return { ok: true, data: new Uint8Array(buf), size: st.size, mtimeMs: st.mtimeMs }
      } catch (err) {
        return { ok: false, kind: 'io', message: `读取失败:${String(err)}` }
      }
    },

    async saveFile(input) {
      const relS = String(input?.path ?? '')
      if (typeof input?.expectedRevision !== 'string' || input.expectedRevision === '') {
        return { ok: false, kind: 'invalid', message: '缺少 expectedRevision,拒绝写入' }
      }
      const abs = resolveContainedFile(opts.getDir(), relS)
      if (abs === null) {
        return { ok: false, kind: 'not-found', message: '文件不存在或不在笔记目录内' }
      }

      let st: Stats
      let current: Buffer
      try {
        st = statSync(abs)
        if (!st.isFile()) {
          return { ok: false, kind: 'not-found', message: '文件不存在或不是普通文件' }
        }
        current = readFileSync(abs)
      } catch (err) {
        return { ok: false, kind: 'io', message: `读取失败:${String(err)}` }
      }

      const revision = sha1Bytes(current)
      if (input.force !== true && input.expectedRevision !== revision) {
        return {
          ok: false,
          kind: 'conflict',
          latest: { revision, size: current.byteLength, mtimeMs: st.mtimeMs }
        }
      }

      // 外部可能改过编码:以**写盘前的磁盘字节**为准探测,再按用户当前文本重建
      const decoded = decodeTextBytes(current)
      if (!decoded.ok) {
        return { ok: false, kind: 'not-text', message: '当前文件不是可编辑文本,未写入' }
      }
      const text = typeof input.text === 'string' ? input.text : ''
      let out: Uint8Array
      try {
        out = encodeTextBytes(decoded.decoded.encoding, decoded.decoded.eol, text)
      } catch (err) {
        return { ok: false, kind: 'io', message: `编码失败:${String(err)}` }
      }
      if (out.byteLength > MAX_TEXT_FILE_BYTES) {
        return { ok: false, kind: 'too-large', message: '正文超过 64 MiB 上限,未写入' }
      }

      const tmp = `${abs}.tmp`
      try {
        // 保留原文件权限位;tmp + rename 保证读者永远看不到半份文件
        writeFileSync(tmp, out, { mode: st.mode })
        renameSync(tmp, abs)
      } catch (err) {
        try {
          rmSync(tmp, { force: true })
        } catch {
          /* 清理失败不掩盖真正的写错误 */
        }
        return { ok: false, kind: 'io', message: `写入失败:${String(err)}` }
      }

      let after: { size: number; mtimeMs: number }
      try {
        after = statSync(abs)
      } catch {
        after = { size: out.byteLength, mtimeMs: now() }
      }
      const stat = fileStatOf(relS, after)
      return {
        ok: true,
        doc: textDoc(stat, {
          kind: stat.kind === 'unsupported' ? 'text' : stat.kind,
          revision: sha1Bytes(out),
          encoding: decoded.decoded.encoding,
          eol: decoded.decoded.eol,
          text: normalizeEol(text)
        })
      }
    },

    async removeFile(rel) {
      const abs = resolveFileInNotes(opts.getDir(), String(rel ?? ''))
      if (abs === null) return { ok: false, message: '文件不存在或不在笔记目录内' }
      try {
        if (opts.trash) {
          await opts.trash(abs)
        } else {
          const trashDir = join(opts.getDir(), NOTES_TRASH_DIR)
          mkdirSync(trashDir, { recursive: true })
          renameSync(abs, join(trashDir, `${compactStamp(now())}-${baseNameOf(abs)}`))
        }
        log(`removed file ${rel}`)
        return { ok: true }
      } catch (err) {
        return { ok: false, message: `删除失败:${String(err)}` }
      }
    },

    async remove(input) {
      const { id } = input
      if (!isSafeNoteId(id)) return { ok: false, kind: 'invalid', message: `非法笔记 id:${id}` }
      const file = fileOf(opts.getDir(), id)
      if (!existsSync(file)) return { ok: false, kind: 'not-found', message: `找不到 ${id}.md` }

      const text = readFileSync(file, 'utf8')
      if (input.expectedRevision !== sha1(text)) {
        return { ok: false, kind: 'conflict', latest: toNote(parsedFromDisk(id, file, text)) }
      }

      if (opts.trash) {
        await opts.trash(file) // 应用内:进系统废纸篓,用户可恢复
      } else {
        // 独立进程没有 shell.trashItem → 移到点开头的 .trash/(扫描器跳过,Obsidian 也忽略)
        const trashDir = join(opts.getDir(), NOTES_TRASH_DIR)
        mkdirSync(trashDir, { recursive: true })
        renameSync(file, join(trashDir, `${compactStamp(now())}-${id}.md`))
      }
      index.delete(id)
      lastKnownRevision.delete(id)
      log(`removed ${id}.md`)
      return { ok: true, removed: true }
    },

    async search(query, limit = 50) {
      const q = query.trim().toLowerCase()
      if (q === '') return []
      scan()
      const all = [...index.values()].sort((a, b) => b.mtimeMs - a.mtimeMs)
      const hits: NoteMeta[] = []
      for (const e of all) {
        if (hits.length >= limit) break
        const hit =
          e.meta.title.toLowerCase().includes(q) ||
          e.meta.tags.some((t) => t.toLowerCase().includes(q)) ||
          e.meta.refs.some((r) => r.label.toLowerCase().includes(q)) ||
          e.body.toLowerCase().includes(q)
        if (hit) hits.push(e.meta)
      }
      return hits
    },

    async saveAsset(input) {
      const dir = opts.getDir()
      const assets = notesAssetsDir(dir)
      const ext = (input.fileName.split('.').pop() ?? '').toLowerCase()
      if (!isNoteImageExt(ext)) throw new Error(`不支持的图片格式:${ext || '(无扩展名)'}`)
      const bytes = Buffer.from(input.data)
      if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error('图片超过 16 MiB 上限')

      mkdirSync(assets, { recursive: true })
      const name = assetName(assets, `Pasted image ${compactStamp(now())}`, ext)
      writeFileSync(join(assets, name), bytes)
      log(`asset ${NOTES_ASSETS_DIR}/${name} (${bytes.byteLength} bytes)`)
      return { relPath: `${NOTES_ASSETS_DIR}/${name}` }
    },

    async readBodyForAi(id) {
      const parsed = readFresh(id)
      if (!parsed) return null
      const truncated = parsed.body.length > MAX_BODY_FOR_AI
      return {
        note: toNote(parsed),
        body: truncated ? parsed.body.slice(0, MAX_BODY_FOR_AI) : parsed.body,
        truncated
      }
    },

    readAssetForAi(rel) {
      // 正文里的路径可能是 %20 编码过的(应用自己写附件时就是这么写的),两种写法都试
      let reason: NoteAssetFailReason = 'invalid'
      for (const cand of assetCandidates(rel)) {
        // 与预览协议同一套闸门:只服务 assets/、扩展名白名单、目录内断言
        const hit = resolveAssetRel(opts.getDir(), cand)
        if (hit === null) continue
        if (hit.kind !== 'image') {
          reason = 'not-image'
          continue
        }
        try {
          const st = statSync(hit.path)
          if (!st.isFile()) continue
          if (st.size > MAX_ASSET_FOR_AI) return { ok: false, reason: 'too-large', size: st.size }
          const bytes = readFileSync(hit.path)
          return {
            ok: true,
            data: bytes.toString('base64'),
            mimeType: noteAssetMime(extname(hit.path).slice(1)),
            bytes: bytes.byteLength,
            path: hit.path
          }
        } catch {
          reason = 'io'
        }
      }
      return { ok: false, reason }
    },

    start() {
      if (opts.onExternalChange === undefined || watcher) return
      const dir = opts.getDir()
      try {
        mkdirSync(dir, { recursive: true })
      } catch (err) {
        log(`笔记目录不可用,跳过监听:${String(err)}`)
        return
      }
      watcher = createDebouncedDirWatcher({
        dirs: [dir],
        debounceMs: 400,
        onChange: () => {
          for (const cb of dirListeners) cb()
          const { changed, foldersChanged, filesChanged } = scan()
          // 目录 / 文件变化也要上报:新建一个空目录、丢进一个 PDF 时没有任何笔记 id 可带,
          // 但界面必须刷新出它
          if (changed.length > 0 || foldersChanged || filesChanged) opts.onExternalChange?.(changed)
        },
        log
      })
      watcher.start()
    },

    stop() {
      watcher?.stop()
      watcher = null
    },

    onDirChange(cb) {
      dirListeners.add(cb)
      return () => dirListeners.delete(cb)
    }
  }
}

