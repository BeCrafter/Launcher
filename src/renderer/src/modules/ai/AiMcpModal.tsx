// ported-from: docs/demo/index.html #aiMcpModal + ai.js aiRenderMcpModal/aiToggleMcpPerm @ 06ff9ba — demo UI 基线
// MCP 接入模态:stdio 命令 + HTTP 端点两种用法并列展示(「用哪套」而非「切到哪套」),各自带复制;
// 权限开关绑定设置里的 mcpPermission(唯一闸门,设置页无开关)
import { useEffect, useState } from 'react'
import { useT, useFmt } from '../../hooks/useT'
import { Modal } from '../../components/Modal'
import { Toggle } from '../../components/ui/Toggle'
import { useAiStore } from '../../state/ai-store'
import { useSettingsStore } from '../../state/settings-store'
import { copyText, showToast } from '../../lib/utils'

/**
 * PATH 链接状态行。
 *
 * 有它之前,弹窗只按「安装来源是不是 brew」猜链接在不在 —— 猜错就把用户送进一条
 * command not found。现在以 main 侧**实际扫 PATH 的结果**为准,并把状态与原因讲清楚。
 */
function McpLinkStatus(): React.JSX.Element {
  const t = useT()
  const fmt = useFmt()
  const info = useAiStore((s) => s.mcpInfo)
  const installLink = useAiStore((s) => s.installMcpLink)
  if (!info) return <div className="ai-mcp-cmd-hint" />
  const { state, foundAt, expected } = info.link
  const bin = info.binName

  const text =
    state === 'linked'
      ? fmt(t('ai.mcp.link.linked'), { P: foundAt ?? '' })
      : state === 'dangling'
        ? fmt(t('ai.mcp.link.dangling'), { N: bin, P: foundAt ?? '' })
        : state === 'foreign'
          ? fmt(t('ai.mcp.link.foreign'), { N: bin, P: foundAt ?? '' })
          : t('ai.mcp.link.missing')

  return (
    <div className={`ai-mcp-link ${state}`}>
      <div className="ai-mcp-link-txt">
        <i
          className={`fa-solid ${state === 'linked' ? 'fa-circle-check' : state === 'missing' ? 'fa-circle-info' : 'fa-triangle-exclamation'}`}
        />
        <span>{text}</span>
      </div>
      {state !== 'linked' && expected !== '' && (
        <button className="d-btn ai-mcp-link-btn" type="button" onClick={() => void installLink()}>
          <i className="fa-solid fa-link" />
          <span>{t(state === 'missing' ? 'ai.mcp.link.install' : 'ai.mcp.link.repair')}</span>
        </button>
      )}
    </div>
  )
}

export function AiMcpModal(): React.JSX.Element {
  const t = useT()
  const open = useAiStore((s) => s.mcpOpen)
  const closeMcp = useAiStore((s) => s.closeMcp)
  const info = useAiStore((s) => s.mcpInfo)
  const openMcp = useAiStore((s) => s.openMcp)
  const mcpPermission = useSettingsStore((s) => s.settings?.mcpPermission ?? 'readOnly')
  const setSetting = useSettingsStore((s) => s.set)
  const writeOn = mcpPermission === 'full'

  // 开启时拉取接入信息(命令/URL 由 main 按 launcher-mcp 真实路径给出)
  useEffect(() => {
    if (open) void openMcp()
  }, [open, openMcp])

  const copy = (text: string): void => {
    void copyText(text).then(() => showToast(t('toast.xmlCopied'), '#22d3ee', 'fa-copy'))
  }

  const onToggle = (on: boolean): void => {
    // 设置 store 乐观写 + 持久化(mcpPermission 在 shared/settings schema)
    setSetting({ mcpPermission: on ? 'full' : 'readOnly' })
    showToast(
      t(on ? 'ai.mcp.permOn' : 'ai.mcp.permOff'),
      on ? '#f87171' : '#4ade80',
      'fa-shield-halved'
    )
  }

  return (
    <Modal id="aiMcpModal" open={open} onClose={closeMcp}>
      <div className="modal-box" style={{ width: 520 }}>
        <div className="modal-hdr">
          <span className="modal-title">
            <i className="fa-solid fa-plug" style={{ color: 'var(--accent2)', marginRight: 7 }} />
            <span>{t('ai.mcp.title')}</span>
          </span>
          <button className="modal-close" type="button" onClick={closeMcp}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>{t('ai.mcp.lead')}</div>

          <div className="ai-mcp-cmd">
            <div className="ai-mcp-cmd-hd">
              <span className="ai-mcp-cmd-tag">stdio</span>
              <span className="ai-mcp-cmd-name">{t('ai.mcp.stdioLabel')}</span>
              <button
                className="ai-mcp-cmd-copy"
                type="button"
                title={t('xml.copy')}
                onClick={() => info && copy(info.stdioCommand)}
              >
                <i className="fa-solid fa-copy" />
              </button>
            </div>
            <div className="ai-appr-cmd" style={{ margin: 0 }}>
              {info?.stdioCommand ?? ''}
            </div>
            <McpLinkStatus />
          </div>

          <div className="ai-mcp-cmd">
            <div className="ai-mcp-cmd-hd">
              <span className="ai-mcp-cmd-tag">HTTP</span>
              <span className="ai-mcp-cmd-name">{t('ai.mcp.httpLabel')}</span>
              <button
                className="ai-mcp-cmd-copy"
                type="button"
                title={t('xml.copy')}
                onClick={() => info && copy(info.httpUrl)}
              >
                <i className="fa-solid fa-copy" />
              </button>
            </div>
            <div className="ai-appr-cmd" style={{ margin: 0 }}>
              {info?.httpUrl ?? ''}
            </div>
            <div className="ai-mcp-cmd-hint">
              <i className={`fa-solid ${info?.httpRunning ? 'fa-circle-check' : 'fa-circle'}`} style={{ color: info?.httpRunning ? 'var(--green)' : 'var(--dim)' }} />
              <span>{t('ai.mcp.httpHint')}</span>
            </div>
          </div>

          <div className="ai-mcp-perm">
            <div>
              <div className="ai-mcp-perm-t">{t('ai.mcp.permTitle')}</div>
              <div className="ai-mcp-perm-d">{t(writeOn ? 'ai.mcp.permDesc' : 'ai.mcp.permDescReadOnly')}</div>
            </div>
            <Toggle checked={writeOn} onChange={onToggle} />
          </div>
        </div>
      </div>
    </Modal>
  )
}
