// ported-from: docs/demo/index.html #view-settings + settings.js @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 设置页(demo #view-settings + settings.js;六 pane + tab 导航 + 页脚)
// 各开关接线状态见 docs/design/demo-react-migration-map.md「设置项接线表」
import { useState } from 'react'
import { UPGRADE_COMMAND, type InstallChannel } from '@shared/ipc'
import { useT, useFmt } from '../../hooks/useT'
import { useAppInfo } from '../../hooks/useAppInfo'
import { useSettingsStore } from '../../state/settings-store'
import { showToast } from '../../lib/utils'
import { openExternal } from '../../lib/utils'
import { SettingsSection, SettingsRow, SettingsHero } from './SettingsBits'
import { ThemeCards } from './ThemeCards'
import { AiPane } from './AiPane'
import { useSettingsNav } from '../../state/settings-nav-store'
import { Toggle } from '../../components/ui/Toggle'
import { MOCK_DATA } from '../../data/mock/mock-data'

// macOS 系统设置「登录项」面板(main 侧 url-guard 白名单放行)
const MACOS_LOGIN_ITEMS_URL = 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension'

/** 每通道一条升级文案(文案里带 {CMD},命令本身来自 main 的 UPGRADE_COMMAND) */
const UPGRADE_TOAST_KEY: Record<InstallChannel, string> = {
  brew: 'toast.update.available.brew',
  npm: 'toast.update.available.npm',
  manual: 'toast.update.available.manual'
}

const TABS = [
  { id: 'general', icon: 'fa-solid fa-sliders', labelKey: 'settings.tab.general' },
  { id: 'launchd', icon: 'fa-solid fa-rocket', labelKey: 'settings.tab.launchd' },
  { id: 'editor', icon: 'fa-solid fa-code', labelKey: 'settings.tab.editor' },
  { id: 'security', icon: 'fa-solid fa-shield-halved', labelKey: 'settings.tab.security' },
  { id: 'about', icon: 'fa-solid fa-circle-info', labelKey: 'settings.tab.about' },
  // AI 助手排在登录项之前(用户要求;登录项是低频只读说明页)
  { id: 'ai', icon: 'fa-solid fa-wand-magic-sparkles', labelKey: 'settings.tab.ai' },
  { id: 'login', icon: 'fa-solid fa-right-to-bracket', labelKey: 'settings.tab.login' }
] as const

type TabId = (typeof TABS)[number]['id']

export function SettingsView(): React.JSX.Element {
  const t = useT()
  const fmt = useFmt()
  const info = useAppInfo()
  // tab 提到共享 store:AI 页的引擎 chip / 引导卡要能直接跳到 AI 面板
  const tab = useSettingsNav((s) => s.tab)
  const setTab = useSettingsNav((s) => s.setTab)
  const [checking, setChecking] = useState(false)
  const settings = useSettingsStore((s) => s.settings)
  const set = useSettingsStore((s) => s.set)

  if (!settings) return <div className="settings-layout" />

  const savedToast = (): void => showToast(t('toast.prefsSaved'), '#4ade80', 'fa-check')

  // 检查更新:main 读 cdn 上的版本清单(与三条安装通道同源;四态见 services/update-check.ts)
  const checkAppUpdates = async (): Promise<void> => {
    if (checking) return
    setChecking(true)
    showToast(t('toast.updating'), '#60a5fa', 'fa-arrows-rotate')
    try {
      const r = await window.launcher.checkForUpdate()
      if (r.status === 'upToDate') {
        showToast(fmt(t('toast.update.upToDate'), { V: r.currentVersion }), '#4ade80', 'fa-circle-check')
      } else if (r.status === 'available') {
        // 按安装来源给对应的升级命令 —— 此前所有人看到的都是「请前往 GitHub 下载」,
        // 而 brew/npx 装的用户照做只会装出第二份应用。
        // 通道取结果里的 installChannel(权威值),不要从 upgradeCommand 反推
        showToast(
          fmt(t(UPGRADE_TOAST_KEY[r.installChannel]), { V: r.latest?.version ?? '', CMD: r.upgradeCommand }),
          '#a78bfa',
          'fa-arrow-up'
        )
      } else if (r.status === 'noRelease') {
        showToast(t('toast.update.noRelease'), '#8888aa', 'fa-circle-info')
      } else {
        showToast(
          r.errorMessage ? fmt(t('toast.update.errorWhy'), { W: r.errorMessage }) : t('toast.update.error'),
          '#f87171',
          'fa-circle-exclamation'
        )
      }
    } catch (err) {
      console.error('[settings] checkForUpdate failed:', err)
      showToast(t('toast.update.error'), '#f87171', 'fa-circle-exclamation')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="settings-layout">
      <div className="settings-tab-nav">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            className={`set-nav-btn${tab === tb.id ? ' active' : ''}`}
            onClick={() => setTab(tb.id)}
          >
            <i className={tb.icon} />
            <span>{t(tb.labelKey)}</span>
          </button>
        ))}
      </div>

      <div className="settings-content-wrap">
        <div className="settings-inner">
          {tab === 'general' && (
            <div className="settings-pane active" id="sp-general">
              <SettingsHero title={t('settings.general.title')} subtitle={t('settings.general.subtitle')} />
              <SettingsSection
                icon="fa-solid fa-palette"
                title={t('settings.general.themeSectionTitle')}
                desc={t('settings.general.themeSectionDesc')}
              >
                <div className="settings-body">
                  <ThemeCards />
                </div>
              </SettingsSection>
              <SettingsSection
                icon="fa-solid fa-language"
                title={t('settings.general.langSectionTitle')}
                desc={t('settings.general.langSectionDesc')}
              >
                <SettingsRow
                  title={t('settings.general.lang.rowTitle')}
                  descKey="settings.general.lang.rowDesc"
                  control={
                    <select
                      className="settings-select"
                      id="languageSelect"
                      value={settings.language}
                      onChange={(e) => {
                        set({ language: e.target.value as typeof settings.language })
                        showToast(t('toast.languageUpdated'), '#60a5fa', 'fa-language')
                      }}
                    >
                      <option value="zh-CN">{t('settings.general.lang.zhCN')}</option>
                      <option value="en-US">English (US)</option>
                    </select>
                  }
                />
              </SettingsSection>
              <SettingsSection
                icon="fa-solid fa-desktop"
                title={t('settings.general.desktopSectionTitle')}
                desc={t('settings.general.desktopSectionDesc')}
              >
                <SettingsRow
                  title={t('settings.general.autoLaunch.rowTitle')}
                  descKey="settings.general.autoLaunch.rowDesc"
                  control={
                    <Toggle
                      checked={settings.launchAtLogin}
                      onChange={(v) => {
                        set({ launchAtLogin: v })
                        savedToast()
                      }}
                    />
                  }
                />
                <SettingsRow
                  title={t('settings.general.menubarResident.rowTitle')}
                  descKey="settings.general.menubarResident.rowDesc"
                  control={
                    <Toggle
                      checked={settings.menubarOnly}
                      onChange={(v) => {
                        set({ menubarOnly: v })
                        savedToast()
                      }}
                    />
                  }
                />
                <SettingsRow
                  title={t('settings.general.trayIcon.rowTitle')}
                  descKey="settings.general.trayIcon.rowDesc"
                  control={
                    <Toggle
                      checked={settings.trayVisible}
                      onChange={(v) => {
                        set({ trayVisible: v })
                        savedToast()
                      }}
                    />
                  }
                />
                <SettingsRow
                  title={t('settings.general.dockIcon.rowTitle')}
                  descKey="settings.general.dockIcon.rowDesc"
                  control={
                    <Toggle
                      checked={settings.dockVisible}
                      onChange={(v) => {
                        set({ dockVisible: v })
                        savedToast()
                      }}
                    />
                  }
                />
                <SettingsRow
                  title={t('settings.general.menubarBadge.rowTitle')}
                  descKey="settings.general.menubarBadge.rowDesc"
                  control={
                    <Toggle
                      checked={settings.menubarBadge}
                      onChange={(v) => {
                        set({ menubarBadge: v })
                        savedToast()
                      }}
                    />
                  }
                />
              </SettingsSection>
            </div>
          )}

          {tab === 'launchd' && (
            <div className="settings-pane active" id="sp-launchd">
              <SettingsHero title={t('settings.launchd.title')} subtitle={t('settings.launchd.subtitle')} />
              <SettingsSection
                icon="fa-solid fa-gear"
                title={t('settings.launchd.fseventsSectionTitle')}
                desc={t('settings.launchd.fseventsSectionDesc')}
              >
                <SettingsRow
                  title={t('settings.launchd.fseventsActive.rowTitle')}
                  descKey="settings.launchd.fseventsActive.rowDesc"
                  control={
                    <Toggle
                      checked={settings.fseventsActive}
                      onChange={(v) => {
                        set({ fseventsActive: v })
                        savedToast()
                      }}
                    />
                  }
                />
              </SettingsSection>
              <SettingsSection
                icon="fa-solid fa-bolt"
                title={t('settings.launchd.execSectionTitle')}
                desc={t('settings.launchd.execSectionDesc')}
              >
                <SettingsRow
                  title={t('settings.launchd.cmdTimeout.rowTitle')}
                  descKey="settings.launchd.cmdTimeout.rowDesc"
                  control={
                    <select
                      className="settings-select"
                      value={String(settings.cmdTimeout)}
                      onChange={(e) => {
                        set({ cmdTimeout: Number(e.target.value) })
                        savedToast()
                      }}
                    >
                      <option value="3000">{t('settings.launchd.cmdTimeout.3s')}</option>
                      <option value="5000">{t('settings.launchd.cmdTimeout.5s')}</option>
                      <option value="10000">{t('settings.launchd.cmdTimeout.10s')}</option>
                    </select>
                  }
                />
                <SettingsRow
                  title={t('settings.launchd.cronLogRetain.rowTitle')}
                  descKey="settings.launchd.cronLogRetain.rowDesc"
                  control={
                    <select
                      className="settings-select"
                      value={String(settings.cronLogRetainDays)}
                      onChange={(e) => {
                        set({ cronLogRetainDays: Number(e.target.value) })
                        savedToast()
                      }}
                    >
                      <option value="1">{t('settings.launchd.cronLogRetain.1d')}</option>
                      <option value="3">{t('settings.launchd.cronLogRetain.3d')}</option>
                      <option value="7">{t('settings.launchd.cronLogRetain.7d')}</option>
                      <option value="14">{t('settings.launchd.cronLogRetain.14d')}</option>
                    </select>
                  }
                />
              </SettingsSection>
            </div>
          )}

          {tab === 'editor' && (
            <div className="settings-pane active" id="sp-editor">
              <SettingsHero title={t('settings.editor.title')} subtitle={t('settings.editor.subtitle')} />
              <SettingsSection
                icon="fa-solid fa-code"
                title={t('settings.editor.sectionTitle')}
                desc={t('settings.editor.sectionDesc')}
              >
                <SettingsRow
                  title={t('settings.editor.labelPrefix.rowTitle')}
                  descKey="settings.editor.labelPrefix.rowDesc"
                  control={
                    <input
                      className="f-input mono"
                      type="text"
                      value={settings.labelPrefix}
                      style={{ maxWidth: 180, fontSize: 11 }}
                      onChange={(e) => set({ labelPrefix: e.target.value })}
                    />
                  }
                />
                <SettingsRow
                  title={t('settings.editor.xmlIndent.rowTitle')}
                  descKey="settings.editor.xmlIndent.rowDesc"
                  control={
                    <select
                      className="settings-select"
                      value={settings.xmlIndent}
                      onChange={(e) => {
                        set({ xmlIndent: e.target.value as typeof settings.xmlIndent })
                        savedToast()
                      }}
                    >
                      <option value="2">{t('settings.editor.xmlIndent.2spaces')}</option>
                      <option value="4">{t('settings.editor.xmlIndent.4spaces')}</option>
                      <option value="tab">{t('settings.editor.xmlIndent.tab')}</option>
                    </select>
                  }
                />
              </SettingsSection>
            </div>
          )}

          {tab === 'security' && (
            <div className="settings-pane active" id="sp-security">
              <SettingsHero title={t('settings.security.title')} subtitle={t('settings.security.subtitle')} />
              <SettingsSection
                icon="fa-solid fa-shield-halved"
                title={t('settings.security.sectionTitle')}
                desc={t('settings.security.sectionDesc')}
              >
                <SettingsRow
                  title={t('settings.security.authCache.rowTitle')}
                  descKey="settings.security.authCache.rowDesc"
                  control={
                    <select
                      className="settings-select"
                      value={String(settings.authCacheMin)}
                      onChange={(e) => {
                        set({ authCacheMin: Number(e.target.value) })
                        savedToast()
                      }}
                    >
                      <option value="0">{t('settings.security.authCache.always')}</option>
                      <option value="5">{t('settings.security.authCache.5min')}</option>
                      <option value="15">{t('settings.security.authCache.15min')}</option>
                    </select>
                  }
                />
                <SettingsRow
                  title={t('settings.security.confirmDangerous.rowTitle')}
                  descKey="settings.security.confirmDangerous.rowDesc"
                  control={
                    <Toggle
                      checked={settings.confirmDangerous}
                      onChange={(v) => {
                        set({ confirmDangerous: v })
                        savedToast()
                      }}
                    />
                  }
                />
              </SettingsSection>
            </div>
          )}

          {tab === 'about' && (
            <div className="settings-pane active" id="sp-about">
              <SettingsHero title={t('settings.about.title')} subtitle={t('settings.about.subtitle')} />
              <SettingsSection
                icon="fa-solid fa-circle-info"
                title={t('settings.about.sectionTitle')}
                desc={t('settings.about.sectionDesc')}
              >
                <SettingsRow
                  title={t('settings.about.version.rowTitle')}
                  desc={info ? `Launcher v${info.version}` : ''}
                  control={
                    <button className="d-btn blue" type="button" disabled={checking} onClick={() => void checkAppUpdates()}>
                      <i className="fa-solid fa-arrows-rotate" />
                      <span>{t('settings.about.btn.checkUpdates')}</span>
                    </button>
                  }
                />
                <SettingsRow
                  title={t('settings.about.installChannel.rowTitle')}
                  descKey="settings.about.installChannel.rowDesc"
                  control={
                    <span className="tag" title={UPGRADE_COMMAND[info?.installChannel ?? 'manual']}>
                      {t(`settings.about.installChannel.${info?.installChannel ?? 'manual'}`)}
                    </span>
                  }
                />
                <SettingsRow
                  title={t('settings.about.arch.rowTitle')}
                  descKey="settings.about.arch.rowDesc"
                  control={<span className="tag purple">macOS 13.0+</span>}
                />
                <SettingsRow
                  title={t('settings.about.license.rowTitle')}
                  descKey="settings.about.license.rowDesc"
                  control={
                    <button
                      className="d-btn"
                      type="button"
                      title={t('settings.about.openRepo')}
                      onClick={() => openExternal(MOCK_DATA.urls.github)}
                    >
                      <i className="fa-brands fa-github" />
                      GitHub
                    </button>
                  }
                />
              </SettingsSection>
            </div>
          )}

          {tab === 'login' && (
            <div className="settings-pane active" id="sp-login">
              <SettingsHero title={t('settings.login.title')} subtitle={t('settings.login.subtitle')} />
              <SettingsSection
                icon="fa-solid fa-right-to-bracket"
                title={t('settings.login.sectionTitle')}
                desc={t('settings.login.sectionDesc')}
              >
                <div
                  style={{
                    background: 'rgba(96,165,250,0.06)',
                    border: '1px solid rgba(96,165,250,0.2)',
                    borderRadius: 10,
                    padding: '14px 16px',
                    margin: '6px 0 12px'
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--blue)', marginBottom: 6 }}>
                    <i className="fa-solid fa-circle-info" style={{ marginRight: 6 }} />
                    <span>{t('settings.login.coreDiff')}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ display: 'flex', gap: 10, fontSize: 11.5 }}>
                      <span style={{ color: 'var(--green)', fontWeight: 700, minWidth: 76 }}>LaunchAgent</span>
                      <span style={{ color: 'var(--muted)' }}>{t('settings.login.launchagentDesc')}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, fontSize: 11.5 }}>
                      <span style={{ color: 'var(--blue)', fontWeight: 700, minWidth: 76 }}>{t('settings.login.itemLabel')}</span>
                      <span style={{ color: 'var(--muted)' }}>{t('settings.login.loginitemDesc')}</span>
                    </div>
                  </div>
                </div>
                <SettingsRow
                  title={t('settings.login.openSettings.rowTitle')}
                  descKey="settings.login.openSettings.rowDesc"
                  control={
                    <button
                      className="d-btn accent"
                      type="button"
                      onClick={() => {
                        showToast(t('toast.openSysSettings'), '#60a5fa', 'fa-arrow-up-right-from-square')
                        openExternal(MACOS_LOGIN_ITEMS_URL)
                      }}
                    >
                      <i className="fa-solid fa-arrow-up-right-from-square" />
                      <span>{t('settings.login.btn.openSettings')}</span>
                    </button>
                  }
                />
              </SettingsSection>
            </div>
          )}

          {tab === 'ai' && <AiPane />}

          <div className="settings-footer">
            <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>
              <i className="fa-solid fa-circle-check" style={{ color: 'var(--green)', marginRight: 5 }} />
              <span>{t('settings.footer.hint')}</span>
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>
              {info ? `Launcher v${info.version}` : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
