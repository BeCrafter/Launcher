// 消息多选操作条:全选 / 复制 / 导出 Markdown / 退出。
// 选中项来自 store(消息级:user.id + assistant.id),转录格式在 lib/ai-transcript.ts。
import { useT } from '../../hooks/useT'
import { fmt } from '../../i18n'
import {
  buildTranscript,
  transcriptFileName,
  type TranscriptLabels
} from '../../lib/ai-transcript'
import { copyText, showToast } from '../../lib/utils'
import { useAiStore } from '../../state/ai-store'

function labelsOf(t: (key: string) => string): TranscriptLabels {
  return {
    user: t('ai.transcript.user'),
    assistant: t('ai.transcript.assistant'),
    completedAt: t('ai.transcript.completedAt'),
    duration: t('ai.transcript.duration'),
    attachments: t('ai.transcript.attachments')
  }
}

export function AiSelectionBar(): React.JSX.Element | null {
  const t = useT()
  const selectionMode = useAiStore((s) => s.selectionMode)
  const selectedIds = useAiStore((s) => s.selectedIds)
  const messages = useAiStore((s) => s.messages)
  const selectAllMessages = useAiStore((s) => s.selectAllMessages)
  const exitSelectionMode = useAiStore((s) => s.exitSelectionMode)
  if (!selectionMode) return null

  const labels = labelsOf(t)
  const transcript = (): string => buildTranscript(messages, selectedIds, labels)

  const onCopy = async (): Promise<void> => {
    const content = transcript()
    if (content === '') {
      showToast(t('ai.select.empty'), '#eec04d', 'fa-list-check')
      return
    }
    const ok = await copyText(content)
    showToast(
      t(ok ? 'ai.select.copied' : 'ai.select.copyFailed'),
      ok ? '#4ade80' : '#f87171',
      'fa-copy'
    )
  }

  const onExport = async (): Promise<void> => {
    const content = transcript()
    if (content === '') {
      showToast(t('ai.select.empty'), '#eec04d', 'fa-list-check')
      return
    }
    try {
      const path = await window.launcher.saveTextFile({
        suggestedName: transcriptFileName(),
        content,
        title: t('ai.export.title')
      })
      // 用户取消 → null,静默
      if (path) {
        showToast(fmt(t('ai.select.exported'), { P: path }), '#4ade80', 'fa-download')
      }
    } catch {
      showToast(t('ai.select.exportFailed'), '#f87171', 'fa-circle-exclamation')
    }
  }

  return (
    <div className="ai-select-bar">
      <span className="ai-select-count">
        <i className="fa-solid fa-list-check" />
        {fmt(t('ai.select.count'), { N: String(selectedIds.length) })}
      </span>
      <div className="ai-select-acts">
        <button className="d-btn" type="button" onClick={selectAllMessages}>
          <i className="fa-solid fa-check-double" />
          <span>{t('ai.select.all')}</span>
        </button>
        <button
          className="d-btn"
          type="button"
          disabled={selectedIds.length === 0}
          onClick={() => void onCopy()}
        >
          <i className="fa-regular fa-copy" />
          <span>{t('ai.select.copy')}</span>
        </button>
        <button
          className="d-btn"
          type="button"
          disabled={selectedIds.length === 0}
          onClick={() => void onExport()}
        >
          <i className="fa-solid fa-download" />
          <span>{t('ai.select.export')}</span>
        </button>
        <button
          className="d-btn"
          type="button"
          title={t('ai.select.cancel')}
          onClick={exitSelectionMode}
        >
          <i className="fa-solid fa-xmark" />
        </button>
      </div>
    </div>
  )
}
