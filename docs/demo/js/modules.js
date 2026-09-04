// ════════ 模块切换 / 侧边栏 / 响应式 ════════

// ════════ 模块切换 ════════
function syncSidebarLayout() {
  const sidebar = document.getElementById('sidebar');
  const mainContent = document.querySelector('.main-content');
  const statusBar = document.getElementById('launchStatusBar');
  if (!sidebar || !mainContent) return;
  /*
   * 直接读取右侧主内容区域的实际边界，而不是根据侧边栏宽度计算。
   * 这样可以同时兼容折叠动画、移动端布局、滚动条以及不同浏览器的布局差异。
   */
  const contentRect = mainContent.getBoundingClientRect();
  const left = Math.max(0, contentRect.left);
  const width = Math.max(0, contentRect.width);
  document.documentElement.style.setProperty('--content-left', `${left}px`);
  document.documentElement.style.setProperty('--content-width', `${width}px`);
  document.documentElement.style.setProperty('--sidebar-width', `${left}px`);
  if (statusBar) {
    statusBar.style.left = `${left}px`;
    statusBar.style.width = `${width}px`;
    statusBar.style.right = 'auto';
    statusBar.style.maxWidth = `${width}px`;
  }
}

function toggleSidebarCollapse(forceCollapsed) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || window.innerWidth <= 680) return;
  const shouldCollapse = typeof forceCollapsed === 'boolean' ?
    forceCollapsed :
    !sidebar.classList.contains('collapsed');
  // 避免连续点击造成过渡状态叠加，统一以当前目标状态为准
  sidebar.classList.toggle('is-transitioning', true);
  sidebar.classList.toggle('collapsed', shouldCollapse);
  localStorage.setItem('launcherSidebarCollapsed', String(shouldCollapse));
  // 使用 transitionend 作为最终同步节点，确保状态栏跟随实际布局完成
  syncSidebarLayout();
  requestAnimationFrame(syncSidebarLayout);
  const finishSync = (event) => {
    if (event && event.propertyName !== 'width') return;
    sidebar.classList.remove('is-transitioning');
    syncSidebarLayout();
    sidebar.removeEventListener('transitionend', finishSync);
  };
  sidebar.addEventListener('transitionend', finishSync);
  setTimeout(() => {
    sidebar.classList.remove('is-transitioning');
    syncSidebarLayout();
  }, 360);
  showToast(
    shouldCollapse ? '侧边栏已折叠' : '侧边栏已展开',
    '#a78bfa',
    shouldCollapse ? 'fa-angles-right' : 'fa-angles-left'
  );
}

function switchModule(mod, navItem) {
  currentModule = mod;
  const cfg = MODULES[mod] || MODULES.agents;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (navItem) {
    navItem.classList.add('active');
  } else {
    const matchedNav = document.querySelector(`.nav-item[onclick*="switchModule('${mod}'"]`);
    if (matchedNav) matchedNav.classList.add('active');
  }
  Object.keys(MODULES).forEach(key => {
    const el = document.getElementById(MODULES[key].viewId);
    if (el) el.style.display = key === mod ? 'flex' : 'none';
  });
  const launchStatusBar = document.getElementById('launchStatusBar');
  if (launchStatusBar) {
    // 底部状态栏属于数据模块与设置页；纯说明页（登录项/plist/设计）不展示统计，隐藏它。
    launchStatusBar.classList.toggle('hidden', !cfg.showStatusBar);
  }
  if (mod === 'settings') {
    // 设置页默认使用折叠态，给设置内容提供更宽阔的阅读空间
    toggleSidebarCollapse(true);
    updateModuleStatusBar('settings');
  }
  if (mod === 'agents') {
    // 切回 Launch Agents 时主动恢复列表渲染，避免切换设置页或折叠侧栏后内容为空
    const agentView = document.getElementById('view-agents');
    if (agentView) {
      agentView.style.display = 'flex';
      agentView.style.flexDirection = 'column';
      agentView.style.flex = '1';
      agentView.style.minHeight = '0';
      agentView.style.overflow = 'hidden';
    }
    const searchValue = document.getElementById('globalSearch')?.value || '';
    renderAgents(activeFilter || 'all', searchValue);
    updateLaunchStatusBar();
  } else if (mod === 'crontab') {
    updateModuleStatusBar('crontab');
  } else if (mod === 'services') {
    updateModuleStatusBar('services');
  } else if (mod === 'ai') {
    renderAi();
    updateModuleStatusBar('ai');
  }
  document.getElementById('topBreadcrumb').innerHTML = `<i class="fa-solid ${cfg.icon}" style="color:var(--accent2);font-size:12px;"></i><span>${cfg.breadcrumb || (cfg.breadcrumbKey ? t(cfg.breadcrumbKey) : mod)}</span>`;
  // 联动更新顶栏右侧搜索框占位符及操作按钮（模板与搜索行为见 js/config.js 模块记录）
  const searchInput = document.getElementById('globalSearch');
  const actionsContainer = document.querySelector('.topbar-actions');
  if (searchInput) {
    searchInput.value = '';
    searchInput.placeholder = cfg.searchPlaceholderKey ? t(cfg.searchPlaceholderKey) : t('topbar.search');
  }
  if (actionsContainer) actionsContainer.innerHTML = cfg.actions();
  if (mod === 'crontab') {
    renderCron();
    updateModuleStatusBar('crontab');
  }
  if (mod === 'services') {
    renderServices();
    updateModuleStatusBar('services');
  }
  // 移动端导航完成后自动关闭侧边栏
  if (window.innerWidth <= 680) {
    document.getElementById('sidebar').classList.remove('mobile-open');
  }
}

// 顶栏统一搜索入口：按当前模块记录分发（模块配置见 js/config.js）
function handleModuleSearch(v) {
  const cfg = MODULES[currentModule];
  if (cfg && typeof cfg.searchHandler === 'function') cfg.searchHandler(v);
}

// ════════ 响应式 ════════
function checkMobile() {
  const w = window.innerWidth;
  const btn = document.getElementById('menuToggle');
  const sidebar = document.getElementById('sidebar');
  if (sidebar && w > 680) {
    const savedCollapsed = localStorage.getItem('launcherSidebarCollapsed') === 'true';
    sidebar.classList.toggle('collapsed', savedCollapsed);
  }
  syncSidebarLayout();
  if (btn) btn.style.display = w <= 680 ? 'flex' : 'none';
  // 移动端切换页面后自动收起菜单，避免菜单遮挡内容
  if (w > 680) {
    document.getElementById('sidebar').classList.remove('mobile-open');
  }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('mobile-open');
}
