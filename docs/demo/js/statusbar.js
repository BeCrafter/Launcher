// ════════ 底部状态栏 ════════
// 各模块的状态栏展示配置在 js/config.js 的 MODULES[mod].statusbar 中，此处只负责渲染。

// ════════ 渲染 Agents ════════
function updateLaunchStatusBar() {
  const total = agentData.length;
  const running = agentData.filter(a => a.status === 'running').length;
  const loaded = agentData.filter(a => a.status === 'loaded').length;
  const unloaded = agentData.filter(a => a.status === 'stopped').length;
  updateModuleStatusBar('agents', {
    total,
    running,
    loaded,
    unloaded
  });
}

function updateModuleStatusBar(module = 'agents', data = {}) {
  const left = document.getElementById('moduleStatusLeft');
  const right = document.getElementById('moduleStatusRight');
  const statusBar = document.getElementById('launchStatusBar');
  if (!left || !right || !statusBar) return;
  statusBar.classList.remove('hidden');
  const mod = MODULES[module] || MODULES.agents;
  const config = typeof mod.statusbar === 'function' ? mod.statusbar(data) : mod.statusbar;
  if (!config) return;
  left.innerHTML = `
    <div class="launch-status-summary">
      <i class="fa-solid ${config.summaryIcon}"></i>
      <span>${config.summary}</span>
    </div>
    <div class="launch-status-divider"></div>
    ${config.items.map(item => `<div class="launch-status-item">${item}</div>`).join('')}
  `;
  right.innerHTML = `
    <div class="launch-status-path">
      <i class="${config.pathIcon}"></i>
      ${
        config.pathHref
          ? `<a class="launch-status-link" href="${config.pathHref}" target="_blank" rel="noopener noreferrer" title="打开 GitHub 仓库">${config.path}</a>`
          : `<span>${config.path}</span>`
      }
    </div>
    <div class="launch-status-monitor">
      <i class="fa-solid fa-circle"></i>
      <span>${config.monitor}</span>
    </div>
  `;
}

// 仅当设置页可见时，刷新底部状态栏中与主题 / 语言相关的展示
function refreshSettingsStatusBar() {
  const settingsView = document.getElementById('view-settings');
  if (settingsView && settingsView.style.display === 'flex') {
    updateModuleStatusBar('settings');
  }
}
