// ════════ 模态框 ════════

// ════════ 模态框 ════════
function showNewModal() {
  openModal('newModal');
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

function createAgent() {
  const lbl = document.getElementById('new_label').value.trim();
  if (!lbl) {
    showToast(t('toast.requireLabel'), '#f87171', 'fa-exclamation-circle');
    return;
  }
  closeModal('newModal');
  showToast(fmt(t('toast.agentCreated'), { L: lbl }), '#4ade80', 'fa-plus');
}

function doImport() {
  closeModal('importModal');
  showToast(t('toast.plistImported'), '#22d3ee', 'fa-file-import');
}
