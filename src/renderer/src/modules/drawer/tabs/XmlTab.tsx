// XML tab(demo #dft-xml:CodeMirror 6 编辑器 + 验证/复制 + 格式化/保存;初始原文 = MOCK_DATA.drawer.xml)
import { useT } from '../../../hooks/useT'
import { useDrawerStore } from '../../../state/drawer-store'
import { XmlEditor } from '../../../components/XmlEditor'
import { copyText, showToast } from '../../../lib/utils'

export function XmlTab(): React.JSX.Element {
  const t = useT()
  const xml = useDrawerStore((s) => s.xml)
  const setXml = useDrawerStore((s) => s.setXml)

  const validate = (): void => {
    // demo validateXml 仅 toast(真实校验属后端阶段)
    showToast(t('toast.xmlValidated'), '#4ade80', 'fa-check-circle')
  }

  const copy = async (): Promise<void> => {
    await copyText(xml)
    showToast(t('toast.xmlCopied'), '#22d3ee', 'fa-copy')
  }

  return (
    <div className="drawer-section active" id="dft-xml" style={{ display: 'flex' }}>
      <div className="xml-section-body">
        <div className="xml-section-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <i className="fa-solid fa-code" style={{ color: 'var(--accent2)', fontSize: 12 }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t('xml.title')}
            </span>
            <span style={{ fontSize: 10, color: 'var(--dim)' }}>{t('xml.syncHint')}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="d-btn" type="button" style={{ padding: '3px 9px', fontSize: 10.5 }} onClick={validate}>
              <i className="fa-solid fa-circle-check" /> <span>{t('xml.validate')}</span>
            </button>
            <button className="d-btn" type="button" style={{ padding: '3px 9px', fontSize: 10.5 }} onClick={() => void copy()}>
              <i className="fa-solid fa-copy" /> <span>{t('xml.copy')}</span>
            </button>
          </div>
        </div>
        <div className="xml-section-content">
          <XmlEditor value={xml} onChange={setXml} />
        </div>
        <div className="xml-section-bottom">
          <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>
            <i className="fa-solid fa-circle-info" style={{ marginRight: 4 }} />
            <span>{t('xml.overwriteHint')}</span>
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="d-btn"
              type="button"
              onClick={() => showToast(t('toast.xmlFormatted'), '#22d3ee', 'fa-wand-magic-sparkles')}
              style={{ padding: '6px 12px' }}
            >
              <i className="fa-solid fa-wand-magic-sparkles" /> <span>{t('xml.format')}</span>
            </button>
            <button
              className="d-btn accent"
              type="button"
              onClick={() => showToast(t('toast.xmlSaved'), '#a78bfa', 'fa-floppy-disk')}
              style={{ padding: '6px 18px' }}
            >
              <i className="fa-solid fa-floppy-disk" /> <span>{t('xml.save')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
