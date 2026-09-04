// ════════════ 模块注册表（单一事实来源）════════
// 每个模块的所有接线信息集中在这条记录里：视图/面包屑/顶栏操作区/搜索行为/底部状态栏。
// 新增模块：在此加一条记录 + index.html 加 nav-item 与 #view-* div，其余全部自动生效。
// 注意：配置为运行时求值（t()/数据计算），加载时刻不执行任何函数。
const MODULES = {

  agents: {
    viewId: 'view-agents',
    icon: 'fa-rocket',
    breadcrumb: 'Launch Agents',
    searchPlaceholderKey: 'topbar.phAgents',
    searchHandler: (v) => handleSearch(v),
    actions: () => `
              <div class="search-wrap">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" placeholder="${t('topbar.searchAgents')}" id="globalSearch" oninput="handleModuleSearch(this.value)" />
              </div>
              <button class="topbar-btn" onclick="showImportModal()"><i class="fa-solid fa-file-import"></i><span>${t('topbar.importConfig')}</span></button>
              <button class="topbar-btn accent" onclick="showNewModal()"><i class="fa-solid fa-plus"></i><span>${t('topbar.newTask')}</span></button>
            `,
    showStatusBar: true,
    statusbar: (d = {}) => ({
      summaryIcon: 'fa-layer-group',
      summary: fmt(t('statusbar.agentsSummary'), { N: d.total ?? agentData.length }),
      items: [
        `<span class="launch-status-dot running"></span><span>${fmt(t('statusbar.agentsRunning'), { N: d.running ?? 3 })}</span>`,
        `<span class="launch-status-dot loaded"></span><span>${fmt(t('statusbar.agentsLoaded'), { N: d.loaded ?? 1 })}</span>`,
        `<span class="launch-status-dot unloaded"></span><span>${fmt(t('statusbar.agentsUnloaded'), { N: d.unloaded ?? 2 })}</span>`
      ],
      pathIcon: 'fa-solid fa-folder',
      path: '~/Library/LaunchAgents',
      monitor: t('statusbar.watching')
    })
  },

  crontab: {
    viewId: 'view-crontab',
    icon: 'fa-clock',
    breadcrumbKey: 'module.crontab',
    searchPlaceholderKey: 'topbar.phCron',
    searchHandler: (v) => renderCron(activeCronFilter, v),
    actions: () => `
              <div class="search-wrap">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" placeholder="${t('topbar.searchCron')}" id="globalSearch" oninput="handleModuleSearch(this.value)" />
              </div>
              <button class="topbar-btn" onclick="renderCron(); showToast(t('toast.crontabReloaded'), '#4ade80', 'fa-arrows-rotate')"><i class="fa-solid fa-arrows-rotate"></i><span>${t('topbar.refresh')}</span></button>
              <button class="topbar-btn accent" onclick="showNewCronModal()"><i class="fa-solid fa-plus"></i><span>${t('topbar.newCron')}</span></button>
            `,
    showStatusBar: true,
    statusbar: (d = {}) => ({
      summaryIcon: 'fa-clock',
      summary: fmt(t('statusbar.cronSummary'), { N: cronData.length }),
      items: [
        `<span class="launch-status-dot running"></span><span>${fmt(t('statusbar.cronEnabled'), { N: cronData.filter(j => j.enabled).length })}</span>`,
        `<span class="launch-status-dot loaded"></span><span>${fmt(t('statusbar.cronUser'), { N: cronData.filter(j => !j.system).length })}</span>`,
        `<span class="launch-status-dot unloaded"></span><span>${fmt(t('statusbar.cronSystem'), { N: cronData.filter(j => j.system).length })}</span>`
      ],
      pathIcon: 'fa-solid fa-terminal',
      path: 'crontab -l / /etc/crontab',
      monitor: t('statusbar.schedulerReady')
    })
  },

  services: {
    viewId: 'view-services',
    icon: 'fa-network-wired',
    breadcrumbKey: 'module.services',
    searchPlaceholderKey: 'topbar.phServices',
    searchHandler: (v) => showToast(t('toast.filteringServices'), '#22d3ee', 'fa-magnifying-glass'),
    actions: () => `
              <div class="search-wrap">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" placeholder="${t('topbar.searchServices')}" id="globalSearch" oninput="handleModuleSearch(this.value)" />
              </div>
              <button class="topbar-btn" onclick="renderServices(); showToast(t('toast.scanRefreshed'), '#4ade80', 'fa-arrows-rotate')"><i class="fa-solid fa-arrows-rotate"></i><span>${t('topbar.rescan')}</span></button>
              <button class="topbar-btn accent" onclick="showToast(t('toast.autoPollingOn'), '#22d3ee', 'fa-bolt')"><i class="fa-solid fa-bolt"></i><span>${t('topbar.watchState')}</span></button>
            `,
    showStatusBar: true,
    statusbar: (d = {}) => ({
      summaryIcon: 'fa-network-wired',
      summary: fmt(t('statusbar.svcSummary'), { N: svcData.length }),
      items: [
        `<span class="launch-status-dot running"></span><span>${fmt(t('statusbar.svcListening'), { N: svcData.length })}</span>`,
        `<span class="launch-status-dot loaded"></span><span>${fmt(t('statusbar.svcTcp'), { N: svcData.length })}</span>`,
        `<span class="launch-status-dot unloaded"></span><span>${fmt(t('statusbar.svcAbnormal'), { N: 0 })}</span>`
      ],
      pathIcon: 'fa-solid fa-magnifying-glass',
      path: 'lsof -iTCP -sTCP:LISTEN',
      monitor: t('statusbar.scanEvery3s')
    })
  },

  ai: {
    viewId: 'view-ai',
    icon: 'fa-wand-magic-sparkles',
    breadcrumbKey: 'ai.module',
    searchPlaceholderKey: 'ai.searchPh',
    searchHandler: (v) => handleAiSearch(v),
    actions: () => `
              <div class="search-wrap">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" placeholder="${t('ai.searchPh')}" id="globalSearch" oninput="handleModuleSearch(this.value)" />
              </div>
              <button class="topbar-btn" onclick="scanAiAgents()"><i class="fa-solid fa-arrows-rotate"></i><span>${t('topbar.rescan')}</span></button>
              <button class="topbar-btn accent" onclick="showToast(t('ai.skillLibToast'),'#a78bfa','fa-wand-magic-sparkles')"><i class="fa-solid fa-wand-magic-sparkles"></i><span>${t('ai.openSkills')}</span></button>
            `,
    showStatusBar: true,
    statusbar: (d = {}) => ({
      summaryIcon: 'fa-wand-magic-sparkles',
      summary: fmt(t('ai.sb.summary'), { N: aiAgentData.filter(a => a.status === 'installed').length }),
      items: [
        `<span class="launch-status-dot running"></span><span>${fmt(t('ai.sb.installed'), { N: aiAgentData.filter(a => a.status === 'installed').length })}</span>`,
        `<span class="launch-status-dot loaded"></span><span>${fmt(t('ai.sb.skills'), { N: aiSkillData.length })}</span>`,
        `<span class="launch-status-dot unloaded"></span><span>${fmt(t('ai.sb.notfound'), { N: aiAgentData.filter(a => a.status === 'not_found').length })}</span>`
      ],
      pathIcon: 'fa-solid fa-magnifying-glass',
      path: t('ai.sb.path'),
      monitor: t('ai.sb.monitor')
    })
  },

  /* ── 无侧边栏入口的页面（映射保留，供 switchModule 直接调用）── */
  login: {
    viewId: 'view-login',
    icon: 'fa-right-to-bracket',
    breadcrumbKey: 'module.login',
    searchPlaceholderKey: 'topbar.phLogin',
    actions: () => `
              <button class="topbar-btn accent" onclick="showToast(t('toast.openSysSettings'),'#60a5fa','fa-arrow-up-right-from-square')"><i class="fa-solid fa-arrow-up-right-from-square"></i><span>${t('login.openSysSettings')}</span></button>
            `,
    showStatusBar: false
  },

  plist: {
    viewId: 'view-plist',
    icon: 'fa-code',
    breadcrumbKey: 'module.plist',
    searchPlaceholderKey: 'topbar.phPlist',
    actions: () => DEFAULT_TOP_ACTIONS(),
    showStatusBar: false
  },

  settings: {
    viewId: 'view-settings',
    icon: 'fa-sliders',
    breadcrumbKey: 'module.settings',
    actions: () => `
              <button class="topbar-btn" onclick="showToast(t('toast.autosaveNote'),'#4ade80','fa-circle-check')"><i class="fa-solid fa-circle-check"></i><span>${t('topbar.autosave')}</span></button>
              <button class="topbar-btn" onclick="resetSettings()"><i class="fa-solid fa-rotate-left"></i><span>${t('topbar.restoreDefault')}</span></button>
            `,
    showStatusBar: true,
    statusbar: (d = {}) => ({
      summaryIcon: 'fa-sliders',
      summary: `Launcher <strong>v2.0.0</strong>`,
      items: [
        `<span class="launch-status-dot running"></span><span>${t('statusbar.theme')} <strong>${themeLabel()}</strong></span>`,
        `<span class="launch-status-dot loaded"></span><span>${t('statusbar.language')} <strong>${languageLabel()}</strong></span>`,
        `<span class="launch-status-dot unloaded"></span><span>${t('statusbar.arch')} <strong>${archLabel()}</strong></span>`
      ],
      pathIcon: 'fa-brands fa-github',
      path: GITHUB_REPO_URL.replace(/^https?:\/\//, ''),
      pathHref: GITHUB_REPO_URL,
      monitor: t('statusbar.prefsAutoSave')
    })
  },

  design: {
    viewId: 'view-design',
    icon: 'fa-compass-drafting',
    breadcrumb: 'design',
    actions: () => DEFAULT_TOP_ACTIONS(),
    showStatusBar: false
  }
};

// 无搜索行为的模块共用顶栏（原 switchModule 默认分支）
const DEFAULT_TOP_ACTIONS = () => `
              <div class="search-wrap">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" placeholder="${t('topbar.search')}" id="globalSearch" />
              </div>
            `;
