// 文件头面板(阶段 2 增强项):查看/编辑 crontab 首个任务之前的注释与环境变量块
// 数据 = store.headers[scope].headerRaw(main 解析产物);保存只替换头部区块,任务区原样
import { useState } from 'react'
import { useT } from '../../hooks/useT'
import { cronErrorToast } from '../../lib/cron'
import { useCronStore } from '../../state/cron-store'
import { ELEVATION } from '../../lib/elevation'
import type { CronScope } from '@shared/models'

export function CronHeaderPanel(): React.JSX.Element {
  const t = useT()
  const headers = useCronStore((s) => s.headers)
  const writeHeader = useCronStore((s) => s.writeHeader)
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<CronScope>('user')
  const [text, setText] = useState('')

  const data = headers[scope]

  const openPanel = (): void => {
    setText(data.headerRaw)
    setOpen(true)
  }

  const switchScope = (s: CronScope): void => {
    setScope(s)
    setText(headers[s].headerRaw)
  }

  const onSave = async (): Promise<void> => {
    try {
      if (scope === 'system') {
        const ok = await ELEVATION.request({
          detail: t('elev.cron.detail'),
          command: t('elev.cron.cmdHeader')
        })
        if (!ok) return
      }
      await writeHeader(scope, text)
      setOpen(false)
    } catch (err) {
      cronErrorToast(err, t)
    }
  }

  return (
    <div id="cronHeaderPanel" style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px' }}>
        <i className="fa-solid fa-file-code" style={{ fontSize: 11, color: 'var(--accent2)' }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>{t('cron.header.title')}</span>
        <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>
          {data.headerRaw.trim() !== '' ? t('cron.header.hasContent') : t('cron.header.empty')}
        </span>
        <div style={{ flex: 1 }} />
        <button className="d-btn" type="button" style={{ padding: '3px 10px', fontSize: 10.5 }} onClick={() => (open ? setOpen(false) : openPanel())}>
          <i className={open ? 'fa-solid fa-xmark' : 'fa-solid fa-pen'} />
          <span>{open ? t('common.cancel') : t('cron.header.edit')}</span>
        </button>
      </div>
      {open && (
        <div style={{ padding: '0 14px 10px' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button
              className={`cron-preset-chip${scope === 'user' ? ' active' : ''}`}
              type="button"
              id="cronHeaderScopeUser"
              onClick={() => switchScope('user')}
            >
              {t('cron.header.scopeUser')}
            </button>
            <button
              className={`cron-preset-chip${scope === 'system' ? ' active' : ''}`}
              type="button"
              id="cronHeaderScopeSystem"
              onClick={() => switchScope('system')}
            >
              {t('cron.header.scopeSystem')}
            </button>
            {!headers[scope].exists && (
              <span style={{ fontSize: 10, color: 'var(--dim)', alignSelf: 'center' }}>{t('cron.header.notExists')}</span>
            )}
          </div>
          <textarea
            id="cronHeaderTextarea"
            className="f-input mono"
            style={{ width: '100%', minHeight: 72, fontSize: 11, lineHeight: 1.6, resize: 'vertical' }}
            value={text}
            placeholder={'SHELL=/bin/zsh\nPATH=/usr/bin:/bin'}
            onChange={(e) => setText(e.target.value)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--dim)', flex: 1, minWidth: 0 }}>{t('cron.header.hint')}</span>
            <button
              className="d-btn accent"
              type="button"
              id="cronHeaderSave"
              // 系统级 /etc/crontab 不存在时写入必失败(SIP 禁止新建);用户级 crontab - 会建表,不受此限
              disabled={scope === 'system' && !data.exists}
              onClick={() => void onSave()}
            >
              <i className="fa-solid fa-check" /> <span>{t('common.save')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
