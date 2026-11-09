// PSD / TIFF / HEIC 解码后交给同一个 ImageViewer。
// 解码器按需 import;失败、超像素上限、读字节失败都落到占位。

import { useEffect, useState } from 'react'
import { useT } from '../../../hooks/useT'
import { decodeImage, type DecodedImageKind } from '../../../lib/decode-image'
import { FilePlaceholder } from './FilePlaceholder'
import { ImageViewer } from './ImageViewer'

export function DecodedImageViewer({
  kind,
  name,
  path,
  data
}: {
  kind: DecodedImageKind
  name: string
  /** 磁盘文件才需要(占位里的打开/显示动作) */
  path: string
  data: Uint8Array
}): React.JSX.Element {
  const t = useT()
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl = false
    let url: string | null = null
    void (async () => {
      try {
        const out = await decodeImage(kind, data)
        if (cancelled) {
          if (out.objectUrl) URL.revokeObjectURL(out.url)
          return
        }
        url = out.url
        objectUrl = out.objectUrl
        setSrc(out.url)
      } catch (err) {
        if (!cancelled) {
          setFailed(true)
          console.warn('decode image failed', err)
        }
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl && url !== null) URL.revokeObjectURL(url)
    }
  }, [kind, data])

  if (failed) {
    return (
      <FilePlaceholder
        path={path}
        icon="fa-file-image"
        title={t('notes.file.imageFailed')}
        hint={t('notes.file.binaryHint')}
      />
    )
  }
  if (src === null) {
    return (
      <div className="file-placeholder" role="status">
        <i className="fa-solid fa-circle-notch fa-spin" />
        <div>{t('notes.file.loading')}</div>
      </div>
    )
  }
  return <ImageViewer src={src} alt={name} />
}
