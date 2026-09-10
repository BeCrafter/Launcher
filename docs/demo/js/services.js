// ════════ TCP Services 视图 ════════
// 数据来源：lsof -iTCP -sTCP:LISTEN（MOCK 提供 COMMAND/PID/USER/NAME 列，见 data.js）。
// 分组依据 = 分类管线（简化版，对齐阶段 3 的 8-Resolver pipeline + 开源 classifier 用例）：
//   ① Brew Resolver：lsof COMMAND ∈ `brew services list` 清单 → 'brew'
//   ② 常规 Resolver：COMMAND 映射表（node → 'node'）
//   ③ 兜底 generic 'process'
// 布局：过滤 chips（全部/Homebrew/Node.js/进程）+ 按类型分组渲染（groupBlock，与 agents 同构）；
// 操作：Open / Copy / Kill（Kill 走危险二次确认，与系统级提权体系一致）
let activeSvcFilter = 'all';

const BREW_MANAGED = new Set(MOCK_DATA.brewServices);
const COMMAND_TYPES = { node: 'node' };

function classifySvc(s) {
  if (BREW_MANAGED.has(s.command)) return 'brew';
  if (COMMAND_TYPES[s.command]) return COMMAND_TYPES[s.command];
  return 'process';
}

const SVC_GROUP_META = {
  node: { icon: 'fa-brands fa-node-js', color: 'var(--blue)', clsKey: 'svc.cls.node' },
  brew: { icon: 'fa-solid fa-beer-mug-empty', color: 'var(--brew)', clsKey: 'svc.cls.brew' },
  process: { icon: 'fa-solid fa-terminal', color: 'var(--yellow)', clsKey: 'svc.cls.process' }
};

function svcCardHtml(s) {
  const type = classifySvc(s);
  const icon = SVC_GROUP_META[type].icon;
  const metaHtml = [
    tagChip(t('svc.type.' + type), type === 'brew' ? 'brew' : 'purple', icon, undefined, fmt(t(SVC_GROUP_META[type].clsKey), { C: s.command })),
    `<span class="tag blue" style="font-family:'SF Mono',Menlo,monospace;">PID ${s.pid}</span>`,
    `<span class="tag cyan" style="font-family:'SF Mono',Menlo,monospace;">${s.addr}:${s.port} ${s.proto || ''}</span>`,
    `<span class="tag dim"><i class="fa-regular fa-clock" style="margin-right:2px;"></i>${s.uptime}</span>`
  ].join('');
  const actionsHtml = [
    actBtn('fa-solid fa-arrow-up-right-from-square', { title: t('svc.open'), onclick: `showToast(fmt(t('toast.openingPort'), { P: ${s.port} }),'#60a5fa','fa-arrow-up-right-from-square')` }),
    actBtn('fa-solid fa-copy', { title: t('common.copy'), onclick: `copyPort(${s.port})` }),
    actBtn('fa-solid fa-stop', { cls: 'red', title: t('common.kill'), onclick: `killSvc('${s.id}','${s.name}')` })
  ].join('');
  return svcCard({ id: 'svc_' + s.id, name: s.name, port: s.port, cmd: s.cmd, metaHtml, actionsHtml });
}

function renderServices(filter = activeSvcFilter) {
  const c = document.getElementById('svcList');
  const list = svcData.filter(s => {
    const type = classifySvc(s);
    if (filter === 'brew') return type === 'brew';
    if (filter === 'node') return type === 'node';
    if (filter === 'process') return type === 'process';
    return true;
  });
  const groups = { node: [], brew: [], process: [] };
  list.forEach(s => {
    groups[classifySvc(s)].push(s);
  });
  let html = '';
  ['node', 'brew', 'process'].forEach(k => {
    const items = groups[k];
    if (!items.length) return;
    const meta = SVC_GROUP_META[k];
    html += groupBlock({
      id: 'svcgrp_' + k,
      icon: `fa-solid ${meta.icon}`,
      color: meta.color,
      label: t('svc.type.' + k),
      count: items.length,
      labelTitle: t(meta.clsKey + '.group')
    }, items.map(svcCardHtml).join(''));
  });
  if (!list.length) html = emptyState('fa-solid fa-network-wired', t('svc.empty'));
  c.innerHTML = html;
  const listenEl = document.getElementById('svcListeningCount');
  const totalEl = document.getElementById('svcTotalCount');
  if (listenEl) listenEl.textContent = svcData.filter(s => s.status === 'running').length;
  if (totalEl) totalEl.textContent = svcData.length;
  updateModuleStatusBar('services');
}

function filterServices(f, btn) {
  activeSvcFilter = f;
  document.querySelectorAll('#svcFilterBar .chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderServices(f);
}

function killSvc(id, name) {
  const svc = svcData.find(x => x.id === id);
  if (!svc) return;
  confirmDangerousAction({ detail: fmt(t('svc.killConfirm'), { N: name, P: svc.pid }) }).then(ok => {
    if (!ok) return;
    showToast(fmt(t('toast.killedSvc'), { N: name }), '#f87171', 'fa-stop');
  });
}

function copyPort(port) {
  showToast(fmt(t('toast.copiedPort'), { P: port }), '#22d3ee', 'fa-copy');
}
