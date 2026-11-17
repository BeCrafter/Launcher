// 把笔记正文 / 纯文本变成**能独立打开**的 HTML 文件(导出用)。
//
// 复用笔记预览的渲染器,但不传任何交互回调:没有 renderDiagram → mermaid 降级成代码块;
// 没有 highlight → 不高亮;没有表格编辑/媒体缩放/任务勾选回调 → 都是静态节点。
// 这样导出的 HTML 不需要应用运行时,也不需要额外维护一份渲染实现。
//
// 本地图片内联成 data: URL(导出文件脱离笔记目录也能看);单张/总量有上限,
// 超限的保留相对路径 —— 宁可裂图也不要把导出文件做成几十 MB。远程 http(s) 图片
// 原样保留地址:导出时联网下载有超时与隐私代价,不做。

import { renderToStaticMarkup } from 'react-dom/server'
import { noteAssetMime } from '@shared/notes'
import { renderMarkdown } from './markdown'
import { resolveNoteAssetSrc, resolvePreviewSrc } from './note-asset'

/** 单张附件内联上限 */
const MAX_INLINE_BYTES = 8 * 1024 * 1024
/** 一次导出内联总量上限 */
const MAX_TOTAL_INLINE_BYTES = 24 * 1024 * 1024

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 正文里的本地附件引用 → 笔记目录内的相对路径。
 * 与预览同一套放行规则(`resolveNoteAssetSrc` 只认相对路径,拒绝 scheme / 绝对路径 / `~`),
 * 再按段解开百分号编码 —— 粘贴图片时写进正文的是 `%20` 形式。
 */
function localAssetRel(src: string): string | null {
  if (resolveNoteAssetSrc(src) === null) return null
  try {
    const rel = src
      .split('/')
      .filter((seg) => seg !== '' && seg !== '.')
      .map((seg) => decodeURIComponent(seg))
      .join('/')
    return rel === '' ? null : rel
  } catch {
    return null // 非法百分号编码:当作远程/无法解析,原样交给渲染器
  }
}

function toBase64(data: Uint8Array): string {
  // 分块避免 String.fromCharCode(...bigArray) 爆栈
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < data.length; i += CHUNK) {
    binary += String.fromCharCode(...data.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function extOf(rel: string): string {
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/**
 * 预取正文里出现的本地附件,返回 `相对路径 → data: URL`。
 * 读失败、超限的条目直接不进 map —— 第二遍渲染时它们会退回原相对地址。
 */
async function inlineLocalAssets(source: string): Promise<Map<string, string>> {
  const pending = new Set<string>()
  // 第一遍只收集:渲染器会在解析图片时把每个 src 交给 resolveImage
  renderToStaticMarkup(
    <>
      {renderMarkdown(source, 'collect', {
        extended: true,
        resolveImage: (src) => {
          const rel = localAssetRel(src)
          if (rel !== null) pending.add(rel)
          return resolveNoteAssetSrc(src)
        }
      })}
    </>
  )

  const out = new Map<string, string>()
  let total = 0
  for (const rel of pending) {
    try {
      const res = await window.launcher.notes.readFileBytes(rel, MAX_INLINE_BYTES)
      if (!res.ok) continue
      if (res.size > MAX_INLINE_BYTES) continue
      if (total + res.size > MAX_TOTAL_INLINE_BYTES) continue
      total += res.size
      out.set(rel, `data:${noteAssetMime(extOf(rel))};base64,${toBase64(res.data)}`)
    } catch {
      /* 读不到就不内联 */
    }
  }
  return out
}

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 40px 28px 56px;
  background: #fff;
  color: #1f2328;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 16px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
}
.md-export { max-width: 820px; margin: 0 auto; }
.md-export .md-h, .md-export h1, .md-export h2,
.md-export h3, .md-export h4, .md-export h5, .md-export h6 {
  line-height: 1.3; margin: 1.6em 0 .6em; font-weight: 650;
}
.md-export .md-h1, .md-export h1 { font-size: 2em; margin-top: 0; }
.md-export .md-h2, .md-export h2 {
  font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: .3em;
}
.md-export .md-h3, .md-export h3 { font-size: 1.25em; }
.md-export .md-h4, .md-export h4 { font-size: 1.1em; }
.md-export .md-h5, .md-export h5,
.md-export .md-h6, .md-export h6 { font-size: 1em; }
.md-export .md-p { margin: .8em 0; }
.md-export .md-list { margin: .8em 0; padding-left: 1.6em; }
.md-export .md-list li { margin: .25em 0; }
.md-export .md-list li.task-list-item { list-style: none; margin-left: -1.4em; }
.md-export input[type="checkbox"] { margin-right: .45em; }
.md-export a, .md-export .md-link { color: #0969da; text-decoration: none; }
.md-export a:hover, .md-export .md-link:hover { text-decoration: underline; }
.md-export .md-link-icon { margin-left: .25em; font-size: .8em; opacity: .7; }
.md-export .md-code-inline, .md-export code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: .9em; background: #f6f8fa; border-radius: 4px; padding: .15em .35em;
}
.md-export .md-code-block {
  margin: 1em 0; border-radius: 8px; overflow: hidden; background: #f6f8fa;
}
.md-export .md-code-bar {
  padding: 6px 12px; font-size: .78em; color: #57606a;
  background: #eef1f4; border-bottom: 1px solid #e1e4e8;
}
.md-export .md-code-lang { font-family: ui-monospace, Menlo, monospace; }
.md-export pre, .md-export .md-code {
  margin: 0; padding: 12px 14px; overflow: auto; background: #f6f8fa;
}
.md-export .md-code code { background: transparent; padding: 0; font-size: .88em; }
.md-export .md-quote, .md-export blockquote {
  margin: 1em 0; padding: .2em 0 .2em 1em; color: #57606a;
  border-left: 3px solid #d0d7de;
}
.md-export .md-hr, .md-export hr {
  border: none; border-top: 1px solid #eaecef; margin: 2em 0;
}
.md-export .md-img, .md-export img { max-width: 100%; height: auto; }
.md-export .md-img-chip {
  display: inline-flex; gap: 6px; align-items: center;
  padding: 2px 8px; border: 1px solid #d0d7de; border-radius: 6px; font-size: .9em;
}
.md-export .md-table-block { margin: 1em 0; overflow-x: auto; }
.md-export .md-table-wrap { overflow-x: auto; }
.md-export .md-table, .md-export table {
  border-collapse: collapse; width: 100%; font-size: .95em;
}
.md-export .md-table th, .md-export .md-table td,
.md-export th, .md-export td {
  border: 1px solid #d0d7de; padding: 6px 10px; text-align: left;
}
.md-export .md-table th, .md-export th { background: #f6f8fa; font-weight: 600; }
.md-export .md-align { text-align: inherit; }
.md-export .md-callout {
  border: 1px solid #d0d7de; border-left-width: 4px; border-radius: 8px;
  padding: 10px 14px; margin: 1em 0; background: #f8fafc;
}
.md-export .md-callout-hd { font-weight: 600; margin-bottom: .3em; }
.md-export .md-callout-body > :first-child { margin-top: 0; }
.md-export .md-callout-body > :last-child { margin-bottom: 0; }
.md-export .md-details {
  margin: 1em 0; padding: .5em .8em; border: 1px solid #d0d7de; border-radius: 8px;
}
.md-export .md-summary { cursor: default; font-weight: 600; }
.md-export .md-embed { margin: 1em 0; border: 1px solid #d0d7de; border-radius: 8px; }
.md-export .md-embed-bar {
  padding: 6px 10px; font-size: .85em; color: #57606a;
  background: #f6f8fa; border-bottom: 1px solid #e1e4e8; word-break: break-all;
}
.md-export .md-embed-frame { display: block; width: 100%; height: 420px; border: 0; }
.md-export .md-media { max-width: 100%; }
.md-export .md-export-plain {
  white-space: pre-wrap; word-break: break-word; background: transparent;
  font-size: .92em; line-height: 1.55;
}
@page { margin: 16mm; }
@media print {
  body { padding: 0; font-size: 12pt; }
  .md-export { max-width: none; }
  .md-export .md-code-block, .md-export .md-img, .md-export .md-table,
  .md-export .md-callout, .md-export .md-embed { break-inside: avoid; }
}
`

function documentShell(title: string, bodyHtml: string): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${CSS}</style>`,
    '</head>',
    '<body>',
    '<article class="md-export">',
    bodyHtml,
    '</article>',
    '</body>',
    '</html>',
    ''
  ].join('\n')
}

/**
 * Markdown 正文 → 独立 HTML。两遍渲染:第一遍收集本地图片,读成 data URL 后第二遍替换。
 * 笔记正文有 1 MiB 上限,两遍渲染的成本可以忽略。
 */
export async function buildMarkdownHtml(opts: {
  title: string
  source: string
}): Promise<string> {
  const assets = await inlineLocalAssets(opts.source)
  const body = renderToStaticMarkup(
    <>
      {renderMarkdown(opts.source, 'export', {
        extended: true,
        resolveImage: (src) => {
          const rel = localAssetRel(src)
          if (rel !== null) {
            const data = assets.get(rel)
            if (data !== undefined) return data
          }
          // 未内联的本地引用保持预览同款地址;远程图片原样放行
          return resolvePreviewSrc(src)
        }
      })}
    </>
  )
  return documentShell(opts.title, body)
}

/** 纯文本 / 代码 / CSV → 独立 HTML(内容整体转义,保留换行) */
export function buildPlainHtml(opts: { title: string; text: string }): string {
  return documentShell(
    opts.title,
    `<pre class="md-export-plain">${escapeHtml(opts.text)}</pre>`
  )
}
