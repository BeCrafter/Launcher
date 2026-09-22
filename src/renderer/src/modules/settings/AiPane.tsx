// 设置页第 7 个 tab「AI 助手」= demo #sp-ai(js/ai-config.js 的 renderAiSettings)
//
// 与 demo 的差别集中在 Key 与模型两处:
//  · Key 走 main 的 safeStorage,进得来出不去 —— 输入框在重新加载后是空的(placeholder 说明已配置),
//    「已配置密钥」的判定来自 main 返回的 hasKey。刚粘贴/修改的值会留在框里,方便核对。
//  · 模型 id **按协议各存各的**(demo 只有一份全局配置,没有这个问题);
//    快捷填入只列「最近用过的 3 个」,不再铺整个内置目录。
import { useEffect, useState } from 'react'
import {
  RECENT_MODEL_MAX,
  type AiProviderConfig,
  type AiProviderId,
  type AiProvidersConfig
} from '@shared/settings'
import { useT, useFmt } from '../../hooks/useT'
import { useSettingsStore } from '../../state/settings-store'
import { dataSource } from '../../data'
import { showToast } from '../../lib/utils'
import { SettingsSection, SettingsRow, SettingsHero } from './SettingsBits'
import { Toggle } from '../../components/ui/Toggle'

/**
 * 请求头 ↔ 文本(每行 `名称: 值`,空行与 `#` 开头忽略)。
 * `undefined` 表示这条协议没有附加头 —— normalize 也是这么约定的(空对象不落盘)。
 */
function formatHeaders(h: Record<string, string> | undefined): string {
  return h ? Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\n') : ''
}

function parseHeaders(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (t === '' || t.startsWith('#')) continue
    const i = t.indexOf(':')
    if (i <= 0) continue
    const name = t.slice(0, i).trim()
    const value = t.slice(i + 1).trim()
    if (name !== '' && value !== '') out[name] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

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
  /** 已落盘的 Key:用来判断输入框是否真的被改过(没改就不必重写一次) */
  const [storedKey, setStoredKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null)
  /** Key 默认隐藏(眼睛按钮可临时显示) */
  const [keyVisible, setKeyVisible] = useState(false)
  /** 自定义请求头的文本形态(每行 `名称: 值`);失焦时解析写回 */
  const [headerDraft, setHeaderDraft] = useState('')

  const providerId = settings?.aiProviderId ?? 'anthropic'
  const providers = settings?.aiProviders ?? ({} as AiProvidersConfig)
  const pc = providers[providerId] ?? { baseUrl: '' }

  useEffect(() => {
    void dataSource()
      .ai.getState()
      .then((st) => setHasKey({ [st.providerId]: st.hasKey }))
      .catch(() => {})
  }, [])

  /**
   * 把该协议已存的 Key 取回来常驻显示(用户要求:配好之后要能一直看到,不能只显示「已保存」)。
   * ⚠ 只有这个面板会把它取出来;引擎态与其它视图仍然只拿 hasKey 布尔。
   */
  // ⚠ 依赖用 settings?.aiProviderId 而不是 providerId:后者在设置加载前也有个默认值,
  //   若真实协议恰好就是那个默认值,effect 不会重跑 → Key 永远取不回来
  const settingsProviderId = settings?.aiProviderId
  useEffect(() => {
    if (!settingsProviderId) return
    let alive = true
    void dataSource()
      .ai.revealKey(settingsProviderId)
      .then((k) => {
        if (!alive) return
        setKeyDraft(k)
        setStoredKey(k)
      })
      .catch(() => {})
    // 请求头跟着协议走,切协议时同步成该协议自己的那份
    setHeaderDraft(formatHeaders(settings?.aiProviders[settingsProviderId]?.headers))
    return () => {
      alive = false
    }
  }, [settingsProviderId])

  if (!settings) return <div className="settings-pane active" id="sp-ai" />

  const patchProvider = (patch: Partial<AiProviderConfig>): void => {
    set({ aiProviders: { ...providers, [providerId]: { ...pc, ...patch } } })
  }

  /** 模型编辑:输入时只落 modelId;失焦/点 chip 时才算「用过」,记进最近列表 */
  const setModelId = (id: string): void => patchProvider({ modelId: id })

  const rememberModel = (id: string): void => {
    const v = id.trim()
    if (v === '') return
    const recent = [v, ...(pc.recentModels ?? []).filter((x) => x !== v)].slice(0, RECENT_MODEL_MAX)
    set({ aiProviders: { ...providers, [providerId]: { ...pc, modelId: v, recentModels: recent } } })
  }

  const pickProvider = (id: AiProviderId): void => {
    if (id === providerId) return
    // 只切协议:端点与模型都跟着这条协议走(以前模型是全局单值,切走再切回就丢了)
    set({ aiProviderId: id })
    setKeyDraft('')
    setTestResult(null)
    showToast(fmt(t('toast.aiProviderSwitched'), { N: t(`settings.ai.prov.${id}.name`) }), '#a78bfa', 'fa-microchip')
  }

  const saveKey = async (): Promise<void> => {
    const v = keyDraft.trim()
    if (v === '' || v === storedKey) return // 没改过就不重写
    try {
      const st = await dataSource().ai.setKey(providerId, v)
      setHasKey((m) => ({ ...m, [st.providerId]: st.hasKey }))
      setStoredKey(v)
      setTestResult(null)
      // 刻意不清空:粘贴进来的 Key 要留在框里可核对(用户反馈过"看不到自己粘了什么")
      showToast(t('toast.prefsSaved'), '#4ade80', 'fa-key')
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('settings.ai.saveFailed'), '#ef8080', 'fa-triangle-exclamation')
    }
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

  // 快捷填入 = 该协议最近用过的模型(最多 3 个)。不再铺整个内置目录 ——
  // 十几个 chip 既挤爆这一行,也没人真的会去点其中第 14 个。
  const currentModel = (pc.modelId ?? '').trim()
  // 含当前模型(以 active 态呈现):这样「最近 3 个」就是真的 3 个,而不是被自己占掉一位后只剩 2 个
  const picks = (pc.recentModels ?? []).slice(0, RECENT_MODEL_MAX)

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
              {/* 眼睛钮**浮动在输入框内部**右缘(不是另起一行) */}
              <div className="ai-cfg-key-field">
                <input
                  className="f-input mono ai-cfg-input"
                  /* 默认隐藏,点眼睛查看 */
                  type={keyVisible ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={keyDraft}
                  placeholder={t('settings.ai.apiKey.ph')}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onBlur={() => void saveKey()}
                />
                <button
                  className="ai-cfg-eye"
                  type="button"
                  title={t(keyVisible ? 'settings.ai.apiKey.hide' : 'settings.ai.apiKey.show')}
                  aria-label={t(keyVisible ? 'settings.ai.apiKey.hide' : 'settings.ai.apiKey.show')}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setKeyVisible((v) => !v)}
                >
                  <i className={`fa-solid ${keyVisible ? 'fa-eye-slash' : 'fa-eye'}`} />
                </button>
              </div>
              {/* 测试连接:图标钮(带 tooltip)—— 文字版在这行里占地太大 */}
              <button
                className="d-btn ai-cfg-test-btn"
                type="button"
                title={t('settings.ai.test.btn')}
                aria-label={t('settings.ai.test.btn')}
                disabled={testing}
                onClick={() => void testConnection()}
              >
                <i className={`fa-solid ${testing ? 'fa-circle-notch ai-spin' : 'fa-plug-circle-check'}`} />
              </button>
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

        <div className="ai-model-block">
          <div className="settings-row ai-model-row">
            <div>
              <div className="settings-row-title">{t('settings.ai.model.rowTitle')}</div>
              <div className="settings-row-desc">{t('settings.ai.model.rowDescRecent')}</div>
            </div>
            <div className="ai-model-pick">
              <input
                className="f-input mono ai-cfg-input"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={pc.modelId ?? ''}
                placeholder={t('settings.ai.model.ph')}
                onChange={(e) => setModelId(e.target.value)}
                /* 失焦才算「用过」:否则边打字边记,列表里全是半截模型名 */
                onBlur={(e) => rememberModel(e.target.value)}
              />
            </div>
          </div>
          {picks.length > 0 && (
            <div className="ai-model-picks ai-model-picks-wide">
              {picks.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`ai-model-chip${id === currentModel ? ' active' : ''}`}
                  title={id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => rememberModel(id)}
                >
                  {id}
                </button>
              ))}
            </div>
          )}
        </div>

        <SettingsRow
          title={t('settings.ai.headers.rowTitle')}
          desc={t('settings.ai.headers.rowDesc')}
          control={
            <textarea
              className="f-input mono ai-cfg-input ai-cfg-headers"
              rows={2}
              spellCheck={false}
              placeholder={t('settings.ai.headers.ph')}
              value={headerDraft}
              onChange={(e) => setHeaderDraft(e.target.value)}
              onBlur={() => patchProvider({ headers: parseHeaders(headerDraft) })}
            />
          }
        />
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
                aiProviders: {
                  anthropic: { baseUrl: 'https://api.anthropic.com', modelId: 'claude-opus-5' },
                  'openai-compatible': { baseUrl: 'https://api.openai.com/v1' }
                },
                // 附加请求头属于「指向哪个网关」的一部分,恢复默认一并清掉
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
