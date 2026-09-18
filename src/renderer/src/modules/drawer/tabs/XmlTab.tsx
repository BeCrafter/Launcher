// ported-from: docs/demo/index.html #dft-xml + drawer.js validateXml/copyXml @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// XML tab(demo #dft-xml:CodeMirror 6 编辑器 + 验证/复制 + 格式化/保存;初始原文 = per-agent plist 真实读取)
// 保存 = plutil 校验 → (系统域)提权 → saveXml 落盘,成功后回读刷新守卫状态
import { useT } from '../../../hooks/useT'
import { useDrawerStore } from '../../../state/drawer-store'
import { useSettingsStore } from '../../../state/settings-store'
import { XmlEditor } from '../../../components/XmlEditor'
import { formatPlistXml } from '../../../lib/plist'
import { copyText, showToast } from '../../../lib/utils'
import { agentErrorToast } from '../../../lib/ipc-error'
import { dataSource } from '../../../data'
import { ELEVATION } from '../../../lib/elevation'

export function XmlTab(): React.JSX.Element {
  const t = useT()
  const xml = useDrawerStore((s) => s.xml)
  const setXml = useDrawerStore((s) => s.setXml)
  const saveXml = useDrawerStore((s) => s.saveXml)
  const document = useDrawerStore((s) => s.document)
  const isNotTask = useDrawerStore((s) => s.isNotTask)
  // 已有任务不能在 XML 中改 Label；非任务文件允许补 Label 后原地转正。
  const blocked = (() => {
    if (!document || isNotTask) return false
    const m = xml.match(/<key>Label<\/key>\s*<string>([^<]*)<\/string>/)
    const newLabel = m ? m[1] : ''
    return document.form !== null && newLabel !== (document.form.label ?? '')
  })()
  const xmlIndent = useSettingsStore((s) => s.settings?.xmlIndent ?? '2')

  const validate = async (): Promise<void> => {
    // 真实校验:plutil -lint(main 侧,与系统口径一致)
    try {
      const r = await dataSource().agents.validateXml(xml)
      if (r.ok) showToast(t('toast.xmlValidated'), '#4ade80', 'fa-check-circle')
      else showToast(`${t('toast.xmlInvalid')}: ${r.error ?? ''}`.slice(0, 120), '#f87171', 'fa-circle-exclamation')
    } catch (err) {
      agentErrorToast(err, t)
    }
  }

  const copy = async (): Promise<void> => {
    await copyText(xml)
    showToast(t('toast.xmlCopied'), '#22d3ee', 'fa-copy')
  }

  const format = (): void => {
    setXml(formatPlistXml(xml, xmlIndent))
    showToast(t('toast.xmlFormatted'), '#22d3ee', 'fa-wand-magic-sparkles')
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
            <button className="d-btn" type="button" style={{ padding: '3px 9px', fontSize: 10.5 }} onClick={() => void validate()}>
              <i className="fa-solid fa-circle-check" /> <span>{t('xml.validate')}</span>
            </button>
            <button className="d-btn" type="button" style={{ padding: '3px 9px', fontSize: 10.5 }} onClick={() => void copy()}>
              <i className="fa-solid fa-copy" /> <span>{t('xml.copy')}</span>
            </button>
          </div>
        </div>
        <div className="xml-section-content">
          <XmlEditor value={xml} onChange={setXml} indent={xmlIndent} />
        </div>
        <div className="xml-section-bottom">
          <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>
            <i className="fa-solid fa-circle-info" style={{ marginRight: 4 }} />
            <span>{t('xml.overwriteHint')}</span>
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="d-btn" type="button" onClick={format} style={{ padding: '6px 12px' }}>
              <i className="fa-solid fa-wand-magic-sparkles" /> <span>{t('xml.format')}</span>
            </button>
            <button className="d-btn" type="button" disabled={blocked} onClick={() => void saveXml('save')} style={{ padding: '6px 14px' }}>
              <i className="fa-solid fa-floppy-disk" /> <span>{t('btn.save')}</span>
            </button>
            <button className="d-btn accent" type="button" disabled={blocked} onClick={() => void saveXml('saveAndApply')} style={{ padding: '6px 18px' }}>
              <i className="fa-solid fa-check" /> <span>{t('btn.saveApply')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
