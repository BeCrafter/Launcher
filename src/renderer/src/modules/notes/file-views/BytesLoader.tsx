// 需要整份字节的查看器(Office / 压缩包 / PSD / TIFF / HEIC / 3D)共用:
// 读 IPC → 加载态 / 超限占位 / 渲染。

import { useEffect, useState } from 'react'
import { MAX_FILE_BYTES_READ } from '@shared/notes'
import { useT } from '../../../hooks/useT'
import { dataSource } from '../../../data'
import { formatBytes } from '../../../lib/format-bytes'
import { cleanIpcErrorMessage } from '../../../lib/ipc-error'
import { FilePlaceholder } from './FilePlaceholder'

export function BytesLoader({
  path,
  url,
  maxBytes = MAX_FILE_BYTES_READ,
  children
}: {
  path: string
  /** 库外文件走协议 URL。笔记目录里的文件不传,仍走 readFileBytes。 */
  url?: string
  maxBytes?: number
  children: (data: Uint8Array) => React.JSX.Element
}): React.JSX.Element {
  const t = useT()
  const [data, setData] = useState<Uint8Array | null>(null)
  const [tooLarge, setTooLarge] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setTooLarge(false)
    setError(null)
    void (async () => {
      try {
        if (url !== undefined) {
          const response = await fetch(url)
          if (cancelled) return
          if (response.status === 413) {
            setTooLarge(true)
            return
          }
          if (!response.ok) {
            setError(t('notes.canvas.embed.missing'))
            return
          }
          const bytes = new Uint8Array(await response.arrayBuffer())
          if (cancelled) return
          if (bytes.byteLength > maxBytes) {
            setTooLarge(true)
            return
          }
          setData(bytes)
          return
        }
        const out = await dataSource().notes.readFileBytes(path, maxBytes)
        if (cancelled) return
        if (!out.ok) {
          if (out.kind === 'too-large') setTooLarge(true)
          else setError(out.message)
          return
        }
        setData(out.data)
      } catch (err) {
        if (!cancelled) setError(cleanIpcErrorMessage(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path, url, maxBytes, t])

  if (tooLarge) {
    return (
      <FilePlaceholder
        path={path}
        icon="fa-file-circle-exclamation"
        title={t('notes.file.tooLarge')}
        hint={t('notes.file.tooLargeHint').replace('{SIZE}', formatBytes(maxBytes))}
      />
    )
  }
  if (error !== null) {
    return (
      <FilePlaceholder path={path} icon="fa-file-circle-xmark" title={error} hint={t('notes.file.binaryHint')} />
    )
  }
  if (data === null) {
    return (
      <div className="file-placeholder" role="status">
        <i className="fa-solid fa-circle-notch fa-spin" />
        <div>{t('notes.file.loading')}</div>
      </div>
    )
  }
  return children(data)
}
