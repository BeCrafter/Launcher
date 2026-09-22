// 设置页第 7 个 tab「AI 助手」= demo #sp-ai(js/ai-config.js 的 renderAiSettings)
//
// 与 demo 的差别只有一处、且是刻意的:demo 把 config(含明文 apiKey)整份存 localStorage,
// 这里 Key 走 main 的 safeStorage(setKey),进得来出不去 —— 所以输入框**永远是空的**
// (placeholder 提示已配置),「已配置密钥」的判定来自 main 返回的 hasKey。
import { useEffect, useState } from 'react'
import type { AiProviderId, AiProvidersConfig } from '@shared/settings'
import { useT, useFmt } from '../../hooks/useT'
import { useSettingsStore } from '../../state/settings-store'
import { dataSource } from '../../data'
import { showToast } from '../../lib/utils'
import { SettingsSection, SettingsRow, SettingsHero } from './SettingsBits'
import { Toggle } from '../../components/ui/Toggle'

/** 协议卡的展示元数据(名称/描述走 i18n;图标纯展示,与 demo 的 aiProviders 一致) */
const PROVIDER_META: { id: AiProviderId; icon: string }[] = [
  { id: 'anthropic', icon: 'fa-solid fa-clone' },
  { id: 'openai-compatible', icon: 'fa-solid fa-code' }
]

const TOOL_ROUNDS = [4, 8, 16]
const TIMEOUTS = [30, 60, 120]

export function AiPane(): React.JSX.Element {
  const t = useT()
  const fmt = useFmt()
  const settings = useSettingsStore((s) => s.settings)
  const set = useSettingsStore((s) => s.set)
  // 已存 Key 的协议集合(Key 本体不出 main,只回布尔)
  const [hasKey, setHasKey] = useState<Record<string, boolean>>({})
  const [keyDraft, setKeyDraft] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null)
  const [catalog, setCatalog] = useState<{ id: string; name: string }[]>([])

  const providerId = settings?.aiProviderId ?? 'anthropic'
  const providers = settings?.aiProviders ?? ({} as AiProvidersConfig)
  const pc = providers[providerId] ?? { baseUrl: '' }

  useEffect(() => {
    void dataSource()
      .ai.getState()
      .then((st) => setHasKey({ [st.providerId]: st.hasKey }))
      .catch(() => {})
  }, [])

  // 模型快捷填入:内置目录的协议给目录;无目录的给「上次用过」(零虚构)
  useEffect(() => {
    let alive = true
    void dataSource()
      .ai.catalog(providerId)
      .then((list) => alive && setCatalog(list))
      .catch(() => alive && setCatalog([]))
    return () => {
      alive = false
    }
  }, [providerId])

  if (!settings) return <div className="settings-pane active" id="sp-ai" />

  const patchProvider = (patch: Partial<{ baseUrl: string }>): void => {
    set({
      aiProviders: { ...providers, [providerId]: { ...pc, ...patch } }
    })
  }

  const pickProvider = (id: AiProviderId): void => {
    if (id === providerId) return
    // 切走时把当前协议用过的模型名记下,供下次切回时做「上次用过」快捷填入
    const next = { ...providers, [providerId]: { ...pc, lastModel: settings.aiModelId } }
    set({ aiProviderId: id, aiProviders: next })
    setKeyDraft('')
    setTestResult(null)
    showToast(fmt(t('toast.aiProviderSwitched'), { N: t(`settings.ai.prov.${id}.name`) }), '#a78bfa', 'fa-microchip')
    // 有内置目录的协议要校正到目录内的模型;无目录的端点连到哪家未知,模型名原样保留
    void dataSource()
      .ai.catalog(id)
      .then((list) => {
        if (list.length === 0) return
        const cur = useSettingsStore.getState().settings?.aiModelId ?? ''
        if (!list.some((m) => m.id === cur)) set({ aiModelId: list[0].id })
      })
      .catch(() => {})
  }

  const saveKey = async (): Promise<void> => {
    const v = keyDraft.trim()
    if (v === '') return
    try {
      const st = await dataSource().ai.setKey(providerId, v)
      setHasKey((m) => ({ ...m, [st.providerId]: st.hasKey }))
      setKeyDraft('')
      setTestResult(null)
      showToast(t('toast.prefsSaved'), '#4ade80', 'fa-key')
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('settings.ai.saveFailed'), '#ef8080', 'fa-triangle-exclamation')
    }
  }

  const clearKey = async (): Promise<void> => {
    const st = await dataSource().ai.clearKey(providerId)
    setHasKey((m) => ({ ...m, [st.providerId]: st.hasKey }))
    setTestResult(null)
    showToast(t('toast.prefsSaved'), '#4ade80', 'fa-key')
  }

  const testConnection = async (): Promise<void> => {
    if (testing) return
    if (!hasKey[providerId]) {
      showToast(t('settings.ai.test.noKey'), '#ef8080', 'fa-triangle-exclamation')
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const r = await dataSource().ai.testConnection(providerId)
      setTestResult(r.ok ? 'ok' : 'fail')
      showToast(
        t(r.ok ? 'settings.ai.test.ok' : 'settings.ai.test.fail'),
        r.ok ? '#4ade80' : '#ef8080',
        r.ok ? 'fa-circle-check' : 'fa-circle-xmark'
      )
    } catch {
      setTestResult('fail')
      showToast(t('settings.ai.test.fail'), '#ef8080', 'fa-circle-xmark')
    } finally {
      setTesting(false)
    }
  }

  const picks =
    catalog.length > 0
      ? catalog.map((m) => ({ id: m.id, label: m.name }))
      : pc.lastModel && pc.lastModel !== settings.aiModelId
        ? [{ id: pc.lastModel, label: t('settings.ai.model.lastUsed') }]
        : []

  const statusHtml = testing ? (
    <span className="ai-cfg-test-st run">
      <i className="fa-solid fa-circle-notch ai-spin" />
      {t('settings.ai.test.testing')}
    </span>
  ) : testResult === 'ok' ? (
    <span className="ai-cfg-test-st ok">
      <i className="fa-solid fa-circle-check" />
      {t('settings.ai.test.ok')}
    </span>
  ) : testResult === 'fail' ? (
    <span className="ai-cfg-test-st fail">
      <i className="fa-solid fa-circle-xmark" />
      {t('settings.ai.test.fail')}
    </span>
  ) : null

  return (
    <div className="settings-pane active" id="sp-ai">
      <SettingsHero title={t('settings.ai.title')} subtitle={t('settings.ai.subtitle')} />

      <SettingsSection
        icon="fa-solid fa-microchip"
        title={t('settings.ai.provSectionTitle')}
        desc={t('settings.ai.provSectionDesc')}
      >
        <div className="ai-prov-grid">
          {PROVIDER_META.map((p) => {
            const on = p.id === providerId
            const configured = !!hasKey[p.id]
            return (
              <div
                key={p.id}
                className={`ai-prov-card${on ? ' selected' : ''}`}
                onClick={() => pickProvider(p.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') pickProvider(p.id)
                }}
              >
                <div className="ai-prov-card-hd">
                  <i className={`${p.icon} ai-prov-card-icon`} />
                  <span className="ai-prov-card-name">{t(`settings.ai.prov.${p.id}.name`)}</span>
                  <i className="fa-solid fa-circle-check ai-prov-check" />
                </div>
                <div className="ai-prov-card-sub">{t(`settings.ai.prov.${p.id}.desc`)}</div>
                <div className="ai-prov-card-foot">
                  <span className={`ai-prov-key${configured ? ' ok' : ''}`}>
                    <i className="fa-solid fa-key" />
                    {t(configured ? 'settings.ai.provKeySet' : 'settings.ai.provKeyEmpty')}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        <SettingsRow
          title={t('settings.ai.baseUrl.rowTitle')}
          desc={t('settings.ai.baseUrl.rowDesc')}
          control={
            <input
              className="f-input mono ai-cfg-input"
              type="text"
              value={pc.baseUrl}
              onChange={(e) => patchProvider({ baseUrl: e.target.value })}
            />
          }
        />

        <SettingsRow
          title={t('settings.ai.apiKey.rowTitle')}
          desc={t('settings.ai.apiKey.rowDesc')}
          control={
            <div className="ai-cfg-key-wrap">
              <input
                className="f-input mono ai-cfg-input"
                type="password"
                autoComplete="off"
                value={keyDraft}
                placeholder={t('settings.ai.apiKey.ph')}
                onChange={(e) => setKeyDraft(e.target.value)}
                onBlur={() => void saveKey()}
              />
              <button className="d-btn" type="button" onClick={() => void testConnection()}>
                <i className="fa-solid fa-plug-circle-check" />
                <span>{t('settings.ai.test.btn')}</span>
              </button>
              {hasKey[providerId] && (
                <button className="d-btn" type="button" onClick={() => void clearKey()}>
                  <i className="fa-solid fa-trash-can" />
                  <span>{t('settings.ai.apiKey.clear')}</span>
                </button>
              )}
            </div>
          }
        />

        {statusHtml && (
          <div className="settings-row">
            <div className="ai-cfg-test-st-wrap">{statusHtml}</div>
            <button className="d-btn" type="button" onClick={() => void testConnection()}>
              <i className="fa-solid fa-arrows-rotate" />
              <span>{t('settings.ai.test.retry')}</span>
            </button>
          </div>
        )}

        <div className="settings-row ai-model-row">
          <div>
            <div className="settings-row-title">{t('settings.ai.model.rowTitle')}</div>
            <div className="settings-row-desc">
              {t(catalog.length > 0 ? 'settings.ai.model.rowDesc' : 'settings.ai.model.rowDescCustom')}
            </div>
          </div>
          <div className="ai-model-pick">
            <input
              className="f-input mono ai-cfg-input"
              type="text"
              value={settings.aiModelId}
              placeholder={t('settings.ai.model.ph')}
              onChange={(e) => set({ aiModelId: e.target.value })}
            />
            {picks.length > 0 && (
              <div className="ai-model-picks">
                {picks.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`ai-model-chip${m.id === settings.aiModelId ? ' active' : ''}`}
                    title={m.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => set({ aiModelId: m.id })}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        icon="fa-solid fa-sliders"
        title={t('settings.ai.behaviorSectionTitle')}
        desc={t('settings.ai.behaviorSectionDesc')}
      >
        <SettingsRow
          title={t('settings.ai.toolRounds.rowTitle')}
          desc={t('settings.ai.toolRounds.rowDesc')}
          control={
            <select
              className="settings-select"
              value={settings.aiToolCallLimit}
              onChange={(e) => set({ aiToolCallLimit: Number(e.target.value) })}
            >
              {TOOL_ROUNDS.map((n) => (
                <option key={n} value={n}>
                  {fmt(t('settings.ai.toolRounds.unit'), { N: n })}
                </option>
              ))}
            </select>
          }
        />

        <SettingsRow
          title={t('settings.ai.stream.rowTitle')}
          desc={t('settings.ai.stream.rowDesc')}
          control={<Toggle checked={settings.aiStream} onChange={(v) => set({ aiStream: v })} />}
        />

        <SettingsRow
          title={t('settings.ai.timeout.rowTitle')}
          desc={t('settings.ai.timeout.rowDesc')}
          control={
            <select
              className="settings-select"
              value={settings.aiRequestTimeout}
              onChange={(e) => set({ aiRequestTimeout: Number(e.target.value) })}
            >
              {TIMEOUTS.map((n) => (
                <option key={n} value={n}>
                  {fmt(t('settings.ai.timeout.unit'), { N: n })}
                </option>
              ))}
            </select>
          }
        />

        <div className="settings-footer ai-cfg-footer">
          <span className="ai-cfg-footer-hint">
            <i className="fa-solid fa-key" />
            {t('settings.ai.footerHint')}
          </span>
          <button
            className="d-btn"
            type="button"
            onClick={() => {
              // AI 配置的「恢复默认」= 复位这几项设置 + 清掉两个协议已存的 Key
              set({
                aiProviderId: 'anthropic',
                aiModelId: 'claude-opus-5',
                aiProviders: {
                  anthropic: { baseUrl: 'https://api.anthropic.com' },
                  'openai-compatible': { baseUrl: 'https://api.openai.com/v1' }
                },
                aiToolCallLimit: 8,
                aiStream: true,
                aiRequestTimeout: 60,
                mcpPermission: 'readOnly'
              })
              void Promise.all([
                dataSource().ai.clearKey('anthropic'),
                dataSource().ai.clearKey('openai-compatible')
              ]).then(() => {
                setHasKey({ anthropic: false, 'openai-compatible': false })
                setTestResult(null)
                setKeyDraft('')
                showToast(t('settings.ai.resetDone'), '#4ade80', 'fa-rotate-left')
              })
            }}
          >
            <i className="fa-solid fa-rotate-left" />
            <span>{t('settings.ai.resetBtn')}</span>
          </button>
        </div>
      </SettingsSection>
    </div>
  )
}
