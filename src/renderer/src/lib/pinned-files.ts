// 置顶区的纯逻辑:哪些条目还算数、改名/移动之后 pin 跟着去哪。
//
// 置顶区是**一条混排顺序**:笔记(frontmatter 里的 pinned)和非 Markdown 文件
// 可以任意交错。顺序用带类型前缀的 token 记:`n:<笔记 id>` / `f:<文件路径>`,
// 由 notes-store 按笔记目录存进 localStorage。
// 笔记的置顶状态仍在 frontmatter 里;文件没有可写回的内容,置顶状态 = 在顺序里。
// 条目在别处被改名/移动时顺序跟着换;删掉了就在 reload 时 prune —— 这是可接受的降级。

export type PinnedKind = 'note' | 'file'

/** 顺序数组里的一条:带类型前缀,避免笔记 id 与文件路径同名时混淆 */
export function pinnedToken(kind: PinnedKind, id: string): string {
  return `${kind === 'note' ? 'n' : 'f'}:${id}`
}

/** 解析 token;不是本应用写出来的形态一律忽略 */
export function parsePinnedToken(token: string): { kind: PinnedKind; id: string } | null {
  if (token.startsWith('n:') && token.length > 2) return { kind: 'note', id: token.slice(2) }
  if (token.startsWith('f:') && token.length > 2) return { kind: 'file', id: token.slice(2) }
  return null
}

/** 从混排顺序里取文件路径(置顶文件列表、旧的读写接口仍按它工作) */
export function pinnedFilesOf(order: readonly string[]): string[] {
  const out: string[] = []
  for (const token of order) {
    const entry = parsePinnedToken(token)
    if (entry !== null && entry.kind === 'file') out.push(entry.id)
  }
  return out.slice(0, MAX_PINNED_FILES)
}

/**
 * 把存储的混排顺序与当前实际置顶的条目对齐:
 *   · 只保留还置顶的条目(笔记看 frontmatter,文件看文件是否还在);
 *   · 没进顺序的旧数据按「笔记在前、文件在后」补到末尾 —— 与升级前的显示顺序一致。
 * 传 null 表示「这一类列表被截断,无法判断」,这时原样保留。
 */
export function normalizePinnedOrder(
  order: readonly string[],
  noteIds: readonly string[] | null,
  filePaths: readonly string[] | null,
  legacyFiles: readonly string[] = []
): string[] {
  const notes = noteIds === null ? null : new Set(noteIds)
  const files = filePaths === null ? null : new Set(filePaths)
  const out: string[] = []
  const seen = new Set<string>()
  for (const token of order) {
    const entry = parsePinnedToken(token)
    if (entry === null || seen.has(token)) continue
    if (entry.kind === 'note' && notes !== null && !notes.has(entry.id)) continue
    if (entry.kind === 'file' && files !== null && !files.has(entry.id)) continue
    seen.add(token)
    out.push(token)
  }
  const append = (token: string): void => {
    if (seen.has(token)) return
    const entry = parsePinnedToken(token)
    if (entry === null) return
    if (entry.kind === 'note' && notes !== null && !notes.has(entry.id)) return
    if (entry.kind === 'file' && files !== null && !files.has(entry.id)) return
    seen.add(token)
    out.push(token)
  }
  if (noteIds !== null) for (const id of noteIds) append(pinnedToken('note', id))
  for (const path of legacyFiles) append(pinnedToken('file', path))
  return out.slice(0, MAX_PINNED_FILES * 2)
}

/** 单条改名/移动:精确替换 token(笔记和文件都用) */
export function remapPinnedToken(
  order: readonly string[],
  kind: PinnedKind,
  from: string,
  to: string
): string[] {
  const src = pinnedToken(kind, from)
  const dst = pinnedToken(kind, to)
  return order.map((token) => (token === src ? dst : token))
}

/** 目录整体改名/移动:笔记 id 和文件路径都换前缀 */
export function remapPinnedTokenFolder(
  order: readonly string[],
  from: string,
  to: string
): string[] {
  if (from === '') return [...order]
  const prefix = `${from}/`
  return order.map((token) => {
    const entry = parsePinnedToken(token)
    if (entry === null) return token
    const rest = entry.id.startsWith(prefix) ? entry.id.slice(from.length) : null
    if (rest === null) return token
    return pinnedToken(entry.kind, `${to}${rest}`)
  })
}

/** 目录被删除:目录下的笔记与文件一起移出顺序 */
export function dropPinnedTokenFolder(order: readonly string[], folder: string): string[] {
  if (folder === '') return [...order]
  const prefix = `${folder}/`
  return order.filter((token) => {
    const entry = parsePinnedToken(token)
    if (entry === null) return false
    return entry.id !== folder && !entry.id.startsWith(prefix)
  })
}

/** 单个笔记目录最多记多少条,防止异常数据把 localStorage 撑大 */
export const MAX_PINNED_FILES = 200

function dedupe(list: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const path of list) {
    if (path === '' || seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

/** 只保留列表里仍然存在的文件,去重并截断上限 */
export function prunePinnedFiles(
  pins: readonly string[],
  files: readonly { path: string }[]
): string[] {
  const alive = new Set(files.map((f) => f.path))
  return dedupe(pins).filter((path) => alive.has(path)).slice(0, MAX_PINNED_FILES)
}

/** 单个文件改名/移动:精确替换那一条 */
export function remapPinnedFile(
  pins: readonly string[],
  from: string,
  to: string
): string[] {
  return dedupe(pins.map((path) => (path === from ? to : path))).slice(0, MAX_PINNED_FILES)
}

/** 目录整体改名/移动:目录下所有文件的 pin 跟着换前缀 */
export function remapPinnedFolder(
  pins: readonly string[],
  from: string,
  to: string
): string[] {
  if (from === '') return [...pins]
  const prefix = `${from}/`
  return dedupe(
    pins.map((path) => {
      if (path === from) return to
      if (path.startsWith(prefix)) return `${to}${path.slice(from.length)}`
      return path
    })
  ).slice(0, MAX_PINNED_FILES)
}

/** 目录被删除:目录下所有文件的 pin 一起删掉 */
export function dropPinnedFolder(pins: readonly string[], folder: string): string[] {
  if (folder === '') return [...pins]
  const prefix = `${folder}/`
  return pins.filter((path) => path !== folder && !path.startsWith(prefix))
}

/**
 * 把一条置顶文件挪到 `toIndex` 之前(`toIndex` 按**原数组**计,`pins.length` 表示末尾)。
 *
 * 下标基于完整的 pin 列表,而不是当前渲染出来的行:文件列表被截断、
 * 或某些 pin 暂时不在目录里时,拖到某一行前面仍然落在正确的存储位置。
 */
export function movePinnedFile(
  pins: readonly string[],
  path: string,
  toIndex: number
): string[] {
  const from = pins.indexOf(path)
  if (from < 0) return [...pins]
  const rest = [...pins.slice(0, from), ...pins.slice(from + 1)]
  // 移除自己之后,原下标在自身之后的项都往前挪了一位。
  const at = Math.max(0, Math.min(rest.length, toIndex > from ? toIndex - 1 : toIndex))
  rest.splice(at, 0, path)
  return rest
}
