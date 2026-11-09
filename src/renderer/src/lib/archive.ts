// 压缩包解析(ZIP / TAR / TAR.GZ / GZ)与压缩包内 HTML 的相对资源内联。
//
// 只读、不落盘:条目通过 `read(path)` 取字节,交给与磁盘文件相同的查看器。
// 条目路径先归一化再进列表 —— 绝对路径、含 `..`、带盘符的条目一律跳过(只计数)。
// 上限:条目数、解压总量、单条目、HTML srcdoc 预算都在 shared/notes.ts。

import {
  ARCHIVE_ENTRIES_MAX,
  ARCHIVE_ENTRY_MAX,
  ARCHIVE_HTML_MAX,
  ARCHIVE_INLINE_RESOURCE_MAX,
  ARCHIVE_UNPACKED_MAX,
  noteFileMime
} from '@shared/notes'
import { decodeTextBytes } from '@shared/text-file'

export interface ArchiveEntry {
  /** 归一后的相对路径(不含前导 /) */
  path: string
  /** 最后一段 */
  name: string
  dir: boolean
  size: number
}

export interface ArchiveSource {
  /** zip / tar / gzip(单文件解压) */
  kind: 'zip' | 'tar' | 'gzip'
  entries: ArchiveEntry[]
  /** 跳过的越界/不安全条目数 */
  unsafeSkipped: number
  /** 超过条目上限未列出的数量 */
  truncatedEntries: number
  /** 声明解压总量(可能为 0,压缩格式不提供时) */
  unpacked: number
  read(path: string): Promise<Uint8Array>
}

/** 压缩包超过上限时抛出,消息是稳定的原因码 */
export class ArchiveLimitError extends Error {
  constructor(readonly reason: 'unpacked' | 'entry', readonly size: number) {
    super(reason)
  }
}

function safeEntryPath(raw: string): string | null {
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  const segs = normalized.split('/').filter((s) => s !== '' && s !== '.')
  if (segs.length === 0) return null
  if (segs.some((s) => s === '..' || /^[a-zA-Z]:$/.test(s))) return null
  return segs.join('/')
}

function nameOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? path : path.slice(i + 1)
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

function isArchiveName(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower.endsWith('.zip') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.gz') ||
    lower.endsWith('.gzip')
  )
}

export { isArchiveName, extOf }

// ── ZIP ──

async function listZip(data: Uint8Array): Promise<ArchiveSource> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(data)
  const entries: ArchiveEntry[] = []
  let unsafeSkipped = 0
  let truncatedEntries = 0
  let unpacked = 0

  for (const raw of Object.values(zip.files)) {
    const path = safeEntryPath(raw.name)
    if (path === null) {
      unsafeSkipped++
      continue
    }
    if (raw.dir) {
      if (entries.length < ARCHIVE_ENTRIES_MAX) {
        entries.push({ path, name: nameOf(path), dir: true, size: 0 })
      } else truncatedEntries++
      continue
    }
    const size = (raw as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
    unpacked += size
    if (unpacked > ARCHIVE_UNPACKED_MAX) throw new ArchiveLimitError('unpacked', unpacked)
    if (entries.length >= ARCHIVE_ENTRIES_MAX) {
      truncatedEntries++
      continue
    }
    entries.push({ path, name: nameOf(path), dir: false, size })
  }

  const byPath = new Map<string, (typeof zip.files)[string]>()
  for (const raw of Object.values(zip.files)) {
    const path = safeEntryPath(raw.name)
    if (path !== null && !raw.dir) byPath.set(path, raw)
  }

  return {
    kind: 'zip',
    entries,
    unsafeSkipped,
    truncatedEntries,
    unpacked,
    async read(path) {
      const raw = byPath.get(path)
      if (raw === undefined) throw new Error(`missing entry: ${path}`)
      const bytes = await raw.async('uint8array')
      if (bytes.byteLength > ARCHIVE_ENTRY_MAX) {
        throw new ArchiveLimitError('entry', bytes.byteLength)
      }
      return bytes
    }
  }
}

// ── TAR ──

interface TarRawEntry {
  path: string
  dir: boolean
  size: number
  offset: number
}

const td = new TextDecoder('utf-8')

function cstr(bytes: Uint8Array, start: number, length: number): string {
  const slice = bytes.subarray(start, start + length)
  let end = slice.indexOf(0)
  if (end < 0) end = slice.length
  return td.decode(slice.subarray(0, end)).trim()
}

function octal(bytes: Uint8Array, start: number, length: number): number {
  const text = cstr(bytes, start, length).trim()
  if (text === '') return 0
  const n = parseInt(text, 8)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** PAX 扩展头里取 path(只认这一项;其余键忽略) */
function paxPath(bytes: Uint8Array): string | null {
  const text = td.decode(bytes)
  for (const line of text.split('\n')) {
    const m = /^\d+ path=(.*)$/.exec(line)
    if (m !== null) return m[1] ?? null
  }
  return null
}

function parseTar(data: Uint8Array): TarRawEntry[] {
  const out: TarRawEntry[] = []
  let offset = 0
  let longName: string | null = null
  let paxName: string | null = null

  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512)
    // 全零块 = 结束
    if (header.every((b) => b === 0)) break

    const size = octal(header, 124, 12)
    const type = String.fromCharCode(header[156] ?? 0)
    const dataStart = offset + 512
    const next = dataStart + Math.ceil(size / 512) * 512
    if (dataStart > data.length) break

    if (type === 'L') {
      const body = data.subarray(dataStart, Math.min(dataStart + size, data.length))
      longName = cstr(body, 0, body.length)
      offset = next
      continue
    }
    if (type === 'x') {
      const body = data.subarray(dataStart, Math.min(dataStart + size, data.length))
      paxName = paxPath(body) ?? paxName
      offset = next
      continue
    }
    if (type === 'g') {
      offset = next
      continue
    }

    const name = cstr(header, 0, 100)
    const prefix = cstr(header, 345, 155)
    const full = paxName ?? longName ?? (prefix !== '' ? `${prefix}/${name}` : name)
    longName = null
    paxName = null

    const dir = type === '5' || (type === '0' || type === '\0' || type === '') && size === 0 && name.endsWith('/')
    if (type === '0' || type === '\0' || type === '' || type === '5') {
      out.push({ path: full, dir, size: dir ? 0 : size, offset: dataStart })
    }
    offset = next
  }
  return out
}

function sourceFromTar(data: Uint8Array, kind: 'tar' | 'gzip'): ArchiveSource {
  const raw = parseTar(data)
  const entries: ArchiveEntry[] = []
  const byPath = new Map<string, TarRawEntry>()
  let unsafeSkipped = 0
  let truncatedEntries = 0
  let unpacked = 0

  for (const e of raw) {
    const path = safeEntryPath(e.path)
    if (path === null) {
      unsafeSkipped++
      continue
    }
    if (e.dir) {
      if (entries.length < ARCHIVE_ENTRIES_MAX) entries.push({ path, name: nameOf(path), dir: true, size: 0 })
      else truncatedEntries++
      continue
    }
    unpacked += e.size
    if (unpacked > ARCHIVE_UNPACKED_MAX) throw new ArchiveLimitError('unpacked', unpacked)
    if (entries.length >= ARCHIVE_ENTRIES_MAX) {
      truncatedEntries++
      continue
    }
    entries.push({ path, name: nameOf(path), dir: false, size: e.size })
    byPath.set(path, e)
  }

  return {
    kind,
    entries,
    unsafeSkipped,
    truncatedEntries,
    unpacked,
    async read(path) {
      const e = byPath.get(path)
      if (e === undefined) throw new Error(`missing entry: ${path}`)
      if (e.size > ARCHIVE_ENTRY_MAX) throw new ArchiveLimitError('entry', e.size)
      return data.subarray(e.offset, e.offset + e.size)
    }
  }
}

// ── GZIP ──

async function ungzip(data: Uint8Array): Promise<Uint8Array> {
  const mod = await import('pako')
  const pako = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod
  return pako.ungzip(data)
}

function looksLikeTar(data: Uint8Array): boolean {
  return data.length > 262 && data[257] === 0x75 && data[258] === 0x73 && data[259] === 0x74 && data[260] === 0x61 && data[261] === 0x72
}

/** 解析任意支持的压缩包;拖入不认识的后缀由调用方先拦掉 */
export async function openArchive(name: string, data: Uint8Array): Promise<ArchiveSource> {
  const lower = name.toLowerCase()
  if (lower.endsWith('.zip')) return listZip(data)
  if (lower.endsWith('.tar')) return sourceFromTar(data, 'tar')
  // .tgz / .tar.gz / .gz / .gzip
  const out = await ungzip(data)
  if (lower.endsWith('.tgz') || lower.endsWith('.tar.gz') || looksLikeTar(out)) {
    return sourceFromTar(out, 'gzip')
  }
  const innerName = name.replace(/\.(?:gz|gzip)$/i, '') || 'content'
  const path = safeEntryPath(innerName) ?? 'content'
  return {
    kind: 'gzip',
    entries: [{ path, name: nameOf(path), dir: false, size: out.byteLength }],
    unsafeSkipped: 0,
    truncatedEntries: 0,
    unpacked: out.byteLength,
    async read(p) {
      if (p !== path) throw new Error(`missing entry: ${p}`)
      return out
    }
  }
}

// ── 压缩包内 HTML:把同包相对资源内联成 data URL,用 srcdoc 渲染 ──

function toDataUrl(bytes: Uint8Array, ext: string): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:${noteFileMime(ext)};base64,${btoa(binary)}`
}

function resolveEntryRel(baseDir: string, ref: string): string | null {
  const clean = ref.split(/[?#]/, 1)[0] ?? ''
  if (clean === '' || clean.startsWith('#') || clean.startsWith('//')) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return null
  const parts = clean.startsWith('/') ? [] : baseDir.split('/').filter(Boolean)
  const out: string[] = []
  for (const seg of [...parts, ...clean.split('/')]) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(seg)
  }
  return out.join('/')
}

const CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; ' +
  "script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; " +
  'img-src data: blob:; media-src data: blob:; font-src data:; ' +
  "connect-src 'none'; form-action 'none'; base-uri 'none'\">"

/** 压缩包条目 HTML → srcdoc(脚本照常执行,外网与跨条目请求全部禁止) */
export async function archiveHtmlSrcdoc(
  entryPath: string,
  bytes: Uint8Array,
  source: ArchiveSource
): Promise<string> {
  const decoded = decodeTextBytes(bytes)
  const raw =
    decoded.ok ? decoded.decoded.text : new TextDecoder('utf-8').decode(bytes).slice(0, ARCHIVE_HTML_MAX)
  if (raw.length > ARCHIVE_HTML_MAX) return raw.slice(0, ARCHIVE_HTML_MAX)

  const baseDir = entryPath.includes('/') ? entryPath.slice(0, entryPath.lastIndexOf('/')) : ''
  const cache = new Map<string, string | null>()
  let budget = ARCHIVE_INLINE_RESOURCE_MAX

  const readAsData = async (ref: string): Promise<string | null> => {
    const resolved = resolveEntryRel(baseDir, ref)
    if (resolved === null) return null
    if (cache.has(resolved)) return cache.get(resolved) ?? null
    const entry = source.entries.find((e) => e.path === resolved && !e.dir)
    if (entry === undefined) {
      cache.set(resolved, null)
      return null
    }
    try {
      const data = await source.read(resolved)
      if (data.byteLength > budget) {
        cache.set(resolved, null)
        return null
      }
      budget -= data.byteLength
      const url = toDataUrl(data, extOf(entry.name))
      cache.set(resolved, url)
      return url
    } catch {
      cache.set(resolved, null)
      return null
    }
  }

  let html = raw
  // <link rel=stylesheet href=...> → <style>...</style>
  html = await replaceAsync(
    html,
    /<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*>/gi,
    async (tag) => {
      const m = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)
      if (m === null) return tag
      const resolved = resolveEntryRel(baseDir, m[1] ?? '')
      if (resolved === null) return tag
      try {
        const bytes2 = await source.read(resolved)
        if (bytes2.byteLength > budget) return tag
        budget -= bytes2.byteLength
        const css = new TextDecoder('utf-8').decode(bytes2)
        return `<style>${await inlineCssUrls(css, baseDir, readAsData)}</style>`
      } catch {
        return tag
      }
    }
  )

  // 本地 <script src> → 内联脚本
  html = await replaceAsync(
    html,
    /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    async (tag, src: string) => {
      const resolved = resolveEntryRel(baseDir, src)
      if (resolved === null) return tag
      try {
        const bytes2 = await source.read(resolved)
        if (bytes2.byteLength > budget) return tag
        budget -= bytes2.byteLength
        const js = new TextDecoder('utf-8').decode(bytes2)
        return `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`
      } catch {
        return tag
      }
    }
  )

  // 其余 src / href(图片、字体、媒体、图标)转 data URL
  html = await replaceAsync(
    html,
    /\b(src|href|poster)\s*=\s*["']([^"']+)["']/gi,
    async (whole, attr: string, ref: string) => {
      if (attr.toLowerCase() === 'href' && /^[a-z][a-z0-9+.-]*:/i.test(ref)) return whole
      const url = await readAsData(ref)
      return url === null ? whole : `${attr}="${url}"`
    }
  )

  // srcset:逐项转换
  html = await replaceAsync(html, /\bsrcset\s*=\s*["']([^"']+)["']/gi, async (whole, value: string) => {
    const items = value.split(',').map((s) => s.trim())
    const out: string[] = []
    for (const item of items) {
      const [ref, ...descriptor] = item.split(/\s+/)
      const url = ref !== undefined ? await readAsData(ref) : null
      out.push(url === null ? item : [url, ...descriptor].join(' '))
    }
    return `srcset="${out.join(', ')}"`
  })

  // 内联 style 与 <style> 里的 url()
  html = await replaceAsync(html, /<style\b[^>]*>([\s\S]*?)<\/style>/gi, async (whole, css: string) => {
    return whole.replace(css, await inlineCssUrls(css, baseDir, readAsData))
  })

  // CSP meta 放在最前面,先于任何脚本生效
  return `${CSP_META}${html}`
}

async function inlineCssUrls(
  css: string,
  _baseDir: string,
  read: (ref: string) => Promise<string | null>
): Promise<string> {
  let out = css
  const m = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi
  const matches: { whole: string; ref: string }[] = []
  let hit: RegExpExecArray | null
  while ((hit = m.exec(css)) !== null) {
    matches.push({ whole: hit[0], ref: hit[2] ?? '' })
  }
  for (const item of matches) {
    const url = await read(item.ref)
    if (url !== null) out = out.replace(item.whole, `url("${url}")`)
  }
  return out
}

async function replaceAsync(
  text: string,
  re: RegExp,
  replacer: (...args: string[]) => Promise<string>
): Promise<string> {
  const jobs: Promise<{ whole: string; value: string }>[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const whole = m[0]
    const args = m.slice(1)
    jobs.push(replacer(whole, ...args).then((value) => ({ whole, value })))
  }
  let out = text
  for (const { whole, value } of await Promise.all(jobs)) {
    if (value !== whole) out = out.replace(whole, value)
  }
  return out
}
