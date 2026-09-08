// ════════ 实时日志 / 响应式 / 初始化 ════════
let liveIdx = 0;
setInterval(() => {
  const [t, m] = liveLogs[liveIdx % liveLogs.length];
  addLogLine(t, m);
  liveIdx++;
}, 4500);

const layoutResizeObserver = new ResizeObserver(() => {
  syncSidebarLayout();
});
const observedMainContent = document.querySelector('.main-content');
if (observedMainContent) {
  layoutResizeObserver.observe(observedMainContent);
}
window.addEventListener('resize', () => {
  checkMobile();
  syncSidebarLayout();
});
checkMobile();
syncSidebarLayout();
// 初始化侧边栏状态：设置页默认折叠，其余页面保留用户上次选择
const savedSidebarCollapsed = localStorage.getItem('launcherSidebarCollapsed') === 'true';
const currentSidebar = document.getElementById('sidebar');
if (currentSidebar && savedSidebarCollapsed && window.innerWidth > 680) {
  currentSidebar.classList.add('collapsed');
}
syncSidebarLayout();

// ════════ 初始化 ════════
// 核心渲染放在最前：即使下方 mermaid 等外部资源加载失败，主界面也能正常显示，
// 避免“打开时右侧为空、点击全部按钮后才恢复”的问题。
// 先做一次架构初判（设置页状态栏展示用），再用 Client Hints 异步精确化。
_detectedArch = detectArch();
navigator.userAgentData?.getHighEntropyValues(['architecture', 'bitness'])
  .then(h => {
    if (h?.architecture) {
      const arch = h.architecture; // e.g. 'arm' / 'x86'
      const bits = h.bitness ? ' ' + h.bitness : '';
      _detectedArch = /^arm/i.test(arch)
        ? 'Apple Silicon (arm64)'
        : /^x86/i.test(arch)
          ? 'Intel (x86_64)'
          : arch + bits;
      refreshSettingsStatusBar();
    }
  })
  .catch(() => {});
renderAgents('all', '');
updateLaunchStatusBar();
updateModuleStatusBar('agents');
loadSettings();

// ════════ Mermaid（仅用于装饰性架构图，加载失败不影响主界面） ════════
if (typeof mermaid !== 'undefined') {
  try {
    mermaid.initialize({
      startOnLoad: true,
      theme: 'dark',
      themeVariables: {
        primaryColor: '#2a2a3e',
        primaryTextColor: '#e2e2f0',
        primaryBorderColor: '#7c6af4',
        lineColor: '#7c6af4',
        secondaryColor: '#1e1e2e',
        background: '#1e1e2e',
        mainBkg: '#2a2a3e',
        nodeBorder: '#7c6af4',
        clusterBkg: '#1e1e2e',
        titleColor: '#e2e2f0',
        edgeLabelBackground: '#2a2a3e',
        fontFamily: 'Noto Sans SC,sans-serif',
        fontSize: '12px',
      },
      flowchart: {
        curve: 'basis',
        htmlLabels: true
      },
    });
  } catch (e) {
    console.warn('Mermaid 初始化失败，已忽略', e);
  }
}

// ── Agents 顶部过滤栏统计（由 mock 数据驱动）──
updateAgentFilterCounts();

// ── 抽屉初始值填充（编辑表单/状态/日志/XML）──
populateDrawerDefaults();

// ── XML 编辑器高亮初始化（导入弹窗 + 抽屉 XML tab）──
initXmlHighlight('import_xml');
initXmlHighlight('ef_xmlEditor');

// ── 设置页页脚 / 关于页版本号（由 mock 数据驱动）──
fillSettingsMeta();
