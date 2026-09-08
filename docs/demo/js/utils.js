// ════════════ 通用工具 ════════════
// 在新标签页打开外部链接（target=_blank + rel=noopener）
function openExternal(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

// 系统架构（运行时检测，Client Hints 异步精确化）
let _detectedArch = 'arm64 / x86_64 通用';

function archLabel() {
  return _detectedArch;
}

function detectArch() {
  const ua = navigator.userAgent || '';
  if (/aarch64|arm64|arm/i.test(ua)) return 'Apple Silicon (arm64)';
  if (/x86_64|amd64/i.test(ua)) return 'Intel (x86_64)';
  return 'arm64 / x86_64 通用';
}

// 读取当前主题 / 语言的展示名，供设置页状态栏使用
function themeLabel() {
  const theme = localStorage.getItem('launcherTheme') || 'system';
  const map = { system: 'settings.theme.system', light: 'settings.theme.light', dark: 'settings.theme.dark' };
  return map[theme] ? t(map[theme]) : theme;
}

function languageLabel() {
  const lang = localStorage.getItem('launcherLanguage') || 'zh-CN';
  return lang === 'en-US' ? 'English' : t('common.chinese');
}

function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n) + '…' : s;
}

function toggleGroupBlock(gid, hdr) {
  const grid = document.getElementById(gid);
  const chev = hdr.querySelector('.group-block-chevron');
  if (!grid) return;
  const isOpen = grid.style.display !== 'none';
  grid.style.display = isOpen ? 'none' : '';
  if (chev) chev.classList.toggle('open', !isOpen);
}

function toggleRowExpand(id, e) {
  e && e.stopPropagation();
  // 浮层互斥：展开本面板前收起其他已开面板（cron 面板注册的 closeCronPanels）
  if (typeof closeCronPanels === 'function') closeCronPanels('exp_' + id);
  const exp = document.getElementById('exp_' + id);
  const chev = document.getElementById('chev_' + id);
  if (!exp) return;
  exp.classList.toggle('open');
  if (chev) chev.classList.toggle('open', exp.classList.contains('open'));
}

let toastTimer = null;

function showToast(msg, color, icon) {
  const toast = document.getElementById('toast');
  const ic = document.getElementById('toastIcon');
  const mc = document.getElementById('toastMsg');
  const isLight = document.body.classList.contains('light-theme');
  // 浅色主题下调暗 toast 用色，避免白底上过于刺眼；不认识的色值原样透传
  const map = {
    '#60a5fa': isLight ? '#3d7fd6' : '#6aa7f0',
    '#4ade80': isLight ? '#1f9d6b' : '#3ecf8e',
    '#22d3ee': isLight ? '#1f9bb3' : '#45cbe0',
    '#f87171': isLight ? '#d75a5a' : '#ef8080',
    '#fbbf24': isLight ? '#c8932a' : '#eec04d',
    '#fb923c': isLight ? '#d9833a' : '#f09a55',
    '#f97316': isLight ? '#d97a32' : '#ef8840',
    '#a78bfa': isLight ? '#6a58e0' : '#a78bfa',
    '#8888aa': isLight ? '#a0a7bb' : '#8e8ea8'
  };
  ic.className = `fa-solid ${icon}`;
  ic.style.color = map[color] || color || (isLight ? '#1f9d6b' : 'var(--green)');
  mc.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
