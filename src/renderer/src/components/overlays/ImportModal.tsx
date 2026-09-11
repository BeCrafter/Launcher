// ported-from: docs/demo/index.html #importModal + modals.js showImportModal/doImport @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 导入 plist 模态(demo importModal + doImport:剪贴板预填 → 解析 → 草稿入抽屉)
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../hooks/useT'
import { Modal } from '../Modal'
import { XmlEditor } from '../XmlEditor'
import { parsePlistXml } from '../../lib/plist'
import { showToast } from '../../lib/utils'
import { useAgentsStore } from '../../state/agents-store'
import { useDrawerStore } from '../../state/drawer-store'
import { useUiStore } from '../../state/ui-store'

export function ImportModal(): React.JSX.Element | null {
  const t = useT()
  const open = useUiStore((s) => s.overlays.includes('importModal'))
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const [xml, setXml] = useState('')
  const prefilled = useRef(false)

  // demo showImportModal:打开时剪贴板含 plist 且文本区为空 → 自动预填(权限受限静默降级)
  useEffect(() => {
    if (open && !prefilled.current) {
      prefilled.current = true
      if (navigator.clipboard?.readText) {
        navigator.clipboard
          .readText()
          .then((text) => {
            if (text && text.includes('<plist') && !xml) setXml(text)
          })
          .catch(() => {})
      }
    }
    if (!open) prefilled.current = false
  }, [open, xml])

  if (!open) return null

  const doImport = async (): Promise<void> => {
    const xmlRaw = (xml || '').trim()
    if (!xmlRaw) {
      showToast(t('toast.requireLabel'), '#f87171', 'fa-circle-exclamation')
      return
    }
    const parsed = parsePlistXml(xmlRaw) ?? { label: '', program: '' }
    let label = parsed.label || 'com.user.imported'
    let idx = 1
    const agents = useAgentsStore.getState().agents
    while (agents.some((a) => a.id === label)) label = 'com.user.imported.' + idx++
    const draft = await useAgentsStore.getState().createDraft('user', label)
    closeOverlay('importModal')
    const drawer = useDrawerStore.getState()
    await drawer.openFor({ ...draft, program: parsed.program })
    drawer.updateForm({ program: parsed.program }) // openFor 只回填 label/desc,导入的 program 在此补入表单
    drawer.setXml(xmlRaw)
    setXml('')
    showToast(t('modal.newAgent.createdOpen').replace('{L}', label), '#a78bfa', 'fa-wand-magic-sparkles')
  }

  return (
    <Modal id="importModal" open={open} onClose={() => closeOverlay('importModal')}>
      <div className="modal-box" style={{ width: 720 }}>
        <div className="modal-hdr">
          <span className="modal-title">
            <i className="fa-solid fa-file-import" style={{ color: 'var(--cyan)', marginRight: 7 }} />
            <span>{t('modal.import.title')}</span>
          </span>
          <button className="modal-close" onClick={() => closeOverlay('importModal')}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="modal-body">
          <div
            className="import-drop"
            onClick={() => {
              void window.launcher
                .pickFile({ mode: 'plist', title: t('dialog.pickPlist') })
                .then((picked) => {
                  if (picked?.content) setXml(picked.content)
                })
                .catch((err) => showToast(String(err), '#f87171', 'fa-circle-exclamation'))
            }}
          >
            <i className="fa-solid fa-file-arrow-up" />
            <div>
              <div>{t('modal.import.dropHint')}</div>
              <div className="import-drop-sub">{t('modal.import.dropSub')}</div>
            </div>
          </div>
          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--dim)' }}>
            {t('modal.import.orPaste')}
          </div>
          <div className="xml-section-content" style={{ height: 300, flex: 'none' }}>
            <XmlEditor value={xml} onChange={setXml} placeholder={t('modal.import.pastePlaceholder')} bordered />
          </div>
        </div>
        <div className="modal-footer">
          <button className="d-btn" onClick={() => closeOverlay('importModal')}>
            <span>{t('common.cancel')}</span>
          </button>
          <button className="d-btn accent" onClick={() => void doImport()}>
            <i className="fa-solid fa-file-import" /> <span>{t('modal.import.doImport')}</span>
          </button>
        </div>
      </div>
    </Modal>
  )
}
