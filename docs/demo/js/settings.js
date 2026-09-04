// ════════ 设置逻辑 ════════

// ════════ 设置逻辑增强 ════════
function switchSettingsSection(sectionId, btn) {
  document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.set-nav-btn').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById('sp-' + sectionId);
  if (pane) pane.classList.add('active');
  if (btn) btn.classList.add('active');
}

function setTheme(theme) {
  localStorage.setItem('launcherTheme', theme);
  document.querySelectorAll('[data-theme-card]').forEach(card => {
    card.classList.toggle('selected', card.getAttribute('data-theme-card') === theme);
  });
  if (theme === 'light') {
    document.body.classList.add('light-theme');
  } else if (theme === 'dark') {
    document.body.classList.remove('light-theme');
  } else {
    // 跟随系统模式
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      document.body.classList.remove('light-theme');
    } else {
      document.body.classList.add('light-theme');
    }
  }
  showToast(fmt(t('toast.themeSwitched'), { N: t('settings.theme.' + theme) }), '#a78bfa', 'fa-palette');
  refreshSettingsStatusBar();
}

function setLanguage(language) {
  localStorage.setItem('launcherLanguage', language);
  applyLanguage();
  showToast(t('toast.languageUpdated'), '#60a5fa', 'fa-language');
}

// 仅当设置页可见时，刷新底部状态栏中与主题 / 语言相关的展示
function refreshSettingsStatusBar() {
  const settingsView = document.getElementById('view-settings');
  if (settingsView && settingsView.style.display === 'flex') {
    updateModuleStatusBar('settings');
  }
}

function saveSetting(key, value) {
  localStorage.setItem('launcher_' + key, String(value));
  showToast(t('toast.prefsSaved'), '#4ade80', 'fa-check');
}

function checkAppUpdates() {
  showToast(t('toast.updating'), '#60a5fa', 'fa-arrows-rotate');
  setTimeout(() => {
    showToast(t('toast.upToDate'), '#4ade80', 'fa-circle-check');
  }, 800);
}

function resetSettings() {
  ['launcherTheme', 'launcherLanguage', 'launcher_autoRefresh', 'launcher_refreshInterval', 'launcher_confirmDangerous', 'launcher_showToast', 'launcher_launchAtLogin', 'launcher_menubarOnly', 'launcher_fseventsActive', 'launcher_cmdTimeout'].forEach(key => localStorage.removeItem(key));
  setTheme('system');
  const language = document.getElementById('languageSelect');
  if (language) language.value = 'zh-CN';
  setLanguage('zh-CN');
  document.querySelectorAll('#view-settings input[type="checkbox"]').forEach(input => input.checked = true);
  showToast(t('toast.settingsReset'), '#4ade80', 'fa-rotate-left');
}

function loadSettings() {
  const theme = localStorage.getItem('launcherTheme') || 'system';
  document.querySelectorAll('[data-theme-card]').forEach(card => {
    card.classList.toggle('selected', card.getAttribute('data-theme-card') === theme);
  });
  if (theme === 'light') {
    document.body.classList.add('light-theme');
  } else if (theme === 'dark') {
    document.body.classList.remove('light-theme');
  } else {
    if (window.matchMedia && !window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.body.classList.add('light-theme');
    }
  }
  applyLanguage();
}

// 设置页页脚 / 关于页版本号（由 MOCK_DATA 驱动）
function fillSettingsMeta() {
  const footerVer = document.getElementById('settingsFooterVer');
  if (footerVer) footerVer.textContent = MOCK_DATA.meta.footerVersion;
  const aboutVer = document.getElementById('aboutVersion');
  if (aboutVer) aboutVer.textContent = MOCK_DATA.meta.versionFull;
}
