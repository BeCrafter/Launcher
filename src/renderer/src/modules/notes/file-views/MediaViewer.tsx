// 音视频:原生控件 + launcher-note:// 协议(Range 已支持,进度条可拖)。
// 不自动播放 —— 打开一个目录里的音频不该突然出声。

import { useState } from 'react'
import { useT } from '../../../hooks/useT'

export function MediaViewer({
  src,
  kind
}: {
  src: string
  kind: 'video' | 'audio'
}): React.JSX.Element {
  const t = useT()
  const [failed, setFailed] = useState(false)
  return (
    <div className="file-media" data-media-kind={kind}>
      {failed ? (
        <div className="file-placeholder">
          <i className="fa-solid fa-file-circle-xmark" />
          <div>{t('notes.file.mediaFailed')}</div>
        </div>
      ) : kind === 'video' ? (
        <video
          className="file-video"
          src={src}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
        />
      ) : (
        <audio
          className="file-audio"
          src={src}
          controls
          preload="metadata"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}
