// Office 三件套只读预览:docx / xlsx / pptx。全部按需 import,首屏不加载,离线可用。
// 内容解析在渲染层,容器里的链接一律拦下(http(s) 交给系统浏览器),不让预览把应用导航走。

import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../hooks/useT'
import { FilePlaceholder } from './FilePlaceholder'

type OfficeKind = 'docx' | 'xlsx' | 'pptx'

interface Sheet {
  name: string
  rows: string[][]
}

const MAX_SHEET_ROWS = 1000
const MAX_SHEET_COLS = 100

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toLocaleString()
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o['richText'])) {
      return (o['richText'] as { text?: string }[]).map((t) => t.text ?? '').join('')
    }
    if (typeof o['text'] === 'string') return o['text']
    if ('result' in o) return cellText(o['result'])
    if ('error' in o) return String(o['error'])
    return ''
  }
  return String(v)
}

/** 链接拦截:所有导航都在预览里失效;http(s) 用系统浏览器打开 */
function guardLinks(root: HTMLElement): () => void {
  const onClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null
    const a = target?.closest('a[href]')
    if (!(a instanceof HTMLAnchorElement)) return
    const href = a.getAttribute('href') ?? ''
    if (href.startsWith('#')) return
    e.preventDefault()
    if (/^https?:\/\//i.test(href)) void window.launcher.openExternal(href)
  }
  root.addEventListener('click', onClick)
  return () => root.removeEventListener('click', onClick)
}

export function OfficeView({
  kind,
  name,
  path,
  data
}: {
  kind: OfficeKind
  name: string
  /** 占位里的打开/显示动作 */
  path: string
  data: Uint8Array
}): React.JSX.Element {
  const t = useT()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    let cancelled = false
    let destroy: (() => void) | null = null
    setLoading(true)
    setFailed(false)
    setSheets([])
    setActiveSheet(0)

    const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer

    void (async () => {
      try {
        if (kind === 'docx') {
          const docx = await import('docx-preview')
          if (cancelled) return
          host.innerHTML = ''
          await docx.renderAsync(bytes, host, host, {
            inWrapper: true,
            breakPages: true,
            ignoreLastRenderedPageBreak: false,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true
          })
          destroy = guardLinks(host)
        } else if (kind === 'xlsx') {
          const mod = await import('exceljs')
          const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod
          const wb = new ExcelJS.Workbook()
          await wb.xlsx.load(bytes)
          if (cancelled) return
          const out: Sheet[] = []
          wb.eachSheet((ws) => {
            const rows: string[][] = []
            const rowCount = Math.min(ws.rowCount, MAX_SHEET_ROWS)
            const colCount = Math.min(ws.columnCount, MAX_SHEET_COLS)
            for (let r = 1; r <= rowCount; r++) {
              const row: string[] = []
              for (let c = 1; c <= colCount; c++) row.push(cellText(ws.getCell(r, c).value))
              rows.push(row)
            }
            out.push({ name: ws.name, rows })
          })
          if (cancelled) return
          setSheets(out)
        } else {
          const { PPTXViewer } = await import('pptx-viewer')
          if (cancelled) return
          host.innerHTML = ''
          const width = host.clientWidth > 0 ? host.clientWidth : 960
          const viewer = new PPTXViewer(host, {
            width,
            height: Math.round((width * 9) / 16),
            showControls: true
          })
          destroy = () => viewer.destroy()
          await viewer.load(bytes)
        }
        if (!cancelled) setLoading(false)
      } catch (err) {
        if (!cancelled) {
          console.warn('office preview failed', name, err)
          setLoading(false)
          setFailed(true)
        }
      }
    })()

    return () => {
      cancelled = true
      destroy?.()
      if (hostRef.current !== null) hostRef.current.innerHTML = ''
    }
  }, [kind, name, data])

  const sheet = kind === 'xlsx' ? sheets[activeSheet] : undefined

  return (
    <div className="file-office" data-office-kind={kind}>
      <div className="file-viewer-tools">
        {kind === 'xlsx' && sheets.length > 1 && (
          <div className="file-sheet-tabs" role="tablist">
            {sheets.map((s, i) => (
              <button
                key={s.name + i}
                type="button"
                role="tab"
                aria-selected={i === activeSheet}
                className={'file-sheet-tab' + (i === activeSheet ? ' active' : '')}
                onClick={() => setActiveSheet(i)}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        <div className="file-zoom">
          <button type="button" title={t('notes.file.zoomOut')} onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>
            <i className="fa-solid fa-magnifying-glass-minus" />
          </button>
          <button type="button" title={t('notes.file.zoomReset')} onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" title={t('notes.file.zoomIn')} onClick={() => setZoom((z) => Math.min(2, z + 0.1))}>
            <i className="fa-solid fa-magnifying-glass-plus" />
          </button>
        </div>
      </div>

      {loading && (
        <div className="file-placeholder" role="status">
          <i className="fa-solid fa-circle-notch fa-spin" />
          <div>{t('notes.file.loading')}</div>
        </div>
      )}
      {failed && (
        <FilePlaceholder path={path} icon="fa-file-circle-xmark" title={t('notes.file.officeFailed')} />
      )}

      {kind === 'xlsx' ? (
        <div className="file-xlsx-scroll" style={{ zoom }}>
          {sheet !== undefined && (
            <table className="file-xlsx-table" data-office-sheet>
              <tbody>
                {sheet.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
      <div
        className="file-office-scroll"
        style={{ zoom, display: kind === 'xlsx' ? 'none' : undefined }}
      >
        <div ref={hostRef} className="file-office-page" data-office-page />
      </div>
    </div>
  )
}
