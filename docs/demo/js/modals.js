// ════════ 模态框 ════════

// plist XML 轻量解析：提取 Label 与（Program > ProgramArguments[0]）
function parsePlistXml(xml) {
  if (!xml || !xml.includes('<plist')) return null;
  const pick = (key) => {
    const m = xml.match(new RegExp(`<key>${key}<\\/key>\\s*<string>([^<]+)<\\/string>`));
    return m ? m[1].trim() : '';
  };
  const label = pick('Label');
  const program = pick('Program') || (() => {
    const m = xml.match(/<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/);
    return m ? m[1].trim() : '';
  })();
  return { label, program };
}

// 新建 Agent：按 scope 直接创建草稿并打开抽屉编辑器（无需中间弹窗，其余字段在抽屉内编辑）
function newAgentWithScope(scope) {
  const prefix = localStorage.getItem('launcher_labelPrefix') || 'com.user.';
  let label = prefix + 'taskname';
  // 与现有任务避免占位 label 重复
  let idx = 1;
  while (agentData.some(a => a.id === label)) label = prefix + 'taskname.' + (idx++);
  openAgentDraft({
    label,
    program: '',
    scope: scope || 'user',
    runAtLoad: true
  });
}

function showNewCronModal() {
  document.getElementById('newCronCmd').value = '';
  document.getElementById('newCronDesc').value = '';
  applyNewCronPreset('0 9 * * *', t('cron.preset.daily9Desc'), document.querySelector('#newCronPresets .cron-preset-chip.active') || document.querySelector('#newCronPresets .cron-preset-chip:nth-child(3)'));
  openModal('newCronModal');
}

function applyNewCronPreset(expr, desc, btn) {
  const parts = expr.split(' ');
  if (parts.length === 5) {
    document.getElementById('newCronMin').value = parts[0];
    document.getElementById('newCronHour').value = parts[1];
    document.getElementById('newCronDom').value = parts[2];
    document.getElementById('newCronMon').value = parts[3];
    document.getElementById('newCronDow').value = parts[4];
  }
  document.getElementById('newCronExprCode').textContent = expr;
  document.getElementById('newCronExprDesc').textContent = desc || parseCronExpr(expr);
  if (btn) {
    const chips = document.querySelectorAll('#newCronPresets .cron-preset-chip');
    chips.forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
  }
}

function updateNewCronExpr() {
  const getF = fid => (document.getElementById(fid) || {}).value || '*';
  const expr = [getF('newCronMin'), getF('newCronHour'), getF('newCronDom'), getF('newCronMon'), getF('newCronDow')].join(' ');
  document.getElementById('newCronExprCode').textContent = expr;
  document.getElementById('newCronExprDesc').textContent = parseCronExpr(expr);
  document.querySelectorAll('#newCronPresets .cron-preset-chip').forEach(c => c.classList.remove('active'));
}

function createCronJob() {
  const cmd = document.getElementById('newCronCmd').value.trim();
  if (!cmd) {
    showToast(t('toast.requireCommand'), '#f87171', 'fa-circle-exclamation');
    return;
  }
  const getF = fid => (document.getElementById(fid) || {}).value || '*';
  const expr = [getF('newCronMin'), getF('newCronHour'), getF('newCronDom'), getF('newCronMon'), getF('newCronDow')].join(' ');
  const desc = document.getElementById('newCronDesc').value.trim() || parseCronExpr(expr);
  const isSystem = document.getElementById('newCronScope').value === 'system';
  const newJob = {
    id: 'c' + Date.now(),
    user: isSystem ? 'root' : 'user',
    expr: expr,
    cmd: cmd,
    desc: desc,
    enabled: true,
    system: isSystem
  };
  cronData.unshift(newJob);
  renderCron();
  // 同步侧边栏任务计数
  const cronNavItem = document.querySelector('.nav-item:nth-child(3) .nav-badge');
  if (cronNavItem) cronNavItem.textContent = cronData.length;
  closeModal('newCronModal');
  showToast(t('toast.cronAdded'), '#4ade80', 'fa-check');
}

function showImportModal() {
  openModal('importModal');
  // 剪贴板含 plist 时自动预填粘贴区（权限受限时静默降级）
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(text => {
      const area = document.getElementById('import_xml');
      if (area && text && text.includes('<plist') && !area.value) area.value = text;
    }).catch(() => {});
  }
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

function closeModalBg(e, id) {
  if (e.target.id === id) closeModal(id);
}

// 新建/导入的统一落点：创建草稿记录 → 打开抽屉编辑器（XML 模式时原文带入 XML tab）
function openAgentDraft({ label, program, scope, runAtLoad, xml }) {
  const newAgent = {
    id: label,
    label,
    desc: '',
    status: 'stopped',
    pid: null,
    uptime: null,
    scope: scope || 'user',
    tags: [],
    program: program || '',
    exitCode: null,
    restarts: 0
  };
  agentData.unshift(newAgent);
  selectedAgent = newAgent;
  closeModal('importModal');
  openEditFloat(label);
  // 草稿未保存：顶栏操作（加载/启用/立即运行）禁用，状态显示「未保存草稿」
  drawerAgentState.isDraft = true;
  updateOpsBar();
  if (xml) {
    const xmlTa = document.getElementById('ef_xmlEditor');
    xmlTa.value = xml;
    xmlTa.dispatchEvent(new Event('input')); // 触发高亮渲染
  }
  renderAgents(activeFilter || 'all', (document.getElementById('globalSearch') || {}).value || '');
  showToast(fmt(t('modal.newAgent.createdOpen'), { L: label }), '#a78bfa', 'fa-wand-magic-sparkles');
}

function doImport() {
  const xmlRaw = (document.getElementById('import_xml').value || '').trim();
  if (!xmlRaw) {
    showToast(t('toast.requireLabel'), '#f87171', 'fa-circle-exclamation');
    return;
  }
  const parsed = parsePlistXml(xmlRaw) || {};
  let label = parsed.label || ('com.user.imported');
  let idx = 1;
  while (agentData.some(a => a.id === label)) label = 'com.user.imported.' + (idx++);
  openAgentDraft({
    label,
    program: parsed.program || '',
    scope: 'user',
    runAtLoad: false,
    xml: xmlRaw
  });
}
