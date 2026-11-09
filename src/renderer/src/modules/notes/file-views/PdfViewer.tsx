// PDF:交给 Chromium 自带的阅读器(iframe)。Range 与缩放/翻页都由阅读器负责;
// 主进程的 frame-scrollbar 会把它的系统粗滚动条换成应用细滚动条。

import { useState } from 'react'
import { useT } from '../../../hooks/useT'

export function PdfViewer({ src }: { src: string }): React.JSX.Element {
  const t = useT()
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="file-placeholder">
        <i className="fa-solid fa-file-circle-xmark" />
        <div>{t('notes.file.pdfFailed')}</div>
      </div>
    )
  }
  return (
    <div className="file-pdf">
      <iframe
        className="file-preview-frame"
        data-file-frame="pdf"
        title="PDF"
        src={src}
        onError={() => setFailed(true)}
      />
    </div>
  )
}
