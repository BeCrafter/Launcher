// 服务「配置」浮层(根级浮层,应用新增 UI;超出 demo 冻结基线)
// 三项覆写:名称(别名)/ Host / 路径。留空 = 使用自动值(placeholder 直接展示该自动值)。
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../hooks/useT'
import { useSvcConfigStore } from '../../state/svc-config-store'
import { useSettingsStore } from '../../state/settings-store'
import { connectHost, serviceIdentityKey } from '../../lib/svc-override'
import { saveServiceOverride } from '../../lib/svc-override-actions'
import { EMPTY_OVERRIDES, refForService, useNoteCountForRef } from '../../lib/note-refs'
import { openNotesFor } from '../../lib/notes-nav'

const MENU_W = 268
// 实测高度(三字段 + hint + 相关笔记行 + 按钮行);用于判断向下是否放得下,宁可略大不可略小。
// ⚠ 加行就要跟着改:翻转定位的算式全靠它,写小了菜单会顶出窗口下沿。
const MENU_H = 278

export function SvcConfigMenu(): React.JSX.Element | null {
  const t = useT()
  const svc = useSvcConfigStore((s) => s.svc)
  const x = useSvcConfigStore((s) => s.x)
  const y = useSvcConfigStore((s) => s.y)
  const close = useSvcConfigStore((s) => s.close)
  const ref = useRef<HTMLDivElement | null>(null)

  const [alias, setAlias] = useState('')
  const [host, setHost] = useState('')
  const [path, setPath] = useState('')

  const overrides = useSettingsStore((s) => s.settings?.serviceOverrides ?? EMPTY_OVERRIDES)
  // svc 为 null 时给一个空键(计数自然是 0);hook 不能条件调用
  const noteCount = useNoteCountForRef(
    svc ? refForService(svc, overrides[serviceIdentityKey(svc)]) : { type: 'service', key: '', label: '' }
  )

  // 打开/切换目标时把当前覆写载入草稿(同一次打开内自由编辑)
  useEffect(() => {
    if (!svc) return
    const o = useSettingsStore.getState().settings?.serviceOverrides?.[serviceIdentityKey(svc)]
    setAlias(o?.alias ?? '')
    setHost(o?.host ?? '')
    setPath(o?.path ?? '')
  }, [svc])

  // 点外部 / Esc 关闭(丢弃草稿)
  useEffect(() => {
    if (!svc) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [svc, close])

  if (!svc) return null

  const key = serviceIdentityKey(svc)
  const save = (): void => {
    saveServiceOverride(key, {
      alias: alias.trim() || undefined,
      host: host.trim() || undefined,
      path: path.trim() || undefined
    })
    close()
  }
  const reset = (): void => {
    saveServiceOverride(key, { alias: undefined, host: undefined, path: undefined })
    close()
  }

  // 定位:锚点按钮右对齐;下方放得下就向下,否则向上翻转
  // (配置按钮在卡片右下角,固定预留余量会让 214px 的浮层跑出屏幕)
  const placeBelow = y + 4 + MENU_H <= window.innerHeight - 8
  const top = placeBelow ? y + 4 : Math.max(8, y - MENU_H - 4)
  const left = Math.max(8, Math.min(x - MENU_W, window.innerWidth - MENU_W - 8))

  return (
    <div className="svc-config-menu" ref={ref} style={{ left, top, width: MENU_W }} id="svcConfigMenu">
      <div className="svc-config-row">
        <label className="svc-config-label" htmlFor="svcCfgAlias">
          {t('svc.configure.name')}
        </label>
        <input
          id="svcCfgAlias"
          className="svc-config-input"
          value={alias}
          placeholder={svc.name}
          onChange={(e) => setAlias(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
          }}
        />
      </div>
      <div className="svc-config-row">
        <label className="svc-config-label" htmlFor="svcCfgHost">
          {t('svc.configure.host')}
        </label>
        <input
          id="svcCfgHost"
          className="svc-config-input"
          value={host}
          placeholder={connectHost(svc.addr)}
          onChange={(e) => setHost(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
          }}
        />
      </div>
      <div className="svc-config-row">
        <label className="svc-config-label" htmlFor="svcCfgPath">
          {t('svc.configure.path')}
        </label>
        <input
          id="svcCfgPath"
          className="svc-config-input"
          value={path}
          placeholder="/"
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
          }}
        />
      </div>
      <div className="svc-config-hint">{t('svc.configure.hint')}</div>
      {/* 反向入口:从这个端口服务找到与它相关的笔记 */}
      <button
        className="svc-config-related"
        type="button"
        onClick={() => {
          close()
          openNotesFor(refForService(svc, overrides[serviceIdentityKey(svc)]))
        }}
      >
        <i className="fa-regular fa-note-sticky" />
        <span>{t('notes.ref.related')}</span>
        <span className="note-related-count">{noteCount}</span>
      </button>
      <div className="svc-config-actions">
        <button className="svc-config-btn" type="button" onClick={reset}>
          {t('svc.configure.reset')}
        </button>
        <button className="svc-config-btn primary" type="button" onClick={save}>
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}
